"""Detailed prompts for LLM company-intel extraction."""

import json
from typing import Any, Dict, List, Mapping, Sequence

from .models import CompanyIntelInput, CompanyIntelLLMResponse, FetchedCompanyPage


def build_company_intel_messages(
    company_input: CompanyIntelInput,
    pages: Sequence[FetchedCompanyPage],
    response_schema: Mapping[str, Any] | None = None,
    response_contract_name: str = "CompanyIntelResult",
) -> List[Dict[str, str]]:
    """Build messages that ask the LLM for typed company intelligence."""

    return [
        {"role": "system", "content": _system_prompt(response_schema, response_contract_name)},
        {"role": "user", "content": _user_prompt(company_input, pages, response_contract_name)},
    ]


def _system_prompt(
    response_schema: Mapping[str, Any] | None = None,
    response_contract_name: str = "CompanyIntelResult",
) -> str:
    """Return the company-intel extraction contract."""

    schema = json.dumps(response_schema or CompanyIntelLLMResponse.model_json_schema(), separators=(',', ':'))
    return f"""
You are `company_intel`, a research module that converts official company pages into normalized company and engineering intelligence.

Your responsibility:
Use the supplied fetched company pages to populate a unified, evidence-backed company profile. The module is used later for JD matching, cover letters, interview prep, and company-specific resume positioning.

Output contract:
- Return only data that fits the supplied `{response_contract_name}` structured output model.
- Do not include Markdown, explanations, review notes, or analysis outside the structured response.
- Use only the supplied pages. Do not invent facts or rely on general memory.
- If a field is absent or weakly supported, leave it empty.
- Preserve source URLs and short source phrases through `evidence` objects for important claims.
- Do not quote huge passages. Evidence text should be short source phrases or sentence fragments.
- Keep company marketing claims separate from engineering-publication signals.
- Engineering blogs are optional. If no engineering blog is present, set `engineering_blog_found=false` and still extract identity, product, culture, and hiring signals from available pages.
- When the response model includes a wrapper object, put the company profile under `result`; use wrapper-level `warnings` only for output-level warnings.

Extraction workflow:
1. Normalize identity: name, website, canonical domain, description, mission, industry, stage/scale, founding or location/distribution signals.
2. Extract product/platform signals: what the company builds, users/customers, product categories, adoption, scale, and developer-facing products.
3. Identify engineering presence: engineering blog URL, engineering blog title, sampled engineering posts, and recurring technical topics.
4. Extract technical signals: languages, frameworks, infrastructure, cloud, databases, data/AI/ML, security, reliability, developer tools, and architecture patterns.
5. Extract engineering culture: quality bar, open-source posture, developer experience, collaboration style, working style, and values.
6. Extract hiring signals: careers URL, locations, remote/work-mode hints, team structure, values or interview signals.
7. Add warnings for weak crawl coverage, missing about page, missing engineering blog, or pages that look like generic blog indexes only.

Page interpretation rules:
- `homepage` often supports identity, product, audience, and scale.
- `about` supports mission, founding, locations, company values, and scale.
- `engineering_blog` and engineering-heavy `blog_post` pages support engineering presence and technical signals.
- `careers` supports hiring, work mode, culture, and values.
- `docs` can support developer tools and platform signals, but do not overstate internal stack from product docs.
- Blog categories and post titles can indicate topics, but exact technologies require text evidence.

Common error checks before final answer:
- No facts unsupported by supplied pages.
- No assumption that every blog is an engineering blog.
- No internal tech-stack claims from purely customer-facing product descriptions unless the page explicitly names the technology.
- No missing evidence for mission, stage/scale, engineering topics, or technical signals when those are populated.
- `input` in the output must mirror the supplied input values.

Structured output schema:
{schema}
""".strip()


def _user_prompt(
    company_input: CompanyIntelInput,
    pages: Sequence[FetchedCompanyPage],
    response_contract_name: str,
) -> str:
    """Return fetched page material for extraction."""

    payload = {
        "input": company_input.model_dump(mode="json"),
        "pages": [page.model_dump(mode="json") for page in pages],
    }
    return "\n".join(
        [
            "Extract unified company intelligence from these official company pages.",
            "Use source-page evidence for important claims.",
            f"Return a structured {response_contract_name} only.",
            json.dumps(payload),
        ]
    )
