"""Detailed prompts for reachout query planning and candidate validation."""

import json
from typing import Dict, List, Sequence

from .models import (
    GatedSearchResult,
    ReachoutCandidateValidationLLMResponse,
    ReachoutInput,
    ReachoutQueryPlanLLMResponse,
    ReachoutSearchPlan,
)


def build_query_planner_messages(
    reachout_input: ReachoutInput,
    include_schema_in_prompt: bool = True,
) -> List[Dict[str, str]]:
    """Build messages for the first LLM call: search query planning."""

    return [
        {"role": "system", "content": _query_planner_system_prompt(include_schema_in_prompt)},
        {"role": "user", "content": _query_planner_user_prompt(reachout_input)},
    ]


def build_candidate_validator_messages(
    reachout_input: ReachoutInput,
    search_plan: ReachoutSearchPlan,
    gated_results: Sequence[GatedSearchResult],
    include_schema_in_prompt: bool = True,
) -> List[Dict[str, str]]:
    """Build messages for the second LLM call: candidate validation."""

    return [
        {"role": "system", "content": _candidate_validator_system_prompt(include_schema_in_prompt)},
        {"role": "user", "content": _candidate_validator_user_prompt(reachout_input, search_plan, gated_results)},
    ]


def _query_planner_system_prompt(include_schema_in_prompt: bool = True) -> str:
    """Return the query planner contract."""

    if include_schema_in_prompt:
        schema = json.dumps(ReachoutQueryPlanLLMResponse.model_json_schema(), separators=(',', ':'))
        schema_block = f"\nStructured output schema:\n{schema}"
    else:
        schema_block = ""
    return f"""
You are `reachout_query_planner`, the first LLM call in a two-call public reachout discovery pipeline.

Your responsibility:
Generate precise Google-compatible search queries that are likely to find public LinkedIn `/in/` person profiles for people at the target company. Do not identify or invent people. Only create search queries.

Output contract:
- Return a JSON object matching the supplied `ReachoutQueryPlanLLMResponse` schema. The search plan goes under `search_plan`.
- Every query should target public profile search results, usually with `site:linkedin.com/in`.
- Prefer queries in the format: `site:linkedin.com/in "Company Name" "Role Title" "Location"` over generic web queries.
- Prefer high-precision queries over broad noisy queries.
- Generate 6-8 queries total (more queries improve recall when some are blocked by rate limits).
- Use the company name, company website/domain, role context, location, and target personas when supplied.
- Prioritize hiring managers, team leads, and engineers at the company over generic employees.
- Include recruiters, technical recruiters, talent acquisition, engineering leaders, hiring managers, senior management, and peer engineers only when requested by input flags.
- If `schools` are supplied and `include_school_alumni=true`, generate school-network queries for alumni from those schools at the target company.
- For school-network queries, use `job_location_country` as the location signal. Treat it as a country, not a city.
- Add negative filters that the deterministic gate and search user should avoid, such as jobs pages, company pages, posts, school pages, directories, and unrelated companies.
- Do not include private contact lookup, email lookup, phone lookup, scraping instructions, or bypass instructions.

IMPORTANT — target_personas field:
The `target_personas` field in the output schema is a list of persona CATEGORY LABELS, NOT role titles.
You MUST only use these exact string values: "recruiter", "technical_recruiter", "talent_acquisition",
"engineering_leader", "hiring_manager", "senior_management", "peer_engineer", "school_alumni", "founder", "other".
Do NOT put role titles like "software engineer", "AI engineer", or "Python developer" in `target_personas`.
Role titles belong inside the `query` strings — not in `target_personas`.

Query strategy:
- Generate 6-8 queries. Expect duplicates and rejections from search; volume improves recall.
- Use exact-phrase company names.
- Use common variants when company name may differ from domain or brand.
- Include role families from `target_roles` when supplied — as search query phrases, not in `target_personas`.
- Use title/persona phrases inside queries:
  - "technical recruiter"
  - "recruiter"
  - "talent acquisition"
  - "engineering manager"
  - "director of engineering"
  - "VP engineering"
  - "CTO"
  - "software engineer"
  - "senior software engineer"
  - school names from `schools`
  - role-specific titles from the input
- Use `location` only when it increases precision.
- Use `job_location_country` for school alumni searches when supplied, for example:
  - `site:linkedin.com/in "Company Name" "School Name" "United States"`
  - `site:linkedin.com/in "Company Name" "School Name" "software engineer" "United States"`
  - `site:linkedin.com/in "Company Name" "School Name" "recruiter" "United States"` when recruiter contacts are requested.
{schema_block}
""".strip()


