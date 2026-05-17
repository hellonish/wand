"""
Database Models
"""

import uuid
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, JSON
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
    llm_provider = Column(String, nullable=True, default="grok")
    llm_model = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    jobs = relationship("Job", back_populates="user", cascade="all, delete-orphan")
    cover_letters = relationship("CoverLetter", back_populates="user", cascade="all, delete-orphan")
    discrepancies = relationship("Discrepancy", back_populates="user", cascade="all, delete-orphan")
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


class Discrepancy(Base):
    __tablename__ = "discrepancies"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    
    unified_profile = Column(JSON, nullable=False)
    result = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    user = relationship("User", back_populates="discrepancies")


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
    discrepancy_result = Column(JSON, nullable=True)

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

    # Step results (JSON)
    extracted_profile = Column(JSON, nullable=True)
    parsed_jd = Column(JSON, nullable=True)
    company_intel = Column(JSON, nullable=True)
    match_analysis = Column(JSON, nullable=True)
    contact_strategy = Column(JSON, nullable=True)
    action_plan = Column(JSON, nullable=True)

    # Raw inputs for re-running
    raw_jd_text = Column(Text, nullable=True)
    company_website = Column(String, nullable=True)

    # Status
    current_step = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="joblens_sessions")
    job = relationship("Job")

