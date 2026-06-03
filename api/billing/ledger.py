"""Credit ledger operations.

The ledger is APPEND-ONLY. Balance = SUM(delta) WHERE user_id = ?.
Never update or delete a row. Every write carries a ref for idempotency:
if a (ref, kind) pair already exists, the write is a no-op.

Fixed per-task credit prices (user-facing, never computed from tokens):
  profile_build  = 30 credits  ($0.60 revenue @ $0.02/credit)
  job_analysis   = 12 credits  ($0.24 revenue)
  cover_letter   =  4 credits  ($0.08 revenue)
  reachout       =  6 credits  ($0.12 revenue)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models import CreditLedger, UsageEvent
from engine.usage import UsageCollector

# ── Constants ─────────────────────────────────────────────────────────────────

# Credit cost per task (fixed, user-facing).
ESTIMATED_CREDITS: dict[str, int] = {
    "profile_build": 30,
    "job_analysis": 12,
    "cover_letter": 4,
    "reachout": 6,
    # Free / burst-only tasks — kept here so the gateway can look them up.
    "job_analysis_retry": 0,
    "cover_letter_tone": 0,
    "profile_upload": 0,
}


# ── Exceptions ────────────────────────────────────────────────────────────────

class InsufficientCredits(Exception):
    """Raised when a user's balance is too low to cover a reservation."""

    def __init__(self, needed: int, balance: int) -> None:
        self.needed = needed
        self.balance = balance
        super().__init__(f"Need {needed} credits, have {balance}")


# ── Core ledger helpers ───────────────────────────────────────────────────────

def get_balance(db: Session, user_id: str) -> int:
    """Return the current credit balance (can be negative only if manually adjusted)."""
    result = (
        db.query(func.coalesce(func.sum(CreditLedger.delta), 0))
        .filter(CreditLedger.user_id == user_id)
        .scalar()
    )
    return int(result or 0)


def _append(
    db: Session,
    user_id: str,
    delta: int,
    kind: str,
    ref: str,
    task_type: str | None = None,
) -> CreditLedger | None:
    """Append a ledger row, idempotent on (ref, kind).

    Returns the new (or existing) row. Returns None only if the session fails
    to flush — callers should not ignore a None return in transaction-critical paths.
    """
    existing = (
        db.query(CreditLedger)
        .filter(CreditLedger.ref == ref, CreditLedger.kind == kind)
        .first()
    )
    if existing:
        return existing  # idempotent: already processed

    row = CreditLedger(
        user_id=user_id,
        delta=delta,
        kind=kind,
        ref=ref,
        task_type=task_type,
    )
    db.add(row)
    db.commit()
    return row


def reserve(db: Session, user_id: str, task_type: str, ref: str) -> int:
    """Debit estimated credits before the LLM task runs — atomically.

    Raises InsufficientCredits if balance < cost. The caller must catch this
    and return HTTP 402 — do not let it propagate as a 500.

    Concurrency: the balance check and the debit happen in a SINGLE conditional
    INSERT statement, so two parallel requests cannot both pass a stale balance
    read and overspend (TOCTOU). On SQLite the write-lock serialises the two
    statements; on Postgres we take a per-user row lock first so the subquery
    snapshot cannot be shared across concurrent transactions.
    """
    cost = ESTIMATED_CREDITS.get(task_type, 0)
    if cost == 0:
        return 0  # free task — no reservation

    dialect = db.bind.dialect.name if db.bind is not None else "sqlite"

    # Postgres MVCC: a bare conditional INSERT's subquery reads a snapshot that
    # two concurrent READ COMMITTED txns can share. Serialise per user with a
    # row lock. (No-op concept on SQLite, which already serialises writers.)
    if dialect == "postgresql":
        db.execute(
            text("SELECT 1 FROM users WHERE id = :uid FOR UPDATE"),
            {"uid": user_id},
        )

    # Atomic: insert the reserve row ONLY if the current balance still covers it.
    stmt = text(
        """
        INSERT INTO credit_ledger (id, user_id, delta, kind, ref, task_type, created_at)
        SELECT :id, :user_id, :neg_cost, 'reserve', :ref, :task_type, :now
        WHERE (
            SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = :user_id
        ) >= :cost
        """
    )
    result = db.execute(
        stmt,
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "neg_cost": -cost,
            "ref": ref,
            "task_type": task_type,
            "now": datetime.utcnow(),
            "cost": cost,
        },
    )
    db.commit()

    if result.rowcount == 0:
        # Condition failed → balance was insufficient. Re-read for an accurate report.
        raise InsufficientCredits(needed=cost, balance=get_balance(db, user_id))

    return cost


