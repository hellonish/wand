# JobLens Pipeline Improvement Plan

_Last updated: 2026-06-03_

A phased plan to improve the JobLens analysis pipeline across output quality,
cost/latency, reliability, and observability. Sequenced so foundations land
first (measure → infra → caching), followed by a module-by-module quality pass,
then orchestration and frontend.

## Locked decisions
- **Match phasing:** keep the **two-phase split everywhere** (Phase A scoring +
  Phase B resume actions) for all providers — uniform code path, lets A/B use
  different temperatures cleanly. Do **not** collapse to single-call on Grok.
- **Reachout search:** **stay free** — harden DuckDuckGo query construction and
  the LinkedIn-URL fallback. No paid search API / new key.

## Guiding principles
- Measure before changing — Phase 0 lands observability + an eval harness so
  every later phase has a provable before/after.
- Shared infra before per-module work — retry, model tiering, caching are
  cross-cutting; build them once.
- Each phase ships green — no phase depends on a later one to be correct.

---

## Phase 0 — Observability & evaluation foundation
_Goal: see what the pipeline does and score its output._

### 0.1 Per-step latency + raw-output capture
- `engine/usage.py` / `engine/providers.py`: extend `UsageCollector` (or add a
  sibling `StepTrace`) to record per-`complete()` wall-clock latency alongside
  tokens.
- `engine/providers.py`: behind `LLM_DEBUG_CAPTURE=1`, persist raw request
  messages + raw response JSON to a debug sink. Off by default.
- `api/routers/jobs.py`: include per-step duration in the
  `joblens_step_complete` payload so timings are visible live.

### 0.2 Eval harness
- New `engine/joblens/eval/` runner that feeds existing `*/tests/fixtures/*`
  through the real prompts and scores outputs:
  - JD breakdown: field-extraction recall vs a hand-labeled key.
  - Match: score calibration + monotonicity, action count, **gap coverage**
    (every `biggest_gap` has >= 1 action).
  - Company intel / reachout: non-empty rate, schema validity.
- Emit a single JSON scorecard so regressions are diffable in CI.

**Acceptance:** harness prints a scorecard; live UI shows per-step timings;
debug capture works behind the flag.

---

## Phase 1 — Provider & routing layer
_Files: `engine/providers.py`, `api/llm.py`, `api/llm_config.json`_

