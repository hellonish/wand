# Wand — Engineering Showcase

> *What an engineer who built this platform would actually want to talk about.*

---

## What this is

Wand is an AI-powered career intelligence platform. From the outside it looks like "a resume tool." From the inside, it's a carefully layered system of structured LLM pipelines, async coordination, multi-source data fusion, and a real-time frontend — all wired together with deliberate architecture decisions worth examining.

This document is written as if the builder is sitting across from you and you've asked: *"What's actually interesting about what you built here?"*

---

## 1. The LLM abstraction layer (`engine/models/llm.py`)

The cleanest thing in the codebase that nobody would notice unless they looked.

Every single AI call in the engine — across 6 different pipeline steps, 3 analysis modules, cover letter generation, discrepancy analysis — flows through a single `LLMClient` class. It wraps `instructor` + OpenAI-compatible endpoints, and supports Grok (xAI), Gemini (Google), and DeepSeek as drop-in providers, each selected at runtime per user preference.

```python
class LLMClient:
    PROVIDERS = {
        "grok":     {"base_url": "https://api.x.ai/v1",          "env_key": "XAI_API_KEY",      ...},
        "gemini":   {"base_url": "https://generativelanguage...", "env_key": "GEMINI_API_KEY",   ...},
        "deepseek": {"base_url": "https://api.deepseek.com",      "env_key": "DEEPSEEK_API_KEY", ...},
    }
```

The key design choice: **structured output via `instructor`**. Every LLM call returns a typed Pydantic model — not a string, not a dict. The call either gives you a `MatchAnalysis` or raises. There's no parsing step, no `json.loads()`, no field extraction anywhere in the engine code. That's a discipline decision and it eliminates an entire class of bugs.

`LLMClient.from_user_settings()` is the dependency injection hook: the API layer creates the client from the authenticated user's stored provider/model preferences and passes it down into every engine module. No module reaches out for keys or clients on its own.

The parallel module in `/llm/` — `GrokProvider` inheriting from `BaseLLMProvider` — shows this was evolving. The engine settled on the unified `LLMClient` pattern; the `/llm/` module precedes it. You can tell the architecture was being actively consolidated during development.

---

## 2. The JobLens 6-step pipeline and the async parallelism design

JobLens is the flagship feature. When a user submits a job posting, six AI analyses run:

1. **Extract Profile** — Structures the user's unified resume into a canonical `ExtractedProfile`
2. **Parse JD** — Structured extraction of the job description into `ParsedJD`
3. **Company Intel** — Scrapes the company website via `trafilatura`, then LLM-analyzes funding, culture, interview process, competitors
4. **Match Analysis** — Scores the candidate 0–100 across technical fit, experience, project relevance, and culture fit
5. **Contact Strategy** — Generates 3–5 named contacts to reach out to, with outreach message templates and where to find them
6. **Action Plan** — Synthesizes all prior steps into concrete resume edits, a cover letter skeleton, interview prep questions, and a follow-up calendar

The interesting engineering is in how these steps are scheduled in `api/routers/jobs.py: _run_pipeline_background()`. It doesn't run them sequentially.

**Wave 1 — parallel:** Steps 1 (Profile Extract) and 2 (JD Parse) run with `asyncio.gather()` since they don't depend on each other and Step 1 has a cache path: if the user's `extracted_profile` is already stored on their `UserProfile`, it's reused immediately — no LLM call.

**Wave 2 — parallel:** Once both Wave 1 results are ready, Steps 3 (Company Intel), 4 (Match Analysis), and 5 (Contact Strategy) fire simultaneously. Step 4 needs the profile and JD (both done). Step 3 only needs the company name. Step 5 needs the JD and optionally company intel, but it's scheduled optimistically.

**Step 6** runs last — it synthesizes everything — and only starts after all of Wave 2 completes.

Each step publishes its result immediately to the frontend via WebSocket so the UI can render progressively. The user sees each panel populate in real time as the LLM returns.

The thread management is done cleanly: blocking LLM calls are offloaded to executor via `loop.run_in_executor(None, lambda: ...)` so they don't block the async event loop.

Database writes use short-lived `SessionLocal()` sessions opened and closed per write (`db_write(fn)` pattern) to avoid holding connections across long-running async tasks.

