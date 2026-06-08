"""
TEST 1 — Pipeline Flow Analysis
================================
Documents exactly what runs in parallel vs serial, in what order,
and how long each step takes. Uses an instrumented FakeLLM so no
real API calls are made — this is a pure structural audit.

Run:
    cd /Users/nishant/Desktop/wand
    python -m pytest engine/joblens/tests/test_1_flow_analysis.py -v -s
"""

import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import pytest

from engine.joblens.job_description import (
    JobDescriptionBreakdownLLMResponse,
    JobDescriptionBreakdown,
    JobMetadata,
    WorkMode,
    SkillRequirement,
    SkillCategory,
    RequirementImportance,
    ResponsibilityRequirement,
    break_down_job_description,
)
from engine.joblens.job_match import (
    JobMatchLLMResponse,
    JobMatchResult,
    JobMatchSummary,
    MatchBand,
    match_profile_to_job,
)
from engine.joblens.job_match.models import (
    JobMatchScoreLLMResponse,
    JobMatchScore,
    ResumeActionsLLMResponse,
    ResumeActions,
    ResumeAction,
    ResumeActionType,
    ActionPriority,
)
from engine.joblens.company_intel import (
    CompanyIntelInput,
    CompanyIntelResult,
    CompanyIntelService,
    FetchedCompanyPage,
)
from engine.joblens.company_intel.models import (
    CompanyIntelLLMResponse,
    CompanyIntelLLMResult,
    CompanyIdentity,
)
from engine.joblens.reachout import (
    ReachoutInput,
    ReachoutResult,
    ReachoutService,
    ReachoutQueryPlanLLMResponse,
    ReachoutCandidateValidationLLMResponse,
    ReachoutSearchPlan,
    ReachoutValidationResult,
    SearchResult,
    build_static_search_fn,
)
from engine.profile.models import UnifiedProfile, ProfileBasics
import engine.inference as inference


# ─── Instrumented FakeLLM ────────────────────────────────────────────────────

@dataclass
class CallRecord:
    step: str
    thread_id: int
    started_at: float
    finished_at: float
    response_model: str
    duration_ms: float = field(init=False)

    def __post_init__(self):
        self.duration_ms = (self.finished_at - self.started_at) * 1000


class InstrumentedLLM:
    """Tracks every LLM call: which thread, what time, what model."""

    def __init__(self, step_name: str, delay: float = 0.05):
        self.step_name = step_name
        self.delay = delay
        self.calls: List[CallRecord] = []
        self._lock = threading.Lock()
        self._responses: List[Any] = []

    def queue(self, response: Any) -> "InstrumentedLLM":
        self._responses.append(response)
        return self

    def complete(self, **kwargs) -> Any:
        started = time.perf_counter()
        time.sleep(self.delay)  # simulate latency
        finished = time.perf_counter()
        record = CallRecord(
            step=self.step_name,
            thread_id=threading.get_ident(),
            started_at=started,
            finished_at=finished,
            response_model=kwargs.get("response_model", type(None)).__name__,
        )
        with self._lock:
            self.calls.append(record)
        if self._responses:
            return self._responses.pop(0)
        raise RuntimeError(f"InstrumentedLLM({self.step_name}): no response queued")


# ─── Fixtures ────────────────────────────────────────────────────────────────

JD_TEXT = """\
Application Engineer — Atom
Location: Austin, TX | Onsite
Primary: Python, JavaScript
Frontend: React, Material UI
Infrastructure: Docker, NGINX
Cloud: AWS
Own architecture, implementation, and maintenance of new software.
2+ years professional software engineering experience required.
"""

def _unified_profile() -> UnifiedProfile:
    return UnifiedProfile(
        basics=ProfileBasics(name="Nishant Sharma", title="Full Stack Engineer", location="Austin, TX"),
        skills=["Python", "JavaScript", "React", "AWS", "Docker"],
    )


