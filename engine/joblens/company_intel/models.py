"""Strict models for company intelligence discovery and extraction."""

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


class StrictCompanyIntelModel(BaseModel):
    """Base model shared by company-intel contracts."""

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


class PageType(str, Enum):
    """Known company page types."""

    HOMEPAGE = "homepage"
    ABOUT = "about"
    ENGINEERING_BLOG = "engineering_blog"
    BLOG_INDEX = "blog_index"
    BLOG_POST = "blog_post"
    CAREERS = "careers"
    DOCS = "docs"
    NEWSROOM = "newsroom"
    OPEN_SOURCE = "open_source"
    OTHER = "other"


class DiscoveryMethod(str, Enum):
    """How a page was discovered."""

    INPUT_WEBSITE = "input_website"
    GUESSED_DOMAIN = "guessed_domain"
    HOMEPAGE_LINK = "homepage_link"
    SITEMAP = "sitemap"
    COMMON_PATH = "common_path"
    MANUAL_FIXTURE = "manual_fixture"


class CompanyIntelInput(StrictCompanyIntelModel):
    """Input for company-intel collection."""

    company_name: Optional[str] = None
    website: Optional[str] = None
    max_pages: int = Field(default=8, ge=1, le=25)
    include_engineering_posts: bool = True

    @model_validator(mode="after")
    def _require_name_or_website(self):
        """Require at least one lookup handle."""

        if not self.company_name and not self.website:
            raise ValueError("Provide either company_name or website.")
        return self


class CompanyLink(StrictCompanyIntelModel):
    """Link discovered on a fetched company page."""

    url: str
    label: Optional[str] = None
    page_type_hint: PageType = PageType.OTHER


class DiscoveredCompanyPage(StrictCompanyIntelModel):
    """A company page selected for fetching."""

    url: str
    page_type: PageType = PageType.OTHER
    confidence: float = Field(default=0.5, ge=0, le=1)
    discovery_method: DiscoveryMethod = DiscoveryMethod.COMMON_PATH
    title_hint: Optional[str] = None


class FetchedCompanyPage(StrictCompanyIntelModel):
    """A fetched and text-normalized company page."""

    url: str
    canonical_url: Optional[str] = None
    title: Optional[str] = None
    page_type: PageType = PageType.OTHER
    text: str = ""
    headings: List[str] = Field(default_factory=list)
    links: List[CompanyLink] = Field(default_factory=list)
    fetched_at: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class SourceEvidence(StrictCompanyIntelModel):
    """One source phrase supporting extracted company intel."""

    url: str
    page_type: PageType = PageType.OTHER
    title: Optional[str] = None
    text: str


class CompanyIdentity(StrictCompanyIntelModel):
    """Normalized company identity."""

    name: Optional[str] = None
    website: Optional[str] = None
    canonical_domain: Optional[str] = None
    short_description: Optional[str] = None
    mission: Optional[str] = None
    industry: Optional[str] = None
    company_stage_or_scale: Optional[str] = None
    founded: Optional[str] = None
    headquarters_or_distribution: Optional[str] = None
    evidence: List[SourceEvidence] = Field(default_factory=list)


class ProductSignal(StrictCompanyIntelModel):
    """Product, platform, customer, or scale signal."""

    name: Optional[str] = None
    description: str
    audience_or_customer: Optional[str] = None
    scale_or_adoption: Optional[str] = None
    evidence: List[SourceEvidence] = Field(default_factory=list)


class EngineeringPostSummary(StrictCompanyIntelModel):
    """Summary of an engineering blog post or engineering-heavy article."""

    title: str
    url: str
    published_date: Optional[str] = None
    author: Optional[str] = None
    topics: List[str] = Field(default_factory=list)
    technologies: List[str] = Field(default_factory=list)
    systems_or_domains: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    evidence: List[SourceEvidence] = Field(default_factory=list)


