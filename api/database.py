"""
Database Configuration
"""

import os
from datetime import datetime
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# Use SQLite for local dev, PostgreSQL for production
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "sqlite:///./wand.db"  # SQLite file in current directory
)

# SQLite needs check_same_thread=False
connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Enable WAL mode for SQLite so background tasks don't lock out all other requests
if "sqlite" in DATABASE_URL:
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
Base = declarative_base()


def ensure_sqlite_schema(bind_engine):
    """
    Apply lightweight SQLite upgrades for DBs created before new ORM columns existed.
    Base.metadata.create_all() creates tables but does not ALTER existing tables.
    """
    if "sqlite" not in str(bind_engine.url):
        return
    with bind_engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(cover_letters)")).fetchall()
        if not rows:
            return
        col_names = {r[1] for r in rows}
        if "custom_prompt" not in col_names:
            conn.execute(text("ALTER TABLE cover_letters ADD COLUMN custom_prompt TEXT"))

        rows = conn.execute(text("PRAGMA table_info(joblens_sessions)")).fetchall()
        if not rows:
            return
        col_names = {r[1] for r in rows}
        for column in ("profile_snapshot", "job_description", "reachout"):
            if column not in col_names:
                conn.execute(text(f"ALTER TABLE joblens_sessions ADD COLUMN {column} JSON"))
        if "jd_text_hash" not in col_names:
            conn.execute(text("ALTER TABLE joblens_sessions ADD COLUMN jd_text_hash VARCHAR(32)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_joblens_sessions_jd_text_hash ON joblens_sessions (jd_text_hash)"))

        rows = conn.execute(text("PRAGMA table_info(users)")).fetchall()
        if rows:
            col_names = {r[1] for r in rows}
            if "is_deleted" not in col_names:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0"))
            if "deleted_at" not in col_names:
                conn.execute(text("ALTER TABLE users ADD COLUMN deleted_at DATETIME"))
            if "onboarding_completed" not in col_names:
                conn.execute(text("ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT 0"))


def get_db():
    """Dependency for database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Plan seed data ─────────────────────────────────────────────────────────────

PLAN_SEED = [
    {
        "code": "free",
        "name": "Free",
        "price_cents": 0,
        "stripe_price_id": None,
        "monthly_credits": 132,
        # Free uses a single combined "actions" daily cap (any credit-consuming task = 1 action)
        "daily_caps": {"actions": 5},
        "weekly_caps": None,
        "profile_build_daily_cap": 1,
        "upload_daily_cap": 8,
        "per_min_burst": 30,
    },
    {
        "code": "starter",
        "name": "Starter",
        "price_cents": 599,                         # $5.99/month
        "stripe_price_id": os.getenv("STRIPE_PRICE_STARTER"),
        "monthly_credits": 242,                     # 1×30 + 15×12 + 8×4
        "daily_caps": {"job_analysis": 4, "cover_letter": 3},
        "weekly_caps": {"job_analysis": 10, "cover_letter": 6},
        "profile_build_daily_cap": 1,
        "upload_daily_cap": 8,
        "per_min_burst": 30,
    },
    {
        "code": "pro",
        "name": "Pro",
        "price_cents": 1499,                        # $14.99/month
        "stripe_price_id": os.getenv("STRIPE_PRICE_PRO"),
        "monthly_credits": 610,                     # 3×30 + 35×12 + 25×4
        "daily_caps": {"job_analysis": 7, "cover_letter": 5},
        "weekly_caps": {"job_analysis": 20, "cover_letter": 12},
        "profile_build_daily_cap": 2,
        "upload_daily_cap": 12,
        "per_min_burst": 60,
    },
    {
        "code": "max",
        "name": "Max",
        "price_cents": 2499,                        # $24.99/month
        "stripe_price_id": os.getenv("STRIPE_PRICE_MAX"),
        "monthly_credits": 1030,                    # 5×30 + 60×12 + 40×4
        "daily_caps": {"job_analysis": 15, "cover_letter": 10},
        "weekly_caps": {"job_analysis": 30, "cover_letter": 20},
        "profile_build_daily_cap": 3,
        "upload_daily_cap": 20,
        "per_min_burst": 120,
    },
]


def seed_plans(bind_engine) -> None:
    """Upsert the 4 Plan rows. Safe to call every startup (idempotent on code).

    Also handles the one-time rename: if a 'power' row exists (old name) and no 'max'
    row exists yet, it renames power → max in place so existing subscriptions keep
    their plan_id foreign key valid.
    """
    from .models import Plan  # local import avoids circular import at module load

    db = SessionLocal()
    try:
        # One-time migration: rename 'power' → 'max' if the old row still exists.
        power_row = db.query(Plan).filter(Plan.code == "power").first()
        max_row = db.query(Plan).filter(Plan.code == "max").first()
        if power_row and not max_row:
            power_row.code = "max"
            power_row.name = "Max"
            db.commit()

        for data in PLAN_SEED:
            existing = db.query(Plan).filter(Plan.code == data["code"]).first()
            if existing:
                # Refresh all fields — prices, credits, caps, and stripe_price_id
                # so a single restart picks up any change made here.
                existing.name = data["name"]
                existing.price_cents = data["price_cents"]
                existing.stripe_price_id = data["stripe_price_id"]
                existing.monthly_credits = data["monthly_credits"]
                existing.daily_caps = data["daily_caps"]
                existing.weekly_caps = data["weekly_caps"]
                existing.profile_build_daily_cap = data["profile_build_daily_cap"]
                existing.upload_daily_cap = data["upload_daily_cap"]
                existing.per_min_burst = data["per_min_burst"]
            else:
                db.add(Plan(**data))
        db.commit()
    finally:
        db.close()


def backfill_subscriptions(bind_engine) -> None:
    """Create a Free subscription + initial grant for every user that doesn't have one.

    Called once at startup after tables exist. Idempotent: users already having a
    Subscription row are skipped. Grant ref is deterministic so re-running is safe.
    """
    from .models import User, Plan, Subscription, CreditLedger  # local to avoid circular

    db = SessionLocal()
    try:
        free_plan = db.query(Plan).filter(Plan.code == "free").first()
        if not free_plan:
            return  # seed_plans hasn't run yet — shouldn't happen

        users_without_sub = (
            db.query(User)
            .outerjoin(Subscription, User.id == Subscription.user_id)
            .filter(Subscription.id.is_(None), User.is_deleted == False)
            .all()
        )

        now = datetime.utcnow()
        from dateutil.relativedelta import relativedelta

        for user in users_without_sub:
            period_end = now + relativedelta(months=1)
            sub = Subscription(
                user_id=user.id,
                plan_id=free_plan.id,
                status="active",
                current_period_start=now,
                current_period_end=period_end,
            )
            db.add(sub)
            db.flush()  # get sub.id

            grant_ref = f"free-grant:{user.id}:{now:%Y-%m}"
            already = db.query(CreditLedger).filter(
                CreditLedger.ref == grant_ref,
                CreditLedger.kind == "grant",
            ).first()
            if not already:
                db.add(CreditLedger(
                    user_id=user.id,
                    delta=free_plan.monthly_credits,
                    kind="grant",
                    ref=grant_ref,
                ))

        db.commit()
    finally:
        db.close()