def _jd_response() -> JobDescriptionBreakdownLLMResponse:
    return JobDescriptionBreakdownLLMResponse(
        breakdown=JobDescriptionBreakdown(
            metadata=JobMetadata(
                job_title="Application Engineer",
                company_name="Atom",
                location="Austin, TX",
                work_mode=WorkMode.ONSITE,
                years_of_experience_min=2.0,
            ),
            primary_skills=[
                SkillRequirement(name="Python", category=SkillCategory.LANGUAGE,
                                 importance=RequirementImportance.MUST_HAVE, is_must_have=True),
                SkillRequirement(name="JavaScript", category=SkillCategory.LANGUAGE,
                                 importance=RequirementImportance.MUST_HAVE, is_must_have=True),
            ],
            responsibilities=[
                ResponsibilityRequirement(action="own", object="architecture and implementation",
                                          context="new software applications"),
            ],
            keywords=["Python", "JavaScript", "React", "AWS", "Docker"],
        ),
        warnings=[],
    )


def _score_response() -> JobMatchScoreLLMResponse:
    return JobMatchScoreLLMResponse(
        result=JobMatchScore(
            job_title="Application Engineer",
            company_name="Atom",
            summary=JobMatchSummary(
                total_score=78,
                match_band=MatchBand.GOOD,
                headline="Strong Python/JS match; good cloud and infra coverage.",
                strongest_matches=["Python", "JavaScript", "React", "AWS"],
                biggest_gaps=["MSSQL", "Redis"],
            ),
        ),
        warnings=[],
    )


def _actions_response() -> ResumeActionsLLMResponse:
    return ResumeActionsLLMResponse(
        result=ResumeActions(
            update_actions=[
                ResumeAction(
                    action_type=ResumeActionType.UPDATE,
                    priority=ActionPriority.HIGH,
                    target_section="skills",
                    suggested_text="Python, JavaScript, React, AWS, Docker, NGINX",
                    reason="Add Docker and NGINX to align with Atom's infrastructure stack.",
                    jd_alignment=["Infrastructure: Docker, NGINX"],
                )
            ],
            selected_actions=[],
        ),
        warnings=[],
    )


def _company_intel_response() -> CompanyIntelLLMResponse:
    return CompanyIntelLLMResponse(
        result=CompanyIntelLLMResult(
            input=CompanyIntelInput(company_name="Atom", website="https://atom.finance"),
            identity=CompanyIdentity(
                name="Atom",
                website="https://atom.finance",
                industry="FinTech / Investment Technology",
                short_description="Global investment platform with systematic portfolio construction.",
            ),
        ),
        warnings=[],
    )


def _reachout_plan_response() -> ReachoutQueryPlanLLMResponse:
    return ReachoutQueryPlanLLMResponse(
        search_plan=ReachoutSearchPlan(
            company_name="Atom",
            queries=[],
        ),
        warnings=[],
    )


def _reachout_validation_response() -> ReachoutCandidateValidationLLMResponse:
    return ReachoutCandidateValidationLLMResponse(
        validation=ReachoutValidationResult(
            accepted_candidates=[],
            rejected_results=[],
        ),
        warnings=[],
    )


# ─── Pipeline simulation matching api/routers/jobs.py ────────────────────────

