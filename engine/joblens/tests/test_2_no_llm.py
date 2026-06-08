"""
TEST 2 — Run Without LLM
=========================
Shows exactly which parts of the joblens pipeline can execute without
an LLM, and which parts hard-require one. Also verifies that each
module's deterministic logic works correctly independently.

Run:
    cd /Users/nishant/Desktop/wand
    python -m pytest engine/joblens/tests/test_2_no_llm.py -v -s
"""

import json
from pathlib import Path

import pytest

from engine.joblens.job_description import (
    JobDescriptionBreaker,
    break_down_job_description,
)
from engine.joblens.job_match import match_profile_to_job
from engine.joblens.job_match.matcher import JobMatcher
from engine.joblens.company_intel import (
    CompanyIntelInput,
    CompanyIntelService,
)
from engine.joblens.reachout import (
    ReachoutInput,
    ReachoutResult,
    ReachoutService,
    SearchResult,
    build_static_search_fn,
    pre_gate_search_results,
)
from engine.joblens.reachout.helpers import search_ddgs
from engine.joblens.job_description.models import JobDescriptionBreakdownResult, JobDescriptionInput
from engine.profile.models import UnifiedProfile, ProfileBasics


# ─── Fixtures ────────────────────────────────────────────────────────────────

FIXTURES_JD = Path(__file__).parents[1] / "job_description" / "tests" / "fixtures"
FIXTURES_JM = Path(__file__).parents[1] / "job_match" / "tests" / "fixtures"

JD_TEXT = (FIXTURES_JD / "atom_application_engineer.txt").read_text(encoding="utf-8")

PROFILE = UnifiedProfile(
    basics=ProfileBasics(name="Nishant Sharma", title="Full Stack Engineer", location="Austin, TX"),
    skills=["Python", "JavaScript", "React", "AWS"],
)


# ─── 1. Job Description ───────────────────────────────────────────────────────

class TestJobDescriptionWithoutLLM:
    """job_description breakdown requires an LLM — no fallback path exists."""

    def test_none_llm_raises_on_init(self):
        """JobDescriptionBreaker rejects None at construction time."""
        with pytest.raises(ValueError, match="requires an LLM client"):
            JobDescriptionBreaker(None)

    def test_convenience_function_raises_with_none_llm(self):
        """break_down_job_description raises immediately when llm=None."""
        with pytest.raises(ValueError, match="requires an LLM client"):
            break_down_job_description(JD_TEXT, llm=None)

    def test_empty_text_is_rejected_before_llm_call(self):
        """Empty text is rejected before any LLM call — purely deterministic."""

        class NeverCallLLM:
            def complete(self, **kwargs):
                raise AssertionError("LLM should not be called for empty input")

        breaker = JobDescriptionBreaker(NeverCallLLM())
        with pytest.raises(ValueError, match="cannot be empty"):
            breaker.break_down("   ")

    def test_whitespace_only_text_rejected(self):
        """Whitespace-only input is rejected deterministically."""

        class NeverCallLLM:
            def complete(self, **kwargs):
                raise AssertionError("LLM should not be called for whitespace input")

        breaker = JobDescriptionBreaker(NeverCallLLM())
        with pytest.raises(ValueError, match="cannot be empty"):
            breaker.break_down("\n\t  \n")

    def test_pre_llm_input_model_construction(self, capsys):
        """JobDescriptionInput validation is fully deterministic (no LLM needed)."""
        from engine.joblens.job_description.models import JobDescriptionInput
        inp = JobDescriptionInput(text=JD_TEXT, source_id="atom_test")
        # StrictJobDescriptionModel strips whitespace — compare trimmed value
        assert inp.text == JD_TEXT.strip()
        assert inp.source_id == "atom_test"
        with capsys.disabled():
            print(f"\n  JobDescriptionInput constructed successfully without LLM:")
            print(f"    text length  : {len(inp.text)} chars")
            print(f"    source_id    : {inp.source_id}")


# ─── 2. Job Match ──────────────────────────────────────────────────────────────

class TestJobMatchWithoutLLM:
    """job_match also requires an LLM — no rule-based fallback."""

    def test_none_llm_raises_on_init(self):
        with pytest.raises(ValueError, match="requires an LLM client"):
            JobMatcher(None)

    def test_convenience_function_raises_with_none_llm(self):
        jd = JobDescriptionBreakdownResult(
            input=JobDescriptionInput(text=JD_TEXT, source_id="atom"),
        )
        with pytest.raises(ValueError, match="requires an LLM client"):
            match_profile_to_job(profile=PROFILE, job_description=jd, llm=None)

    def test_existing_match_outputs_load_without_llm(self, capsys):
        """Pre-generated match JSON files can be loaded and validated without any LLM."""
        from engine.joblens.job_match import JobMatchResult
        # Match outputs live in test_outputs/, not fixtures/
        output_dir = FIXTURES_JM.parent / "test_outputs"
        match_files = sorted(output_dir.glob("*.match.json"))
        assert match_files, "No pre-generated match files found in fixtures"
        loaded = []
        for path in match_files:
            raw = json.loads(path.read_text(encoding="utf-8"))
            raw.pop("domain_matches", None)  # removed field — strip from legacy fixtures
            result = JobMatchResult.model_validate(raw)
            loaded.append((path.name, result))
        with capsys.disabled():
            print(f"\n  Loaded {len(loaded)} pre-generated match result(s) without LLM:")
            for name, res in loaded:
                print(f"    {name}")
                print(f"      score       : {res.summary.total_score}/100")
                print(f"      band        : {res.summary.match_band.value}")
                print(f"      headline    : {res.summary.headline}")
                print(f"      skills      : {len(res.skill_matches)} matched")
                print(f"      constraints : {len(res.constraints)} checked")
                print(f"      actions     : {len(res.update_actions)} update / {len(res.replace_actions)} replace / {len(res.delete_actions)} delete")