### 1.1 Transient-error retry
- Wrap `XAIClient.complete` / `DeepSeekClient.complete` with backoff retry on
  HTTP 429 / 5xx / timeout (distinct from instructor's parse-retry). Capped
  attempts, jittered backoff; surface the final error so the step still fails
  cleanly when exhausted.

### 1.2 Per-task model tiering
- `api/llm_config.json`: stop defaulting every task to grok-3. Cheaper/faster
  model for `job_description` and `company_intel`; keep grok-3 for `job_match`.
  Config-only — routing already exists in `resolve_llm_settings`.

### 1.3 Schema-injection slimming
- `_inject_response_schema` / prompt builders: strip `description` fields and
  compress `$ref`s before inlining the schema. Validate parsing via Phase 0.

### 1.4 Prompt-caching spike
- Investigate xAI/DeepSeek prompt-cache support. If available, mark the static
  system prefix (rubrics + schema) cacheable. Cost/latency win, no behavior
  change.

### 1.5 Temperature plumbing
- Ensure `temperature` is threadable per inference call (already is in
  `inference.py`); sets the stage for Phase 3 generative tuning.

**Acceptance:** retries recover from a simulated 429; harness shows
equal-or-better quality at lower token cost after slimming + tiering.

---

## Phase 2 — Caching layer (company-scoped)
_Goal: stop recomputing company-scoped work per job._

### 2.1 Company-intel cache
- Cache keyed by **normalized company domain/name** with a TTL (7-30 days). In
  `_gather_company_intel`, check cache before fetch+extract; write on success.

### 2.2 Reachout cache
- Same pattern keyed by `(company, target_roles_signature, location)`.

### 2.3 Cache observability
- Surface cache hit/miss in the step payload (mirrors the JD-cache log in
  `jobs.py`).

**Acceptance:** second analysis of a job at the same company skips
company_intel + reachout LLM/network work; harness confirms identical output
from cache.

---

## Phase 3 — Per-module quality pass

### 3A — `job_description`
- Verify breakdown completeness against the Phase 0 recall metric; tighten the
  prompt only where recall is weak. Lowest-risk module — mostly validation.

### 3B — `company_intel`
- **Discovery robustness** (`service.py` `_discover_pages`): when no website is
  supplied, resolve the real domain via the reachout search providers **before**
  falling back to `guess_company_domains`. Eliminates silent-empty intel.
- Produce a **slim company summary** (tech stack, product domain, size)
  explicitly intended for downstream `job_match` consumption (feeds Phase 4.1).

### 3C — `job_match` (core) — TWO-PHASE RETAINED
- **Resume actions prompt** (`prompts.py` `build_resume_actions_messages`):
  - Remove the zero-sum "Length preservation (STRICT)" block.
  - Add a 5-9 action budget.
  - **Force gap -> action mapping** from `match_score.biggest_gaps` +
    MISSING/TRANSFERABLE must-have skills.
  - Set per-section expectations (summary, each experience entry, skills,
    projects).
- **Reconcile `selected_actions` vs the union** so the field the prompt
  prioritizes is the field the UI renders (pair with Phase 5.1).
- **Generative temperature:** Phase B (`generate_resume_actions`) ~0.4; Phase A
  scoring stays 0.0. (Two-phase split makes this clean — a key reason to keep
  it.)
- **Multi-candidate context:** re-introduce the profile as read-only evidence
  for `suggested_text` while keeping `target_text` grounded in the selected
  resume.

### 3D — `reachout` — FREE, HARDEN DDG
- Improve DuckDuckGo query construction and ordering in `_run_searches` /
  query planning; no paid provider.
- Strengthen the `linkedin_search_urls` fallback so a blocked search still
  yields actionable People-Search links.
- Query planning at a small non-zero temperature for query diversity.

**Acceptance:** harness shows resume actions cover gaps with 5-9 actions;
reachout non-empty/fallback rate rises; match scores shift as expected once
company context lands (Phase 4).

---

## Phase 4 — Orchestration
_File: `api/routers/jobs.py`_

### 4.1 Cross-step context wiring
- Feed the Phase 3B company summary into `_score_match` so domain/skill scoring
  is grounded in real company data. Requires resequencing (company_intel before
  match, or pass a partial when ready). Evaluate the latency trade-off.

### 4.2 Input truncation over hard-reject
- Replace the hard `InputTooLarge` failure (`providers.py`) with graceful
  truncation of the least-relevant blocks for oversized profiles/JDs, surfacing
  a warning.

### 4.3 Idempotency
- Guard against duplicate concurrent analyses of the same job.

**Acceptance:** match output references company-specific signal; oversized
inputs degrade gracefully.

---

## Phase 5 — Frontend robustness
_File: `frontend/src/app/jobs/[id]/page.tsx`_

### 5.1 Honor `selected_actions` (paired with 3C)
- Render the curated subset, or formally make the union the contract and drop
  `selected_actions` from the prompt. Pick one; make code + prompt agree.

### 5.2 Unanchored-suggestion fallback
- When `target_text` doesn't substring-match the resume (`highlightText`), show
  the action in a separate "general suggestions" group with a visible count
  instead of silently dropping the highlight.

**Acceptance:** no action is ever silently invisible; the card list matches the
prompt's contract.

---

## Sequencing & dependencies
- **0 -> 1 -> 2** strictly ordered (measure, infra, caching).
- **Phase 3 modules** parallelizable once Phase 1 lands; 3B precedes 4.1; 3C
  pairs with 5.1.
- **Phase 4.1** depends on 3B's company summary.
- **Phase 5** depends on 3C decisions.

**Suggested shipping order for fastest value:**
0.1 -> 1.1/1.2 -> 2 -> 3C -> 5 -> 3B/3D -> 4 -> 0.2 backfill.
(Observability-lite first, then cheap infra wins, then the resume-actions fix
users feel immediately.)
