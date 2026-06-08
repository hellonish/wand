"""Shared utility helpers for engine modules."""

from collections.abc import Iterable


def dedupe_warning_strings(values: Iterable[object]) -> list[str]:
    """Return unique warning strings while preserving first-seen order."""

    seen = set()
    result = []
    for value in values:
        clean = " ".join(str(value).split())
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
    return result
