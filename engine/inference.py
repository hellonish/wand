"""Central registry of every AI inference call in the engine.

All llm.complete() calls flow through this module. Model selection,
temperature, and token budgets are visible in one place.
"""

from typing import Any, Dict, List, Mapping, Optional, Sequence

from engine.cover_letter.models import CoverLetter, EnhancedPrompt, JDToneAnalysis
from engine.cover_letter.prompts import (
    JD_TONE_SYSTEM_PROMPT,
    JD_TONE_USER_TEMPLATE,
    MODE_TEMPERATURES,
    PROMPT_ENHANCER_SYSTEM_PROMPT,
    PROMPT_ENHANCER_USER_TEMPLATE,
)
from engine.joblens.company_intel.models import (
    CompanyIntelInput,
    CompanyIntelLLMResponse,
    FetchedCompanyPage,
)
from engine.joblens.company_intel.prompts import build_company_intel_messages
from engine.joblens.job_description.models import (
    JobDescriptionBreakdownLLMResponse,
    JobDescriptionInput,
)
from engine.joblens.job_description.prompts import build_job_description_breakdown_messages
from engine.joblens.job_match.models import (
    JobMatchLLMResponse,
    JobMatchRequest,
    JobMatchScore,
    JobMatchScoreLLMResponse,
    ResumeActionsLLMResponse,
)
from engine.joblens.job_match.prompts import (
    build_job_match_messages,
    build_job_match_score_messages,
    build_resume_actions_messages,
)
from engine.joblens.reachout.models import (
    GatedSearchResult,
    ReachoutCandidateValidationLLMResponse,
    ReachoutInput,
    ReachoutQueryPlanLLMResponse,
    ReachoutSearchPlan,
)
from engine.joblens.reachout.prompts import (
    build_candidate_validator_messages,
    build_query_planner_messages,
)
from engine.profile.models import UnifiedProfile
from engine.profile.models import (
    IngestedProfileDocument,
    LongFormProfileSections,
    ProfileParserLLMResponse,
)
from engine.profile.prompts import (
    build_long_form_merge_messages,
    build_long_form_section_messages,
    build_profile_parser_messages,
)


# ── Profile ───────────────────────────────────────────────────────────────────

def parse_profile(
    llm: Any,
    documents: List[IngestedProfileDocument],
) -> ProfileParserLLMResponse:
    """Broad-pass extraction of normalized profile components from documents."""
    return llm.complete(
        response_model=ProfileParserLLMResponse,
        messages=build_profile_parser_messages(documents),
        temperature=0.0,
        max_tokens=24000,
        step="parse_profile",
    )


def extract_long_form_sections(
    llm: Any,
    document: IngestedProfileDocument,
) -> LongFormProfileSections:
    """Extract detailed long-form sections from a single profile document."""
    return llm.complete(
        response_model=LongFormProfileSections,
        messages=build_long_form_section_messages([document]),
        temperature=0.0,
        max_tokens=24000,
        step="extract_long_form_sections",
    )


def merge_long_form_versions(
    llm: Any,
    sections: LongFormProfileSections,
) -> LongFormProfileSections:
    """Merge per-document versions of the same long-form records into one."""
    return llm.complete(
        response_model=LongFormProfileSections,
        messages=build_long_form_merge_messages(sections),
        temperature=0.0,
        max_tokens=24000,
        step="merge_long_form_versions",
    )


_UNIFICATION_SYSTEM_PROMPT = """Create one master profile from the supplied parsed profile sources.
Merge duplicate jobs, schools, skills, and projects into one item each.
Preserve every non-duplicate source fact, bullet, metric, tool, responsibility, achievement, outcome, and qualifier.
Inputs may include multiple resumes, multiple profile versions, and multiple versions of the same project pointers.
Treat each source/version as independent evidence.
When the same real work experience or project appears in multiple sources with different wording, bullets, metrics, links, stack details, dates, titles, or scope, keep one record for the real entity and preserve every non-duplicate detail from every version.
Do not let one resume/version overwrite another. Later, shorter, prettier, or more detailed versions can add details, but they must not erase unique details from other versions.
If scalar fields differ across versions, use the most specific visible value in the scalar field and preserve alternate visible values in the item's descriptive fields or dynamic section data.
Do not summarize, compress, paraphrase, rewrite, shorten, or reduce content to fewer words.
Never use ellipses (`...` or `…`), "etc.", "and more", or similar placeholders to stand in for source content.
Prefer precise source facts over generated prose.
Return data matching the UnifiedProfile schema."""


