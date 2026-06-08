"""Evaluation harness for the JobLens pipeline.

Offline mode (default, EVAL_USE_LLM=0):
  - JD breakdown: loads test_output JSON directly instead of calling the LLM.
  - Match: loads test_output JSON directly instead of calling the LLM.

Live mode (EVAL_USE_LLM=1):
  - Calls break_down_job_description against the real LLM, then measures
    quality by comparing to the test_output JSON.
  - Match eval still uses test_output JSON because we'd need a running matcher.

Run:
  python -m engine.joblens.eval.runner
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

from engine.joblens.job_description.models import (
    JobDescriptionBreakdownResult,
)
from engine.joblens.job_match.models import JobMatchResult


# ── path constants ────────────────────────────────────────────────────────────

_HERE = Path(__file__).parent
_ENGINE = _HERE.parent.parent.parent  # engine/joblens/eval -> root

_JD_FIXTURES = _ENGINE / "engine" / "joblens" / "job_description" / "tests" / "fixtures"
_JD_OUTPUTS = _ENGINE / "engine" / "joblens" / "job_description" / "tests" / "test_outputs"
_MATCH_OUTPUTS = _ENGINE / "engine" / "joblens" / "job_match" / "tests" / "test_outputs"
_MATCH_FIXTURES = _ENGINE / "engine" / "joblens" / "job_match" / "tests" / "fixtures"

_SCORECARD_PATH = _HERE / "scorecard.json"


# ── helpers ───────────────────────────────────────────────────────────────────

def _load_json(path: Path) -> Dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def _stem(path: Path) -> str:
    """Return filename without extension(s), e.g. foo.breakdown.json → foo."""
    name = path.name
    for suffix in path.suffixes:
        name = name.replace(suffix, "")
    return name


def _non_null_fields(d: Dict[str, Any], prefix: str = "") -> List[str]:
    """Recursively collect dotted paths of non-null scalar fields."""
    paths: List[str] = []
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            paths.extend(_non_null_fields(v, full))
        elif v is not None and v != [] and v != "unspecified":
            paths.append(full)
    return paths


def _validate_jd_result(data: Dict[str, Any]) -> Optional[str]:
    """Return None if valid, or an error string."""
    try:
        JobDescriptionBreakdownResult.model_validate(data)
        return None
    except ValidationError as e:
        return str(e)


def _validate_match_result(data: Dict[str, Any]) -> Optional[str]:
    """Return None if valid, or an error string.

    The test_output JSONs include a legacy `domain_matches` key that the current
    Pydantic model (extra='forbid') does not accept. We strip unknown top-level
    keys before validation so existing fixtures don't break the harness.
    """
    known_fields = set(JobMatchResult.model_fields.keys())
    cleaned = {k: v for k, v in data.items() if k in known_fields}
    try:
        JobMatchResult.model_validate(cleaned)
        return None
    except ValidationError as e:
        return str(e)


# ── JD breakdown eval ─────────────────────────────────────────────────────────

def _eval_jd_fixture(fixture_path: Path, use_llm: bool) -> Dict[str, Any]:
    stem = _stem(fixture_path)  # e.g. atom_application_engineer

    expected_path = _JD_OUTPUTS / f"{stem}.breakdown.json"
    if not expected_path.exists():
        return {"fixture": stem, "skipped": True, "reason": "no expected output file"}

    expected = _load_json(expected_path)
    expected_breakdown = expected.get("breakdown", {})

    if use_llm:
        from engine.joblens.job_description import break_down_job_description
        from engine.providers import XAIClient

        jd_text = fixture_path.read_text()
        actual_result = break_down_job_description(jd_text, llm=XAIClient(), source_id=stem)
        actual_data = actual_result.model_dump()
        actual_breakdown = actual_data.get("breakdown", {})
    else:
        actual_data = expected
        actual_breakdown = expected_breakdown

    schema_error = _validate_jd_result(actual_data)

    expected_non_null = _non_null_fields(expected_breakdown)
    if expected_non_null:
        actual_non_null = set(_non_null_fields(actual_breakdown))
        field_recall = sum(1 for f in expected_non_null if f in actual_non_null) / len(expected_non_null)
    else:
        field_recall = 1.0

    expected_skills: List[str] = [
        s["name"].lower() for s in expected_breakdown.get("primary_skills", []) if isinstance(s, dict) and s.get("name")
    ]
    actual_skills: List[str] = [
        s["name"].lower() for s in actual_breakdown.get("primary_skills", []) if isinstance(s, dict) and s.get("name")
    ]
    if expected_skills:
        primary_skills_recall = sum(1 for s in expected_skills if s in actual_skills) / len(expected_skills)
    else:
        primary_skills_recall = 1.0

    def _responsibility_text(r: Any) -> str:
        if isinstance(r, dict):
            return f"{r.get('action', '')} {r.get('object', '')}".lower().strip()
        return str(r).lower()

    expected_resp = [_responsibility_text(r) for r in expected_breakdown.get("responsibilities", [])]
    actual_resp = [_responsibility_text(r) for r in actual_breakdown.get("responsibilities", [])]
    if expected_resp:
        resp_recall = sum(
            1 for er in expected_resp if any(er in ar or ar in er for ar in actual_resp)
        ) / len(expected_resp)
    else:
        resp_recall = 1.0

    return {
        "fixture": stem,
        "schema_valid": schema_error is None,
        "schema_error": schema_error,
        "field_recall": round(field_recall, 4),
        "primary_skills_recall": round(primary_skills_recall, 4),
        "responsibilities_recall": round(resp_recall, 4),
    }


def eval_jd_breakdowns(use_llm: bool) -> List[Dict[str, Any]]:
    results = []
    for fixture in sorted(_JD_FIXTURES.glob("*.txt")):
        results.append(_eval_jd_fixture(fixture, use_llm))
    return results


# ── match eval ────────────────────────────────────────────────────────────────

def _eval_match_fixture(match_output_path: Path) -> Dict[str, Any]:
    stem = _stem(match_output_path)
    data = _load_json(match_output_path)

    schema_error = _validate_match_result(data)

    summary = data.get("summary", {})
    total_score = summary.get("total_score")

    if total_score is not None:
        score_in_range = 0.0 <= total_score <= 100.0
    else:
        score_in_range = False

    update_actions = data.get("update_actions", [])
    replace_actions = data.get("replace_actions", [])
    delete_actions = data.get("delete_actions", [])
    action_count = len(update_actions) + len(replace_actions) + len(delete_actions)

    biggest_gaps: List[str] = [g.lower() for g in summary.get("biggest_gaps", []) if isinstance(g, str)]
    all_actions = update_actions + replace_actions + delete_actions

    def _action_text(a: Any) -> str:
        if not isinstance(a, dict):
            return ""
        reason = (a.get("reason") or "").lower()
        alignments = " ".join(x.lower() for x in (a.get("jd_alignment") or []) if isinstance(x, str))
        return f"{reason} {alignments}"

    action_texts = [_action_text(a) for a in all_actions]

    if biggest_gaps:
        covered = sum(
            1 for gap in biggest_gaps
            if any(gap in at for at in action_texts)
        )
        gap_coverage = covered / len(biggest_gaps)
    else:
        gap_coverage = 1.0

    return {
        "fixture": stem,
        "schema_valid": schema_error is None,
        "schema_error": schema_error,
        "score_in_range": score_in_range,
        "total_score": total_score,
        "action_count": action_count,
        "gap_coverage": round(gap_coverage, 4),
    }


def eval_matches() -> List[Dict[str, Any]]:
    results = []
    for output in sorted(_MATCH_OUTPUTS.glob("*.match.json")):
        results.append(_eval_match_fixture(output))
    return results


# ── aggregate scorecard ───────────────────────────────────────────────────────

def _mean(values: List[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def build_scorecard(jd_results: List[Dict], match_results: List[Dict]) -> Dict[str, Any]:
    valid_jd = [r for r in jd_results if not r.get("skipped")]
    valid_match = [r for r in match_results if not r.get("skipped")]

    return {
        "jd_breakdown": {
            "fixtures_evaluated": len(valid_jd),
            "schema_pass_rate": _mean([1.0 if r["schema_valid"] else 0.0 for r in valid_jd]),
            "avg_field_recall": _mean([r["field_recall"] for r in valid_jd]),
            "avg_primary_skills_recall": _mean([r["primary_skills_recall"] for r in valid_jd]),
            "avg_responsibilities_recall": _mean([r["responsibilities_recall"] for r in valid_jd]),
            "per_fixture": valid_jd,
        },
        "match": {
            "fixtures_evaluated": len(valid_match),
            "schema_pass_rate": _mean([1.0 if r["schema_valid"] else 0.0 for r in valid_match]),
            "score_in_range_rate": _mean([1.0 if r["score_in_range"] else 0.0 for r in valid_match]),
            "avg_action_count": _mean([float(r["action_count"]) for r in valid_match]),
            "avg_gap_coverage": _mean([r["gap_coverage"] for r in valid_match]),
            "per_fixture": valid_match,
        },
    }


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    use_llm = os.environ.get("EVAL_USE_LLM", "0") == "1"

    jd_results = eval_jd_breakdowns(use_llm=use_llm)
    match_results = eval_matches()
    scorecard = build_scorecard(jd_results, match_results)

    print(json.dumps(scorecard, indent=2))

    with open(_SCORECARD_PATH, "w") as f:
        json.dump(scorecard, f, indent=2)

    print(f"\nScorecard written to {_SCORECARD_PATH}")


if __name__ == "__main__":
    main()
