"""Strict models for matching a unified profile against a JD breakdown."""

from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from engine.profile.models import UnifiedProfile

from engine.joblens.job_description.models import JobDescriptionBreakdownResult, RequirementImportance, SkillCategory


NOISE_STRINGS = {
    "n/a",
    "na",
    "none",
    "null",
    "not applicable",
    "not available",
    "not provided",
    "not specified",
    "various",
}


class StrictJobMatchModel(BaseModel):
    """Base model shared by match contracts."""

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


class MatchBand(str, Enum):
    """Overall match category."""

    STRONG = "strong"
    GOOD = "good"
    PARTIAL = "partial"
    WEAK = "weak"


class MatchLevel(str, Enum):
    """How directly profile evidence matches a JD target."""

    EXACT = "exact"
    ALIAS = "alias"
    ADJACENT = "adjacent"
    TRANSFERABLE = "transferable"
    MISSING = "missing"
    UNKNOWN = "unknown"


class ConstraintStatus(str, Enum):
    """Hard-constraint outcome."""

    PASS = "pass"
    RISK = "risk"
    FAIL = "fail"
    UNKNOWN = "unknown"
    NOT_APPLICABLE = "not_applicable"


class ResumeActionType(str, Enum):
    """Resume action categories the user can apply later."""

    UPDATE = "update"
    REPLACE = "replace"
    DELETE = "delete"


class EvidenceType(str, Enum):
    """Closed set of evidence categories."""
    SKILL = "skill"
    EXPERIENCE = "experience"
    PROJECT = "project"
    EDUCATION = "education"
    SUMMARY = "summary"
    AUTHORIZATION = "authorization"
    LOCATION = "location"
    OTHER = "other"


class ResumeTargetSection(str, Enum):
    """Resume sections a tailoring action can target."""
    SUMMARY = "summary"
    SKILLS = "skills"
    EXPERIENCE = "experience"
    PROJECTS = "projects"
    EDUCATION = "education"
    OTHER = "other"


