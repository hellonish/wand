"""Unified profile merging: LLM synthesis plus a deterministic dedup safety net.

The LLM does the smart cross-document storytelling; the deterministic pass that
runs on every result guarantees entity-level deduplication (companies, schools,
skills, dynamic sections) even when the model misses. Belt and suspenders — the
user should never see the same company or degree twice.
"""

import re
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import engine.inference as inference


# Common legal/entity suffixes stripped when comparing company or school names.
_ENTITY_SUFFIXES = {
    "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
    "gmbh", "plc", "pvt", "private", "llp", "lp", "sa", "ag", "nv", "bv",
    "university", "college", "school", "institute", "institution",
}


def merge_profile_sources(
    sources: Mapping[str, Mapping[str, Any]],
    llm: Any = None,
    global_context: Optional[str] = None,
    per_file_context: Optional[Mapping[str, str]] = None,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """Create a unified profile through an injected LLM, with deterministic cleanup."""

    if not sources:
        return {}, None

    if len(sources) == 1:
        # Single source still needs deduplication: the parser can emit duplicate
        # entries within one document.
        unified = _normalize_unified(dict(next(iter(sources.values()))))
        return unified, None

    response = inference.unify_profiles(llm, sources, global_context, per_file_context)
    unified = _normalize_unified(response.model_dump())
    return unified, None


def create_unified_profile(sources: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministically merge parsed profile dictionaries without calling an LLM."""

    base = deepcopy(_first_source(sources) or {})
    if not base:
        return {}

    base["basics"] = _merge_basics(sources)
    base["skills"] = _merge_strings(_iter_values(sources, "skills"))
    base["work_experience"] = _merge_work_experience(_iter_values(sources, "work_experience"))
    base["education"] = _merge_education(_iter_values(sources, "education"))
    base["additional_sections"] = _merge_additional_sections(_iter_values(sources, "additional_sections"))
    base.pop("dynamic_sections", None)
    return base


# ─── Deterministic normalization pass ─────────────────────────────────────────

def _normalize_unified(data: Dict[str, Any]) -> Dict[str, Any]:
    """Entity-deduplicate a single unified-profile dict in place and return it."""

    if not isinstance(data, dict):
        return {}

    if isinstance(data.get("skills"), list):
        data["skills"] = _merge_strings(data["skills"])
    if isinstance(data.get("work_experience"), list):
        data["work_experience"] = _merge_work_experience(data["work_experience"])
    if isinstance(data.get("education"), list):
        data["education"] = _merge_education(data["education"])
    if isinstance(data.get("additional_sections"), list):
        data["additional_sections"] = _merge_additional_sections(data["additional_sections"])
    return data


def _normalize_entity(name: Any) -> str:
    """Canonical comparison key for a company or institution name."""

    text = str(name or "").lower()
    text = re.sub(r"[.,/&()]", " ", text)
    tokens = [token for token in text.split() if token not in _ENTITY_SUFFIXES]
    return " ".join(tokens)


def _merge_work_experience(values: Iterable[Any]) -> List[Dict[str, Any]]:
    """Merge work items that describe the same role at the same employer."""

    order: List[Tuple[str, str]] = []
    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for value in values:
        if not isinstance(value, dict):
            continue
        key = (_normalize_entity(value.get("company_name")), _normalize_entity(value.get("job_title")))
        if not any(key):
            key = (_normalize_entity(value.get("company_name")), str(value.get("start_date", "")).strip().lower())

        if key not in grouped:
            grouped[key] = deepcopy(value)
            grouped[key]["description"] = _merge_strings(value.get("description") or [])
            grouped[key]["achievements"] = _merge_strings(value.get("achievements") or [])
            order.append(key)
            continue

        target = grouped[key]
        target["description"] = _merge_strings([*target.get("description", []), *(value.get("description") or [])])
        target["achievements"] = _merge_strings([*target.get("achievements", []), *(value.get("achievements") or [])])
        for scalar in ("job_title", "company_name", "start_date", "end_date", "location"):
            if not target.get(scalar) and value.get(scalar):
                target[scalar] = value[scalar]
        target["is_current"] = bool(target.get("is_current") or value.get("is_current"))

    return [grouped[key] for key in order]


def _merge_education(values: Iterable[Any]) -> List[Dict[str, Any]]:
    """Merge education items for the same degree at the same institution."""

    order: List[Tuple[str, str]] = []
    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for value in values:
        if not isinstance(value, dict):
            continue
        key = (_normalize_entity(value.get("institution")), _normalize_entity(value.get("degree")))
        if not any(key):
            continue

        if key not in grouped:
            grouped[key] = deepcopy(value)
            order.append(key)
            continue

        target = grouped[key]
        for scalar in ("degree", "major", "graduation_year"):
            if not target.get(scalar) and value.get(scalar):
                target[scalar] = value[scalar]

    return [grouped[key] for key in order]


def _merge_additional_sections(values: Iterable[Any]) -> List[Dict[str, Any]]:
    """Merge titled pointer sections by normalized title, unioning their pointers."""

    order: List[str] = []
    grouped: Dict[str, Dict[str, Any]] = {}

    for value in values:
        if not isinstance(value, dict):
            continue
        title = str(value.get("title", "")).strip()
        key = " ".join(title.split()).lower()
        if not key:
            continue
        pointers = [p for p in (value.get("pointers") or []) if isinstance(p, str)]

        if key not in grouped:
            grouped[key] = {"title": title, "pointers": _merge_strings(pointers)}
            order.append(key)
        else:
            grouped[key]["pointers"] = _merge_strings([*grouped[key]["pointers"], *pointers])

    return [grouped[key] for key in order if grouped[key]["pointers"]]


# ─── Deterministic source-combining helpers (LLM-free path) ────────────────────

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
