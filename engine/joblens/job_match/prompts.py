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
    include_schema_in_prompt: bool = True,
) -> List[Dict[str, str]]:
    """Build messages that ask the LLM for a typed match result."""

    return [
        {"role": "system", "content": _system_prompt(response_schema, response_contract_name, include_schema_in_prompt)},
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
    include_schema_in_prompt: bool = True,
) -> str:
    """Return the matching contract."""

    # Use the wrapper schema (JobMatchLLMResponse) so the LLM knows to return
    # {"result": {...}, "warnings": [...]} — not the inner JobMatchResult fields at root.
    if include_schema_in_prompt:
        schema = json.dumps(response_schema or JobMatchLLMResponse.model_json_schema(), separators=(',', ':'))
        schema_block = f"\nStructured output schema:\n{schema}"
    else:
        schema_block = ""
    return f"""
You are `job_match`, the second module in a hybrid job-to-profile matching pipeline.

Your responsibility:
Compare a candidate's structured `UnifiedProfile` against a structured `JobDescriptionBreakdownResult`. Produce an explainable score, evidence-backed match details, and truthful resume actions. The job description has already been broken down; do not re-parse it from raw text except as supporting context.

Evidence sourcing (read the WHOLE profile, do not cherry-pick):
- The `UnifiedProfile` carries evidence in several places: `basics.summary`, `work_experience` (descriptions + achievements), `education`, `skills`, and `additional_sections` — a list of `{title, pointers}` groups (e.g. "Additional Experience", "Projects", "Certifications", "Publications").
- Mine ALL of them. A JD requirement is frequently proven by a pointer inside `additional_sections`, not by a core field. Extract and infer the matching evidence rather than only matching the obvious top-level fields.
- When you cite evidence, set `profile_field` to where it came from (e.g. "work_experience[1].achievements", "additional_sections['Projects']") so the match is traceable.

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
- Compare JD responsibilities against profile work experience, achievements, and every additional_sections pointer (projects, additional experience, leadership, etc.).
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
{schema_block}
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
    include_schema_in_prompt: bool = True,
) -> List[Dict[str, str]]:
    """Phase A — score, evidence, gaps. No resume actions."""
    if include_schema_in_prompt:
        schema = json.dumps(response_schema or JobMatchScoreLLMResponse.model_json_schema(), separators=(',', ':'))
        schema_block = f"\nStructured output schema (JobMatchScoreLLMResponse):\n{schema}"
    else:
        schema_block = ""
    system = f"""
You are `job_match_score`, the scoring phase of a two-phase job-match pipeline.

Your responsibility:
Produce a complete fit assessment — score, evidence, gaps — but do NOT generate resume actions.
Resume actions are handled in a separate phase with full context from this output.

Output contract:
- Return only data fitting JobMatchScoreLLMResponse: {{ result: JobMatchScore, warnings: [] }}
- JobMatchScore has: summary, score_components, constraints, skill_matches,
  responsibility_matches, warnings.
- Do NOT include update_actions, replace_actions, delete_actions, or selected_actions.
- Do not invent evidence. If profile evidence is absent, mark the gap.

{_shared_scoring_rules()}
- If company_summary is provided, use it to calibrate domain_relevance and technical_skills scores — a candidate whose background matches the company's actual tech stack should score higher than one who only matches the JD keywords.
{schema_block}
""".strip()

    jd_data = request.job_description.model_dump(mode="json")
    _drop_source_phrases(jd_data)
    payload = {
        "profile": request.profile.model_dump(mode="json"),
        "job_description": jd_data,
    }
    if request.base_resume_text is not None:
        payload["base_resume_text"] = request.base_resume_text
    if request.company_summary:
        payload["company_summary"] = request.company_summary

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
    include_schema_in_prompt: bool = True,
) -> List[Dict[str, str]]:
    """Phase B — resume actions grounded in Phase A score + gaps."""
    if include_schema_in_prompt:
        schema = json.dumps(response_schema or ResumeActionsLLMResponse.model_json_schema(), separators=(',', ':'))
        schema_block = f"\nStructured output schema (ResumeActionsLLMResponse):\n{schema}"
    else:
        schema_block = ""

    has_candidates = bool(request.resume_candidates)
    has_single = request.base_resume_text is not None and not has_candidates

    # Tailoring aggressiveness. Read defensively so this prompt keeps working
    # before `tailoring_mode` is wired into JobMatchRequest / the API / the UI.
    mode = (getattr(request, "tailoring_mode", None) or "surgical").lower()
    if mode not in ("surgical", "full_rewrite"):
        mode = "surgical"

    if has_candidates:
        resume_instructions = f"""
Resume selection (MANDATORY — do this first):
- You are given {len(request.resume_candidates)} resume file(s). Select the ONE that best fits this JD based on skill
  relevance, experience framing, and keyword alignment.
- Set selected_resume_filename to the exact filename of the chosen resume.
- All edits, and every target_text, MUST come from the SELECTED resume — never mix lines from the others.
- target_text MUST be an exact or near-exact quote from the SELECTED resume's text.
- suggested_text may draw truthful additional detail from the profile if provided.
""".strip()
    elif has_single:
        resume_instructions = """
Resume text usage:
- `base_resume_text` is the authoritative source. target_text MUST be an exact or near-exact
  quote from it so the candidate knows exactly which line is being changed.
- suggested_text may draw truthful additional detail from the profile if provided.
- Do not invent metrics or experience not present in profile evidence.
""".strip()
    else:
        resume_instructions = """
Resume text usage:
- No resume file provided. Target profile evidence fields for `target_text`.
- `suggested_text` must be grounded in real profile evidence — no invented metrics.
""".strip()

    if mode == "full_rewrite":
        mode_instructions = """