# ─── 3. Company Intel ─────────────────────────────────────────────────────────

class TestCompanyIntelWithoutLLM:
    """company_intel: page discovery + fetching is deterministic; extraction needs LLM."""

    def test_discover_pages_from_website_no_llm(self, capsys):
        """_discover_pages() builds candidate URL list from known website — no LLM, no network."""
        service = CompanyIntelService(llm=None)
        company_input = CompanyIntelInput(company_name="Stripe", website="https://stripe.com")
        pages = service._discover_pages(company_input)
        assert len(pages) > 0
        urls = [p.url for p in pages]
        with capsys.disabled():
            print(f"\n  Discovered {len(pages)} candidate pages (no LLM, no network):")
            for p in pages:
                print(f"    [{p.page_type.value:<15}] conf={p.confidence:.2f}  {p.url}")

    def test_discover_pages_from_name_only_no_llm(self, capsys):
        """When only a company name is given, domains are guessed deterministically."""
        service = CompanyIntelService(llm=None)
        company_input = CompanyIntelInput(company_name="Anthropic")
        pages = service._discover_pages(company_input)
        assert len(pages) > 0
        with capsys.disabled():
            print(f"\n  Guessed {len(pages)} domain(s) for 'Anthropic' (no LLM, no network):")
            for p in pages:
                print(f"    {p.url}  (confidence: {p.confidence})")

    def test_extract_without_llm_raises(self):
        """extract step requires LLM — collecting without one raises at extraction time."""
        service = CompanyIntelService(llm=None)
        company_input = CompanyIntelInput(company_name="Atom", website="https://atom.finance")
        with pytest.raises(Exception):
            service._extract(company_input, [])

    def test_load_fixture_pages_without_llm(self, capsys):
        """Pre-fetched page fixtures can be loaded and inspected without LLM or network."""
        fixture_dir = Path(__file__).parents[1] / "company_intel" / "tests" / "fixtures"
        fixture_files = sorted(fixture_dir.glob("*.pages.json"))
        assert fixture_files, "No company intel page fixtures found"
        for path in fixture_files:
            from engine.joblens.company_intel import FetchedCompanyPage
            payload = json.loads(path.read_text(encoding="utf-8"))
            pages = [FetchedCompanyPage.model_validate(p) for p in payload["pages"]]
            with capsys.disabled():
                print(f"\n  Fixture: {path.name}")
                print(f"    Pages fetched : {len(pages)}")
                for page in pages:
                    print(f"      [{page.page_type.value:<15}] {page.url}")
                    print(f"        title      : {page.title}")
                    print(f"        text chars : {len(page.text)}")
                    print(f"        headings   : {len(page.headings)}")
                    print(f"        links      : {len(page.links)}")


# ─── 4. Reachout ──────────────────────────────────────────────────────────────

