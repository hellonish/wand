"""
Tests for resume candidate selection in Phase B (resume actions).

Covers:
- Single resume → used directly, no selection needed
- Multiple resumes → LLM receives all candidates, selects one, sets selected_resume_filename
- Zero resumes → base_resume_text fallback still works
- Length preservation instructions appear in prompt when candidates provided
- selected_resume_filename propagates from LLM output to ResumeActions model
"""

import json
from pathlib import Path

from engine.joblens.job_description.models import (
    JobDescriptionBreakdownResult,
    JobDescriptionInput,
)
from engine.joblens.job_match.models import (
    JobMatchRequest,
    JobMatchScore,
    JobMatchSummary,
    MatchBand,
    ResumeActions,
    ResumeCandidateInput,
)
from engine.joblens.job_match.prompts import build_resume_actions_messages

# ─── Fixtures ────────────────────────────────────────────────────────────────

from engine.profile.models import ProfileBasics, UnifiedProfile

_PROFILE = UnifiedProfile(
    basics=ProfileBasics(name="Test User", title="Software Engineer", location="New York, NY"),
    skills=["Python", "FastAPI", "React"],
)

_JD = JobDescriptionBreakdownResult(
    input=JobDescriptionInput(text="Build backend APIs with Python and FastAPI.", source_id="test"),
)

_SCORE = JobMatchScore(
    summary=JobMatchSummary(
        total_score=72.0,
        match_band=MatchBand.GOOD,
        headline="Strong backend match",
    )
)

_RESUME_A = ResumeCandidateInput(
    filename="resume_general.pdf",
    text="Software Engineer with 3 years experience.\n• Built REST APIs with Python\n• Led a 2-person team",
)

_RESUME_B = ResumeCandidateInput(
    filename="resume_backend.pdf",
    text="Backend Engineer specializing in Python, FastAPI, and PostgreSQL.\n• Designed async pipelines\n• Deployed on AWS EC2",
)


# ─── Prompt content tests (no LLM needed) ────────────────────────────────────

class TestResumeActionPromptBuilding:
    """Verify prompt content for all resume input modes."""

    def _get_user_payload(self, messages: list) -> dict:
        user_msg = next(m for m in messages if m["role"] == "user")
        lines = user_msg["content"].strip().split("\n")
        return json.loads(lines[-1])

    def test_no_candidates_no_base_text(self):
        """No resume provided → profile evidence fallback instructions, no candidates key."""
        request = JobMatchRequest(profile=_PROFILE, job_description=_JD)
        messages = build_resume_actions_messages(request, _SCORE)
        system = messages[0]["content"]
        payload = self._get_user_payload(messages)

        assert "resume_candidates" not in payload
        assert "base_resume_text" not in payload
        assert "No resume file provided" in system
        assert "profile evidence" in system

    def test_single_candidate_in_prompt(self):
        """One resume candidate → appears in resume_candidates list in payload."""
        request = JobMatchRequest(profile=_PROFILE, job_description=_JD, resume_candidates=[_RESUME_A])
        messages = build_resume_actions_messages(request, _SCORE)
        payload = self._get_user_payload(messages)

        assert "resume_candidates" in payload
        assert len(payload["resume_candidates"]) == 1
        assert payload["resume_candidates"][0]["filename"] == "resume_general.pdf"
        assert payload["resume_candidates"][0]["text"] == _RESUME_A.text

    def test_multiple_candidates_in_prompt(self):
        """Multiple resume candidates → all passed, prompt instructs selection."""
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            resume_candidates=[_RESUME_A, _RESUME_B],
        )
        messages = build_resume_actions_messages(request, _SCORE)
        system = messages[0]["content"]
        payload = self._get_user_payload(messages)

        assert len(payload["resume_candidates"]) == 2
        filenames = [c["filename"] for c in payload["resume_candidates"]]
        assert "resume_general.pdf" in filenames
        assert "resume_backend.pdf" in filenames

        assert "2 resume file(s)" in system
        assert "selected_resume_filename" in system
        assert "Select the ONE that best fits" in system

    def test_gap_coverage_and_volume_instructions_present_with_candidates(self):
        """Phase 3C: gap-coverage + output-volume rules replace the old zero-sum length rule."""
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            resume_candidates=[_RESUME_A, _RESUME_B],
        )
        messages = build_resume_actions_messages(request, _SCORE)
        system = messages[0]["content"]

        # The zero-sum "Length preservation" mandate was deliberately removed in Phase 3C.
        assert "Length preservation" not in system
        assert "Gap coverage" in system
        assert "biggest_gaps" in system
        assert "5 to 9 high-impact actions" in system

    def test_gap_coverage_and_volume_instructions_present_with_base_text(self):
        """Phase 3C: gap-coverage + output-volume rules apply on the single base_resume_text path too."""
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            base_resume_text="Existing resume text.\n• Bullet one\n• Bullet two",
        )
        messages = build_resume_actions_messages(request, _SCORE)
        system = messages[0]["content"]

        assert "Length preservation" not in system
        assert "Gap coverage" in system

    def test_candidates_take_priority_over_base_resume_text(self):
        """When both resume_candidates and base_resume_text set, candidates win."""
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            base_resume_text="Should be ignored",
            resume_candidates=[_RESUME_A],
        )
        messages = build_resume_actions_messages(request, _SCORE)
        payload = self._get_user_payload(messages)

        assert "resume_candidates" in payload
        assert "base_resume_text" not in payload

    def test_schema_contains_selected_resume_filename(self):
        """ResumeActionsLLMResponse schema includes selected_resume_filename field."""
        from engine.joblens.job_match.models import ResumeActionsLLMResponse
        schema = ResumeActionsLLMResponse.model_json_schema()
        result_props = schema["$defs"]["ResumeActions"]["properties"]
        assert "selected_resume_filename" in result_props