def unify_profiles(
    llm: Any,
    sources: Mapping[str, Mapping[str, Any]],
    global_context: Optional[str] = None,
    per_file_context: Optional[Mapping[str, str]] = None,
) -> UnifiedProfile:
    """Merge multiple parsed profile sources into a single unified profile."""
    parts = ["PROFILE SOURCES:"]
    for name, data in sources.items():
        parts.append(f"{name}:\n{data}")
    if global_context:
        parts.append(f"GLOBAL CONTEXT:\n{global_context}")
    if per_file_context:
        parts.append("PER-FILE CONTEXT:")
        parts.extend(f"{name}: {ctx}" for name, ctx in per_file_context.items())
    return llm.complete(
        response_model=UnifiedProfile,
        messages=[
            {"role": "system", "content": _UNIFICATION_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        temperature=0.0,
        max_tokens=24000,
        step="unify_profiles",
    )


# ── Job description ───────────────────────────────────────────────────────────

def break_down_job_description(
    llm: Any,
    job_input: JobDescriptionInput,
) -> JobDescriptionBreakdownLLMResponse:
    """Normalize a raw job description into typed matching components."""
    return llm.complete(
        response_model=JobDescriptionBreakdownLLMResponse,
        messages=build_job_description_breakdown_messages(job_input),
        temperature=0.0,
        max_tokens=3000,
        step="job_description",
    )


# ── Company intel ─────────────────────────────────────────────────────────────

def extract_company_intel(
    llm: Any,
    company_input: CompanyIntelInput,
    pages: Sequence[FetchedCompanyPage],
) -> CompanyIntelLLMResponse:
    """Extract structured company intelligence from fetched web pages."""
    return llm.complete(
        response_model=CompanyIntelLLMResponse,
        messages=build_company_intel_messages(
            company_input,
            pages,
            response_schema=CompanyIntelLLMResponse.model_json_schema(),
            response_contract_name="CompanyIntelLLMResponse",
        ),
        temperature=0.0,
        max_tokens=4000,
        step="company_intel",
    )


# ── Job match ─────────────────────────────────────────────────────────────────

def match_profile_to_job(
    llm: Any,
    request: JobMatchRequest,
) -> JobMatchLLMResponse:
    """Score and explain how a unified profile fits a job breakdown (single call)."""
    return llm.complete(
        response_model=JobMatchLLMResponse,
        messages=build_job_match_messages(
            request,
            response_schema=JobMatchLLMResponse.model_json_schema(),
            response_contract_name="JobMatchLLMResponse",
        ),
        temperature=0.0,
        max_tokens=24000,
        step="match_analysis",
    )


def score_job_match(
    llm: Any,
    request: JobMatchRequest,
) -> JobMatchScoreLLMResponse:
    """Phase A — score, evidence, gaps. No resume actions."""
    return llm.complete(
        response_model=JobMatchScoreLLMResponse,
        messages=build_job_match_score_messages(
            request,
            response_schema=JobMatchScoreLLMResponse.model_json_schema(),
        ),
        temperature=0.0,
        max_tokens=8000,
        step="match_analysis",
    )


def generate_resume_actions(
    llm: Any,
    request: JobMatchRequest,
    score: JobMatchScore,
) -> ResumeActionsLLMResponse:
    """Phase B — resume tailoring actions grounded in Phase A score."""
    return llm.complete(
        response_model=ResumeActionsLLMResponse,
        messages=build_resume_actions_messages(
            request,
            score,
            response_schema=ResumeActionsLLMResponse.model_json_schema(),
        ),
        temperature=0.3,
        max_tokens=12000,
        step="resume_actions",
    )


# ── Reachout ──────────────────────────────────────────────────────────────────

def plan_reachout_queries(
    llm: Any,
    reachout_input: ReachoutInput,
) -> ReachoutQueryPlanLLMResponse:
    """Create a targeted public-search plan for finding reachout contacts."""
    return llm.complete(
        response_model=ReachoutQueryPlanLLMResponse,
        messages=build_query_planner_messages(reachout_input),
        temperature=0.4,
        max_tokens=2000,
        step="reachout_query_plan",
    )


def validate_reachout_candidates(
    llm: Any,
    reachout_input: ReachoutInput,
    search_plan: ReachoutSearchPlan,
    gated_results: Sequence[GatedSearchResult],
) -> ReachoutCandidateValidationLLMResponse:
    """Validate and normalize pre-gated search results into reachout candidates."""
    return llm.complete(
        response_model=ReachoutCandidateValidationLLMResponse,
        messages=build_candidate_validator_messages(reachout_input, search_plan, gated_results),
        temperature=0.0,
        max_tokens=4000,
        step="reachout_validate",
    )


# ── Cover letter ──────────────────────────────────────────────────────────────

def analyze_jd_tone(
    llm: Any,
    job_posting: Dict,
) -> JDToneAnalysis:
    """Infer the tone of a job posting to guide cover letter mode selection."""
    user_msg = JD_TONE_USER_TEMPLATE.format(
        job_title=job_posting.get("job_title", ""),
        company_name=job_posting.get("company_name", ""),
        company_about=job_posting.get("company_about", ""),
        job_description=job_posting.get("job_description", ""),
        required=job_posting.get("required_qualifications", []),
        technical=job_posting.get("technical_skills", []),
        keywords=job_posting.get("job_keywords", []),
    )
    return llm.complete(
        response_model=JDToneAnalysis,
        messages=[
            {"role": "system", "content": JD_TONE_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.3,
        max_tokens=1024,
        step="cover_letter_jd_tone",
    )


def enhance_cover_letter_prompt(
    llm: Any,
    rough_prompt: str,
    job_posting: Dict,
    unified_profile: Dict,
) -> EnhancedPrompt:
    """Enhance a rough custom prompt before cover-letter generation."""
    user_msg = PROMPT_ENHANCER_USER_TEMPLATE.format(
        rough_prompt=rough_prompt,
        job_title=job_posting.get("job_title", ""),
        company_name=job_posting.get("company_name", ""),
        company_about=job_posting.get("company_about", ""),
        job_description=job_posting.get("job_description", ""),
        required=job_posting.get("required_qualifications", []),
        technical=job_posting.get("technical_skills", []),
        soft=job_posting.get("soft_skills", []),
        keywords=job_posting.get("job_keywords", []),
        profile=unified_profile,
    )
    return llm.complete(
        response_model=EnhancedPrompt,
        messages=[
            {"role": "system", "content": PROMPT_ENHANCER_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.5,
        max_tokens=2048,
        step="cover_letter_enhance_prompt",
    )


def write_cover_letter(
    llm: Any,
    system_prompt: str,
    context: str,
    mode: str,
) -> CoverLetter:
    """Generate a cover letter given a resolved system prompt and assembled context."""
    return llm.complete(
        response_model=CoverLetter,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Generate a cover letter:\n\n{context}"},
        ],
        temperature=MODE_TEMPERATURES[mode],
        max_tokens=4096,
        step="cover_letter_write",
    )