---

## 3. The WebSocket event bus (`api/websocket.py` + `frontend/src/hooks/useGlobalWebSocket.ts`)

Background workers (Celery or async background tasks) can't directly write to a WebSocket — they're in a different thread or process. The solution here uses Redis as a pub/sub channel for the Celery path.

Celery tasks call `notify_job_status()`, which publishes a JSON payload to the `job_updates` Redis channel. The FastAPI WebSocket handler subscribes and rebroadcasts to connected clients.

The frontend hook `useGlobalWebSocket` keeps a single persistent WebSocket connection per authenticated session. It routes different event types to different consumers:

- `job_update` events → update the Zustand job queue
- `discrepancy_complete` → module-level event emitter pattern (`subscribeToDiscrepancy`)
- `joblens_step_*` events → per-session listeners (`subscribeToJobLens(sessionId, handler)`)

The session-scoped listener pattern means any page component interested in a specific JobLens pipeline instance can subscribe by session ID and get incremental step results streamed in, without every component needing its own socket connection.

---

## 4. The analysis engine — weighted scoring with 3 independent sub-analyzers

Resume vs. job analysis runs three independent checks, then combines them with explicit weights:

| Dimension | Weight | Model Used |
|---|---|---|
| Qualification Match | 30% | Gemini 2.5 Pro |
| Technical Skill Match | 25% | Gemini 2.5 Pro |
| Keyword Match | 25% | Gemini 2.5 Flash |
| Resume Formatting | 20% | Gemini 2.5 Flash |

The model selection is deliberate and evidence-based: `qualification_check/checker.py` uses `gemini-2.5-pro` (the reasoning model) with `temperature=0.0` — it needs to evaluate nuanced claims like "does 'built distributed systems at scale' count as meeting this requirement for Kafka experience." The `keyword_match/matcher.py` uses `gemini-2.5-flash` at `temperature=0.0` — it's a faster, pattern-matching task.

The `QualificationChecker` system prompt has a subtle but important requirement: the `evidence` field must **never** be empty. For matched items it must quote the resume text that demonstrates the qualification. For unmatched items it must state specifically what's missing. This is not just UX polish — it forces the LLM to actually ground its ✓/✗ judgments in text, reducing hallucinated matches.

The `KeywordMatcher` prompt has another notable design: it explicitly forbids array index notation in suggestions (`work_experience[0]`). Suggestions must reference sections by job title and company name (`"Software Engineer at Acme Corp"`). This makes the output human-readable and directly actionable.

---

## 5. Resume re-evaluation loop with score delta tracking

When a user edits their resume in response to suggestions, they can trigger a re-evaluation. The `ReEvaluator` runs all three analysis modules again and returns scores only (no suggestions), plus a score delta from the previous version:

```python
score_change = final_score - previous_score
improved = score_change > 0
```

Each evaluation snapshot is stored as a `ResumeHistory` entry (versioned, with score) so the user can see their improvement over time. The re-evaluation uses the same weight formula as initial analysis — so the delta is comparable, not a different scoring system.

The Celery path (`reevaluate_job_task`) does this with progress events sent over WebSocket: the UI shows a live "Re-evaluating..." state, then the score counter animates to the new value.

---

## 6. Multi-source profile unification (`engine/profile/unifier.py`)

Users can upload PDF resume, LinkedIn export, and HTML portfolio. Each is parsed by a dedicated parser using PyMuPDF (for PDFs) and trafilatura (for HTML), then passed to DeepSeek-chat via `instructor` to extract a `HybridResume` Pydantic model.

Profile merging uses explicit priority rules (Resume > LinkedIn > Portfolio) with deduplication:

- **Skills**: Set union across all sources — every unique skill from any source makes it in
- **Work Experience**: Deduplicated by `(company_name, job_title)` tuple (normalized, lowercased). If the same role appears in Resume and LinkedIn, the Resume version wins (richer descriptions). Sorted by `start_date` descending.
- **Education**: Same deduplication pattern
- **Dynamic Sections**: Resume wins on collision for strings; lists get merged with uniqueness

