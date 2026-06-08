"""Strict models for reachout contact discovery."""

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class StrictReachoutModel(BaseModel):
    """Base model shared by reachout contracts."""

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


class ReachoutPersona(str, Enum):
    """Contact persona buckets."""

    RECRUITER = "recruiter"
    TECHNICAL_RECRUITER = "technical_recruiter"
    TALENT_ACQUISITION = "talent_acquisition"
    ENGINEERING_LEADER = "engineering_leader"
    HIRING_MANAGER = "hiring_manager"
    SENIOR_MANAGEMENT = "senior_management"
    PEER_ENGINEER = "peer_engineer"
    SCHOOL_ALUMNI = "school_alumni"
    FOUNDER = "founder"
    OTHER = "other"


class ProfileSource(str, Enum):
    """Source type for a reachout profile."""

    LINKEDIN = "linkedin"
    COMPANY_PAGE = "company_page"
    GITHUB = "github"
    PERSONAL_SITE = "personal_site"
    OTHER = "other"


class SearchResultStatus(str, Enum):
    """Search result gate status."""

    PASSED_PRE_GATE = "passed_pre_gate"
    REJECTED_PRE_GATE = "rejected_pre_gate"
    ACCEPTED_BY_LLM = "accepted_by_llm"
    REJECTED_BY_LLM = "rejected_by_llm"


class ConfidenceBand(str, Enum):
    """Candidate confidence band."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReachoutInput(StrictReachoutModel):
    """Input for reachout discovery."""

    company_name: Optional[str] = None
    company_website: Optional[str] = None
    target_contact_count: int = Field(default=10, ge=1, le=50)
    target_roles: List[str] = Field(default_factory=list)
    location: Optional[str] = None
    job_location_country: Optional[str] = Field(default=None, description="Country where the user is targeting the job search.")
    schools: List[str] = Field(default_factory=list, description="Schools mentioned in the user's resume/profile.")
    seniority: Optional[str] = None
    include_recruiters: bool = True
    include_engineering_leaders: bool = True
    include_peer_engineers: bool = True
    include_school_alumni: bool = True
    allow_former_employees: bool = False
    min_confidence: float = Field(default=0.85, ge=0, le=1)

    @model_validator(mode="after")
    def _require_company(self):
        """Require a company name or website."""

        if not self.company_name and not self.company_website:
            raise ValueError("Provide either company_name or company_website.")
        return self


class ReachoutSearchQuery(StrictReachoutModel):
    """One search query generated for contact discovery."""

    query: str
    target_persona: ReachoutPersona = ReachoutPersona.OTHER
    intent: str
    expected_result_type: str = "LinkedIn /in/ person profile"
    priority: int = Field(default=1, ge=1, le=5)


class ReachoutSearchPlan(StrictReachoutModel):
    """LLM-generated search plan."""

    company_name: Optional[str] = None
    company_website: Optional[str] = None
    target_personas: List[ReachoutPersona] = Field(default_factory=list)
    queries: List[ReachoutSearchQuery] = Field(default_factory=list)
    negative_filters: List[str] = Field(default_factory=list)
    search_strategy_notes: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _coerce_personas(cls, values):
        """Map unrecognised persona strings to OTHER instead of crashing."""
        if not isinstance(values, dict):
            return values
        raw = values.get("target_personas")
        if not isinstance(raw, list):
            return values
        valid = {e.value for e in ReachoutPersona}
        coerced = []
        for item in raw:
            if isinstance(item, str) and item not in valid:
                coerced.append(ReachoutPersona.OTHER.value)
            else:
                coerced.append(item)
        values = {**values, "target_personas": coerced}
        return values


class SearchResult(StrictReachoutModel):
    """One raw search result."""

    title: str
    url: str
    snippet: Optional[str] = None
    query: str
    rank: int = Field(default=0, ge=0)
    source: str = "google"


class GatedSearchResult(StrictReachoutModel):
    """Search result after deterministic pre-gating."""

    source_result_id: str
    result: SearchResult
    status: SearchResultStatus
    reasons: List[str] = Field(default_factory=list)
    normalized_profile_url: Optional[str] = None
    inferred_name: Optional[str] = None
    inferred_title: Optional[str] = None
    inferred_company: Optional[str] = None


class ReachoutCandidate(StrictReachoutModel):
    """One high-confidence reachout contact."""

    source_result_id: Optional[str] = Field(default=None, description="GatedSearchResult.source_result_id for the source search result.")
    full_name: str
    current_title: Optional[str] = None
    company: Optional[str] = None
    profile_url: str
    profile_source: ProfileSource = ProfileSource.LINKEDIN
    likely_persona: ReachoutPersona = ReachoutPersona.OTHER
    confidence: float = Field(ge=0, le=1)
    confidence_band: ConfidenceBand = ConfidenceBand.HIGH
    confidence_reasons: List[str] = Field(default_factory=list)
    matched_query: str
    source_title: str
    source_snippet: Optional[str] = None
    gating_notes: List[str] = Field(default_factory=list)


class RejectedReachoutResult(StrictReachoutModel):
    """Rejected search result with reason."""

    title: str
    url: str
    snippet: Optional[str] = None
    query: Optional[str] = None
    status: SearchResultStatus = SearchResultStatus.REJECTED_PRE_GATE
    rejection_reasons: List[str] = Field(default_factory=list)


class ReachoutValidationResult(StrictReachoutModel):
    """Second-call LLM validation output."""

    accepted_candidates: List[ReachoutCandidate] = Field(default_factory=list)
    rejected_results: List[RejectedReachoutResult] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ReachoutResult(StrictReachoutModel):
    """Complete reachout discovery output."""

    input: ReachoutInput
    search_plan: ReachoutSearchPlan
    raw_results: List[SearchResult] = Field(default_factory=list)
    pre_gated_results: List[GatedSearchResult] = Field(default_factory=list)
    candidates: List[ReachoutCandidate] = Field(default_factory=list)
    rejected_results: List[RejectedReachoutResult] = Field(default_factory=list)
    linkedin_search_urls: List[str] = Field(
        default_factory=list,
        description="Actionable LinkedIn People Search URLs generated from the search plan when no direct profiles were found.",
    )
    warnings: List[str] = Field(default_factory=list)


class ReachoutQueryPlanLLMResponse(StrictReachoutModel):
    """Structured response expected from the query-planning LLM."""

    search_plan: ReachoutSearchPlan = Field(default_factory=ReachoutSearchPlan)
    warnings: List[str] = Field(default_factory=list)


class ReachoutCandidateValidationLLMResponse(StrictReachoutModel):
    """Structured response expected from the candidate-validation LLM."""

    validation: ReachoutValidationResult = Field(default_factory=ReachoutValidationResult)
    warnings: List[str] = Field(default_factory=list)
