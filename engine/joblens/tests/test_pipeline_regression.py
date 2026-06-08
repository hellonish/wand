"""
Pipeline Parallelism Regression Tests
======================================
Guards against silent regressions where company_intel and match_score
stop running in parallel (Wave 2), or where resume_actions is accidentally
serialised so that it can no longer overlap with the reachout tail.

If either assertion fails it means a code change has broken the concurrency
structure that was deliberately built into run_job_analysis_background().
"""

import asyncio

from engine.joblens.tests.test_1_flow_analysis import (
    simulate_pipeline,
    InstrumentedLLM,
    _jd_response,
    _score_response,
    _actions_response,
    _company_intel_response,
    _reachout_plan_response,
    _reachout_validation_response,
)


def test_company_intel_overlaps_match():
    """
    Structural regression test: asserts that the Wave 2 parallelism between
    company_intel and match_score is preserved, and that resume_actions (Wave 3)
    starts before reachout finishes (i.e. Wave 3 overlaps the tail of Wave 2).
    """

    # Reachout is given a longer delay (0.15 s) than match_score (0.10 s) so
    # that it is still in-flight when resume_actions starts, exercising the
    # real production overlap where Wave 3 begins as soon as match finishes
    # while reachout is still running.
    jd_llm       = InstrumentedLLM("job_description", delay=0.08).queue(_jd_response())
    score_llm    = InstrumentedLLM("match_score",     delay=0.10).queue(_score_response())
    actions_llm  = InstrumentedLLM("resume_actions",  delay=0.06).queue(_actions_response())
    ci_llm       = InstrumentedLLM("company_intel",   delay=0.09).queue(_company_intel_response())
    reachout_llm = (
        InstrumentedLLM("reachout", delay=0.15)
        .queue(_reachout_plan_response())
        .queue(_reachout_validation_response())
    )

    result = asyncio.run(
        simulate_pipeline(jd_llm, score_llm, actions_llm, ci_llm, reachout_llm)
    )

    timeline = result["timeline"]

    # ── Assert 1: company_intel and match_score overlap ──────────────────────
    ci_start  = next(t for lbl, ev, t in timeline if lbl == "company_intel" and ev == "start")
    ci_done   = next(t for lbl, ev, t in timeline if lbl == "company_intel" and ev == "done")
    ms_start  = next(t for lbl, ev, t in timeline if lbl == "match_score"   and ev == "start")
    ms_done   = next(t for lbl, ev, t in timeline if lbl == "match_score"   and ev == "done")

    overlap = min(ci_done, ms_done) > max(ci_start, ms_start)
    assert overlap, "company_intel and match_score must overlap (run in parallel)"

    # ── Assert 2: resume_actions starts before reachout finishes ────────────
    ra_start      = next(t for lbl, ev, t in timeline if lbl == "resume_actions" and ev == "start")
    reachout_done = next(t for lbl, ev, t in timeline if lbl == "reachout"       and ev == "done")
    assert ra_start < reachout_done, "resume_actions must start before reachout finishes"
