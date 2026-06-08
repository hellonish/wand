"""Billing gateway — usage logging only (BYOK mode).

metered() is a lightweight FastAPI dependency that creates a MeterContext
for usage tracking. No credits, no rate limits, no Stripe.
"""
from __future__ import annotations
import uuid
from dataclasses import dataclass, field
from fastapi import Depends
from ..auth import get_current_user
from ..database import SessionLocal
from ..models import User, UsageEvent
from engine.usage import UsageCollector


@dataclass
class MeterContext:
    user_id: str
    task_type: str
    ref: str
    collector: UsageCollector = field(default_factory=UsageCollector)

    def settle_success(self) -> None:
        _write_usage(self.user_id, self.task_type, self.ref, self.collector, failed=False)

    def settle_failure(self) -> None:
        _write_usage(self.user_id, self.task_type, self.ref, self.collector, failed=True)


def _write_usage(user_id: str, task_type: str, ref: str, collector: UsageCollector, failed: bool) -> None:
    db = SessionLocal()
    try:
        event = UsageEvent(
            user_id=user_id,
            task_type=task_type,
            provider=collector.provider if not collector.is_empty() else "unknown",
            model=collector.model if not collector.is_empty() else "unknown",
            input_tokens=collector.input_tokens,
            output_tokens=collector.output_tokens,
            raw_cost_usd=collector.cost_usd(),
            credits_charged=0,
            failed=failed,
            ref=ref,
        )
        db.add(event)
        db.commit()
    finally:
        db.close()


def metered(task_type: str):
    """FastAPI dependency — creates a MeterContext for usage tracking."""
    def dep(user: User = Depends(get_current_user)) -> MeterContext:
        return MeterContext(
            user_id=user.id,
            task_type=task_type,
            ref=str(uuid.uuid4()),
            collector=UsageCollector(),
        )
    return dep


def bg_settle_success(user_id: str, task_type: str, ref: str, collector: UsageCollector) -> None:
    _write_usage(user_id, task_type, ref, collector, failed=False)


def bg_settle_failure(user_id: str, task_type: str, ref: str, collector: UsageCollector) -> None:
    _write_usage(user_id, task_type, ref, collector, failed=True)
