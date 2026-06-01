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
        dynamic_sections=_dynamic_sections(components, extraction.warnings),
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


def _dynamic_sections(components: NormalizedProfileComponents, warnings: Sequence[str]) -> Dict[str, Any]:
    """Carry rich normalized sections without reinterpreting them."""

    sections: Dict[str, Any] = {}
    for name in (
        "about",
        "featured",
        "projects",
        "publications",
        "licenses_certifications",
        "honors_awards",
        "volunteer_experience",
        "languages",
        "recommendations",
        "notes",
    ):
        payload = _component_payload(getattr(components, name))
        if payload:
            sections[name] = payload
    if warnings:
        sections["warnings"] = list(warnings)
    return sections


def _is_current_end_date(end_date: Optional[str]) -> bool:
    if not end_date:
        return False
    return bool(CURRENT_END_DATE_RE.search(" ".join(end_date.split())))


def _component_payload(value):
    if isinstance(value, list):
        return [
            item
            for item in (record.model_dump(exclude_none=True, exclude_defaults=True) for record in value)
            if item
        ]
    return value.model_dump(exclude_none=True, exclude_defaults=True)


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
