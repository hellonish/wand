"""Detailed prompts for LLM-assisted profile-to-JD matching."""

import json
from typing import Any, Dict, List, Mapping, Optional

from .models import (
    JobMatchLLMResponse,
    JobMatchRequest,
    JobMatchResult,
    JobMatchScore,
    JobMatchScoreLLMResponse,
    ResumeActions,
    ResumeActionsLLMResponse,
)


def build_job_match_messages(
    request: JobMatchRequest,
    response_schema: Optional[Mapping[str, Any]] = None,
    response_contract_name: str = "JobMatchLLMResponse",
) -> List[Dict[str, str]]:
    """Build messages that ask the LLM for a typed match result."""

    return [
        {"role": "system", "content": _system_prompt(response_schema, response_contract_name)},
        {"role": "user", "content": _user_prompt(request, response_contract_name)},
    ]


def _drop_source_phrases(obj: Any) -> None:
    """Recursively remove source_phrases keys from a serialized dict/list in-place."""
    if isinstance(obj, dict):
        obj.pop("source_phrases", None)
        for v in obj.values():
            _drop_source_phrases(v)
    elif isinstance(obj, list):
        for item in obj:
            _drop_source_phrases(item)


def _system_prompt(
    response_schema: Optional[Mapping[str, Any]] = None,
    response_contract_name: str = "JobMatchLLMResponse",
) -> str:
    """Return the matching contract."""

    # Use the wrapper schema (JobMatchLLMResponse) so the LLM knows to return
    # {"result": {...}, "warnings": [...]} — not the inner JobMatchResult fields at root.
    schema = json.dumps(response_schema or JobMatchLLMResponse.model_json_schema(), separators=(',', ':'))
    return f"""
You are `job_match`, the second module in a hybrid job-to-profile matching pipeline.

Your responsibility:
Compare a candidate's structured `UnifiedProfile` against a structured `JobDescriptionBreakdownResult`. Produce an explainable score, evidence-backed match details, and truthful resume actions. The job description has already been broken down; do not re-parse it from raw text except as supporting context.

Output contract:
- Return only data that fits the supplied structured output model.
- Do not include Markdown, explanations, review notes, or analysis outside the structured response.
- Do not invent candidate experience, metrics, tools, education, authorization, location, or outcomes.
- If profile evidence is weak or absent, mark the gap. Do not fill it with plausible-sounding claims.
- Resume actions must be truthful transformations of available profile/base resume evidence.
- If `base_resume_text` is absent, use profile evidence as the target and say so through `target_section` and `target_text`.
- Do not recommend applying to the job or not applying; only score and explain fit.

Scoring rubric:
Use a 100-point total, with these components:
- hard_constraints: 0 to 0 points. Hard constraints gate risk but do not add points. Mention pass/risk/fail/unknown.
- technical_skills: 30 points.
- responsibilities: 25 points.
- project_evidence: 15 points.
- domain_relevance: 10 points.
- seniority_and_ownership: 10 points.
- education_and_logistics: 5 points.
- keyword_coverage: 5 points.

Match band:
- 85-100: strong
- 70-84: good
- 55-69: partial
- below 55: weak

Evidence strength scale:
- 0: no evidence.
- 1: keyword-only mention.
- 2: adjacent or coursework evidence.
- 3: direct project or experience evidence.
- 4: direct shipped or professional evidence.
- 5: direct production evidence with metric, users, reliability, revenue, latency, activation, or operational impact.

Skill matching rules:
- EXACT: profile names the same canonical skill or tool.
- ALIAS: profile names a clear alias, for example JS for JavaScript or MUI for Material UI.
- ADJACENT: profile has a same-category substitute, for example PostgreSQL for MSSQL, Azure for AWS, or Vue for React.
- TRANSFERABLE: profile shows related capability but not the requested tool.
- MISSING: no credible evidence.
- Primary and must-have JD skills should drive most of `technical_skills`.
- Nice-to-have or context skills should not dominate the score.

Responsibility matching rules:
- Compare JD responsibilities against profile work experience, achievements, projects, and dynamic sections.
- Prefer evidence that proves action + object + lifecycle stage.
- Ownership language matters: owning architecture from inception to production is stronger than contributing to a small feature.
- If a responsibility can be proven only by a generic skill list, score it weakly.

Hard constraint rules:
- Check location, work mode, work authorization, sponsorship, degree, GPA, and minimum years only when the JD has evidence.
- If profile does not contain the needed information, status should usually be `unknown`, not fail.
- If JD requires a constraint and profile contradicts it, mark `fail`.
- If JD requires a constraint and profile is unclear, mark `risk` or `unknown` depending on severity.

Resume action rules:
- Create `update_actions` when an existing profile/base resume item is relevant but underspecified.
- Create `replace_actions` when a lower-value or less relevant item should be swapped for stronger evidence that exists in the profile.
- Create `delete_actions` when a content category is likely wasting space for this JD.
- Put the highest-impact actions in `selected_actions`. These should be a concise prioritized subset across update, replace, and delete.
- `suggested_text` should be a resume-ready bullet or phrase only when supported by profile evidence.
- Do not add fake metrics. If no metric exists, use impact wording without a number.
- `jd_alignment` should quote or name the JD requirement the action supports.
- `expected_score_impact` should be qualitative, for example "high technical-skill impact" or "medium responsibility-evidence impact".

Common error checks before final answer:
- Total score equals the sum of score components, excluding hard constraints.
- Score components use the rubric categories and max scores.
- No resume action contains unsupported claims.
- No hard constraint is silently ignored.
- The strongest matches and biggest gaps are grounded in detailed match objects.
- The output is directly usable by a UI and by a later resume editor.

Structured output schema:
{schema}
""".strip()


