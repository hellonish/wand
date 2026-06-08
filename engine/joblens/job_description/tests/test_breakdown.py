"""Tests for job description breakdown."""

from engine.joblens.job_description import (
    JobDescriptionBreakdown,
    JobDescriptionBreakdownLLMResponse,
    JobDescriptionBreaker,
    JobMetadata,
    RequirementImportance,
    ResponsibilityRequirement,
    SkillCategory,
    SkillRequirement,
    WorkMode,
    break_down_job_description,
)
from engine.testing import generate_review_outputs


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


def test_breakdown_uses_structured_llm_response():
    """Use the LLM structured breakdown output directly."""

    llm = FakeLLM(
        JobDescriptionBreakdownLLMResponse(
            breakdown=JobDescriptionBreakdown(
                metadata=JobMetadata(
                    job_title="Application Engineer",
                    company_name="Atom",
                    location="Austin",
                    work_mode=WorkMode.ONSITE,
                ),
                primary_skills=[
                    SkillRequirement(
                        name="Python",
                        category=SkillCategory.LANGUAGE,
                        importance=RequirementImportance.MUST_HAVE,
                        is_must_have=True,
                        source_phrases=["Primary: Python, JavaScript"],
                    )
                ],
                responsibilities=[
                    ResponsibilityRequirement(
                        action="own",
                        object="new software applications",
                        context="close collaboration with Atom's leadership team",
                        source_phrases=[
                            "Own the architecture, implementation, and maintenance of new software applications"
                        ],
                    )
                ],
            ),
            warnings=["Check work mode", "Check work mode"],
        )
    )

    result = break_down_job_description(
        "Application Engineer\nPrimary: Python, JavaScript\nOwn architecture and implementation.",
        llm=llm,
        source_id="atom.txt",
    )

    assert result.input.source_id == "atom.txt"
    assert result.breakdown.metadata.job_title == "Application Engineer"
    assert result.breakdown.primary_skills[0].name == "Python"
    assert result.breakdown.responsibilities[0].action == "own"
    assert result.warnings == ["Check work mode"]


def test_prompt_contains_matching_handoff_contract():
    """Send the LLM a detailed component contract for the future matcher."""

    llm = FakeLLM(JobDescriptionBreakdownLLMResponse())

    break_down_job_description(
        "Full Stack Java Developer\nCore Java, Spring Boot, OOP concepts.",
        llm=llm,
        source_id="ltm.txt",
    )

    call = llm.calls[0]
    messages = call["messages"]

    assert call["response_model"] is JobDescriptionBreakdownLLMResponse
    assert "hybrid job-to-profile matching pipeline" in messages[0]["content"]
    assert "Do not score the candidate" in messages[0]["content"]
    assert "constraints" in messages[0]["content"]
    assert "Source ID: ltm.txt" in messages[1]["content"]
    assert "\nJob Description:\nFull Stack Java Developer" in messages[1]["content"]
    assert "Full Stack Java Developer" in messages[1]["content"]


def test_empty_job_description_is_rejected():
    """Reject empty input before calling the LLM."""

    llm = FakeLLM(JobDescriptionBreakdownLLMResponse())
    breaker = JobDescriptionBreaker(llm)

    try:
        breaker.break_down("   ")
    except ValueError as error:
        assert "cannot be empty" in str(error)
    else:
        raise AssertionError("Expected empty job description to fail")


def test_no_llm_is_rejected():
    """Require all normalized breakdown extraction to go through an LLM."""

    try:
        JobDescriptionBreaker(None)
    except ValueError as error:
        assert "requires an LLM client" in str(error)
    else:
        raise AssertionError("Expected breakdown without an LLM to fail")


def test_review_outputs_accept_falsey_llm(tmp_path, monkeypatch):
    """Use caller-supplied falsey clients instead of constructing X.AI."""

    def fail_xai_client(**kwargs):
        raise AssertionError("X.AI client should not be constructed")

    monkeypatch.setattr(generate_review_outputs, "XAIClient", fail_xai_client)
    llm = FalseyFakeLLM(JobDescriptionBreakdownLLMResponse())

    written_paths = generate_review_outputs.write_review_outputs(output_dir=tmp_path, llm=llm, features=["job_description"])

    assert written_paths
    assert len(llm.calls) == len(written_paths)
