"""
Database Configuration
"""

import os
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
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("PRAGMA busy_timeout=5000"))
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

        profile_rows = conn.execute(text("PRAGMA table_info(user_profiles)")).fetchall()
        if profile_rows:
            profile_cols = {r[1] for r in profile_rows}
            if "discrepancy_result" not in profile_cols:
                conn.execute(text("ALTER TABLE user_profiles ADD COLUMN discrepancy_result JSON"))


def get_db():
    """Dependency for database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
