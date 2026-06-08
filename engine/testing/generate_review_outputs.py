"""Write manual review JSON and HTML artifacts for engine modules."""

import json
from pathlib import Path
from typing import Any, List, Optional

# Import target function components
from engine.profile import UnifiedProfile, ingest_documents, build_profile_input, extract_profile_sections, profile_extraction_to_unified_profile
from engine.joblens.company_intel import CompanyIntelInput, CompanyIntelResult, CompanyIntelService, FetchedCompanyPage
from engine.joblens.job_description import JobDescriptionBreakdownResult, break_down_job_description
from engine.joblens.job_match import match_profile_to_job
from engine.joblens.reachout import ReachoutInput, ReachoutService, SearchResult, build_static_search_fn
from engine.providers import XAIClient
from engine.testing.html_report import write_parser_html

ENGINE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ENGINE_DIR / "review_outputs"


def _module_test_dir(module_name: str) -> Path:
    """Return the tests directory for an engine submodule."""

    return ENGINE_DIR / module_name / "tests"


def _joblens_module_test_dir(module_name: str) -> Path:
    """Return the tests directory for a JobLens submodule."""

    return ENGINE_DIR / "joblens" / module_name / "tests"


def write_company_intel_review_outputs(output_dir: Path, llm: Any) -> List[Path]:
    """Generate company-intel review artifacts."""
    written_paths: List[Path] = []
    fixture_dir = _joblens_module_test_dir("company_intel") / "fixtures"
    for fixture_path in sorted(fixture_dir.glob("*.pages.json")):
        payload = _load_fixture(fixture_path)
        company_input = CompanyIntelInput.model_validate(payload["input"])
        pages = [FetchedCompanyPage.model_validate(page) for page in payload["pages"]]
        result = CompanyIntelService(llm=llm)._extract(company_input, pages)
        output_path = output_dir / f"{fixture_path.stem}.intel.json"
        output_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        written_paths.append(output_path)
    return written_paths


def write_job_description_review_outputs(output_dir: Path, llm: Any) -> List[Path]:
    """Generate job-description breakdown review artifacts."""
    written_paths: List[Path] = []
    fixture_dir = _joblens_module_test_dir("job_description") / "fixtures"
    fixture_paths = sorted(path for path in fixture_dir.iterdir() if path.is_file() and path.suffix.lower() == ".txt")
    for path in fixture_paths:
        result = break_down_job_description(
            job_text=path.read_text(encoding="utf-8"),
            source_id=path.name,
            llm=llm,
        )
        output_path = output_dir / f"{path.stem}.breakdown.json"
        output_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        written_paths.append(output_path)
    return written_paths


def write_job_match_review_outputs(output_dir: Path, llm: Any) -> List[Path]:
    """Generate job-match review artifacts."""
    written_paths: List[Path] = []
    profile_path = _joblens_module_test_dir("job_match") / "fixtures" / "sample_unified_profile.json"
    if not profile_path.exists():
        return []
    profile = UnifiedProfile.model_validate_json(profile_path.read_text(encoding="utf-8"))

    # Need job descriptions from output_dir, or fallback to checked-in test_outputs
    jd_paths = sorted(output_dir.glob("*.breakdown.json"))
    if not jd_paths:
        test_output_dir = _joblens_module_test_dir("job_description") / "test_outputs"
        jd_paths = sorted(test_output_dir.glob("*.breakdown.json"))

    for jd_path in jd_paths:
        job = JobDescriptionBreakdownResult.model_validate_json(jd_path.read_text(encoding="utf-8"))
        result = match_profile_to_job(profile=profile, job_description=job, llm=llm)
        # Avoid suffix collision or duplication when outputting
        stem = jd_path.name
        if stem.endswith(".breakdown.json"):
            stem = stem[:-15]
        elif stem.endswith(".json"):
            stem = stem[:-5]
        output_path = output_dir / f"{stem}.breakdown.match.json"
        output_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        written_paths.append(output_path)
    return written_paths


def write_profile_review_outputs(output_dir: Path, llm: Any) -> List[Path]:
    """Generate profile ingestion/extraction review artifacts."""
    # Profile fixtures are PDF, HTML, DOCX
    fixture_dir = _module_test_dir("profile") / "fixtures"
    fixture_paths = sorted(
        path for path in fixture_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".pdf", ".html", ".htm", ".docx", ".txt"}
        and not path.name.startswith(".") and "atom_application_engineer" not in path.name
        and "fovus_software_development_engineer" not in path.name
        and "ltm_full_stack_java_developer" not in path.name
    )
    if not fixture_paths:
        return []

    documents = ingest_documents([build_profile_input(path) for path in fixture_paths])
    extraction = extract_profile_sections(documents, llm)
    unified_profile = profile_extraction_to_unified_profile(extraction)

    written_paths: List[Path] = []
    for document in documents:
        output_path = output_dir / f"{document.metadata.filename}.ingested.json"
        output_path.write_text(document.model_dump_json(indent=2), encoding="utf-8")
        written_paths.append(output_path)

    extraction_path = output_dir / "profile_extraction.xai.json"
    extraction_path.write_text(extraction.model_dump_json(indent=2), encoding="utf-8")
    written_paths.append(extraction_path)

    unified_path = output_dir / "unified_profile.xai.json"
    unified_path.write_text(unified_profile.model_dump_json(indent=2), encoding="utf-8")
    written_paths.append(unified_path)

    html_path = output_dir / "parsed_profiles.html"
    write_parser_html(documents, extraction, html_path, unified_profile=unified_profile)
    written_paths.append(html_path)
    return written_paths


def write_reachout_review_outputs(output_dir: Path, llm: Any) -> List[Path]:
    """Generate reachout review artifacts."""
    written_paths: List[Path] = []
    fixture_dir = _joblens_module_test_dir("reachout") / "fixtures"
    for fixture_path in sorted(fixture_dir.glob("*.reachout_fixture.json")):
        payload = _load_fixture(fixture_path)
        reachout_input = ReachoutInput.model_validate(payload["input"])
        search_fn = build_static_search_fn(
            {
                query: [SearchResult.model_validate(item) for item in results]
                for query, results in payload["results_by_query"].items()
            }
        )
        result = ReachoutService(llm=llm, search_fn=search_fn).discover(reachout_input)
        output_path = output_dir / f"{fixture_path.stem}.json"
        output_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        written_paths.append(output_path)
    return written_paths


def write_review_outputs(
    output_dir: Path = OUTPUT_DIR,
    model: Optional[str] = None,
    llm: Any = None,
    reachout_llm: Any = None,
    features: Optional[List[str]] = None,
) -> List[Path]:
    """Generate manual review artifacts for all sub-features."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if features is None:
        features = ["company_intel", "job_description", "job_match", "profile", "reachout"]

    shared_llm = llm if llm is not None else XAIClient(model=model)
    resolved_reachout_llm = reachout_llm if reachout_llm is not None else shared_llm

    paths: List[Path] = []
    if "company_intel" in features:
        paths.extend(write_company_intel_review_outputs(output_dir, shared_llm))
    if "job_description" in features:
        paths.extend(write_job_description_review_outputs(output_dir, shared_llm))
    if "job_match" in features:
        paths.extend(write_job_match_review_outputs(output_dir, shared_llm))
    if "profile" in features:
        paths.extend(write_profile_review_outputs(output_dir, shared_llm))
    if "reachout" in features:
        paths.extend(write_reachout_review_outputs(output_dir, resolved_reachout_llm))
    return paths


def _load_fixture(path: Path) -> dict:
    """Load a JSON fixture."""
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    for written_path in write_review_outputs():
        print(written_path)
