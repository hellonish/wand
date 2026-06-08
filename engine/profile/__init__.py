"""Profile ingestion, X.AI extraction, and source merging."""

from .extraction import ProfileExtractor, extract_profile_sections
from .ingestion import ProfileIngestor, ingest_document, ingest_documents
from .models import (
    CapturedLink,
    ContactInfo,
    DocumentMetadata,
    FileType,
    IngestedProfileDocument,
    LinkKind,
    LinkSource,
    LongFormProfileSections,
    NormalizedProfileComponents,
    ParsedAboutSection,
    ParsedAwardItem,
    ParsedCertificationItem,
    ParsedEducationItem,
    ParsedExperienceItem,
    ParsedFeaturedItem,
    ParsedIntroSection,
    ParsedLanguageItem,
    ParsedProfileNote,
    ParsedProfileRecord,
    ParsedProjectItem,
    ParsedPublicationItem,
    ParsedRecommendationItem,
    ParsedSkillsSection,
    ParsedVolunteerItem,
    ProfileBasics,
    ProfileDocumentInput,
    ProfileExtractionResult,
    ProfileParserLLMResponse,
    SourceType,
    TextBlock,
    UnifiedEducationItem,
    UnifiedProfile,
    UnifiedProfileSection,
    UnifiedWorkExperienceItem,
)
from .service import (
    ProfileService,
    build_profile_input,
    extract_profile_from_bytes,
    extract_profile_from_files,
    parse_profile_upload,
    profile_extraction_to_unified_profile,
    source_type_from_label,
)
from .unification import create_unified_profile, merge_profile_sources


def parse_resume(file_content: bytes):
    """Parse resume bytes into the unified profile API shape."""

    return ProfileService().parse_upload(
        file_content=file_content,
        filename="resume.pdf",
        content_type="application/pdf",
        source_label="resume",
    ).model_dump()


def parse_linkedin(file_content: bytes):
    """Parse LinkedIn export bytes into the unified profile API shape."""

    return ProfileService().parse_upload(
        file_content=file_content,
        filename="linkedin.pdf",
        content_type="application/pdf",
        source_label="linkedin",
    ).model_dump()


def parse_portfolio(file_content: bytes):
    """Parse portfolio bytes into the unified profile API shape."""

    return ProfileService().parse_upload(
        file_content=file_content,
        filename="portfolio.html",
        content_type="text/html",
        source_label="portfolio",
    ).model_dump()

__all__ = [
    "CapturedLink",
    "ContactInfo",
    "DocumentMetadata",
    "FileType",
    "IngestedProfileDocument",
    "LinkKind",
    "LinkSource",
    "LongFormProfileSections",
    "NormalizedProfileComponents",
    "ParsedAboutSection",
    "ParsedAwardItem",
    "ParsedCertificationItem",
    "ParsedEducationItem",
    "ParsedExperienceItem",
    "ParsedFeaturedItem",
    "ParsedIntroSection",
    "ParsedLanguageItem",
    "ParsedProfileNote",
    "ParsedProfileRecord",
    "ParsedProjectItem",
    "ParsedPublicationItem",
    "ParsedRecommendationItem",
    "ParsedSkillsSection",
    "ParsedVolunteerItem",
    "ProfileBasics",
    "ProfileDocumentInput",
    "ProfileExtractionResult",
    "ProfileExtractor",
    "ProfileIngestor",
    "ProfileParserLLMResponse",
    "ProfileService",
    "SourceType",
    "TextBlock",
    "UnifiedEducationItem",
    "UnifiedProfile",
    "UnifiedProfileSection",
    "UnifiedWorkExperienceItem",
    "build_profile_input",
    "create_unified_profile",
    "extract_profile_sections",
    "extract_profile_from_bytes",
    "extract_profile_from_files",
    "ingest_document",
    "ingest_documents",
    "merge_profile_sources",
    "parse_profile_upload",
    "parse_resume",
    "parse_linkedin",
    "parse_portfolio",
    "profile_extraction_to_unified_profile",
    "source_type_from_label",
]
