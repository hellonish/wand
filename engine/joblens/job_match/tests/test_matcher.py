"""Tests for profile-to-job matching."""

import json
from pathlib import Path

from engine.joblens.job_description import (
    JobDescriptionBreakdown,
    JobDescriptionBreakdownResult,
    JobDescriptionInput,
    JobMetadata,
    SkillRequirement,
)
from engine.joblens.job_match import (
    EvidenceItem,
    JobMatchLLMResponse,
    JobMatchRequest,
    JobMatchResult,
    JobMatchSummary,
    MatchBand,
    MatchLevel,
    ScoreComponent,
    SkillMatch,
    build_job_match_messages,
    match_profile_to_job,
)
from engine.testing import generate_review_outputs
from engine.profile.models import ProfileBasics, UnifiedProfile


class FakeLLM:
    """Minimal fake LLM client returning a predefined response."""

    def __init__(self, response):
        """Initialize with a static response."""

        self.response = response
        self.calls = []

    def complete(self, **kwargs):
        """Return the static response and record the call."""

        self.calls.append(kwargs)
        return self.response


class FalseyFakeLLM(FakeLLM):
    """Fake LLM client that evaluates as false."""

    def __bool__(self):
        """Return false to exercise explicit None checks."""

        return False


def _profile():
    """Create a minimal profile fixture."""

    return UnifiedProfile(
        basics=ProfileBasics(name="Nishant Sharma", title="Full Stack Engineer", location="Austin, TX"),
        skills=["Python", "JavaScript", "React", "AWS"],
    )


def _job():
    """Create a minimal JD breakdown fixture."""

    return JobDescriptionBreakdownResult(
        input=JobDescriptionInput(text="Application Engineer. Primary: Python, JavaScript.", source_id="atom.txt"),
        breakdown=JobDescriptionBreakdown(
            metadata=JobMetadata(job_title="Application Engineer", company_name="Atom"),
            primary_skills=[SkillRequirement(name="Python")],
        ),
    )


def _minimal_match_response():
    """Create a valid minimal match LLM response."""

    return JobMatchLLMResponse(
        result=JobMatchResult(summary=JobMatchSummary(total_score=0, match_band=MatchBand.WEAK, headline="No evidence."))
    )


def _user_payload(content):
    """Extract the JSON payload from a user prompt."""

    return json.loads(content[content.index("{") :])


def test_matcher_uses_structured_llm_response():
    """Use the LLM structured match output directly."""

    llm = FakeLLM(
        JobMatchLLMResponse(
            result=JobMatchResult(
                job_title="Application Engineer",
                company_name="Atom",
                role_family="full-stack application engineer",
                summary=JobMatchSummary(
                    total_score=82,
                    match_band=MatchBand.GOOD,
                    headline="Good match with strong Python and React evidence.",
                ),
                score_components=[
                    ScoreComponent(name="technical_skills", score=25, max_score=30),
                    ScoreComponent(name="responsibilities", score=20, max_score=25),
                    ScoreComponent(name="project_evidence", score=12, max_score=15),
                    ScoreComponent(name="domain_relevance", score=7, max_score=10),
                    ScoreComponent(name="seniority_and_ownership", score=8, max_score=10),
                    ScoreComponent(name="education_and_logistics", score=5, max_score=5),
                    ScoreComponent(name="keyword_coverage", score=5, max_score=5),
                ],
                skill_matches=[
                    SkillMatch(
                        jd_skill="Python",
                        normalized_skill="Python",
                        match_level=MatchLevel.EXACT,
                        score=1,
                        max_score=1,
                        profile_evidence=[
                            EvidenceItem(
                                profile_field="skills",
                                text="Python",
                                evidence_type="skill",
                                strength=3,
                            )
                        ],
                    )
                ],
                warnings=["Review work authorization", "Review work authorization"],
            ),
            warnings=["Review location"],
        )
    )

    result = match_profile_to_job(profile=_profile(), job_description=_job(), llm=llm)

    assert result.summary.total_score == 82
    assert result.summary.match_band == MatchBand.GOOD
    assert result.skill_matches[0].match_level == MatchLevel.EXACT
    assert result.warnings == ["Review work authorization", "Review location"]


def test_prompt_contains_hybrid_scoring_contract():
    """Send profile and JD breakdown to the LLM with the scoring rubric."""

    llm = FakeLLM(_minimal_match_response())

    match_profile_to_job(profile=_profile(), job_description=_job(), llm=llm)

    call = llm.calls[0]
    messages = call["messages"]

    assert call["response_model"] is JobMatchLLMResponse
    assert "hybrid job-to-profile matching pipeline" in messages[0]["content"]
    assert "technical_skills: 30 points" in messages[0]["content"]
    assert "resume actions" in messages[0]["content"]
    assert "Application Engineer" in messages[1]["content"]
    assert "Python" in messages[1]["content"]


def test_prompt_omits_absent_base_resume_text():
    """Keep the prompt payload stable when no base resume is supplied."""

    messages = build_job_match_messages(JobMatchRequest(profile=_profile(), job_description=_job()))
    payload = _user_payload(messages[1]["content"])

    assert list(payload) == ["profile", "job_description"]


def test_prompt_includes_base_resume_text_when_supplied():
    """Include base resume text only when callers provide it."""

    messages = build_job_match_messages(
        JobMatchRequest(profile=_profile(), job_description=_job(), base_resume_text="Existing resume text")
    )
    payload = _user_payload(messages[1]["content"])

    assert payload["base_resume_text"] == "Existing resume text"


def test_no_llm_is_rejected():
    """Require all match reasoning to go through an LLM client."""

    try:
        match_profile_to_job(profile=_profile(), job_description=_job(), llm=None)
    except ValueError as error:
        assert "requires an LLM client" in str(error)
    else:
        raise AssertionError("Expected matching without an LLM to fail")


def test_review_outputs_accept_falsey_llm(tmp_path, monkeypatch):
    """Use caller-supplied falsey clients instead of constructing X.AI."""

    def fail_xai_client(**kwargs):
        raise AssertionError("X.AI client should not be constructed")

    monkeypatch.setattr(generate_review_outputs, "XAIClient", fail_xai_client)
    llm = FalseyFakeLLM(_minimal_match_response())

    written_paths = generate_review_outputs.write_review_outputs(output_dir=tmp_path, llm=llm, features=["job_match"])

    assert written_paths
    assert len(llm.calls) == len(written_paths)


def test_sample_outputs_validate_against_schema():
    """Keep checked-in manual review outputs aligned with the match schema."""

    output_dir = Path(__file__).resolve().parent / "test_outputs"
    paths = sorted(output_dir.glob("*.match.json"))

    assert paths
    for path in paths:
        JobMatchResult.model_validate_json(path.read_text(encoding="utf-8"))
