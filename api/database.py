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


def _is_sqlite(bind_engine) -> bool:
    return "sqlite" in str(bind_engine.url)


def _table_column_names(conn, table: str, sqlite: bool) -> set[str] | None:
    """Return column names for an existing table, or None if the table does not exist."""
    if sqlite:
        rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        return None if not rows else {r[1] for r in rows}

    rows = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :table"
        ),
        {"table": table},
    ).fetchall()
    return None if not rows else {r[0] for r in rows}


def ensure_sqlite_schema(bind_engine):
    """
    Apply lightweight schema upgrades for DBs created before new ORM columns existed.
    Base.metadata.create_all() creates tables but does not ALTER existing tables.
    """
    sqlite = _is_sqlite(bind_engine)
    bool_default = "0" if sqlite else "false"

    with bind_engine.begin() as conn:
        col_names = _table_column_names(conn, "cover_letters", sqlite)
        if col_names and "custom_prompt" not in col_names:
            conn.execute(text("ALTER TABLE cover_letters ADD COLUMN custom_prompt TEXT"))

        col_names = _table_column_names(conn, "joblens_sessions", sqlite)
        if col_names:
            for column in ("profile_snapshot", "job_description", "reachout"):
                if column not in col_names:
                    conn.execute(text(f"ALTER TABLE joblens_sessions ADD COLUMN {column} JSON"))
            if "jd_text_hash" not in col_names:
                conn.execute(text("ALTER TABLE joblens_sessions ADD COLUMN jd_text_hash VARCHAR(32)"))
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_joblens_sessions_jd_text_hash ON joblens_sessions (jd_text_hash)")
                )

        col_names = _table_column_names(conn, "users", sqlite)
        if col_names:
            if "is_deleted" not in col_names:
                conn.execute(
                    text(f"ALTER TABLE users ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT {bool_default}")
                )
            if "deleted_at" not in col_names:
                deleted_type = "DATETIME" if sqlite else "TIMESTAMP"
                conn.execute(text(f"ALTER TABLE users ADD COLUMN deleted_at {deleted_type}"))
            if "onboarding_completed" not in col_names:
                conn.execute(
                    text(f"ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT {bool_default}")
                )

        col_names = _table_column_names(conn, "user_profiles", sqlite)
        if col_names and "build_status" not in col_names:
            conn.execute(
                text("ALTER TABLE user_profiles ADD COLUMN build_status VARCHAR NOT NULL DEFAULT 'idle'")
            )


def get_db():
    """Dependency for database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