# ─── Model tests (no LLM needed) ─────────────────────────────────────────────

class TestResumeActionsModel:
    """Verify model construction and field defaults."""

    def test_selected_resume_filename_defaults_to_none(self):
        actions = ResumeActions()
        assert actions.selected_resume_filename is None

    def test_selected_resume_filename_set(self):
        actions = ResumeActions(selected_resume_filename="resume_backend.pdf")
        assert actions.selected_resume_filename == "resume_backend.pdf"

    def test_resume_candidate_input_construction(self):
        candidate = ResumeCandidateInput(filename="cv.pdf", text="My resume text")
        assert candidate.filename == "cv.pdf"
        assert candidate.text == "My resume text"

    def test_job_match_request_with_candidates(self):
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            resume_candidates=[_RESUME_A, _RESUME_B],
        )
        assert len(request.resume_candidates) == 2
        assert request.resume_candidates[0].filename == "resume_general.pdf"

    def test_job_match_request_candidates_default_empty(self):
        request = JobMatchRequest(profile=_PROFILE, job_description=_JD)
        assert request.resume_candidates == []


# ─── FakeLLM integration test ────────────────────────────────────────────────

class TestResumeSelectionWithFakeLLM:
    """Verify end-to-end flow with a fake LLM that returns selected_resume_filename."""

    def _make_fake_llm(self, selected_filename: str):
        from engine.joblens.job_match.models import ResumeActionsLLMResponse

        class FakeLLM:
            def complete(self, response_model, messages, **kwargs):
                return response_model(
                    result={
                        "selected_resume_filename": selected_filename,
                        "update_actions": [],
                        "replace_actions": [],
                        "delete_actions": [],
                        "selected_actions": [],
                        "warnings": [],
                    },
                    warnings=[],
                )

        return FakeLLM()

    def test_single_candidate_filename_returned(self):
        """LLM sets selected_resume_filename; it appears in the result."""
        import engine.inference as inference
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            resume_candidates=[_RESUME_A],
        )
        fake_llm = self._make_fake_llm("resume_general.pdf")
        result = inference.generate_resume_actions(fake_llm, request, _SCORE)
        assert result.result.selected_resume_filename == "resume_general.pdf"

    def test_multi_candidate_filename_returned(self):
        """With two candidates, LLM-selected filename propagates to result."""
        import engine.inference as inference
        request = JobMatchRequest(
            profile=_PROFILE,
            job_description=_JD,
            resume_candidates=[_RESUME_A, _RESUME_B],
        )
        fake_llm = self._make_fake_llm("resume_backend.pdf")
        result = inference.generate_resume_actions(fake_llm, request, _SCORE)
        assert result.result.selected_resume_filename == "resume_backend.pdf"

    def test_no_candidates_filename_none(self):
        """Without candidates, selected_resume_filename stays None."""
        import engine.inference as inference
        request = JobMatchRequest(profile=_PROFILE, job_description=_JD)
        fake_llm = self._make_fake_llm(None)
        result = inference.generate_resume_actions(fake_llm, request, _SCORE)
        assert result.result.selected_resume_filename is None