The `create_unified_profile()` function returns a single canonical dict used as input to every downstream analysis. This normalization step is what makes the rest of the engine source-agnostic.

After unification, the profile is auto-passed through `extract_profile()` (JobLens Step 1) to produce a cached `ExtractedProfile` stored on the user record. This means when the JobLens pipeline runs, Step 1 skips the LLM call if the profile hasn't changed — a meaningful latency improvement.

---

## 7. Cover letter generation with JD tone detection and 3 distinct writing modes

Three cover letter writing modes, each with a substantially different system prompt:

- **Storyline**: Hero's journey structure — pivotal moment open → rising action → conflict/resolution → thematic bridge → forward vision. Targets 300–400 words, with explicit rules about narrative cohesion and sensory language.
- **Disruptive**: Opens with a provocation. Explicitly forbids clichés like "passionate," "team player," "detail-oriented." Requires varying sentence rhythm for impact.
- **Regular**: Traditional structure — specific experience → company interest → closing. Requires precise outcome-based evidence.

The `auto` mode adds an LLM pre-step: `JDToneAnalyzer` reads the JD and returns a structured `JDToneAnalysis` containing the recommended mode, a confidence score (0.0–1.0), the actual tone signals found verbatim in the text, and the detected industry. The recommended mode is then used as the actual mode. Each mode also runs at a different temperature — `disruptive` at 0.85, `regular` at 0.60 — matching the level of creativity the output requires.

The `custom` mode runs the user's rough prompt through `PromptEnhancer` first, which reformulates it into a detailed instruction set the generation model can follow reliably.

Cover letters can optionally include live company news (fetched via the news engine) as context — referenced naturally in the letter to demonstrate the applicant is paying attention to the company's current activity.

---

## 8. Profile discrepancy detection with cross-source entity alignment

The `DiscrepancyAnalyzer` does something non-trivial: it doesn't just diff Resume vs. LinkedIn field by field. It first asks the LLM to semantically align entities across sources before comparing.

The system prompt explicitly handles this:
> *"Ingelt Board" and "InGelt Board" are the SAME company. "New York University" and "NYU" are the SAME institution. Align them first."*

The output is a structured `ProfileDiscrepancy` with:
- A `comparison_table` of `ProfileItem` entries (each field from each aligned entity)
- Status per item: `match`, `mismatch`, or `partial` (missing from at least one source)
- `DiscrepancyItem` entries only for actual mismatches or significant gaps
- A `consistency_score` (0–100) and actionable recommendations

The boundary conditions are handled gracefully: if fewer than 2 sources are uploaded, the analyzer returns a `consistency_score` of 100 with an explanation that there's nothing to compare. It doesn't error — it gives useful output regardless.

---

## 9. Company intelligence via real web scraping

The `CompanyIntelAnalyzer` in `engine/joblens/company_intel.py` doesn't just ask the LLM to make things up about a company. It actually fetches the website.

`_fetch_multiple_pages()` tries six paths in order: `/`, `/about`, `/careers`, `/engineering`, `/blog`, `/team`. Each successful page is appended to the context sent to the LLM. There's a 15,000-character budget — once exceeded, scraping stops. The LLM is then instructed to reason only from what's in the content, and to say "Unknown" rather than hallucinate facts it doesn't have.

The `trafilatura` library is used for content extraction — it strips nav, headers, footers, ads, and returns article text. This keeps the LLM context signal-dense rather than cluttered with boilerplate HTML text.

---

## 10. The Celery / async duality

The system has two task execution paths that coexist:

1. **Celery** (`api/tasks.py`) — the original async worker path, used for the traditional analysis pipeline (qualification check → formatting check → keyword match). Uses Redis as both broker and result backend. Workers are capped at 3 concurrent, with a 5-minute task timeout.

2. **FastAPI BackgroundTasks + asyncio** — the newer JobLens pipeline uses `background_tasks.add_task()` (FastAPI native, no separate process) and `asyncio.gather()` for step parallelism within a single async function. This runs in the API process, not a separate Celery worker.

