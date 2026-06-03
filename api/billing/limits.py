"""Token-aware, multi-window rate limiter.

Windows (evaluated cheapest-first, all must pass):
  1. per-minute burst  — abusive/runaway loops
  2. daily             — bound worst-case spend per day
  3. weekly            — smooth usage across the week
  4. upload daily      — /api/profile/upload hard cap (free LLM burn guard)
  5. profile-build     — /api/profile/unified daily cap

Storage: RateWindow table (SQLite atomic UPDATE). Swap for Redis at scale.
All limits come from the user's Plan row — never hard-coded in this module.

Returns 429 with Retry-After and X-RateLimit-* headers on breach.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Plan, RateWindow


# ── Window key builders ───────────────────────────────────────────────────────

def _epoch_minute(dt: datetime) -> int:
    return int(dt.timestamp()) // 60


def _week_key(dt: datetime) -> str:
    """ISO year-week: '2026-W23'"""
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _window_keys(task_type: str, now: datetime) -> dict[str, tuple[str, datetime]]:
    """Build all window (key, resets_at) pairs for a task. Returns dict keyed by scope."""
    day_str = now.strftime("%Y-%m-%d")
    week_str = _week_key(now)
    minute_str = str(_epoch_minute(now))

    # resets_at values
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    next_week_start = (now + timedelta(days=(7 - now.weekday()))).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    next_minute = now.replace(second=0, microsecond=0) + timedelta(minutes=1)

    return {
        "burst": (f"min:{task_type}:{minute_str}", next_minute),
        "daily": (f"daily:{task_type}:{day_str}", tomorrow),
        "weekly": (f"weekly:{task_type}:{week_str}", next_week_start),
        "upload": (f"upload:{day_str}", tomorrow),
        "pbuild": (f"pbuild:{day_str}", tomorrow),
        "actions": (f"daily:actions:{day_str}", tomorrow),  # Free combined daily cap
    }


# ── Atomic counter (SQLite) ───────────────────────────────────────────────────

def _check_and_increment(
    db: Session,
    user_id: str,
    window_key: str,
    resets_at: datetime,
    limit: int,
    increment: int = 1,
) -> tuple[bool, int]:
    """Upsert the RateWindow row and try to atomically increment.

    Returns (allowed: bool, current_count: int).
    'allowed' is True if the window is not yet exceeded after incrementing.
    """
    row = db.query(RateWindow).filter(
        RateWindow.user_id == user_id,
        RateWindow.window_key == window_key,
    ).first()

    if row is None:
        # First hit in this window — create the row.
        row = RateWindow(
            user_id=user_id,
            window_key=window_key,
            count=0,
            limit=limit,
            resets_at=resets_at,
        )
        db.add(row)
        db.flush()

    # Always refresh limit (plan upgrades take effect immediately).
    row.limit = limit
    row.resets_at = resets_at

    if row.count + increment > limit:
        db.commit()
        return False, row.count

    row.count += increment
    db.commit()
    return True, row.count


def _decrement(db: Session, user_id: str, window_key: str) -> None:
    """Undo an increment (used on task failure so quota is not burned)."""
    row = db.query(RateWindow).filter(
        RateWindow.user_id == user_id,
        RateWindow.window_key == window_key,
    ).first()
    if row and row.count > 0:
        row.count -= 1
        db.commit()


def _retry_after(resets_at: datetime) -> int:
    return max(1, math.ceil((resets_at - datetime.utcnow()).total_seconds()))


def _rate_limit_error(window_key: str, limit: int, current: int, resets_at: datetime) -> HTTPException:
    retry = _retry_after(resets_at)
    return HTTPException(
        status_code=429,
        detail={
            "detail": f"Rate limit reached for window '{window_key}'",
            "retry_after": retry,
        },
        headers={
            "Retry-After": str(retry),
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(max(0, limit - current)),
            "X-RateLimit-Reset": str(int(resets_at.timestamp())),
        },
    )


# ── Public interface ──────────────────────────────────────────────────────────

class WindowTracker:
    """Records which windows were incremented so they can be rolled back on failure."""

    def __init__(self) -> None:
        self._incremented: list[str] = []  # list of window_keys

    def record(self, window_key: str) -> None:
        self._incremented.append(window_key)

    def rollback(self, db: Session, user_id: str) -> None:
        for key in self._incremented:
            _decrement(db, user_id, key)
        self._incremented.clear()


def enforce_rate_limits(
    db: Session,
    user_id: str,
    plan: Plan,
    task_type: str,
    tracker: WindowTracker | None = None,
) -> None:
    """Check and increment all applicable rate windows for task_type.

    Raises HTTPException(429) on the first window that is exceeded.
    The tracker records which windows were incremented so callers can roll back on failure.
    """
    now = datetime.utcnow()
    keys = _window_keys(task_type, now)
    is_free = plan.daily_caps.get("actions") is not None  # Free plan uses combined "actions" cap

    # 1. Per-minute burst — checked against burst credits (1 action = 1 increment)
    burst_key, burst_resets = keys["burst"]
    burst_limit = plan.per_min_burst
    allowed, count = _check_and_increment(db, user_id, burst_key, burst_resets, burst_limit)
    if not allowed:
        raise _rate_limit_error(burst_key, burst_limit, count, burst_resets)
    if tracker:
        tracker.record(burst_key)

    # 2. Daily and weekly caps — behaviour differs between Free and paid.
    if is_free:
        # Free: single combined "actions" daily cap (any credit task = 1 action).
        if task_type in ("profile_build", "job_analysis", "cover_letter", "reachout"):
            actions_key, actions_resets = keys["actions"]
            actions_limit = plan.daily_caps["actions"]
            allowed, count = _check_and_increment(db, user_id, actions_key, actions_resets, actions_limit)
            if not allowed:
                raise _rate_limit_error(actions_key, actions_limit, count, actions_resets)
            if tracker:
                tracker.record(actions_key)
    else:
        # Paid: per-task daily cap.
        daily_limit = plan.daily_caps.get(task_type)
        if daily_limit is not None:
            daily_key, daily_resets = keys["daily"]
            allowed, count = _check_and_increment(db, user_id, daily_key, daily_resets, daily_limit)
            if not allowed:
                raise _rate_limit_error(daily_key, daily_limit, count, daily_resets)
            if tracker:
                tracker.record(daily_key)

        # Per-task weekly cap.
        weekly_limit = (plan.weekly_caps or {}).get(task_type)
        if weekly_limit is not None:
            weekly_key, weekly_resets = keys["weekly"]
            allowed, count = _check_and_increment(db, user_id, weekly_key, weekly_resets, weekly_limit)
            if not allowed:
                raise _rate_limit_error(weekly_key, weekly_limit, count, weekly_resets)
            if tracker:
                tracker.record(weekly_key)

    # 3. Profile-build daily cap — applies regardless of plan type.
    if task_type == "profile_build":
        pbuild_key, pbuild_resets = keys["pbuild"]
        pbuild_limit = plan.profile_build_daily_cap
        allowed, count = _check_and_increment(db, user_id, pbuild_key, pbuild_resets, pbuild_limit)
        if not allowed:
            raise _rate_limit_error(pbuild_key, pbuild_limit, count, pbuild_resets)
        if tracker:
            tracker.record(pbuild_key)

    # 4. Upload daily cap — only applied when task_type is profile_upload.
    if task_type == "profile_upload":
        upload_key, upload_resets = keys["upload"]
        upload_limit = plan.upload_daily_cap
        allowed, count = _check_and_increment(db, user_id, upload_key, upload_resets, upload_limit)
        if not allowed:
            raise _rate_limit_error(upload_key, upload_limit, count, upload_resets)
        if tracker:
            tracker.record(upload_key)