def _user_prompt(
    request: JobMatchRequest,
    response_contract_name: str = "JobMatchLLMResponse",
) -> str:
    """Return profile and JD source material for matching."""

    jd_data = request.job_description.model_dump(mode="json")
    _drop_source_phrases(jd_data)
    payload = {
        "profile": request.profile.model_dump(mode="json"),
        "job_description": jd_data,
    }
    if request.base_resume_text is not None:
        payload["base_resume_text"] = request.base_resume_text

    return "\n".join(
        [
            "Match this UnifiedProfile against this JobDescriptionBreakdownResult.",
            "Use the supplied structured components, comparison targets, and resume tailoring signals.",
            f"Return a structured {response_contract_name} with `result` (the JobMatchResult) and `warnings` (any output-level warnings).",
            json.dumps(payload),
        ]
    )


# ─── Phase A: scoring only ────────────────────────────────────────────────────

def build_job_match_score_messages(
    request: JobMatchRequest,
    response_schema: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, str]]:
    """Phase A — score, evidence, gaps. No resume actions."""
    schema = json.dumps(response_schema or JobMatchScoreLLMResponse.model_json_schema(), separators=(',', ':'))
    system = f"""
You are `job_match_score`, the scoring phase of a two-phase job-match pipeline.

Your responsibility:
Produce a complete fit assessment — score, evidence, gaps — but do NOT generate resume actions.
Resume actions are handled in a separate phase with full context from this output.

Output contract:
- Return only data fitting JobMatchScoreLLMResponse: {{ result: JobMatchScore, warnings: [] }}
- JobMatchScore has: summary, score_components, constraints, skill_matches,
  responsibility_matches, domain_matches, warnings.
- Do NOT include update_actions, replace_actions, delete_actions, or selected_actions.
- Do not invent evidence. If profile evidence is absent, mark the gap.

{_shared_scoring_rules()}

Structured output schema (JobMatchScoreLLMResponse):
{schema}
""".strip()

    jd_data = request.job_description.model_dump(mode="json")
    _drop_source_phrases(jd_data)
    payload = {
        "profile": request.profile.model_dump(mode="json"),
        "job_description": jd_data,
    }
    if request.base_resume_text is not None:
        payload["base_resume_text"] = request.base_resume_text

    user = "\n".join([
        "Score this UnifiedProfile against this JobDescriptionBreakdownResult.",
        "Return JobMatchScoreLLMResponse with result (JobMatchScore) and warnings.",
        json.dumps(payload),
    ])
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ─── Phase B: resume actions ──────────────────────────────────────────────────