async def simulate_pipeline(
    jd_llm: InstrumentedLLM,
    score_llm: InstrumentedLLM,
    actions_llm: InstrumentedLLM,
    company_intel_llm: InstrumentedLLM,
    reachout_llm: InstrumentedLLM,
) -> Dict[str, Any]:
    """Mirrors run_job_analysis_background() from api/routers/jobs.py exactly."""

    timeline: List[Tuple[str, str, float]] = []
    t0 = time.perf_counter()

    def ts(label: str, event: str):
        timeline.append((label, event, (time.perf_counter() - t0) * 1000))

    profile_snapshot = None
    job_description = None

    # ── WAVE 1: profile + job_description run in PARALLEL ────────────────────
    ts("wave_1", "start")

    async def run_profile():
        nonlocal profile_snapshot
        ts("profile", "start")
        # profile loading is DB-only (no LLM) — simulate with a small sleep
        await asyncio.sleep(0.02)
        profile_snapshot = _unified_profile()
        ts("profile", "done")

    async def run_job_description():
        nonlocal job_description
        ts("job_description", "start")
        job_description = await asyncio.to_thread(
            lambda: break_down_job_description(JD_TEXT, llm=jd_llm)
        )
        ts("job_description", "done")

    await asyncio.gather(run_profile(), run_job_description())
    ts("wave_1", "done")

    from engine.joblens.job_description import JobDescriptionBreakdownResult
    from engine.joblens.job_match.models import JobMatchRequest
    import engine.inference as _inf

    # ── WAVE 2: company_intel + match_score + reachout run in PARALLEL ────────
    ts("wave_2", "start")

    async def run_company_intel():
        ts("company_intel", "start")
        result = await asyncio.to_thread(
            lambda: CompanyIntelService(llm=company_intel_llm)._extract(
                CompanyIntelInput(company_name="Atom", website="https://atom.finance"),
                [],
            )
        )
        ts("company_intel", "done")
        return result

    async def run_match_score():
        ts("match_score", "start")
        req = JobMatchRequest(profile=profile_snapshot, job_description=job_description)
        result = await asyncio.to_thread(lambda: _inf.score_job_match(score_llm, req))
        ts("match_score", "done")
        return result.result

    async def run_reachout():
        ts("reachout", "start")
        result = await asyncio.to_thread(
            lambda: ReachoutService(
                llm=reachout_llm,
                search_fn=build_static_search_fn({}),
            ).discover(ReachoutInput(company_name="Atom", target_roles=["Application Engineer"]))
        )
        ts("reachout", "done")
        return result

    # Launch match and reachout as background tasks so Wave 3 can start as soon
    # as match finishes — mirroring the production router (jobs.py).
    match_task   = asyncio.create_task(run_match_score())
    reachout_task = asyncio.create_task(run_reachout())

    # company_intel runs concurrently alongside match and reachout.
    company_intel, _ = await asyncio.gather(run_company_intel(), match_task)
    ts("wave_2", "done")

    match_score = match_task.result()

    # ── WAVE 3: resume_actions starts as soon as match finishes; reachout may
    #    still be in flight — this is the intentional overlap.
    ts("wave_3", "start")

    async def run_resume_actions():
        ts("resume_actions", "start")
        req = JobMatchRequest(profile=profile_snapshot, job_description=job_description)
        result = await asyncio.to_thread(
            lambda: _inf.generate_resume_actions(actions_llm, req, match_score)
        )
        ts("resume_actions", "done")
        return result

    resume_actions_task = asyncio.create_task(run_resume_actions())
    reachout = await reachout_task
    resume_actions = await resume_actions_task

    ts("wave_3", "done")

    return {
        "timeline": timeline,
        "profile_snapshot": profile_snapshot,
        "job_description": job_description,
        "company_intel": company_intel,
        "match_score": match_score,
        "resume_actions": resume_actions.result,
        "reachout": reachout,
    }


# ─── Test ────────────────────────────────────────────────────────────────────