class EngineeringPresence(StrictCompanyIntelModel):
    """Company engineering-publication surface."""

    engineering_blog_found: bool = False
    engineering_blog_url: Optional[str] = None
    engineering_blog_title: Optional[str] = None
    post_count_sampled: int = 0
    recent_posts: List[EngineeringPostSummary] = Field(default_factory=list)
    primary_engineering_topics: List[str] = Field(default_factory=list)
    evidence: List[SourceEvidence] = Field(default_factory=list)


class TechnicalSignals(StrictCompanyIntelModel):
    """Technical stack and engineering domains mentioned in public sources."""

    programming_languages: List[str] = Field(default_factory=list)
    frameworks: List[str] = Field(default_factory=list)
    infrastructure: List[str] = Field(default_factory=list)
    cloud: List[str] = Field(default_factory=list)
    databases: List[str] = Field(default_factory=list)
    data_ai_ml: List[str] = Field(default_factory=list)
    security: List[str] = Field(default_factory=list)
    reliability: List[str] = Field(default_factory=list)
    developer_tools: List[str] = Field(default_factory=list)
    architecture_patterns: List[str] = Field(default_factory=list)
    evidence: List[SourceEvidence] = Field(default_factory=list)


class EngineeringCultureSignals(StrictCompanyIntelModel):
    """Engineering culture, working style, and quality signals."""

    values: List[str] = Field(default_factory=list)
    working_style: List[str] = Field(default_factory=list)
    quality_signals: List[str] = Field(default_factory=list)
    open_source_signals: List[str] = Field(default_factory=list)
    developer_experience_signals: List[str] = Field(default_factory=list)
    collaboration_signals: List[str] = Field(default_factory=list)
    evidence: List[SourceEvidence] = Field(default_factory=list)


class HiringSignals(StrictCompanyIntelModel):
    """Hiring, team, location, and career-page signals."""

    careers_url: Optional[str] = None
    hiring_locations: List[str] = Field(default_factory=list)
    remote_or_work_mode: Optional[str] = None
    team_structure: List[str] = Field(default_factory=list)
    interview_or_values_signals: List[str] = Field(default_factory=list)
    evidence: List[SourceEvidence] = Field(default_factory=list)


class CompanyIntelResult(StrictCompanyIntelModel):
    """Unified output for company intelligence."""

    input: CompanyIntelInput
    slim_summary: Optional[str] = Field(
        default=None,
        description="2-3 sentence summary of the company: product domain, tech stack, and approximate size. Used by downstream job matching."
    )
    identity: CompanyIdentity = Field(default_factory=CompanyIdentity)
    product_signals: List[ProductSignal] = Field(default_factory=list)
    engineering_presence: EngineeringPresence = Field(default_factory=EngineeringPresence)
    technical_signals: TechnicalSignals = Field(default_factory=TechnicalSignals)
    engineering_culture: EngineeringCultureSignals = Field(default_factory=EngineeringCultureSignals)
    hiring_signals: HiringSignals = Field(default_factory=HiringSignals)
    source_pages: List[FetchedCompanyPage] = Field(default_factory=list)
    extraction_notes: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class CompanyIntelLLMResult(StrictCompanyIntelModel):
    """LLM-visible subset of CompanyIntelResult — source_pages excluded to avoid token explosion.

    The service fills source_pages from the original fetched pages after the LLM call.
    """

    input: CompanyIntelInput
    slim_summary: Optional[str] = Field(
        default=None,
        description="2-3 sentence summary of the company: product domain, tech stack, and approximate size. Used by downstream job matching."
    )
    identity: CompanyIdentity = Field(default_factory=CompanyIdentity)
    product_signals: List[ProductSignal] = Field(default_factory=list)
    engineering_presence: EngineeringPresence = Field(default_factory=EngineeringPresence)
    technical_signals: TechnicalSignals = Field(default_factory=TechnicalSignals)
    engineering_culture: EngineeringCultureSignals = Field(default_factory=EngineeringCultureSignals)
    hiring_signals: HiringSignals = Field(default_factory=HiringSignals)
    extraction_notes: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class CompanyIntelLLMResponse(StrictCompanyIntelModel):
    """Structured response expected from the company-intel LLM."""

    result: CompanyIntelLLMResult
    warnings: List[str] = Field(default_factory=list)
