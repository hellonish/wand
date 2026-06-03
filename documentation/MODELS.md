# Wand — AI Models & Inference (Source of Truth)

> This document is generated from the actual code (`engine/providers.py`,
> `engine/inference.py`, `api/llm.py`). Where older docs (README history,
> `PROJECT_SHOWCASE.md`, `ENGINEERING_SHOWCASE.md`) mention **Gemini**, that is
> **outdated** — there is **no Gemini provider in the codebase**. The engine ships
> two providers: **xAI Grok** (default) and **DeepSeek**.

## 1. Providers (`engine/providers.py`)

The engine is provider-agnostic. Each provider is a small client class exposing a
single `complete(response_model, messages, temperature, max_tokens)` method that
returns a validated Pydantic object.

| Provider | Class | Default model | Path | Env vars |
|---|---|---|---|---|
| xAI (Grok) | `XAIClient` | `grok-3` | `instructor` JSON mode | `XAI_API_KEY`, `XAI_MODEL` |
| DeepSeek | `DeepSeekClient` | `deepseek-chat` | plain OpenAI SDK, `response_format=json_object` | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` |

- **Grok** handles structured generation well, so `instructor` retries are safe
  (`max_retries=2`). Default output budget `24000`, hard cap `32768`.
- **DeepSeek** does *not* handle `instructor` coercion reliably — it is used via the
  plain OpenAI SDK with manual JSON-schema injection and **no silent retries**
  (retries burn quota and trip 403 spend limits). Output hard cap `8192`.
- Adding a provider = one subclass with its base URL + env-var names. No caller changes.

API keys are read from the **server environment only** — never stored in app config
or user settings (`api/llm.py::build_llm_from_settings`).

## 2. Per-task model routing (`api/llm.py`)

Routing is product-owner controlled, persisted in `api/llm_config.json`, and resolved
per task by `resolve_llm_settings(task)`. Every task defaults to `grok-3`:

```
default, profile, job_description, company_intel,
job_match, reachout, cover_letter, cover_letter_tone  ->  grok-3
```

Any task can be pointed at a different provider/model (e.g. route `profile` and
`job_description` to DeepSeek to cut cost, keep `cover_letter` on Grok for quality).

## 3. Inference registry (`engine/inference.py`)

Every LLM call in the product is registered here with an explicit token budget. These
are the real `max_tokens` ceilings in the code:

| Function | Task family | Temp | `max_tokens` (output cap) |
|---|---|---|---|
| `parse_profile` | profile | 0.0 | 24000 |
| `extract_long_form_sections` | profile | 0.0 | 24000 |
| `merge_long_form_versions` | profile | 0.0 | 24000 |
| `unify_profiles` | profile | 0.0 | 24000 |
| `break_down_job_description` | job_description | 0.0 | 3000 |
| `extract_company_intel` | company_intel | 0.0 | 4000 |
| `match_profile_to_job` | job_match (single) | 0.0 | 24000 |
| `score_job_match` | job_match (phase A) | 0.0 | 8000 |
| `generate_resume_actions` | job_match (phase B) | 0.0 | 8192 |
| `plan_reachout_queries` | reachout | 0.0 | 2000 |
| `validate_reachout_candidates` | reachout | 0.0 | 4000 |
| `analyze_jd_tone` | cover_letter_tone | 0.3 | 1024 |
| `enhance_cover_letter_prompt` | cover_letter | 0.5 | 2048 |
| `write_cover_letter` | cover_letter | mode | 4096 |

`max_tokens` is the **output ceiling**, not typical usage. For real cost metering,
capture the actual `usage` (prompt/completion tokens) from the provider response — see
[`MONETIZATION.md`](MONETIZATION.md) §"Metering".
