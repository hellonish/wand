"""
Analytics router — custom page-hit tracking.

POST /analytics/hit   — called by the frontend on every page navigation (public)
GET  /analytics/stats — returns aggregated stats (protected by ANALYTICS_SECRET)
"""

import hmac
import os
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from ..database import get_db
from ..limiter import limiter, _real_ip
from ..models import PageHit, AnalyticsEvent

router = APIRouter(prefix="/analytics", tags=["analytics"])

ANALYTICS_SECRET = os.getenv("ANALYTICS_SECRET", "")


# ---------------------------------------------------------------------------
# Public: record a hit
# ---------------------------------------------------------------------------

class HitPayload(BaseModel):
    """Typed, size-bounded payload for page-hit recording."""
    path: str = Field(default="/", max_length=2000)
    referer: str | None = Field(default=None, max_length=2000)


@router.post("/hit", status_code=204)
@limiter.limit("30/minute", override_defaults=False)
async def record_hit(
    request: Request,
    payload: HitPayload,
    db: Session = Depends(get_db),
):
    hit = PageHit(
        ip=_real_ip(request),
        path=payload.path,
        user_agent=request.headers.get("user-agent"),
        referer=payload.referer,
    )
    db.add(hit)
    db.commit()


# ---------------------------------------------------------------------------
# Protected: view stats
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_stats(
    secret: str = Query(...),
    days: int = Query(30),
    db: Session = Depends(get_db),
):
    if not ANALYTICS_SECRET or not hmac.compare_digest(secret, ANALYTICS_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")

    since = datetime.utcnow() - timedelta(days=days)

    total_hits = db.query(func.count(PageHit.id)).filter(PageHit.created_at >= since).scalar()
    unique_ips = db.query(func.count(func.distinct(PageHit.ip))).filter(PageHit.created_at >= since).scalar()

    top_pages = (
        db.query(PageHit.path, func.count(PageHit.id).label("hits"))
        .filter(PageHit.created_at >= since)
        .group_by(PageHit.path)
        .order_by(text("hits DESC"))
        .limit(20)
        .all()
    )

    hits_by_day = (
        db.query(
            func.strftime("%Y-%m-%d", PageHit.created_at).label("day"),
            func.count(PageHit.id).label("hits"),
        )
        .filter(PageHit.created_at >= since)
        .group_by(text("day"))
        .order_by(text("day"))
        .all()
    )

    top_ips = (
        db.query(PageHit.ip, func.count(PageHit.id).label("hits"))
        .filter(PageHit.created_at >= since)
        .group_by(PageHit.ip)
        .order_by(text("hits DESC"))
        .limit(20)
        .all()
    )

    all_time_total = db.query(func.count(PageHit.id)).scalar()
    all_time_unique = db.query(func.count(func.distinct(PageHit.ip))).scalar()

    # --- Product events ---
    events_by_name = (
        db.query(AnalyticsEvent.event, func.count(AnalyticsEvent.id).label("count"))
        .filter(AnalyticsEvent.created_at >= since)
        .group_by(AnalyticsEvent.event)
        .order_by(text("count DESC"))
        .all()
    )

    events_by_day = (
        db.query(
            func.strftime("%Y-%m-%d", AnalyticsEvent.created_at).label("day"),
            AnalyticsEvent.event,
            func.count(AnalyticsEvent.id).label("count"),
        )
        .filter(AnalyticsEvent.created_at >= since)
        .group_by(text("day"), AnalyticsEvent.event)
        .order_by(text("day"))
        .all()
    )

    unique_users_by_event = (
        db.query(AnalyticsEvent.event, func.count(func.distinct(AnalyticsEvent.user_id)).label("users"))
        .filter(AnalyticsEvent.created_at >= since)
        .group_by(AnalyticsEvent.event)
        .all()
    )

    all_time_events = (
        db.query(AnalyticsEvent.event, func.count(AnalyticsEvent.id).label("count"))
        .group_by(AnalyticsEvent.event)
        .order_by(text("count DESC"))
        .all()
    )

    return {
        "window_days": days,
        "all_time": {
            "total_hits": all_time_total,
            "unique_ips": all_time_unique,
            "events": {r.event: r.count for r in all_time_events},
        },
        "last_n_days": {
            "total_hits": total_hits,
            "unique_ips": unique_ips,
            "events": {r.event: r.count for r in events_by_name},
            "unique_users_per_event": {r.event: r.users for r in unique_users_by_event},
        },
        "top_pages": [{"path": r.path, "hits": r.hits} for r in top_pages],
        "hits_by_day": [{"day": r.day, "hits": r.hits} for r in hits_by_day],
        "events_by_day": [{"day": r.day, "event": r.event, "count": r.count} for r in events_by_day],
        "top_ips": [{"ip": r.ip, "hits": r.hits} for r in top_ips],
    }