Active tailoring mode: FULL_REWRITE.
- Rewrite most bullets toward this JD wherever truthful evidence allows — including already-decent
  lines — to maximise keyword and impact alignment.
- Bias toward more, larger edits. A big visual diff is expected and acceptable.
""".strip()
    else:
        mode_instructions = """
Active tailoring mode: SURGICAL (default).
- Only edit a line when there is a clear, JD-driven reason to change it.
- Leave lines that are already strong AND already relevant untouched — do not churn good content.
- Prefer fewer, higher-confidence edits over broad rewrites.
""".strip()

    volume = "6 to 10" if mode == "full_rewrite" else "4 to 7"

    system = f"""
You are `resume_actions`, the tailoring phase of a two-phase job-match pipeline.

Mission:
Given the completed match score and gap analysis, propose truthful, evidence-grounded edits that
make ONE resume fit THIS specific job — readable by both the machine and the human behind it.

Dual audience (optimise for both; sacrifice neither):
1. Keyword / Boolean filter — still literal. When the candidate genuinely has a JD hard skill,
   use the JD's EXACT term and spelling in suggested_text (e.g. "Kubernetes", not "container
   orchestration"; "React", not "frontend frameworks"). Never introduce a skill the profile can't back.
2. Semantic AI ranker + human recruiter — reward real ownership and quantified impact; they
   penalise keyword stuffing that the evidence doesn't support. A recruiter scans ~6 seconds, so the
   first words of every bullet must carry a strong action verb and the result.

{resume_instructions}

{mode_instructions}

Each action is a diff pair (this is exactly what the UI renders — old content cut, new content in its place):
- target_text: the EXACT span from the resume to cut. Must be verbatim and locatable; the UI highlights it as removed.
- suggested_text: the copy-ready line that takes its place, highlighted as new. It MUST be a complete,
  drop-in bullet: starts with a strong past-tense action verb, expresses one idea, is ATS-plain text
  (no tables, columns, or special glyphs), and is roughly the same length so the layout holds.
- delete actions: leave suggested_text empty.
- pure additions (no existing line to cut): leave target_text empty and name the section in target_section
  so the UI can anchor the insert.

Bullet rewrite standard (XYZ):
- Lead with the result, then how: "Accomplished X, as measured by Y, by doing Z."
- Put a real number first when the profile truthfully has one. If no metric exists, use concrete impact
  wording — NEVER invent a number.
- One idea per bullet. Cut filler: "responsible for", "helped with", "worked on".

Truthfulness (non-negotiable):
- Only transform evidence that already exists in the profile or selected resume.
- Never invent experience, metrics, tools, scope, titles, education, authorization, or location.
- If a gap has no supporting evidence, do NOT fabricate a fix — record it in warnings instead.

Every action must be explainable (the UI shows these as labels next to the resume):
- reason: ONE plain-English sentence on why this change raises fit for THIS job.
- jd_alignment: the exact JD requirement / phrase the action serves.
- profile_evidence: the source field + line proving the new claim is true.
- priority: high | medium | low — drives ordering in the full-width resume view.

Gap coverage (REQUIRED):
- For every item in match_score.summary.biggest_gaps, produce at least one action that addresses it.
  If the profile has no evidence to fix the gap, note it in warnings instead.
- For every skill_match with match_level MISSING or TRANSFERABLE where importance is "must_have" or
  "important", produce at least one action.
- For every responsibility_match with evidence_score < 2 and importance "must_have", produce at least one action.

Output volume:
- Produce {volume} high-impact actions total across update_actions, replace_actions, and delete_actions.
- selected_actions must contain the top 5 by expected impact (or all of them if fewer than 5 exist),
  drawn from the three lists above.
- Do not pad with low-value actions to hit the minimum. Quality over quantity.
- Be concise. Each action's reason and suggested_text should be 1–2 sentences maximum.
  Do not restate the full resume or JD; reference only the relevant excerpt.

Output contract:
- Return only data fitting ResumeActionsLLMResponse: {{ result: ResumeActions, warnings: [] }}
- ResumeActions has: selected_resume_filename, update_actions, replace_actions, delete_actions, selected_actions, warnings.

{_shared_action_rules()}
{schema_block}
""".strip()

    jd_data = request.job_description.model_dump(mode="json")
    _drop_source_phrases(jd_data)

    if has_candidates:
        payload: dict = {
            "job_description": jd_data,
            "match_score": score.model_dump(mode="json"),
            "profile": request.profile.model_dump(mode="json"),
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

Evidence sourcing: mine the WHOLE profile — basics.summary, work_experience, education, skills, and every additional_sections pointer ({title, pointers} groups such as "Projects" or "Additional Experience"). Requirements are often proven by a pointer, not a core field; extract that evidence instead of only matching top-level fields.
""".strip()


def _shared_action_rules() -> str:
    return """
Resume action rules:
- update_actions: existing line is relevant but underspecified — strengthen it in place (keep target_text + suggested_text).
- replace_actions: a lower-value line should be swapped for stronger existing evidence (target_text = old line, suggested_text = new line).
- delete_actions: content wastes space for this JD — set target_text, leave suggested_text empty.
- selected_actions: the prioritised top subset across all action types (the headline edits).
- target_text: an exact, locatable span from the selected resume (or empty for a pure addition).
- suggested_text: a complete, copy-ready, ATS-plain bullet starting with a strong action verb — only when supported by real evidence.
- reason: one plain-English sentence on why the edit raises fit.
- jd_alignment: quote or name the JD requirement the action supports.
- expected_score_impact: qualitative, e.g. "high technical-skill impact".
""".strip()
