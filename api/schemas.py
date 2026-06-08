"""
Pydantic Schemas for API
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
from pydantic import BaseModel
from uuid import UUID


# Enums
class JobStatusEnum(str, Enum):
    tracked = "tracked"
    queued = "queued"
    analyzing = "analyzing"
    applied = "applied"
    interview = "interview"
    offer = "offer"
    rejected = "rejected"
    archived = "archived"


class CoverLetterModeEnum(str, Enum):
    storyline = "storyline"
    disruptive = "disruptive"
    regular = "regular"
    auto = "auto"
    custom = "custom"


# User Schemas
class UserBase(BaseModel):
    email: str
    name: str
    profile_picture: Optional[str] = None


class UserResponse(UserBase):
    id: UUID
    created_at: datetime
    has_profile: bool = False
    onboarding_completed: bool = False

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    profile_picture: Optional[str] = None


# Auth Schemas
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Job Schemas
class JobCreate(BaseModel):
    jd_text: str
    company_website: Optional[str] = None


class JobUpdate(BaseModel):
    status: Optional[JobStatusEnum] = None
    user_notes: Optional[str] = None
    job_link: Optional[str] = None


class ResumeHistoryResponse(BaseModel):
    version: int
    resume_data: Dict[str, Any]
    score: Optional[float] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class JobResponse(BaseModel):
    id: UUID
    job_posting: Dict[str, Any]
    analysis_result: Optional[Dict[str, Any]] = None
    status: JobStatusEnum
    user_notes: Optional[str] = None
    resume_history: List[ResumeHistoryResponse] = []
    company_website: Optional[str] = None
    joblens_session_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    id: UUID
    job_posting: Dict[str, Any]
    status: JobStatusEnum
    final_score: Optional[float] = None
    company_website: Optional[str] = None
    joblens_session_id: Optional[str] = None
    current_step: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Cover Letter Schemas
class CoverLetterCreate(BaseModel):
    job_id: Optional[UUID] = None
    mode: CoverLetterModeEnum = CoverLetterModeEnum.regular
    custom_prompt: Optional[str] = None
    include_news: bool = False
    jd_text: Optional[str] = None
    company_name: Optional[str] = None


class CoverLetterUpdate(BaseModel):
    full_letter: Optional[str] = None
    content: Optional[Dict[str, Any]] = None


class CoverLetterResponse(BaseModel):
    id: UUID
    job_id: Optional[UUID] = None
    mode: str
    content: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# News Schemas
class NewsArticleResponse(BaseModel):
    title: str
    description: str
    url: str
    source: str
    published_at: str


class NewsResponse(BaseModel):
    company_name: str
    articles: List[NewsArticleResponse]
    total_results: int

# Profile Schemas
class UserProfileResponse(BaseModel):
    id: UUID
    user_id: str

    # File Paths (Nullable)
    resume_path: Optional[str] = None
    linkedin_path: Optional[str] = None
    portfolio_path: Optional[str] = None

    # Parsed Data (Nullable)
    resume_data: Optional[Dict[str, Any]] = None
    linkedin_data: Optional[Dict[str, Any]] = None
    portfolio_data: Optional[Dict[str, Any]] = None

    # Final Profile
    unified_profile: Optional[Dict[str, Any]] = None

    # JobLens
    extracted_profile: Optional[Dict[str, Any]] = None
    additional_context: Optional[str] = None

    # Background build state: idle | building | ready | error
    build_status: Optional[str] = None

    updated_at: datetime

    class Config:
        from_attributes = True

class ProfileUploadResponse(BaseModel):
    file_type: str
    filename: str
    parsed_data: Dict[str, Any]


class ProfileFileResponse(BaseModel):
    id: UUID
    filename: str
    file_type: str
    file_size: int
    parsed_data: Optional[Dict[str, Any]] = None
    additional_context: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProfileFileListResponse(BaseModel):
    files: List[ProfileFileResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ProfileFileUploadResponse(BaseModel):
    id: UUID
    file_type: str
    filename: str
    parsed_data: Optional[Dict[str, Any]] = None


class ProfileFileUpdate(BaseModel):
    file_type: Optional[str] = None
    additional_context: Optional[str] = None


class JDToneAnalysisResponse(BaseModel):
    recommended_mode: str
    confidence: float
    tone_signals: List[str]
    culture_indicators: List[str]
    formality_level: str
    industry: str
    reasoning: str


# ============================================================================
# JobLens Schemas
# ============================================================================

class JobLensSessionResponse(BaseModel):
    id: UUID
    job_id: Optional[UUID] = None
    profile_snapshot: Optional[Dict[str, Any]] = None
    job_description: Optional[Dict[str, Any]] = None
    company_intel: Optional[Dict[str, Any]] = None
    match_analysis: Optional[Dict[str, Any]] = None   # Phase A: score + evidence
    resume_actions: Optional[Dict[str, Any]] = None   # Phase B: tailored resume actions
    reachout: Optional[Dict[str, Any]] = None
    raw_jd_text: Optional[str] = None
    company_website: Optional[str] = None
    current_step: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AdditionalContextUpdate(BaseModel):
    additional_context: str

class JobTrackCreate(BaseModel):
    """Create a simple tracked job without running the AI pipeline."""
    job_title: str
    company_name: str
    job_url: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = "tracked"
