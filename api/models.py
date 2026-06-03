"""
Database Models
"""

import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, JSON, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


def generate_uuid():
    return str(uuid.uuid4())


class JobStatus(str, Enum):
    TRACKED = "tracked"
    QUEUED = "queued"
    ANALYZING = "analyzing"
    APPLIED = "applied"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class User(Base):
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    profile_picture = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    
    jobs = relationship("Job", back_populates="user", cascade="all, delete-orphan")
    cover_letters = relationship("CoverLetter", back_populates="user", cascade="all, delete-orphan")
    profile = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    joblens_sessions = relationship("JobLensSession", back_populates="user", cascade="all, delete-orphan")
    profile_files = relationship("ProfileFile", back_populates="user", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    
    # Job data
    job_posting = Column(JSON, nullable=False)
    analysis_result = Column(JSON, nullable=True)

    # JobLens
    company_website = Column(String, nullable=True)
    joblens_session_id = Column(String(36), nullable=True)

    # Tracking
    status = Column(String, default=JobStatus.TRACKED)
    user_notes = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="jobs")
    resume_history = relationship("ResumeHistory", back_populates="job", cascade="all, delete-orphan")
    cover_letters = relationship("CoverLetter", back_populates="job", cascade="all, delete-orphan")


class ResumeHistory(Base):
    __tablename__ = "resume_history"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False)
    
    version = Column(Integer, nullable=False)
    resume_data = Column(JSON, nullable=False)
    score = Column(Float, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    job = relationship("Job", back_populates="resume_history")


class CoverLetter(Base):
    __tablename__ = "cover_letters"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=True)
    
    mode = Column(String, default="regular")
    content = Column(JSON, nullable=False)
    custom_prompt = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="cover_letters")
    job = relationship("Job", back_populates="cover_letters")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)

    # File Paths
    resume_path = Column(String, nullable=True)
    linkedin_path = Column(String, nullable=True)
    portfolio_path = Column(String, nullable=True)

    # Parsed Data
    resume_data = Column(JSON, nullable=True)
    linkedin_data = Column(JSON, nullable=True)
    portfolio_data = Column(JSON, nullable=True)

    unified_profile = Column(JSON, nullable=True)

    extracted_profile = Column(JSON, nullable=True)
    additional_context = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="profile")


class ProfileFile(Base):
    __tablename__ = "profile_files"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String(20), nullable=False, default="other")
    file_size = Column(Integer, nullable=False, default=0)
    parsed_data = Column(JSON, nullable=True)
    additional_context = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="profile_files")


class JobLensSession(Base):
    __tablename__ = "joblens_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=True)

    # JobLens module outputs (JSON)
    profile_snapshot = Column(JSON, nullable=True)
    job_description = Column(JSON, nullable=True)
    company_intel = Column(JSON, nullable=True)
    match_analysis = Column(JSON, nullable=True)   # Phase A: score + evidence
    resume_actions = Column(JSON, nullable=True)   # Phase B: tailored resume actions
    reachout = Column(JSON, nullable=True)

    # Raw inputs for re-running
    raw_jd_text = Column(Text, nullable=True)
    jd_text_hash = Column(String(32), nullable=True, index=True)
    company_website = Column(String, nullable=True)

    # Status
    current_step = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="joblens_sessions")
    job = relationship("Job")


# ── Billing tables ────────────────────────────────────────────────────────────

class Plan(Base):
    """Static plan catalogue. Seeded once at startup — do not mutate at runtime."""

    __tablename__ = "plans"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    code = Column(String, unique=True, nullable=False)          # free|starter|pro|power
    name = Column(String, nullable=False)
    price_cents = Column(Integer, nullable=False, default=0)
    stripe_price_id = Column(String, nullable=True)             # None for free tier
    monthly_credits = Column(Integer, nullable=False)
    # daily_caps shape: {"actions": N} for Free; {"job_analysis": N, "cover_letter": N} for paid
    daily_caps = Column(JSON, nullable=False)
    weekly_caps = Column(JSON, nullable=True)                   # None for Free
    profile_build_daily_cap = Column(Integer, nullable=False, default=1)
    upload_daily_cap = Column(Integer, nullable=False, default=8)
    per_min_burst = Column(Integer, nullable=False, default=30) # in credits


class Subscription(Base):
    """One row per user — the user's current plan, Stripe ids, and period dates."""

    __tablename__ = "subscriptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    plan_id = Column(String(36), ForeignKey("plans.id"), nullable=False)
    stripe_customer_id = Column(String, nullable=True, index=True)
    stripe_subscription_id = Column(String, nullable=True, index=True)
    # status: trialing | active | past_due | canceled
    status = Column(String, nullable=False, default="active")
    cancel_at_period_end = Column(Boolean, nullable=False, default=False)
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)        # used for Free lazy monthly reset
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="subscription")
    plan = relationship("Plan")


class CreditLedger(Base):
    """Append-only credit ledger. Balance = SUM(delta) WHERE user_id = ?.
    NEVER update a row. Always insert a new one.
    """

    __tablename__ = "credit_ledger"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    delta = Column(Integer, nullable=False)         # positive = credit in, negative = credit out
    # kind: grant | topup | reserve | refund | expire
    kind = Column(String, nullable=False)
    task_type = Column(String, nullable=True)       # job_analysis|cover_letter|profile_build|reachout
    ref = Column(String, nullable=False, index=True)  # idempotency key
    created_at = Column(DateTime, default=datetime.utcnow)

    # (ref, kind) must be unique — prevents double-processing the same event.
    __table_args__ = (UniqueConstraint("ref", "kind", name="uq_ledger_ref_kind"),)


class UsageEvent(Base):
    """One row per LLM-backed task (charged or free). Source of truth for margin analytics."""

    __tablename__ = "usage_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    task_type = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="grok")
    model = Column(String, nullable=False, default="grok-3")
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    raw_cost_usd = Column(Float, nullable=False, default=0.0)   # what WE paid the provider
    credits_charged = Column(Integer, nullable=False, default=0) # what the USER was charged
    failed = Column(Boolean, nullable=False, default=False)      # True if task failed (refunded)
    ref = Column(String, nullable=True, index=True)             # ties back to the reservation
    created_at = Column(DateTime, default=datetime.utcnow)


class RateWindow(Base):
    """Fixed-window rate-limit counters. SQLite MVP — swap for Redis at scale."""

    __tablename__ = "rate_windows"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # key examples: "daily:job_analysis:2026-06-01" | "daily:actions:2026-06-01" | "min:job_analysis:27543210"
    window_key = Column(String, nullable=False)
    count = Column(Integer, nullable=False, default=0)
    limit = Column(Integer, nullable=False)
    resets_at = Column(DateTime, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "window_key", name="uq_user_window"),)


class ProcessedWebhook(Base):
    """Stripe webhook idempotency store. If stripe_event_id exists, skip re-processing."""

    __tablename__ = "processed_webhooks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    stripe_event_id = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