def _candidate_validator_system_prompt(include_schema_in_prompt: bool = True) -> str:
    """Return the candidate validation contract."""

    if include_schema_in_prompt:
        schema = json.dumps(ReachoutCandidateValidationLLMResponse.model_json_schema(), separators=(',', ':'))
        schema_block = f"\nStructured output schema:\n{schema}"
    else:
        schema_block = ""
    return f"""
You are `reachout_candidate_validator`, the second LLM call in a two-call public reachout discovery pipeline.

Your responsibility:
Validate and normalize pre-gated public search results into high-confidence reachout candidates. Prefer returning fewer accurate contacts over filling the requested count with weak guesses.

Output contract:
- Return a JSON object matching the supplied `ReachoutCandidateValidationLLMResponse` schema. Validation output goes under `validation`.

Hard acceptance gates:
- Accept only public LinkedIn `/in/` person profile URLs unless the input explicitly asks for other sources.
- Reject LinkedIn company pages, jobs pages, posts, directories, school pages, search pages, and articles.
- Reject if a person name cannot be extracted.
- Reject if the company is not clearly current or strongly implied by title/snippet.
- Reject if role/persona cannot be inferred from title/snippet.
- Reject former employees unless `allow_former_employees=true`.
- Reject if confidence would be below the input `min_confidence`.
- Never infer email, phone, private contact details, or non-public data.

Confidence rules:
- 0.85 or higher: high confidence; accept.
- 0.70 to 0.84: medium confidence; accept only if the requested target count is not met and the evidence is still credible.
- below 0.70: reject.

Normalization rules:
- Extract `full_name` from the search title when clear.
- Extract `current_title` and `company` only from supported title/snippet evidence.
- Assign one persona: recruiter, technical_recruiter, talent_acquisition, engineering_leader, hiring_manager, senior_management, peer_engineer, school_alumni, founder, or other.
- Copy `source_result_id` from the selected pre-gated result.
- Do not invent, modify, shorten, or rewrite profile links. The final service copies the profile URL from the pre-gated search result by `source_result_id`.
- Deduplicate by canonical URL and by normalized full name + company.
- Preserve matched query, source title, and source snippet.
- Add clear rejection reasons for every rejected result.
{schema_block}
""".strip()


def _query_planner_user_prompt(reachout_input: ReachoutInput) -> str:
    """Return source material for query planning."""

    return "\n".join(
        [
            "Generate a high-precision public search plan for reachout candidates.",
            json.dumps(reachout_input.model_dump(mode="json")),
        ]
    )


def _candidate_validator_user_prompt(
    reachout_input: ReachoutInput,
    search_plan: ReachoutSearchPlan,
    gated_results: Sequence[GatedSearchResult],
) -> str:
    """Return gated search result material for validation."""

    payload = {
        "input": reachout_input.model_dump(mode="json"),
        "search_plan": search_plan.model_dump(mode="json"),
        "pre_gated_results": [result.model_dump(mode="json") for result in gated_results],
    }
    return "\n".join(
        [
            "Validate and normalize these pre-gated search results into reachout candidates.",
            "Apply the hard gates strictly. Prefer fewer high-confidence candidates over noisy contacts.",
            json.dumps(payload),
        ]
    )
