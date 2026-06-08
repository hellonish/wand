"""Strict models for LLM-backed job description breakdowns.

This module is the evidence-gathering layer for job descriptions. It turns a
raw posting into normalized components that a later matching module can compare
against a unified candidate profile.
"""

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


NOISE_STRINGS = {
    "n/a",
    "na",
    "none",
    "null",
    "not applicable",
    "not available",
    "not provided",
    "not specified",
    "unknown",
    "various",
}


class StrictJobDescriptionModel(BaseModel):
    """Base model shared by job description contracts."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, validate_assignment=True)

    @field_validator("*", mode="before")
    @classmethod
    def _clean_value(cls, value):
        """Trim strings, drop placeholders, and dedupe primitive lists."""

        if isinstance(value, str):
            clean = value.strip()
            return None if clean.lower() in NOISE_STRINGS else clean
        if isinstance(value, list):
            result = []
            seen = set()
            for item in value:
                if isinstance(item, str):
                    clean = item.strip()
                    normalized_key = " ".join(clean.split()).lower()
                    if not clean or normalized_key in NOISE_STRINGS:
                        continue
                    if normalized_key in seen:
                        continue
                    seen.add(normalized_key)
                    result.append(clean)
                else:
                    result.append(item)
            return result
        return value


class RequirementImportance(str, Enum):
    """How important the requirement appears in the posting."""

    MUST_HAVE = "must_have"
    IMPORTANT = "important"
    NICE_TO_HAVE = "nice_to_have"
    CONTEXT = "context"


class RequiredLevel(str, Enum):
    """Depth or proficiency level requested by the posting."""

    BASIC = "basic"
    WORKING = "working"
    STRONG = "strong"
    EXPERT = "expert"
    UNSPECIFIED = "unspecified"


class SkillCategory(str, Enum):
    """Normalized categories for technical and functional skills."""

    LANGUAGE = "language"
    FRONTEND = "frontend"
    BACKEND = "backend"
    FRAMEWORK = "framework"
    DATABASE = "database"
    CLOUD = "cloud"
    INFRASTRUCTURE = "infrastructure"
    DEVOPS = "devops"
    DATA = "data"
    AI_ML = "ai_ml"
    SECURITY = "security"
    TESTING = "testing"
    API = "api"
    VISUALIZATION = "visualization"
    FUNCTIONAL = "functional"
    DOMAIN = "domain"
    SOFT_SKILL = "soft_skill"
    OTHER = "other"


class WorkMode(str, Enum):
    """Work arrangement inferred from the posting."""

    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "onsite"
    FLEXIBLE = "flexible"
    UNSPECIFIED = "unspecified"


class EmploymentType(str, Enum):
    """Employment type inferred from the posting."""

    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERNSHIP = "internship"
    TEMPORARY = "temporary"
    UNSPECIFIED = "unspecified"


class SeniorityLevel(str, Enum):
    """Seniority level inferred from years, title, and responsibility language."""

    INTERN = "intern"
    ENTRY = "entry"
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"
    STAFF = "staff"
    LEAD = "lead"
    MANAGER = "manager"
    UNSPECIFIED = "unspecified"


class ConstraintCategory(str, Enum):
    """Hard or practical constraint category."""

    LOCATION = "location"
    WORK_AUTHORIZATION = "work_authorization"
    EDUCATION = "education"
    COMPENSATION = "compensation"
    EMPLOYMENT_TYPE = "employment_type"
    CLEARANCE = "clearance"
    OTHER = "other"


class QualificationCategory(str, Enum):
    """Category for non-skill qualification requirements."""
    EXPERIENCE = "experience"
    EDUCATION = "education"
    SOFT_SKILL = "soft_skill"
    LOGISTICS = "logistics"
    AVAILABILITY = "availability"
    OTHER = "other"


class JobDescriptionInput(StrictJobDescriptionModel):
    """Raw job description supplied for breakdown."""

    text: str = Field(description="Raw job description text.")
    source_id: Optional[str] = Field(default=None, description="Caller-provided source id, URL, or local fixture name.")


class JobMetadata(StrictJobDescriptionModel):
    """Top-level facts about the job."""

    job_title: Optional[str] = None
    company_name: Optional[str] = None
    location: Optional[str] = None
    work_mode: WorkMode = WorkMode.UNSPECIFIED
    employment_type: EmploymentType = EmploymentType.UNSPECIFIED
    seniority_level: SeniorityLevel = SeniorityLevel.UNSPECIFIED
    years_of_experience_min: Optional[float] = None
    years_of_experience_max: Optional[float] = None
    posted_at: Optional[str] = None
    apply_by: Optional[str] = None
    source_phrases: List[str] = Field(default_factory=list)


class CompanyContext(StrictJobDescriptionModel):
    """Company, product, mission, and domain context."""

    summary: Optional[str] = None
    industry: Optional[str] = None
    company_stage_or_scale: Optional[str] = None
    mission_or_value_signals: List[str] = Field(default_factory=list)
    product_or_platform_signals: List[str] = Field(default_factory=list)
    domain_signals: List[str] = Field(default_factory=list)
    source_phrases: List[str] = Field(default_factory=list)


class JobConstraint(StrictJobDescriptionModel):
    """One explicit location, authorization, education, compensation, or logistics constraint."""

    category: ConstraintCategory = ConstraintCategory.OTHER
    text: str
    importance: RequirementImportance = RequirementImportance.IMPORTANT
    is_must_have: bool = False
    source_phrases: List[str] = Field(default_factory=list)


class SkillRequirement(StrictJobDescriptionModel):
    """One normalized skill or tool requested by the posting."""

    name: str
    category: SkillCategory = SkillCategory.OTHER
    required_level: RequiredLevel = RequiredLevel.UNSPECIFIED
    required_years: Optional[float] = None
    importance: RequirementImportance = RequirementImportance.CONTEXT
    is_must_have: bool = False
    source_phrases: List[str] = Field(default_factory=list)


class ResponsibilityRequirement(StrictJobDescriptionModel):
    """One work responsibility normalized for later evidence matching."""

    action: str = Field(description="Verb or action, for example build, own, deploy, maintain, present.")
    object: str = Field(description="Thing being acted on, for example APIs, applications, dashboards, cloud services.")
    context: Optional[str] = Field(default=None, description="Business, technical, or team context for the responsibility.")
    importance: RequirementImportance = RequirementImportance.IMPORTANT
    source_phrases: List[str] = Field(default_factory=list)


class QualificationRequirement(StrictJobDescriptionModel):
    """Non-skill qualification or candidate trait."""

    text: str
    category: QualificationCategory = QualificationCategory.OTHER
    importance: RequirementImportance = RequirementImportance.IMPORTANT
    is_must_have: bool = False
    source_phrases: List[str] = Field(default_factory=list)


class RoleClassification(StrictJobDescriptionModel):
    """Role-family interpretation used to choose matching strategy later."""

    role_family: Optional[str] = Field(default=None, description="For example full-stack, backend, frontend, cloud, data platform.")
    primary_track: Optional[str] = Field(default=None, description="Most important track for matching.")
    secondary_tracks: List[str] = Field(default_factory=list)
    seniority_rationale: Optional[str] = None
    source_phrases: List[str] = Field(default_factory=list)


class JobDescriptionBreakdown(StrictJobDescriptionModel):
    """Complete normalized breakdown of a job description."""

    metadata: JobMetadata = Field(default_factory=JobMetadata)
    company_context: CompanyContext = Field(default_factory=CompanyContext)
    role_classification: RoleClassification = Field(default_factory=RoleClassification)
    primary_skills: List[SkillRequirement] = Field(default_factory=list)
    secondary_skills: List[SkillRequirement] = Field(default_factory=list)
    responsibilities: List[ResponsibilityRequirement] = Field(default_factory=list)
    qualifications: List[QualificationRequirement] = Field(default_factory=list)
    constraints: List[JobConstraint] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    extraction_notes: List[str] = Field(default_factory=list)


class JobDescriptionBreakdownResult(StrictJobDescriptionModel):
    """Extractor output consumed by the future matching module."""

    input: JobDescriptionInput
    breakdown: JobDescriptionBreakdown = Field(default_factory=JobDescriptionBreakdown)
    warnings: List[str] = Field(default_factory=list)


class JobDescriptionBreakdownLLMResponse(StrictJobDescriptionModel):
    """Structured response expected from the job description LLM."""

    breakdown: JobDescriptionBreakdown = Field(default_factory=JobDescriptionBreakdown)
    warnings: List[str] = Field(default_factory=list)