The two paths use the same Redis pub/sub channel for WebSocket events. Celery tasks call `notify_job_status()` which publishes to `job_updates`. The async pipeline path calls `manager.send_to_user()` directly (since it's in the same event loop). Both appear as the same type of event on the frontend.

---

## 11. Authentication — Google OAuth + JWT session

Login uses Google OAuth 2.0 via `authlib` (Starlette integration). On successful OAuth callback:
1. User is looked up by email; created if new
2. A 7-day JWT is issued using `python-jose`
3. JWT payload contains the user's database ID as `sub`

All protected routes use a `HTTPBearer` dependency (`get_current_user`) that decodes the JWT and loads the user from the database. There is no refresh token mechanism — the token is long-lived (7 days) and stored in the Zustand store with localStorage persistence.

The Zustand store handles a subtle edge case: on page reload, the stored token is synced back to the `api.ts` module before any API calls are made. The `onRehydrateStorage` hook in `persist()` runs synchronously and handles the "store has no token but localStorage does" recovery case.

---

## 12. Frontend state management with Zustand

The frontend uses Zustand with `persist` middleware (localStorage) for cross-reload state. Persisted fields: `token`, `queue`, `theme`, `jobsFilter`.

The job analysis queue is managed client-side in the store — items are added when a job is created, updated via WebSocket events (status transitions: `pending → analyzing → complete/error`), and removed with a 3-second delay after completion so the user sees the final state before it disappears.

The global WebSocket hook (`useGlobalWebSocket`) uses `useRef` to hold the socket and cleans up on unmount or token change, ensuring no stale connections.

Framer Motion (`AnimatePresence` + `motion.div`) is used throughout for list entry/exit animations. The jobs table rows have `layout` prop set, meaning when items are added/removed, surrounding rows animate their position rather than snapping.

---

## 13. Database design — JSON columns for structured intelligence

The SQLite schema makes heavy use of JSON columns rather than normalized tables for the AI-generated data:

- `jobs.job_posting` — the structured job posting (parsed from raw JD)
- `jobs.analysis_result` — the full `AnalysisResult` dict
- `joblens_sessions.*` — each step stores its full Pydantic model dump as JSON (6 separate JSON columns: `extracted_profile`, `parsed_jd`, `company_intel`, `match_analysis`, `contact_strategy`, `action_plan`)
- `resume_history.resume_data` — versioned resume snapshots

This is a deliberate tradeoff: the AI output schemas evolve, and normalizing every field (100+ fields across 6 pipeline models) would require constant migration churn. JSON columns give flexibility; `current_step` (integer) tracks pipeline progress without decoding the JSON blobs.

The `ensure_sqlite_schema()` call in startup handles additive column migrations that SQLAlchemy's `create_all` doesn't manage on existing tables.

---

## 14. The `SUGGESTION_BOX.md` file

There's a `SUGGESTION_BOX.md` at the repo root. It has three entries:

```
- Job Scraper - Auto pull JDs from job boards (LinkedIn, Indeed)
- Interview Prep AI
- Salary Negotiation tool
```

It's a scratchpad of where this is going. None of these are implemented yet. But they fit directly into the existing schema — JobLens already models everything from contact strategy to interview prep questions. The infrastructure is already built for them.

---

## What this tells you about how it was built

Reading through the code, a few patterns are consistent enough to be deliberate:

- **Every engine module is a class with a convenience function.** `QualificationChecker.check()` / `check_qualifications()`. `CoverLetterGenerator.generate()` / `generate_cover_letter()`. This makes testing easy (inject mock LLM) and gives the API layer clean one-liners.
- **No module reaches outside its boundary for dependencies.** LLM clients are injected. API keys are resolved in one place. No module imports from sibling modules except via the package `__init__`.
- **Errors are deleted, not failed.** In `analyze_job_task`, if analysis fails, the job is deleted from the database — not left in a failed state. Clean state is preferred over orphaned records.
- **The engine `__init__.py` wraps all imports in `try/except ImportError`.** The engine can be imported even if specific dependencies (DeepSeek, older modules) aren't available. Graceful degradation by design.
- **Temperature is never `None` and is always explicit.** Every LLM call in the codebase specifies `temperature=`. Qualification check is `0.0`. Action planner is `0.5`. Disruptive cover letter is `0.85`. These are not defaults — they're considered choices per task.

---

*Last reviewed against codebase: April 2026*