class ActionPriority(str, Enum):
    """Action priority."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ResumeCandidateInput(StrictJobMatchModel):
    """One resume file available for AI selection."""

    filename: str
    text: str


class JobMatchRequest(StrictJobMatchModel):
    """Inputs needed to compare one profile against one broken-down JD."""

    profile: UnifiedProfile
    job_description: JobDescriptionBreakdownResult
    base_resume_text: Optional[str] = Field(
        default=None,
        description="Single resume text (legacy / single-file path). Ignored when resume_candidates is non-empty.",
    )
    resume_candidates: List[ResumeCandidateInput] = Field(
        default_factory=list,
        description="All resume files tagged by the user. AI picks the best one for this JD.",
    )
    company_summary: Optional[str] = Field(
        default=None,
        description="2-3 sentence company summary (product domain, tech stack, size) from company intel. Used to ground domain_relevance scoring.",
    )
    tailoring_mode: Literal["surgical", "full_rewrite"] = Field(
        default="surgical",
        description="Controls how aggressively the LLM rewrites resume content. 'surgical' only edits lines with a clear JD-driven reason; 'full_rewrite' rewrites broadly wherever truthful evidence allows.",
    )


class EvidenceItem(StrictJobMatchModel):
    """One profile evidence item used for a match or gap."""

    profile_field: str
    text: str
    evidence_type: EvidenceType
    strength: int = Field(ge=0, le=5, description="0=no evidence, 5=direct production evidence with impact.")
    explanation: Optional[str] = None


class ScoreComponent(StrictJobMatchModel):
    """One category score in the 100-point match score."""

    name: str
    score: float = Field(ge=0)
    max_score: float = Field(gt=0)
    rationale: Optional[str] = None


class ConstraintMatch(StrictJobMatchModel):
    """Hard constraint comparison."""

    constraint: str
    status: ConstraintStatus
    importance: RequirementImportance
    profile_evidence: List[EvidenceItem] = Field(default_factory=list)
    jd_source_phrases: List[str] = Field(default_factory=list)
    risk_or_gap: Optional[str] = None


class SkillMatch(StrictJobMatchModel):
    """Skill-level match explanation."""

    jd_skill: str
    normalized_skill: Optional[str] = None
    category: SkillCategory = SkillCategory.OTHER
    importance: RequirementImportance
    match_level: MatchLevel
    score: float = Field(ge=0)
    max_score: float = Field(gt=0)
    profile_evidence: List[EvidenceItem] = Field(default_factory=list)
    gap: Optional[str] = None
    action_hint: Optional[str] = None


class ResponsibilityMatch(StrictJobMatchModel):
    """Responsibility-level match explanation."""

    target: str
    importance: RequirementImportance
    match_level: MatchLevel
    evidence_score: int = Field(ge=0, le=5)
    profile_evidence: List[EvidenceItem] = Field(default_factory=list)
    gap: Optional[str] = None
    action_hint: Optional[str] = None


class ResumeAction(StrictJobMatchModel):
    """One actionable resume recommendation."""

    action_type: ResumeActionType
    priority: ActionPriority = ActionPriority.MEDIUM
    target_section: ResumeTargetSection
    target_text: Optional[str] = Field(default=None, description="Existing resume/profile text to update, replace, or delete when available.")
    suggested_text: Optional[str] = Field(default=None, description="Suggested truthful replacement/update text. Empty for delete actions.")
    reason: str
    jd_alignment: List[str]
    profile_evidence: List[EvidenceItem]
    expected_score_impact: Optional[str] = None


class JobMatchSummary(StrictJobMatchModel):
    """Concise overall result."""

    total_score: float = Field(ge=0, le=100)
    match_band: MatchBand
    headline: str
    strongest_matches: List[str]
    biggest_gaps: List[str]
    hard_constraint_summary: Optional[str] = None


class JobMatchResult(StrictJobMatchModel):
    """Complete profile-to-JD match output."""

    job_title: Optional[str] = None
    company_name: Optional[str] = None
    role_family: Optional[str] = None
    summary: JobMatchSummary
    score_components: List[ScoreComponent] = Field(default_factory=list)
    constraints: List[ConstraintMatch] = Field(default_factory=list)
    skill_matches: List[SkillMatch] = Field(default_factory=list)
    responsibility_matches: List[ResponsibilityMatch] = Field(default_factory=list)
    update_actions: List[ResumeAction] = Field(default_factory=list)
    replace_actions: List[ResumeAction] = Field(default_factory=list)
    delete_actions: List[ResumeAction] = Field(default_factory=list)
    selected_actions: List[ResumeAction] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class JobMatchLLMResponse(StrictJobMatchModel):
    """Structured response expected from the matching LLM."""

    result: JobMatchResult
    warnings: List[str] = Field(default_factory=list)


# ─── Two-phase split models ───────────────────────────────────────────────────
# Phase A: scoring + evidence (fits within 8K output tokens).
# Phase B: resume actions (consumes Phase A result as context).
# Both are merged into JobMatchResult by the caller.

class JobMatchScore(StrictJobMatchModel):
    """Phase A output — scoring and evidence only, no resume actions."""

    job_title: Optional[str] = None
    company_name: Optional[str] = None
    role_family: Optional[str] = None
    summary: JobMatchSummary
    score_components: List[ScoreComponent] = Field(default_factory=list)
    constraints: List[ConstraintMatch] = Field(default_factory=list)
    skill_matches: List[SkillMatch] = Field(default_factory=list)
    responsibility_matches: List[ResponsibilityMatch] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class JobMatchScoreLLMResponse(StrictJobMatchModel):
    """LLM wrapper for Phase A."""

    result: JobMatchScore
    warnings: List[str] = Field(default_factory=list)


class ResumeActions(StrictJobMatchModel):
    """Phase B output — resume tailoring actions."""

    selected_resume_filename: Optional[str] = Field(
        default=None,
        description="Filename of the resume chosen by the AI when multiple candidates were provided.",
    )
    selected_resume_text: Optional[str] = Field(
        default=None,
        description="Full extracted text of the selected resume. Populated server-side after AI selection; not sent to the LLM.",
    )
    update_actions: List[ResumeAction]
    replace_actions: List[ResumeAction]
    delete_actions: List[ResumeAction]
    selected_actions: List[ResumeAction]
    warnings: List[str]


class ResumeActionsLLMResponse(StrictJobMatchModel):
    """LLM wrapper for Phase B."""

    result: ResumeActions
    warnings: List[str] = Field(default_factory=list)