class TestReachoutWithoutLLM:
    """reachout: search execution and pre-gating are deterministic; LLM needed for plan + validate."""

    def test_static_search_fn_works_without_llm(self, capsys):
        """build_static_search_fn returns results without any LLM or network call."""
        static_results = {
            'site:linkedin.com/in "Atom" recruiter': [
                SearchResult(title="Jane Doe - Recruiter at Atom", url="https://linkedin.com/in/janedoe",
                             snippet="Recruiter at Atom | 5 years", query='site:linkedin.com/in "Atom" recruiter', rank=1),
                SearchResult(title="John Smith - Talent Acquisition at Atom", url="https://linkedin.com/in/johnsmith",
                             snippet="Talent Acquisition at Atom", query='site:linkedin.com/in "Atom" recruiter', rank=2),
            ]
        }
        search_fn = build_static_search_fn(static_results)
        results = search_fn('site:linkedin.com/in "Atom" recruiter', limit=5)
        assert len(results) == 2
        with capsys.disabled():
            print(f"\n  Static search returned {len(results)} results (no LLM, no network):")
            for r in results:
                print(f"    [{r.rank}] {r.title}")
                print(f"        url     : {r.url}")
                print(f"        snippet : {r.snippet}")

    def test_pre_gate_logic_runs_without_llm(self, capsys):
        """pre_gate_search_results() is purely deterministic — filters by URL patterns."""
        reachout_input = ReachoutInput(
            company_name="Atom",
            target_roles=["Application Engineer"],
        )
        raw_results = [
            SearchResult(title="Jane Doe at Atom", url="https://linkedin.com/in/janedoe",
                         snippet="Recruiter at Atom", query="atom recruiter", rank=1),
            SearchResult(title="Not a person", url="https://atom.finance/about",
                         snippet="About Atom Finance", query="atom company", rank=2),
            SearchResult(title="Invalid", url="https://linkedin.com/jobs/12345",
                         snippet="Job posting", query="atom jobs", rank=3),
        ]
        passed, rejected = pre_gate_search_results(raw_results, reachout_input)
        with capsys.disabled():
            print(f"\n  Pre-gate results (no LLM, no network):")
            print(f"    Passed  : {len(passed)}")
            print(f"    Rejected: {len(rejected)}")
            for r in passed:
                print(f"      ✓ PASSED  : {r.result.url}")
            for r in rejected:
                print(f"      ✗ REJECTED: {r.url} — {r.rejection_reasons}")

    def test_full_discover_without_llm_raises_on_plan(self):
        """The planning step (first LLM call) fails when llm=None."""
        service = ReachoutService(llm=None, search_fn=build_static_search_fn({}))
        reachout_input = ReachoutInput(company_name="Atom")
        with pytest.raises((AttributeError, TypeError)):
            service.discover(reachout_input)

    def test_reachout_fixture_loads_without_llm(self, capsys):
        """Static search fixture can be fully loaded without LLM or network."""
        fixture_dir = Path(__file__).parents[1] / "reachout" / "tests" / "fixtures"
        fixture_path = fixture_dir / "atom_reachout.reachout_fixture.json"
        if not fixture_path.exists():
            pytest.skip("atom_reachout fixture not found")
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        reachout_input = ReachoutInput.model_validate(payload["input"])
        results_by_query: dict[str, list[SearchResult]] = {
            q: [SearchResult.model_validate(r) for r in rs]
            for q, rs in payload["results_by_query"].items()
        }
        total_results = sum(len(v) for v in results_by_query.values())
        with capsys.disabled():
            print(f"\n  Fixture: atom_reachout.reachout_fixture.json")
            print(f"    Company     : {reachout_input.company_name}")
            print(f"    Target roles: {reachout_input.target_roles}")
            print(f"    Queries     : {len(results_by_query)}")
            print(f"    Total results in fixture: {total_results}")
            for query, results in list(results_by_query.items())[:3]:
                print(f"\n    Query: {query[:60]}...")
                for r in results[:2]:
                    print(f"      [{r.rank}] {r.title[:60]}")
                    print(f"            {r.url}")


# ─── 5. Summary: what works without LLM ──────────────────────────────────────

def test_no_llm_capability_matrix(capsys):
    """
    Summarize what parts of joblens work without an LLM.

    This test always passes — it's a documentation fixture.
    """
    with capsys.disabled():
        SEP = "=" * 72
        print(f"\n{SEP}")
        print("  NO-LLM CAPABILITY MATRIX")
        print(SEP)
        print("""
  ┌─────────────────────────┬──────────────┬────────────────────────────────────┐
  │ Module / Step           │ Works w/o LLM│ Notes                              │
  ├─────────────────────────┼──────────────┼────────────────────────────────────┤
  │ job_description         │ ✗ NO         │ Requires LLM from first call        │
  │   ∟ input validation    │ ✓ YES        │ Empty text rejected deterministically│
  │   ∟ model construction  │ ✓ YES        │ JobDescriptionInput builds w/o LLM  │
  ├─────────────────────────┼──────────────┼────────────────────────────────────┤
  │ job_match               │ ✗ NO         │ Requires LLM from first call        │
  │   ∟ existing JSON       │ ✓ YES        │ Pre-generated outputs load fine     │
  ├─────────────────────────┼──────────────┼────────────────────────────────────┤
  │ company_intel           │ PARTIAL      │                                     │
  │   ∟ _discover_pages     │ ✓ YES        │ URL generation is deterministic     │
  │   ∟ _fetch_page         │ ✓ YES        │ HTTP + HTML parsing, no LLM         │
  │   ∟ _extract            │ ✗ NO         │ Requires LLM for extraction         │
  ├─────────────────────────┼──────────────┼────────────────────────────────────┤
  │ reachout                │ PARTIAL      │                                     │
  │   ∟ pre_gate_search     │ ✓ YES        │ URL pattern matching, no LLM        │
  │   ∟ _run_searches       │ ✓ YES        │ Web search, no LLM                  │
  │   ∟ _plan_queries       │ ✗ NO         │ LLM call #1                         │
  │   ∟ _validate_candidates│ ✗ NO         │ LLM call #2                         │
  │   ∟ _with_school_queries│ ✓ YES        │ Deterministic query augmentation    │
  └─────────────────────────┴──────────────┴────────────────────────────────────┘

  KEY FINDING: Only company_intel and reachout have meaningful deterministic
  work (page fetching and web searching). The job_description and job_match
  modules are LLM-only — they raise ValueError immediately without one.
""")
        print(SEP)
