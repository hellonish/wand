"""Profile pipeline orchestration for files, uploads, and API storage."""

import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .extraction import extract_profile_sections
from .ingestion import ingest_document, ingest_documents
from .models import (
    ContactInfo,
    NormalizedProfileComponents,
    ProfileBasics,
    ProfileDocumentInput,
    ProfileExtractionResult,
    SourceType,
    UnifiedEducationItem,
    UnifiedProfile,
    UnifiedProfileSection,
    UnifiedWorkExperienceItem,
)
from engine.providers import XAIClient


CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".html": "text/html",
    ".htm": "text/html",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
}

SOURCE_TYPES = {
    "resume": SourceType.RESUME,
    "linkedin": SourceType.LINKEDIN,
    "portfolio": SourceType.PORTFOLIO,
    "other": SourceType.OTHER,
}

CURRENT_END_DATE_RE = re.compile(r"^(present|current|now|ongoing)\b", re.IGNORECASE)


def source_type_from_label(label: Optional[str]) -> SourceType:
    """Map a user-facing upload type to a profile source type."""

    return SOURCE_TYPES.get((label or "other").lower(), SourceType.OTHER)


class ProfileService:
    """Profile ingestion, extraction, merge, and API adaptation service."""

    def __init__(self, llm: Any = None):
        """Initialize with an optional structured-output LLM client."""

        self.llm = llm

    def extract_from_bytes(
        self,
        file_content: bytes,
        filename: str,
        content_type: str,
        source_type: SourceType = SourceType.OTHER,
    ) -> ProfileExtractionResult:
        """Ingest one upload and extract normalized profile components."""

        document = ingest_document(
            ProfileDocumentInput(
                filename=filename,
                content_type=content_type,
                file_bytes=file_content,
                declared_source_type=source_type,
            )
        )
        return extract_profile_sections([document], self.llm or XAIClient())

    def extract_from_files(
        self,
        paths: Sequence[Path | str],
        source_types: Optional[Mapping[str, SourceType]] = None,
    ) -> ProfileExtractionResult:
        """Ingest local files and extract normalized profile components."""

        inputs = []
        for raw_path in paths:
            path = Path(raw_path)
            declared = source_types.get(path.name) if source_types else None
            inputs.append(build_profile_input(path, declared))
        documents = ingest_documents(inputs)
        return extract_profile_sections(documents, self.llm or XAIClient())

    def parse_upload(
        self,
        file_content: bytes,
        filename: str,
        content_type: str,
        source_label: str,
    ) -> UnifiedProfile:
        """Parse one uploaded profile file into a unified profile model."""

        extraction = self.extract_from_bytes(
            file_content=file_content,
            filename=filename,
            content_type=content_type,
            source_type=source_type_from_label(source_label),
        )
        return self.to_unified_profile(extraction)

    def to_unified_profile(self, extraction: ProfileExtractionResult) -> UnifiedProfile:
        """Adapt normalized extraction into the profile shape stored by the API."""

        return profile_extraction_to_unified_profile(extraction)

    def merge_sources(
        self,
        sources: Mapping[str, Mapping[str, Any]],
        global_context: Optional[str] = None,
        per_file_context: Optional[Mapping[str, str]] = None,
    ) -> UnifiedProfile:
        """Merge parsed profile source dictionaries into one unified profile."""

        from .unification import merge_profile_sources

        merged, _ = merge_profile_sources(
            sources,
            self.llm,
            global_context=global_context,
            per_file_context=per_file_context,
        )
        return UnifiedProfile.model_validate(merged)


def build_profile_input(path: Path, declared_source_type: Optional[SourceType] = None) -> ProfileDocumentInput:
    """Build an ingestion input from a local profile file."""

    extension = path.suffix.lower()
    return ProfileDocumentInput(
        filename=path.name,
        content_type=CONTENT_TYPES.get(extension, "application/octet-stream"),
        file_bytes=path.read_bytes(),
        declared_source_type=declared_source_type,
    )


