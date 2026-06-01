"""X.AI-backed profile source merging."""

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import engine.inference as inference
from .models import UnifiedProfile


def merge_profile_sources(
    sources: Mapping[str, Mapping[str, Any]],
    llm: Any = None,
    global_context: Optional[str] = None,
    per_file_context: Optional[Mapping[str, str]] = None,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """Create a unified profile through X.AI or a compatible injected LLM."""

    if not sources:
        return {}, None
    if len(sources) == 1:
        return dict(next(iter(sources.values()))), None

    response = inference.unify_profiles(llm, sources, global_context, per_file_context)
    return response.model_dump(), None


def create_unified_profile(sources: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministically merge parsed profile dictionaries without calling an LLM."""

    base = deepcopy(_first_source(sources) or {})
    if not base:
        return {}

    base["basics"] = _merge_basics(sources)
    base["skills"] = _merge_strings(_iter_values(sources, "skills"))
    base["work_experience"] = _merge_records(_iter_values(sources, "work_experience"), ("company_name", "job_title"))
    base["education"] = _merge_records(_iter_values(sources, "education"), ("institution", "degree"))
    base["dynamic_sections"] = _merge_dynamic_sections(sources)
    return base


def _first_source(sources: Dict[str, Dict[str, Any]]) -> Dict[str, Any] | None:
    for preferred in ("resume", "linkedin", "portfolio"):
        for key, value in sources.items():
            if preferred in key.lower() and value:
                return value
    return next((value for value in sources.values() if value), None)


def _merge_basics(sources: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    basics: Dict[str, Any] = {}
    contact: Dict[str, Any] = {}
    for source in sources.values():
        source_basics = source.get("basics", {}) if isinstance(source, dict) else {}
        for key, value in source_basics.items():
            if key == "contact_info" and isinstance(value, dict):
                for contact_key, contact_value in value.items():
                    if contact_value and not contact.get(contact_key):
                        contact[contact_key] = contact_value
            elif value and not basics.get(key):
                basics[key] = value
    basics["contact_info"] = contact
    return basics


def _iter_values(sources: Dict[str, Dict[str, Any]], key: str) -> Iterable[Any]:
    for source in sources.values():
        if isinstance(source, dict):
            value = source.get(key, [])
            if isinstance(value, list):
                yield from value


def _merge_strings(values: Iterable[Any]) -> List[str]:
    seen = set()
    result = []
    for value in values:
        if not isinstance(value, str):
            continue
        clean = value.strip()
        normalized = " ".join(clean.split()).lower()
        if clean and normalized not in seen:
            seen.add(normalized)
            result.append(clean)
    return result


def _merge_records(values: Iterable[Any], keys: tuple[str, ...]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for value in values:
        if not isinstance(value, dict):
            continue
        signature = tuple(str(value.get(key, "")).strip().lower() for key in keys)
        if any(signature) and signature in seen:
            continue
        seen.add(signature)
        result.append(value)
    return result


def _merge_dynamic_sections(sources: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    for source in sources.values():
        if not isinstance(source, dict):
            continue
        for key, value in source.get("dynamic_sections", {}).items():
            if key not in merged:
                merged[key] = deepcopy(value)
            elif isinstance(merged[key], list) and isinstance(value, list):
                existing = {str(item) for item in merged[key]}
                merged[key].extend(item for item in value if str(item) not in existing)
    return merged