def build_resume_actions_messages(
    request: JobMatchRequest,
    score: "JobMatchScore",
    response_schema: Optional[Mapping[str, Any]] = None,
) -> List[Dict[str, str]]:
    """Phase B — resume actions grounded in Phase A score + gaps."""
    schema = json.dumps(response_schema or ResumeActionsLLMResponse.model_json_schema(), separators=(',', ':'))

    has_candidates = bool(request.resume_candidates)
    has_single = request.base_resume_text is not None and not has_candidates

    if has_candidates:
        resume_instructions = f"""
Resume selection (MANDATORY — do this first before generating any actions):
- You are given {len(request.resume_candidates)} resume file(s) in `resume_candidates`.
- Read ALL resume files, then select the ONE that best fits this specific job description
  based on skill relevance, experience framing, and keyword alignment with the JD.
- You MUST set `selected_resume_filename` to the exact filename string of the chosen resume.
  Omitting or nulling `selected_resume_filename` is an error.
- Every `target_text` value MUST be an exact quote or close paraphrase of a real line
  from the SELECTED resume's text. Do NOT pull `target_text` from profile fields,
  the match_score, or any other source.
- `suggested_text` must be grounded in evidence from the match_score and the selected resume
  — no invented metrics.

Length preservation (STRICT):
- The total bullet/line count of the resume MUST stay the same after all actions are applied.
- Every update_action rewrites one existing line — no net change in count.
- Every replace_action swaps one existing line for a stronger one — no net change in count.
- delete_actions remove lines. If you add net-new content via an update/replace that expands
  to more lines than the original, you MUST include a delete_action to compensate.
- Do NOT suggest adding new sections or new bullet points without removing an equal number.
""".strip()
    elif has_single:
        resume_instructions = """
Resume text usage:
- `base_resume_text` is the authoritative source. Quote or closely paraphrase actual lines
  so the candidate knows exactly what to change.
- `suggested_text` must be grounded in real profile evidence — no invented metrics.

Length preservation (STRICT):
- The total bullet/line count of the resume MUST stay the same after all actions are applied.
- update_action and replace_action each rewrite ONE existing line.
- If any action adds more lines than it removes, include compensating delete_actions.
""".strip()
    else:
        resume_instructions = """
Resume text usage:
- No resume file provided. Target profile evidence fields for `target_text`.
- `suggested_text` must be grounded in real profile evidence — no invented metrics.
""".strip()

    system = f"""
You are `resume_actions`, the tailoring phase of a two-phase job-match pipeline.

Your responsibility:
Given the completed match score and gap analysis, generate specific, evidence-backed
resume actions that help the candidate tailor their resume for this job.

{resume_instructions}

Output contract:
- Return only data fitting ResumeActionsLLMResponse: {{ result: ResumeActions, warnings: [] }}
- ResumeActions has: selected_resume_filename, update_actions, replace_actions, delete_actions, selected_actions, warnings.
- Do not add fake metrics. If no metric exists, use impact wording without a number.
- selected_actions must be a concise prioritised subset across update/replace/delete.

{_shared_action_rules()}

Structured output schema (ResumeActionsLLMResponse):
{schema}
""".strip()

    jd_data = request.job_description.model_dump(mode="json")
    _drop_source_phrases(jd_data)

    if has_candidates:
        # Omit `profile` so target_text can only be grounded in the selected resume's text.
        # The match_score already carries all the evidence and gap context needed.
        payload: dict = {
            "job_description": jd_data,
            "match_score": score.model_dump(mode="json"),
            "resume_candidates": [
                {"filename": c.filename, "text": c.text}
                for c in request.resume_candidates
            ],
        }
    else:
        payload = {
            "profile": request.profile.model_dump(mode="json"),
            "job_description": jd_data,
            "match_score": score.model_dump(mode="json"),
        }
        if has_single:
            payload["base_resume_text"] = request.base_resume_text

    user = "\n".join([
        "Generate resume actions for this candidate based on the match score and gap analysis.",
        "Return ResumeActionsLLMResponse with result (ResumeActions) and warnings.",
        json.dumps(payload),
    ])
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


# ─── Shared rule fragments ────────────────────────────────────────────────────

def _shared_scoring_rules() -> str:
    return """
Scoring rubric (100-point total):
- hard_constraints: gate risk only, do not add points.
- technical_skills: 30 pts. responsibilities: 25 pts. project_evidence: 15 pts.
- domain_relevance: 10 pts. seniority_and_ownership: 10 pts.
- education_and_logistics: 5 pts. keyword_coverage: 5 pts.

Match bands: 85-100 strong | 70-84 good | 55-69 partial | below 55 weak
Evidence strength: 0 none | 1 keyword | 2 adjacent | 3 direct project | 4 professional | 5 production+metric
Skill match levels: EXACT | ALIAS | ADJACENT | TRANSFERABLE | MISSING
""".strip()


def _shared_action_rules() -> str:
    return """
Resume action rules:
- update_actions: existing item is relevant but underspecified.
- replace_actions: lower-value item should be swapped for stronger profile evidence.
- delete_actions: content category likely wastes space for this JD.
- selected_actions: concise prioritised subset across all action types.
- suggested_text: resume-ready bullet only when supported by profile evidence.
- jd_alignment: quote or name the JD requirement the action supports.
- expected_score_impact: qualitative, e.g. "high technical-skill impact".
""".strip()