def extract_profile_from_bytes(
    file_content: bytes,
    filename: str,
    content_type: str,
    source_type: SourceType = SourceType.OTHER,
    llm: Any = None,
) -> ProfileExtractionResult:
    """Ingest one upload and extract normalized profile components with X.AI."""

    return ProfileService(llm).extract_from_bytes(
        file_content=file_content,
        filename=filename,
        content_type=content_type,
        source_type=source_type,
    )


def extract_profile_from_files(
    paths: Sequence[Path | str],
    llm: Any = None,
    source_types: Optional[Mapping[str, SourceType]] = None,
) -> ProfileExtractionResult:
    """Ingest local files and extract normalized profile components with X.AI."""

    return ProfileService(llm).extract_from_files(paths, source_types)


def profile_extraction_to_unified_profile(extraction: ProfileExtractionResult) -> UnifiedProfile:
    """Adapt normalized extraction into the profile shape stored by the API."""

    components = extraction.components
    intro = components.intro
    about = components.about

    return UnifiedProfile(
        basics=ProfileBasics(
            name=intro.full_name or "",
            title=intro.target_headline,
            summary=about.role_identity or about.signature_outcome,
            location=intro.location,
            contact_info=ContactInfo(
                email=intro.email,
                phone=intro.phone,
                linkedin_url=intro.linkedin_url,
                portfolio_url=intro.portfolio_url,
                github_url=intro.github_url,
            ),
        ),
        work_experience=[_experience_to_profile(item) for item in components.experience],
        education=[_education_to_profile(item) for item in components.education],
        skills=_component_skills(components),
        additional_sections=_additional_sections(components),
        dynamic_sections=_legacy_dynamic_sections(extraction.warnings),
    )


def parse_profile_upload(
    file_content: bytes,
    filename: str,
    content_type: str,
    source_label: str,
    llm: Any = None,
) -> Dict[str, Any]:
    """Parse one uploaded profile file into API-storable JSON."""

    return ProfileService(llm).parse_upload(
        file_content=file_content,
        filename=filename,
        content_type=content_type,
        source_label=source_label,
    ).model_dump()


def _experience_to_profile(item) -> UnifiedWorkExperienceItem:
    """Adapt one normalized experience item to the API profile shape."""

    achievements = _dedupe_strings(item.achievements)
    return UnifiedWorkExperienceItem(
        job_title=item.job_title or "",
        company_name=item.company or "",
        start_date=item.start_date or "",
        end_date=item.end_date,
        is_current=_is_current_end_date(item.end_date),
        location=item.location,
        description=_dedupe_strings_excluding([*item.scope, *item.responsibilities], achievements),
        achievements=achievements,
    )


def _education_to_profile(item) -> UnifiedEducationItem:
    """Adapt one normalized education item to the API profile shape."""

    return UnifiedEducationItem(
        institution=item.school_institution or "",
        degree=item.degree_program,
        major=item.field_of_study,
        graduation_year=item.graduation_date or item.end_date,
    )


def _component_skills(components: NormalizedProfileComponents) -> List[str]:
    """Flatten skill groups without changing their wording."""

    skills = components.skills
    return _dedupe_strings(
        [
            *skills.technical_skills,
            *skills.functional_skills,
            *skills.domain_skills,
            *skills.soft_skills,
            *components.about.top_skills_tools,
        ]
    )


def _legacy_dynamic_sections(warnings: Sequence[str]) -> Dict[str, Any]:
    """Keep machine-only flags out of the user-facing pointer sections.

    Rich human-readable content now lives in additional_sections; dynamic_sections
    only carries parser warnings (a developer signal, never rendered).
    """

    return {"warnings": list(warnings)} if warnings else {}


