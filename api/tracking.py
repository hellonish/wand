"""
Lightweight event tracking helper.

Usage:
    from .tracking import track
    track(db, user_id="abc123", event="cover_letter_generated", meta={"mode": "formal"})

Never raises — all errors are swallowed so tracking never breaks user flow.
"""

from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session

from .models import AnalyticsEvent


def track(
    db: Session,
    user_id: Optional[str],
    event: str,
    meta: Optional[dict] = None,
) -> None:
    try:
        db.add(AnalyticsEvent(user_id=user_id, event=event, meta=meta))
        db.commit()
    except Exception:
        pass
