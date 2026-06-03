"""Billing gateway — FastAPI dependency factory.

Usage:
    @router.post("/...")
    async def my_endpoint(ctx: MeterContext = Depends(metered("cover_letter"))):
        llm = get_llm("cover_letter", collector=ctx.collector)
        try:
            result = do_work(llm)
            ctx.settle_success()
            return result
        except Exception:
            ctx.settle_failure()
            raise

For background tasks (job_analysis) pass ctx.ref and ctx.user_id into the
background function and call settle_success/settle_failure from there using
a fresh DB session (see api/routers/jobs.py).

charge=False: enforces burst + upload/pbuild caps but never touches credits.
              Still writes a UsageEvent with credits_charged=0.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import SessionLocal, get_db
from ..models import User, Plan
from engine.usage import UsageCollector
from .ledger import (
    ESTIMATED_CREDITS,
    InsufficientCredits,
    refund,
    reserve,
    write_usage_event,
)
from .limits import WindowTracker, enforce_rate_limits
from .subscriptions import get_or_create_subscription


@dataclass
class MeterContext:
    """Passed to endpoints after the gateway checks pass.

    Carries everything needed to settle (or refund) the task.
    """

    user_id: str
    task_type: str
    ref: str
    charge: bool
    credits_reserved: int
    collector: UsageCollector = field(default_factory=UsageCollector)
    # Internal — used by settle helpers.
    _db_factory: object = field(default=None, repr=False)
    _tracker: WindowTracker = field(default_factory=WindowTracker, repr=False)

    # ── Inline settle helpers (synchronous endpoints) ─────────────────────────

    def settle_success(self) -> None:
        """Call after successful inline (synchronous) task completion."""
        db = SessionLocal()
        try:
            write_usage_event(
                db,
                user_id=self.user_id,
                task_type=self.task_type,
                ref=self.ref,
                collector=self.collector,
                credits_charged=self.credits_reserved,
                failed=False,
            )
        finally:
            db.close()

    def settle_failure(self) -> None:
        """Call in the except-block of an inline endpoint on any exception."""
        db = SessionLocal()
        try:
            if self.charge and self.credits_reserved > 0:
                refund(db, self.user_id, self.task_type, self.ref)
            self._tracker.rollback(db, self.user_id)
            write_usage_event(
                db,
                user_id=self.user_id,
                task_type=self.task_type,
                ref=self.ref,
                collector=self.collector,
                credits_charged=0,
                failed=True,
            )
        finally:
            db.close()


def _insufficient_credits_error(needed: int, balance: int) -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={
            "detail": "Insufficient credits",
            "needed": needed,
            "balance": balance,
            "upgrade_url": "/billing",
            "topup_url": "/billing/topup",
        },
    )


def _past_due_error() -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={
            "detail": "Your subscription payment is past due. Please update your payment method.",
            "portal_url": "/billing/portal",
        },
    )


def metered(task_type: str, charge: bool = True):
    """FastAPI dependency factory — wrap any credit-consuming endpoint with this.

    Parameters
    ----------
    task_type : str
        One of the keys in ESTIMATED_CREDITS (e.g. 'job_analysis', 'cover_letter').
    charge : bool
        True  = reserve credits + enforce all rate windows.
        False = enforce burst + type-specific caps only; no credit deduction.
    """

    def dep(
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> MeterContext:
        sub = get_or_create_subscription(db, user.id)

        if sub.status == "past_due":
            raise _past_due_error()

        plan: Plan = sub.plan

        tracker = WindowTracker()

        # Enforce rate limits (raises 429 on breach; increments tracked windows).
        enforce_rate_limits(db, user.id, plan, task_type, tracker)

        # Reserve credits (raises 402 on insufficient balance).
        credits_reserved = 0
        if charge:
            try:
                ref = str(uuid.uuid4())
                credits_reserved = reserve(db, user.id, task_type, ref)
            except InsufficientCredits as e:
                tracker.rollback(db, user.id)
                raise _insufficient_credits_error(e.needed, e.balance)
        else:
            ref = str(uuid.uuid4())  # still need a ref for UsageEvent

        return MeterContext(
            user_id=user.id,
            task_type=task_type,
            ref=ref,
            charge=charge,
            credits_reserved=credits_reserved,
            collector=UsageCollector(),
            _tracker=tracker,
        )

    return dep


# ── Background-task settle helpers (called from jobs.py) ─────────────────────
# These open their own DB session because the request session is closed by the
# time background tasks run.

def bg_settle_success(
    user_id: str,
    task_type: str,
    ref: str,
    credits_reserved: int,
    collector: UsageCollector,
) -> None:
    """Write UsageEvent for a successful background task.
    The reservation stands — no additional debit needed.
    """
    db = SessionLocal()
    try:
        write_usage_event(
            db,
            user_id=user_id,
            task_type=task_type,
            ref=ref,
            collector=collector,
            credits_charged=credits_reserved,
            failed=False,
        )
    finally:
        db.close()


def bg_settle_failure(
    user_id: str,
    task_type: str,
    ref: str,
    tracker_keys: list[str],
    collector: UsageCollector,
) -> None:
    """Refund reservation and roll back rate windows for a failed background task."""
    db = SessionLocal()
    try:
        refund(db, user_id, task_type, ref)
        # Manually decrement the windows that were incremented at reservation time.
        from ..models import RateWindow
        for key in tracker_keys:
            row = db.query(RateWindow).filter(
                RateWindow.user_id == user_id,
                RateWindow.window_key == key,
            ).first()
            if row and row.count > 0:
                row.count -= 1
        db.commit()
        write_usage_event(
            db,
            user_id=user_id,
            task_type=task_type,
            ref=ref,
            collector=collector,
            credits_charged=0,
            failed=True,
        )
    finally:
        db.close()