def _additional_sections(components: NormalizedProfileComponents) -> List[UnifiedProfileSection]:
    """Flatten rich normalized components into titled, pointer-based sections.

    Every non-core fact is preserved verbatim as a self-contained pointer so the
    data stays human-readable in the profile UI and directly usable by downstream
    LLM steps. Sections with no content are dropped.
    """

    builders = (
        ("Projects", components.projects, _project_pointer),
        ("Featured", components.featured, _featured_pointer),
        ("Publications", components.publications, _publication_pointer),
        ("Certifications & Licenses", components.licenses_certifications, _certification_pointer),
        ("Honors & Awards", components.honors_awards, _award_pointer),
        ("Volunteer Experience", components.volunteer_experience, _volunteer_pointer),
        ("Languages", components.languages, _language_pointer),
        ("Recommendations", components.recommendations, _recommendation_pointer),
        ("Additional Notes", components.notes, _note_pointer),
    )

    sections: List[UnifiedProfileSection] = []
    for title, items, formatter in builders:
        pointers = _dedupe_strings(formatter(item) for item in items if formatter(item))
        if pointers:
            sections.append(UnifiedProfileSection(title=title, pointers=pointers))
    return sections


def _join_pointer(*parts: Optional[str]) -> str:
    """Join present, non-empty fragments into one readable pointer."""

    return " ".join(part.strip() for part in parts if part and part.strip())


def _project_pointer(item) -> str:
    head = item.project_name or "Project"
    if item.role:
        head = f"{head} ({item.role})"
    body = _join_pointer(item.problem, item.outcome)
    tools = f"Tools: {', '.join(item.tools_methods)}." if item.tools_methods else ""
    urls = ", ".join(filter(None, [item.project_url, item.github_url, item.live_demo_url, item.report_url]))
    urls = f"Links: {urls}." if urls else ""
    detail = _join_pointer(body, tools, urls)
    return f"{head} — {detail}" if detail else head


def _featured_pointer(item) -> str:
    head = item.title or "Featured"
    detail = _join_pointer(item.description, item.url)
    return f"{head} — {detail}" if detail else head


def _publication_pointer(item) -> str:
    head = item.title or "Publication"
    detail = _join_pointer(
        item.publisher,
        item.date,
        f"Co-authors: {', '.join(item.coauthors)}." if item.coauthors else None,
        item.url,
        item.relevance,
    )
    return f"{head} — {detail}" if detail else head


def _certification_pointer(item) -> str:
    head = item.credential_name or "Certification"
    detail = _join_pointer(
        item.issuing_organization,
        item.credential_status,
        item.issue_date,
        f"Expires {item.expiration_date}." if item.expiration_date else None,
        item.credential_url,
    )
    return f"{head} — {detail}" if detail else head


def _award_pointer(item) -> str:
    head = item.award_name or "Award"
    detail = _join_pointer(item.issuer, item.date, item.reason)
    return f"{head} — {detail}" if detail else head


def _volunteer_pointer(item) -> str:
    head = _join_pointer(item.role, f"at {item.organization}" if item.organization else None) or "Volunteer"
    detail = _join_pointer(item.cause_mission, item.dates, item.impact)
    return f"{head} — {detail}" if detail else head


def _language_pointer(item) -> str:
    return _join_pointer(item.language, f"({item.proficiency})" if item.proficiency else None, item.use_context)


def _recommendation_pointer(item) -> str:
    head = _join_pointer(item.recommender_name, f"({item.relationship})" if item.relationship else None)
    quote = f'"{item.quote}"' if item.quote else ""
    return _join_pointer(head, quote) if (head or quote) else ""


def _note_pointer(item) -> str:
    return item.text or ""


def _is_current_end_date(end_date: Optional[str]) -> bool:
    if not end_date:
        return False
    return bool(CURRENT_END_DATE_RE.search(" ".join(end_date.split())))


def _dedupe_strings(values: Iterable[str]) -> List[str]:
    """Deduplicate exact text values while preserving the first source wording."""

    seen = set()
    result = []
    for value in values:
        clean = str(value).strip()
        key = " ".join(clean.split()).lower()
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
    return result


def _dedupe_strings_excluding(values: Iterable[str], excluded: Iterable[str]) -> List[str]:
    excluded_keys = {" ".join(str(value).strip().split()).lower() for value in excluded if str(value).strip()}
    return [value for value in _dedupe_strings(values) if " ".join(value.split()).lower() not in excluded_keys]