def refund(db: Session, user_id: str, task_type: str, ref: str) -> None:
    """Refund a reservation on task failure. Idempotent on ref."""
    cost = ESTIMATED_CREDITS.get(task_type, 0)
    if cost == 0:
        return  # nothing was reserved

    _append(db, user_id, +cost, "refund", ref, task_type)


def grant(
    db: Session,
    user_id: str,
    amount: int,
    ref: str,
    kind: str = "grant",
) -> None:
    """Credit a user's account. Used by Stripe webhook and Free lazy reset."""
    if amount <= 0:
        return
    _append(db, user_id, +amount, kind, ref)


def expire_grant(db: Session, user_id: str, ref: str) -> None:
    """Expire unused monthly-grant credits at period end (no rollover).

    Top-up credits (kind='topup') are NOT expired — only the monthly grant.
    The expired amount = current balance minus the sum of all outstanding topup credits.
    If that number is <= 0 there is nothing to expire.
    """
    total_balance = get_balance(db, user_id)
    topup_balance = int(
        db.query(func.coalesce(func.sum(CreditLedger.delta), 0))
        .filter(
            CreditLedger.user_id == user_id,
            CreditLedger.kind == "topup",
        )
        .scalar()
        or 0
    )
    expire_amount = total_balance - topup_balance
    if expire_amount <= 0:
        return
    _append(db, user_id, -expire_amount, "expire", ref)


# ── Usage event writer ────────────────────────────────────────────────────────

def write_usage_event(
    db: Session,
    user_id: str,
    task_type: str,
    ref: str,
    collector: UsageCollector | None,
    credits_charged: int,
    failed: bool = False,
) -> None:
    """Write one UsageEvent row capturing real token counts and cost.

    Always called — even for free tasks (credits_charged=0) and failures
    (failed=True, credits_charged=0). This is the margin analytics source.
    """
    input_tokens = 0
    output_tokens = 0
    raw_cost_usd = 0.0
    provider = "grok"
    model = "grok-3"

    if collector and not collector.is_empty():
        input_tokens = collector.input_tokens
        output_tokens = collector.output_tokens
        raw_cost_usd = collector.cost_usd()
        provider = collector.provider
        model = collector.model

    event = UsageEvent(
        user_id=user_id,
        task_type=task_type,
        provider=provider,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        raw_cost_usd=raw_cost_usd,
        credits_charged=0 if failed else credits_charged,
        failed=failed,
        ref=ref,
    )
    db.add(event)
    db.commit()


# ── Orphaned-reservation reconciliation ─────────────────────────────────────────

def sweep_orphaned_reservations(db: Session, older_than_minutes: int = 30) -> int:
    """Refund reservations that never settled (e.g. server crashed mid-task).

    A reservation is "settled" when write_usage_event wrote a UsageEvent for its
    ref — that happens on BOTH the success and failure paths. So a reserve row
    with no matching UsageEvent and no matching refund, older than the cutoff,
    is an orphan: the user was debited but the work never completed or recorded.

    Refunds are idempotent on (ref, kind='refund'), so re-running is safe.
    Returns the number of reservations refunded. Intended for startup + cron.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=older_than_minutes)

    settled_refs = db.query(UsageEvent.ref).filter(UsageEvent.ref.isnot(None))
    refunded_refs = db.query(CreditLedger.ref).filter(CreditLedger.kind == "refund")

    orphans = (
        db.query(CreditLedger)
        .filter(
            CreditLedger.kind == "reserve",
            CreditLedger.created_at < cutoff,
            CreditLedger.ref.notin_(settled_refs),
            CreditLedger.ref.notin_(refunded_refs),
        )
        .all()
    )

    count = 0
    for row in orphans:
        # refund() re-derives the cost from task_type and is idempotent on ref.
        refund(db, row.user_id, row.task_type or "", row.ref)
        count += 1

    return count