def test_pipeline_flow_and_parallelism(capsys):
    """
    Audit the exact execution order, parallelism, and timing of the pipeline.

    This test:
    1. Runs the full simulated pipeline with instrumented (fake) LLMs
    2. Reports which steps are parallel vs serial
    3. Shows a timeline of events
    4. Confirms Wave 1 and Wave 2 overlap within their respective groups
    """

    # Set up instrumented LLMs with queued responses
    jd_llm        = InstrumentedLLM("job_description", delay=0.08).queue(_jd_response())
    score_llm     = InstrumentedLLM("match_score",     delay=0.10).queue(_score_response())
    actions_llm   = InstrumentedLLM("resume_actions",  delay=0.06).queue(_actions_response())
    ci_llm        = InstrumentedLLM("company_intel",   delay=0.09).queue(_company_intel_response())
    reachout_llm  = InstrumentedLLM("reachout",        delay=0.07) \
                        .queue(_reachout_plan_response()) \
                        .queue(_reachout_validation_response())

    result = asyncio.run(simulate_pipeline(jd_llm, score_llm, actions_llm, ci_llm, reachout_llm))

    timeline    = result["timeline"]
    all_llms    = [jd_llm, score_llm, actions_llm, ci_llm, reachout_llm]
    all_calls   = [c for llm in all_llms for c in llm.calls]

    # ── Print flow report ────────────────────────────────────────────────────
    with capsys.disabled():
        _print_flow_report(timeline, all_calls, result)

    # ── Assertions: structural correctness ───────────────────────────────────

    # Wave 1 must complete before Wave 2 starts
    wave1_done = next(t for (lbl, ev, t) in timeline if lbl == "wave_1" and ev == "done")
    wave2_start = next(t for (lbl, ev, t) in timeline if lbl == "wave_2" and ev == "start")
    assert wave2_start >= wave1_done, "Wave 2 started before Wave 1 finished"

    # Wave 2 must complete before Wave 3 starts
    wave2_done = next(t for (lbl, ev, t) in timeline if lbl == "wave_2" and ev == "done")
    wave3_start = next(t for (lbl, ev, t) in timeline if lbl == "wave_3" and ev == "start")
    assert wave3_start >= wave2_done, "Wave 3 started before Wave 2 finished"

    # Wave 1: profile and job_description should overlap
    profile_start  = next(t for (lbl, ev, t) in timeline if lbl == "profile" and ev == "start")
    jd_start       = next(t for (lbl, ev, t) in timeline if lbl == "job_description" and ev == "start")
    profile_done   = next(t for (lbl, ev, t) in timeline if lbl == "profile" and ev == "done")
    jd_done        = next(t for (lbl, ev, t) in timeline if lbl == "job_description" and ev == "done")
    wave1_overlap  = min(profile_done, jd_done) > max(profile_start, jd_start)
    assert wave1_overlap, "profile and job_description should overlap (run in parallel)"

    # Wave 2: all three steps should overlap
    steps_w2 = ["company_intel", "match_score", "reachout"]
    w2_starts = {s: next(t for (lbl, ev, t) in timeline if lbl == s and ev == "start") for s in steps_w2}
    w2_dones  = {s: next(t for (lbl, ev, t) in timeline if lbl == s and ev == "done")  for s in steps_w2}
    # At least two of them must have overlapping ranges
    overlap_pairs = 0
    checked = []
    for i, s1 in enumerate(steps_w2):
        for s2 in steps_w2[i+1:]:
            if min(w2_dones[s1], w2_dones[s2]) > max(w2_starts[s1], w2_starts[s2]):
                overlap_pairs += 1
            checked.append((s1, s2))
    assert overlap_pairs >= 2, f"Expected Wave 2 steps to overlap in pairs; got {overlap_pairs}/{len(checked)}"

    # resume_actions (Wave 3) must run AFTER match_score (Wave 2)
    match_done    = next(t for (lbl, ev, t) in timeline if lbl == "match_score" and ev == "done")
    actions_start = next(t for (lbl, ev, t) in timeline if lbl == "resume_actions" and ev == "start")
    assert actions_start >= match_done, "resume_actions started before match_score finished"

    # LLM call count
    assert len(jd_llm.calls)       == 1, "job_description should make exactly 1 LLM call"
    assert len(score_llm.calls)    == 1, "match_score (Phase A) should make exactly 1 LLM call"
    assert len(actions_llm.calls)  == 1, "resume_actions (Phase B) should make exactly 1 LLM call"
    assert len(ci_llm.calls)       == 1, "company_intel should make exactly 1 LLM call"
    # reachout makes 1 call (plan) always, and a 2nd call (validate) only when results pass pre-gate.
    # With an empty search fixture, no results pass pre-gate so only the plan call is made.
    assert 1 <= len(reachout_llm.calls) <= 2, "reachout should make 1-2 LLM calls (plan + optional validate)"


