"""
Database Models
"""

import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, JSON, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
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


class CompanyCache(Base):
    __tablename__ = "company_cache"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    company_key = Column(String, nullable=False, index=True)
    cache_type = Column(String, nullable=False)  # "intel" or "reachout"
    roles_key = Column(String, nullable=True)    # for reachout: sorted roles hash
    data = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
