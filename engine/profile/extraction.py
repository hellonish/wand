"""LLM-only extraction into normalized profile components."""

import json
from typing import Any, List, Sequence

from pydantic import Field

import engine.inference as inference
from engine.utils import dedupe_warning_strings

from .models import (
    CapturedLink,
    IngestedProfileDocument,
    LongFormProfileSections,
    NormalizedProfileComponents,
    ProfileExtractionResult,
    ProfileParserLLMResponse,
    StrictProfileModel,
)


LONG_FORM_SECTION_FIELDS = (
    "featured",
    "experience",
    "projects",
    "publications",
    "licenses_certifications",
    "honors_awards",
    "volunteer_experience",
    "recommendations",
)


class ProfileExtractor:
    """Create normalized LinkedIn-style components with a structured LLM."""

    def __init__(self, llm: Any):
        """Initialize with a required structured-output LLM client."""

        if llm is None:
            raise ValueError("Profile extraction requires an LLM client. Use XAIProfileClient for X.AI.")
        self.llm = llm

    def extract(self, documents: List[IngestedProfileDocument]) -> ProfileExtractionResult:
        """Extract components through the LLM using a typed response model."""

        response = inference.parse_profile(self.llm, documents)
        long_form = self._extract_long_form_sections(documents)
        warnings = [warning for document in documents for warning in document.warnings]
        warnings.extend(response.warnings)
        warnings.extend(long_form.warnings)

        return ProfileExtractionResult(
            documents=documents,
            components=self._merge_long_form_sections(response.components, long_form),
            links=self._all_links(documents),
            warnings=dedupe_warning_strings(warnings),
        )

    def _merge_long_form_sections(
        self,
        components: NormalizedProfileComponents,
        long_form: LongFormProfileSections,
    ) -> NormalizedProfileComponents:
        """Merge focused long-form records without dropping broad-pass-only records."""

        updates = {}
        for field in LONG_FORM_SECTION_FIELDS:
            long_form_value = getattr(long_form, field)
            if long_form_value:
                broad_value = getattr(components, field)
                updates[field] = self._dedupe_exact_records([*broad_value, *long_form_value])
        return components.model_copy(update=updates)

    def _extract_long_form_sections(self, documents: Sequence[IngestedProfileDocument]) -> LongFormProfileSections:
        """Extract long-form sections per document, then dedupe exact records."""

        sections = {field: [] for field in LONG_FORM_SECTION_FIELDS}
        warnings: List[str] = []
        for document in documents:
            response = inference.extract_long_form_sections(self.llm, document)
            warnings.extend(response.warnings)
            for field in sections:
                sections[field].extend(getattr(response, field))

        exact_deduped = {field: self._dedupe_exact_records(records) for field, records in sections.items()}
        combined = LongFormProfileSections(**exact_deduped, warnings=dedupe_warning_strings(warnings))
        return self._merge_long_form_versions(combined)

    def _merge_long_form_versions(self, sections: LongFormProfileSections) -> LongFormProfileSections:
        """Ask the LLM to merge per-document versions of the same real records."""

        if not any(getattr(sections, field) for field in LONG_FORM_SECTION_FIELDS):
            return sections
        response = inference.merge_long_form_versions(self.llm, sections)
        exact_deduped = {field: self._dedupe_exact_records(getattr(response, field)) for field in LONG_FORM_SECTION_FIELDS}
        return LongFormProfileSections(**exact_deduped, warnings=dedupe_warning_strings([*sections.warnings, *response.warnings]))

    def _dedupe_exact_records(self, records: list[Any]) -> list[Any]:
        """Drop only byte-equivalent structured records returned by the LLM."""

        seen = set()
        result = []
        for record in records:
            key = json.dumps(record.model_dump(mode="json", exclude_none=True), sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            result.append(record)
        return result

    def _all_links(self, documents: Sequence[IngestedProfileDocument]) -> List[CapturedLink]:
        """Collect unique links from all documents."""

        seen = set()
        links: List[CapturedLink] = []
        for document in documents:
            for link in document.links:
                key = (
                    link.kind.value,
                    link.url.lower().rstrip("/"),
                    (link.label or "").lower().strip(),
                    link.block_id,
                    (link.context or "").lower().strip(),
                )
                if key in seen:
                    continue
                seen.add(key)
                links.append(link)
        return links


def extract_profile_sections(
    documents: List[IngestedProfileDocument],
    llm: Any,
) -> ProfileExtractionResult:
    """Extract normalized components using the supplied LLM."""

    return ProfileExtractor(llm).extract(documents)
