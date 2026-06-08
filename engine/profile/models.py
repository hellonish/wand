"""Strict models for profile document ingestion and LLM extraction.

The parser is the evidence-gathering layer of the profile pipeline. These
models keep programmatic ingestion artifacts separate from LLM-normalized
LinkedIn-style components, while rejecting unexpected fields and common
placeholder noise.
"""

from enum import Enum
from typing import Any, Dict, List, Optional

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


class StrictProfileModel(BaseModel):
    """Base model shared by parser contracts."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, validate_assignment=True)

    @field_validator("*", mode="before")
    @classmethod
    def _clean_value(cls, value):
        """Trim strings, drop placeholders, and dedupe primitive lists without summarizing."""

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


class SourceType(str, Enum):
    """Supported high-level source document categories."""

    RESUME = "resume"
    COVER_LETTER = "cover_letter"
    LINKEDIN = "linkedin"
    PORTFOLIO = "portfolio"
    PROJECTS = "projects"
    OTHER = "other"


class FileType(str, Enum):
    """Supported physical input formats."""

    PDF = "pdf"
    HTML = "html"
    DOCX = "docx"
    TXT = "txt"


class LinkKind(str, Enum):
    """Known profile link categories."""

    EMAIL = "email"
    LINKEDIN = "linkedin"
    GITHUB = "github"
    PORTFOLIO = "portfolio"
    PROJECT = "project"
    DOCUMENT = "document"
    ANCHOR = "anchor"
    OTHER = "other"


class LinkSource(str, Enum):
    """Where a captured link came from."""

    TEXT = "text"
    PDF_EMBEDDED = "pdf_embedded"
    HTML_HREF = "html_href"
    DOCX_RELATIONSHIP = "docx_relationship"


class ProfileDocumentInput(StrictProfileModel):
    """Raw document payload supplied to ingestion."""

    filename: str
    content_type: str = "application/octet-stream"
    file_bytes: bytes = Field(repr=False)
    declared_source_type: Optional[SourceType] = None


class DocumentMetadata(StrictProfileModel):
    """Metadata known before LLM extraction."""

    filename: str
    content_type: str
    extension: str
    size_bytes: int
    sha256: str
    page_count: Optional[int] = None
    paragraph_count: Optional[int] = None
    table_count: Optional[int] = None
    block_count: Optional[int] = None
    link_count: Optional[int] = None
    title: Optional[str] = None
    duplicate_of: Optional[str] = None


class TextBlock(StrictProfileModel):
    """Simple source text block supplied to the LLM."""

    block_id: str
    text: str
    page_number: Optional[int] = None
    heading_path: List[str] = Field(default_factory=list)


class CapturedLink(StrictProfileModel):
    """Visible or embedded link captured during ingestion."""

    link_id: Optional[str] = Field(default=None, description="Stable id for referring to this captured link.")
    url: str
    kind: LinkKind = LinkKind.OTHER
    label: Optional[str] = None
    context: Optional[str] = None
    block_id: Optional[str] = None
    page_number: Optional[int] = None
    source: LinkSource = LinkSource.TEXT
    heading_path: List[str] = Field(default_factory=list)


class IngestedProfileDocument(StrictProfileModel):
    """A source document ready for LLM profile extraction."""

    document_id: str
    source_type: SourceType
    file_type: FileType
    metadata: DocumentMetadata
    text_blocks: List[TextBlock] = Field(default_factory=list)
    links: List[CapturedLink] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ParsedProfileRecord(StrictProfileModel):
    """Shared fields for parsed LinkedIn-style components."""

    raw_text: Optional[str] = Field(default=None, description="Full component-relevant source text; do not summarize or shorten.")
    source_document_ids: List[str] = Field(default_factory=list)


class ParsedIntroSection(ParsedProfileRecord):
    """LinkedIn-style profile intro/header."""

    full_name: Optional[str] = None
    target_headline: Optional[str] = None
    location: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None


class ParsedAboutSection(ParsedProfileRecord):
    """Professional about component."""

    role_identity: Optional[str] = None
    years_or_depth_of_experience: Optional[str] = None
    domain_context: List[str] = Field(default_factory=list)
    top_skills_tools: List[str] = Field(default_factory=list)
    signature_outcome: Optional[str] = None


class ParsedFeaturedItem(ParsedProfileRecord):
    """Featured proof artifact."""

    title: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    kind: Optional[str] = None


class ParsedExperienceItem(ParsedProfileRecord):
    """Professional experience item."""

    job_title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    scope: List[str] = Field(default_factory=list)
    responsibilities: List[str] = Field(default_factory=list)
    achievements: List[str] = Field(default_factory=list)
    tools_used: List[str] = Field(default_factory=list)


class ParsedEducationItem(ParsedProfileRecord):
    """Education item."""

    school_institution: Optional[str] = None
    degree_program: Optional[str] = None
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    graduation_date: Optional[str] = None
    honors: List[str] = Field(default_factory=list)
    relevant_coursework: List[str] = Field(default_factory=list)


class ParsedSkillsSection(ParsedProfileRecord):
    """Grouped skills component."""

    technical_skills: List[str] = Field(default_factory=list)
    functional_skills: List[str] = Field(default_factory=list)
    domain_skills: List[str] = Field(default_factory=list)
    soft_skills: List[str] = Field(default_factory=list)


class ParsedCertificationItem(ParsedProfileRecord):
    """License or certification item."""

    credential_name: Optional[str] = None
    issuing_organization: Optional[str] = None
    license_number: Optional[str] = None
    state_jurisdiction: Optional[str] = None
    issue_date: Optional[str] = None
    expiration_date: Optional[str] = None
    credential_status: Optional[str] = None
    credential_url: Optional[str] = None


class ParsedProjectItem(ParsedProfileRecord):
    """Portfolio or project item."""

    project_name: Optional[str] = Field(default=None, description="Exact visible project, product, repository, demo, or research artifact name.")
    role: Optional[str] = Field(default=None, description="Builder, owner, researcher, founder, contributor, team role, or visible project date/context.")
    problem: Optional[str] = Field(default=None, description="Source-stated problem or use case solved by the project; do not shorten.")
    tools_methods: List[str] = Field(default_factory=list, description="Technologies, models, methods, frameworks, infrastructure, or datasets used; keep non-duplicate source items.")
    outcome: Optional[str] = Field(default=None, description="Concrete result, metric, shipped state, user impact, report result, or publication status; do not shorten.")
    project_url: Optional[str] = Field(default=None, description="Canonical project page or portfolio detail URL.")
    github_url: Optional[str] = Field(default=None, description="GitHub repository URL for this specific project.")
    live_demo_url: Optional[str] = Field(default=None, description="Live demo, deployed app, or product URL.")
    report_url: Optional[str] = Field(default=None, description="Report, paper, PDF, proposal, slide, or document URL for this project.")


class ParsedPublicationItem(ParsedProfileRecord):
    """Publication or writing item."""

    title: Optional[str] = None
    publisher: Optional[str] = None
    date: Optional[str] = None
    coauthors: List[str] = Field(default_factory=list)
    url: Optional[str] = None
    relevance: Optional[str] = None


class ParsedAwardItem(ParsedProfileRecord):
    """Honor or award item."""

    award_name: Optional[str] = None
    issuer: Optional[str] = None
    date: Optional[str] = None
    reason: Optional[str] = None


class ParsedVolunteerItem(ParsedProfileRecord):
    """Volunteer experience item."""

    organization: Optional[str] = None
    role: Optional[str] = None
    cause_mission: Optional[str] = None
    dates: Optional[str] = None
    impact: Optional[str] = None


class ParsedLanguageItem(ParsedProfileRecord):
    """Language proficiency item."""

    language: Optional[str] = None
    proficiency: Optional[str] = None
    use_context: Optional[str] = None


class ParsedRecommendationItem(ParsedProfileRecord):
    """Recommendation or testimonial item."""

    recommender_name: Optional[str] = None
    relationship: Optional[str] = None
    quote: Optional[str] = None
    permission: Optional[str] = None


class ParsedProfileNote(ParsedProfileRecord):
    """Explicit miscellaneous profile fact that does not deserve a dedicated model."""

    category: str = Field(description="availability, work_authorization, application_document, preference, or other.")
    text: str
    source_phrases: List[str] = Field(default_factory=list)


class NormalizedProfileComponents(StrictProfileModel):
    """LLM-normalized LinkedIn-style profile components."""

    intro: ParsedIntroSection = Field(default_factory=ParsedIntroSection)
    about: ParsedAboutSection = Field(default_factory=ParsedAboutSection)
    featured: List[ParsedFeaturedItem] = Field(default_factory=list)
    experience: List[ParsedExperienceItem] = Field(default_factory=list)
    education: List[ParsedEducationItem] = Field(default_factory=list)
    skills: ParsedSkillsSection = Field(default_factory=ParsedSkillsSection)
    licenses_certifications: List[ParsedCertificationItem] = Field(default_factory=list)
    projects: List[ParsedProjectItem] = Field(default_factory=list)
    publications: List[ParsedPublicationItem] = Field(default_factory=list)
    honors_awards: List[ParsedAwardItem] = Field(default_factory=list)
    volunteer_experience: List[ParsedVolunteerItem] = Field(default_factory=list)
    languages: List[ParsedLanguageItem] = Field(default_factory=list)
    recommendations: List[ParsedRecommendationItem] = Field(default_factory=list)
    notes: List[ParsedProfileNote] = Field(default_factory=list)

    @field_validator("intro", "about", "skills", mode="before")
    @classmethod
    def _default_empty_component(cls, value):
        """Treat explicit null component objects from LLMs as omitted."""

        return {} if value is None else value


class LongFormProfileSections(StrictProfileModel):
    """LLM-normalized long-form sections that are easy to truncate in a broad pass."""

    featured: List[ParsedFeaturedItem] = Field(default_factory=list)
    experience: List[ParsedExperienceItem] = Field(default_factory=list)
    projects: List[ParsedProjectItem] = Field(default_factory=list)
    publications: List[ParsedPublicationItem] = Field(default_factory=list)
    licenses_certifications: List[ParsedCertificationItem] = Field(default_factory=list)
    honors_awards: List[ParsedAwardItem] = Field(default_factory=list)
    volunteer_experience: List[ParsedVolunteerItem] = Field(default_factory=list)
    recommendations: List[ParsedRecommendationItem] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ProfileExtractionResult(StrictProfileModel):
    """Profile parser output consumed by unified_profile."""

    documents: List[IngestedProfileDocument]
    components: NormalizedProfileComponents = Field(default_factory=NormalizedProfileComponents)
    links: List[CapturedLink] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ContactInfo(BaseModel):
    """Contact details shown in the unified profile view."""

    model_config = ConfigDict(extra="forbid")

    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    github_url: Optional[str] = None


class ProfileBasics(BaseModel):
    """Top-level identity details for the unified profile."""

    model_config = ConfigDict(extra="forbid")

    name: str = ""
    title: Optional[str] = None
    summary: Optional[str] = None
    contact_info: ContactInfo = Field(default_factory=ContactInfo)
    location: Optional[str] = Field(None, description="City, State, Country")


class UnifiedWorkExperienceItem(BaseModel):
    """Work item rendered by the profile API."""

    model_config = ConfigDict(extra="forbid")

    job_title: str = ""
    company_name: str = ""
    start_date: str = Field(default="", description="YYYY-MM or visible source date")
    end_date: Optional[str] = Field(default=None, description="YYYY-MM, visible source date, or Present")
    is_current: bool = False
    location: Optional[str] = None
    description: List[str] = Field(default_factory=list, description="Responsibilities, scope, and achievements.")
    achievements: List[str] = Field(default_factory=list)


class UnifiedEducationItem(BaseModel):
    """Education item rendered by the profile API."""

    model_config = ConfigDict(extra="forbid")

    institution: str = ""
    degree: Optional[str] = None
    major: Optional[str] = None
    graduation_year: Optional[str] = None


class UnifiedProfileSection(BaseModel):
    """A titled profile section preserved as deduplicated bullet-point pointers.

    This is the home for any resume/profile content that does not map cleanly onto
    the typed core fields (work_experience, education, skills) — for example
    "Additional Experience", "Leadership", "Certifications", "Projects", or
    "Publications". Storing each section as plain pointers keeps the data both
    human-readable in the profile UI and directly consumable by downstream LLM
    steps (job matching, cover letters) without bespoke per-section schemas.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(description="Section heading exactly as a reader would label it, e.g. 'Additional Experience'.")
    pointers: List[str] = Field(
        default_factory=list,
        description="Verbatim bullet-point facts under this section. Each pointer is one self-contained fact; never summarized, shortened, or merged across distinct facts.",
    )


class UnifiedProfile(BaseModel):
    """Renderable profile model stored by the profile API."""

    model_config = ConfigDict(extra="forbid")

    basics: ProfileBasics = Field(default_factory=ProfileBasics)
    work_experience: List[UnifiedWorkExperienceItem] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    education: List[UnifiedEducationItem] = Field(default_factory=list)
    additional_sections: List[UnifiedProfileSection] = Field(
        default_factory=list,
        description="Dynamic, titled sections preserved as pointers and deduplicated by title. Carries every non-core fact so nothing from the source documents is lost.",
    )
    dynamic_sections: Dict[str, Any] = Field(
        default_factory=dict,
        description="Legacy structured carrier for rich parsed components (projects, certifications, awards, etc.). Retained for backward compatibility; new content flows through additional_sections.",
    )

    def to_dict(self) -> Dict[str, Any]:
        """Return model as a dictionary."""

        return self.model_dump()


class ProfileParserLLMResponse(StrictProfileModel):
    """Structured response expected from the profile parsing LLM."""

    components: NormalizedProfileComponents = Field(default_factory=NormalizedProfileComponents)
    warnings: List[str] = Field(default_factory=list)
