import pytest

from engine.cover_letter import (
    CoverLetterService,
    generate_cover_letter,
)
from engine.cover_letter.models import CoverLetter, EnhancedPrompt, JDToneAnalysis


JOB_POSTING = {
    "job_title": "Staff Product Engineer",
    "company_name": "Example Labs",
    "company_about": "Builds reliable tools for operations teams.",
    "job_description": "Lead cross-functional product engineering work.",
    "required_qualifications": ["Python", "systems design"],
    "technical_skills": ["Python", "FastAPI"],
    "soft_skills": ["communication"],
    "job_keywords": ["platform", "reliability"],
}

PROFILE = {
    "basics": {"name": "Ada Lovelace"},
    "experience": [{"company": "Analytical Engines", "role": "Engineer"}],
}


class FakeLLM:
    def __init__(self, recommended_mode: str = "storyline") -> None:
        self.recommended_mode = recommended_mode
        self.calls = []

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        response_model = kwargs["response_model"]

        if response_model is JDToneAnalysis:
            return JDToneAnalysis(
                recommended_mode=self.recommended_mode,
                confidence=0.91,
                tone_signals=["make an impact"],
                culture_indicators=["mission-driven"],
                formality_level="semi-formal",
                industry="developer tools",
                reasoning="The JD emphasizes impact and product ownership.",
            )

        if response_model is EnhancedPrompt:
            return EnhancedPrompt(
                enhanced_prompt="Use a confident custom narrative.",
                enhancements_made=["clarified tone"],
                suggested_mode="custom",
            )

        if response_model is CoverLetter:
            return CoverLetter(
                greeting="Dear Hiring Manager,",
                body_paragraphs=[
                    "I build clear systems for product teams.",
                    "This role matches that operating style.",
                ],
                closing_paragraph="I would welcome a conversation.",
                sign_off="Sincerely,",
                full_letter="",
            )

        raise AssertionError(f"unexpected response model: {response_model!r}")


def test_import_smoke():
    import engine.cover_letter as cover_letter

    assert cover_letter.CoverLetterService is CoverLetterService
    assert cover_letter.generate_cover_letter is generate_cover_letter


def test_constructor_rejects_none():
    with pytest.raises(ValueError, match="llm is required"):
        CoverLetterService(None)


def test_regular_mode_generates_cover_letter():
    llm = FakeLLM()

    result = CoverLetterService(llm).generate(
        job_posting=JOB_POSTING,
        unified_profile=PROFILE,
        mode="regular",
    )

    assert result.mode == "regular"
    assert result.company_intel_used is False
    assert result.full_letter == (
        "Dear Hiring Manager,\n\n"
        "I build clear systems for product teams.\n\n"
        "This role matches that operating style.\n\n"
        "I would welcome a conversation.\n\n"
        "Sincerely,\n"
        "Ada Lovelace"
    )
    assert llm.calls[-1]["response_model"] is CoverLetter
    assert llm.calls[-1]["temperature"] == 0.6
    assert (
        "polished, traditional cover letter"
        in llm.calls[-1]["messages"][0]["content"]
    )


def test_auto_mode_uses_jd_recommendation():
    llm = FakeLLM(recommended_mode="disruptive")

    result = CoverLetterService(llm).generate(
        job_posting=JOB_POSTING,
        unified_profile=PROFILE,
        mode="auto",
    )

    assert [call["response_model"] for call in llm.calls] == [JDToneAnalysis, CoverLetter]
    assert result.mode == "disruptive"
    assert result.jd_tone_detected == "disruptive"
    assert result.mode_label == "Auto-Detected: Disruptive"
    assert llm.calls[-1]["temperature"] == 0.85
    assert "refuses to blend in" in llm.calls[-1]["messages"][0]["content"]


def test_custom_mode_enhances_prompt_before_generation():
    llm = FakeLLM()

    result = CoverLetterService(llm).generate(
        job_posting=JOB_POSTING,
        unified_profile=PROFILE,
        mode="custom",
        custom_prompt="  Make this direct and specific.  ",
    )

    assert [call["response_model"] for call in llm.calls] == [EnhancedPrompt, CoverLetter]
    assert result.mode == "custom"
    assert result.enhanced_prompt == "Use a confident custom narrative."
    assert llm.calls[0]["temperature"] == 0.5
    assert (
        "ROUGH USER PROMPT:\nMake this direct and specific."
        in llm.calls[0]["messages"][1]["content"]
    )
    assert llm.calls[-1]["temperature"] == 0.75
    assert (
        "FOLLOW THESE INSTRUCTIONS PRECISELY"
        in llm.calls[-1]["messages"][0]["content"]
    )
    assert (
        "Use a confident custom narrative."
        in llm.calls[-1]["messages"][0]["content"]
    )


def test_invalid_mode_is_rejected_before_llm_call():
    llm = FakeLLM()

    with pytest.raises(ValueError, match="Unsupported cover letter mode"):
        CoverLetterService(llm).generate(
            job_posting=JOB_POSTING,
            unified_profile=PROFILE,
            mode="concise",
        )

    assert llm.calls == []


@pytest.mark.parametrize("custom_prompt", [None, "", "   "])
def test_custom_mode_requires_prompt(custom_prompt):
    llm = FakeLLM()

    with pytest.raises(ValueError, match="custom_prompt is required"):
        CoverLetterService(llm).generate(
            job_posting=JOB_POSTING,
            unified_profile=PROFILE,
            mode="custom",
            custom_prompt=custom_prompt,
        )

    assert llm.calls == []


def test_auto_mode_rejects_invalid_recommendation():
    llm = FakeLLM(recommended_mode="concise")

    with pytest.raises(ValueError, match="Unsupported auto-detected"):
        CoverLetterService(llm).generate(
            job_posting=JOB_POSTING,
            unified_profile=PROFILE,
            mode="auto",
        )

    assert [call["response_model"] for call in llm.calls] == [JDToneAnalysis]


def test_fallback_full_letter_formatting_skips_empty_sections():
    letter = CoverLetter(
        greeting="",
        body_paragraphs=["First paragraph.", "", "  Second paragraph.  "],
        closing_paragraph="",
        sign_off="",
    )

    result = CoverLetterService._format_full_letter(letter, "Ada Lovelace")

    assert result == "First paragraph.\n\nSecond paragraph.\n\nAda Lovelace"
    assert "\n\n\n" not in result


def test_wrapper_function_delegates_to_service():
    generated = generate_cover_letter(
        job_posting=JOB_POSTING,
        unified_profile=PROFILE,
        llm=FakeLLM(),
        mode="regular",
        applicant_name="Grace Hopper",
    )

    assert generated.mode == "regular"
    assert generated.full_letter.endswith("Grace Hopper")