def _print_flow_report(
    timeline: List[Tuple[str, str, float]],
    llm_calls: List[CallRecord],
    result: Dict[str, Any],
) -> None:
    SEP = "=" * 72

    print(f"\n{SEP}")
    print("  JOBLENS PIPELINE — FLOW ANALYSIS REPORT")
    print(SEP)

    print("\n▌ ARCHITECTURE OVERVIEW")
    print("""
  The pipeline has 3 sequential WAVES. Within each wave, steps run
  concurrently via asyncio.gather + asyncio.to_thread.

  WAVE 1  ─ runs in PARALLEL ─────────────────────────────────────
    [profile]          Load/build UnifiedProfile from DB/files (no LLM)
    [job_description]  Parse raw JD text → JobDescriptionBreakdown (1 LLM call)

  WAVE 2  ─ runs in PARALLEL  (needs Wave 1 output) ──────────────
    [company_intel]    Fetch company pages → extract intel (1 LLM call)
    [match_score]      Phase A: score profile vs JD (1 LLM call)
    [reachout]         Plan search queries + validate candidates (2 LLM calls)

  WAVE 3  ─ runs SERIALLY  (needs Wave 2 match_score) ─────────────
    [resume_actions]   Phase B: generate resume actions (1 LLM call)

  Total LLM calls per pipeline run: 6 (or 5 if no resume file uploaded)
  Note: reachout makes 2 calls only when search results pass pre-gate.
        With no passing results, the validation call is skipped (1 call).
""")

    print("▌ EXECUTION TIMELINE  (ms from pipeline start)")
    print(f"  {'Step':<20} {'Event':<8} {'Time':>8}")
    print(f"  {'-'*20} {'-'*8} {'-'*8}")
    for lbl, ev, t in timeline:
        marker = "▶" if ev == "start" else "✓"
        print(f"  {lbl:<20} {marker+' '+ev:<10} {t:>7.1f}ms")

    print("\n▌ LLM CALL INVENTORY")
    print(f"  {'Step':<20} {'Response Model':<40} {'Duration':>10}")
    print(f"  {'-'*20} {'-'*40} {'-'*10}")
    for c in sorted(llm_calls, key=lambda x: x.started_at):
        print(f"  {c.step:<20} {c.response_model:<40} {c.duration_ms:>8.1f}ms")

    print(f"\n  Total LLM calls: {len(llm_calls)}")

    print("\n▌ PARALLELISM SUMMARY")
    groups = {
        "Wave 1 (parallel)": ["profile", "job_description"],
        "Wave 2 (parallel)": ["company_intel", "match_score", "reachout"],
        "Wave 3 (serial)":   ["resume_actions"],
    }
    for wave, steps in groups.items():
        starts = {s: next((t for (lbl, ev, t) in timeline if lbl == s and ev == "start"), None) for s in steps}
        ends   = {s: next((t for (lbl, ev, t) in timeline if lbl == s and ev == "done"),  None) for s in steps}
        valid  = [s for s in steps if starts[s] is not None and ends[s] is not None]
        if not valid:
            continue
        wave_start = min(starts[s] for s in valid)
        wave_end   = max(ends[s]   for s in valid)
        print(f"\n  {wave}")
        for s in valid:
            bar_start = int((starts[s] - wave_start) / max(wave_end - wave_start, 1) * 40)
            bar_len   = max(1, int((ends[s] - starts[s]) / max(wave_end - wave_start, 1) * 40))
            bar       = " " * bar_start + "█" * bar_len
            dur       = ends[s] - starts[s]
            print(f"    {s:<20} [{bar:<40}]  {dur:>6.1f}ms")

    print("\n▌ DATA OUTPUTS PRODUCED")
    for key, value in result.items():
        if key == "timeline":
            continue
        if value is None:
            print(f"  {key:<20} → None")
        else:
            t = type(value).__name__
            print(f"  {key:<20} → {t}")

    print(f"\n{SEP}\n")
