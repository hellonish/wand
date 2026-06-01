"""LLM-assisted matching between a unified profile and a JD breakdown."""

from typing import Any, List, Optional

from pydantic import Field

import engine.inference as inference
from engine.profile.models import UnifiedProfile
from engine.providers import XAIClient
from engine.utils import dedupe_warning_strings

from engine.joblens.job_description.models import JobDescriptionBreakdownResult

from .models import JobMatchLLMResponse, JobMatchRequest, JobMatchResult, StrictJobMatchModel


class JobMatcher:
    """Compare a unified profile against a job breakdown with a structured LLM."""

    def __init__(self, llm: Any):
        """Initialize with a required structured-output LLM client."""

        if llm is None:
            raise ValueError("Job matching requires an LLM client.")
        self.llm = llm

    def match(
        self,
        profile: UnifiedProfile,
        job_description: JobDescriptionBreakdownResult,
        base_resume_text: Optional[str] = None,
    ) -> JobMatchResult:
        """Return an explainable profile-to-job match result."""

        request = JobMatchRequest(
            profile=profile,
            job_description=job_description,
            base_resume_text=base_resume_text,
        )
        response = inference.match_profile_to_job(self.llm, request)
        warnings = dedupe_warning_strings([*response.result.warnings, *response.warnings])
        return response.result.model_copy(update={"warnings": warnings})


def match_profile_to_job(
    profile: UnifiedProfile,
    job_description: JobDescriptionBreakdownResult,
    llm: Any,
    base_resume_text: Optional[str] = None,
) -> JobMatchResult:
    """Match a profile to a job using the supplied structured LLM."""

    return JobMatcher(llm).match(
        profile=profile,
        job_description=job_description,
        base_resume_text=base_resume_text,
    )


def match_profile_to_job_with_xai(
    profile: UnifiedProfile,
    job_description: JobDescriptionBreakdownResult,
    model: Optional[str] = None,
    base_resume_text: Optional[str] = None,
) -> JobMatchResult:
    """Convenience wrapper using the shared X.AI structured client."""

    return match_profile_to_job(
        profile=profile,
        job_description=job_description,
        llm=XAIClient(model=model),
        base_resume_text=base_resume_text,
    )
