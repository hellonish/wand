"""Subscription lifecycle helpers.

Responsibilities:
- Get or create a Subscription for a user (defaulting to Free plan).
- Lazy monthly credit reset for Free-plan users (no Stripe, no cron).
- The Stripe-driven reset for paid users lives in api/routers/billing.py (webhook handler).
"""

from __future__ import annotations

from datetime import datetime

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from ..models import Plan, Subscription, CreditLedger
from .ledger import grant, expire_grant


def get_free_plan(db: Session) -> Plan:
    plan = db.query(Plan).filter(Plan.code == "free").first()
    if not plan:
        raise RuntimeError("Free plan not found. Did seed_plans() run at startup?")
    return plan


def get_or_create_subscription(db: Session, user_id: str) -> Subscription:
    """Return the user's Subscription, creating a Free one if it doesn't exist.

    Also triggers a lazy monthly reset if the Free-plan period has expired.
    This is the only function that should be called from the gateway/auth layer
    to retrieve subscription state — do not query Subscription directly.
    """
    sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    if sub:
        _maybe_reset_free_period(db, sub)
        return sub

    # First-ever login after billing tables were added (or a net-new user).
    free_plan = get_free_plan(db)
    now = datetime.utcnow()
    period_end = now + relativedelta(months=1)

    sub = Subscription(
        user_id=user_id,
        plan_id=free_plan.id,
        status="active",
        current_period_start=now,
        current_period_end=period_end,
    )
    db.add(sub)
    db.flush()  # sub.id available before commit

    # Grant first month's credits. Ref is deterministic — safe to replay.
    grant_ref = f"free-grant:{user_id}:{now:%Y-%m}"
    grant(db, user_id, free_plan.monthly_credits, ref=grant_ref, kind="grant")
    db.commit()
    db.refresh(sub)
    return sub


def _maybe_reset_free_period(db: Session, sub: Subscription) -> None:
    """Lazy monthly reset for Free users — runs on every request that touches the sub.

    Only fires when:
    1. The plan is still Free (paid plans are reset by Stripe invoice.paid webhook).
    2. current_period_end is in the past.

    Steps:
    1. Expire unused monthly-grant credits (top-ups survive).
    2. Grant next month's credits.
    3. Advance current_period_start / current_period_end by 1 month.
    """
    if sub.status not in ("active", "trialing"):
        return
    plan = db.query(Plan).filter(Plan.id == sub.plan_id).first()
    if not plan or plan.code != "free":
        return  # paid plans are reset by Stripe
    if sub.current_period_end is None:
        return

    now = datetime.utcnow()
    if now < sub.current_period_end:
        return  # still within the period — nothing to reset

    # Expire the previous grant's unused portion.
    expire_ref = f"free-expire:{sub.user_id}:{sub.current_period_end:%Y-%m}"
    expire_grant(db, sub.user_id, ref=expire_ref)

    # Advance period (may be multiple months behind if user was inactive).
    new_start = sub.current_period_end
    new_end = new_start + relativedelta(months=1)
    while new_end < now:
        new_start = new_end
        new_end = new_start + relativedelta(months=1)

    # Grant next month.
    grant_ref = f"free-grant:{sub.user_id}:{new_start:%Y-%m}"
    grant(db, sub.user_id, plan.monthly_credits, ref=grant_ref, kind="grant")

    sub.current_period_start = new_start
    sub.current_period_end = new_end
    db.commit()
