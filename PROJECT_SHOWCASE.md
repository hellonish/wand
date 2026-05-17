# Wand 🪄 — Project Showcase

> *An AI-powered career intelligence platform. Looks like a resume tool from the outside. From the inside: structured LLM pipelines, async DAG scheduling, multi-source data fusion, and a real-time streaming frontend — all wired together with deliberate architecture decisions.*

---

## Table of Contents

1. [What Was Built](#what-was-built)
2. [Tech Stack](#tech-stack)
3. [System Architecture](#system-architecture)
4. [DSA & Algorithms](#dsa--algorithms)
5. [Systems Design Highlights](#systems-design-highlights)
6. [LLM Engineering](#llm-engineering)
7. [Frontend Engineering](#frontend-engineering)
8. [Cost Evaluation](#cost-evaluation)
9. [What's Next](#whats-next)

---

## What Was Built

Wand is a full-stack AI career platform with five core capabilities:

| Feature | What it does |
|---|---|
| **JobLens** | 6-step AI pipeline — parses JD, extracts profile, scores match 0–100, finds contacts, writes action plan |
| **Resume Analysis** | 3-module scoring engine: qualification check, keyword match, formatting audit |
| **Cover Letter Generator** | 3 distinct writing modes (Storyline, Disruptive, Regular) with JD tone detection |
| **Profile Unifier** | Merges PDF resume + LinkedIn export + HTML portfolio into one canonical profile |
| **Discrepancy Detector** | Cross-source entity alignment + semantic diff to surface inconsistencies |

Everything streams to the frontend in real time over WebSocket — users watch each pipeline step populate as results arrive.

---

## Tech Stack

### Backend
| Layer | Technology |
|---|---|
| API | FastAPI (async, Python 3.12) |
| Task Queue | Celery + Redis |
| Database | SQLAlchemy / SQLite |
| Auth | Google OAuth 2.0 (`authlib`) + JWT (`python-jose`) |
| LLM Abstraction | `instructor` + OpenAI-compatible client |
| PDF Parsing | PyMuPDF (`fitz`) |
| Web Scraping | `trafilatura` |

### AI Providers
| Provider | Models Used | Role |
|---|---|---|
| Google Gemini | `gemini-2.5-pro`, `gemini-2.5-flash` | Primary reasoning + fast extraction |
| xAI (Grok) | `grok-3`, `grok-3-mini` | User-selectable alternative |
| DeepSeek | `deepseek-chat`, `deepseek-reasoner` | Profile unification (cost-efficient) |

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS |
| State | Zustand with `persist` middleware |
| Animations | Framer Motion (`AnimatePresence`, layout animations) |
| Real-time | Native WebSocket (`useGlobalWebSocket` hook) |

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────┐
│                  Next.js Frontend                │
│  Zustand Store ──── useGlobalWebSocket hook      │
│      └── JobLens panels (stream in real-time)   │
└───────────────────┬─────────────────────────────┘
                    │ HTTP + WebSocket
┌───────────────────▼─────────────────────────────┐
│               FastAPI (async)                    │
│  /api/jobs  /api/profile  /api/cover-letter ...  │
│                    │                             │
│       ┌────────────┴────────────┐                │
│  BackgroundTasks            Celery Workers       │
│  (JobLens pipeline)         (Analysis pipeline)  │
└───────┬──────────────────────┬──────────────────┘
        │                      │
┌───────▼──────┐    ┌──────────▼──────────────────┐
│  AI Engine   │    │  Redis                       │
│  /engine/*   │    │  • Task broker               │
│  joblens/    │    │  • Result backend            │
│  analysis/   │    │  • WebSocket pub/sub bridge  │
│  profile/    │    └─────────────────────────────┘
│  discrepancy/│
└──────────────┘
```

### JobLens Pipeline — DAG Execution

The 6-step pipeline is a dependency graph executed in parallel waves, not a linear sequence:

```
 Wave 1 ──────────────────────── asyncio.gather() ──────────────
 │  [Step 1: Profile Extract]   (cache hit → zero LLM call)     │
 │  [Step 2: JD Parse        ]                                   │
 └────────────────────────────────────────────────────────── ▼ ─┘
                              both complete
 Wave 2 ──────────────────────── asyncio.gather() ──────────────
 │  [Step 3: Company Intel   ]   (web scrape + LLM)             │
 │  [Step 4: Match Analysis  ]   (scores 0–100)                 │
 │  [Step 5: Contact Strategy]   (3–5 named contacts + DMs)     │
 └────────────────────────────────────────────────────────── ▼ ─┘
                              all three complete
 Wave 3 ──────────────────────── sequential ────────────────────
    [Step 6: Action Plan    ]   (synthesizes all prior output)
```

Each step emits a WebSocket event the moment it completes — the UI populates progressively.

---

## DSA & Algorithms

### 1. Topological Scheduling on a Dependency DAG

The JobLens pipeline is a static DAG. Steps are grouped by their earliest executable wave based on data dependencies, then each wave is dispatched with `asyncio.gather()`. Conceptually identical to `make -j` or Airflow's parallel task executor.

```python
# Wave 1: no dependencies between steps
await asyncio.gather(run_step1(), run_step2())

# Wave 2: depends on both Wave 1 results
await asyncio.gather(run_step3(), run_step4(), run_step5())

# Wave 3: depends on all of Wave 2
await run_step6()
```

**Complexity:** O(max_wave_latency) wall-clock time instead of O(sum_of_all_latencies). 6 serial steps at ~3s each = 18s. With wave scheduling: ~9s.

---

### 2. Weighted Dot-Product Scoring

`UnifiedAnalyzer` computes a final score as a weighted linear combination across four independent dimensions:

```python
WEIGHTS = {
    'qualification': 0.30,
    'skill':         0.25,
    'keyword':       0.25,
    'formatting':    0.20,
}

final_score = sum(score[dim] * WEIGHTS[dim] for dim in WEIGHTS)
```

Each dimension score is independently computed by a dedicated module. The weights are explicit constants, not learned — making them auditable and tweakable.

**Re-evaluation delta tracking:** Every run is stored as an append-only `ResumeHistory` snapshot. The delta `Δ = new_score − previous_score` is computed at read time, enabling a time-series view of score improvement.

---

### 3. Hash-Keyed Deduplication with Priority-Ordered Merge

`engine/profile/unifier.py` merges up to three profile sources using a priority-ordered pass with O(1) duplicate detection:

```python
seen: set[tuple] = set()

for source_type in ['resume', 'linkedin', 'portfolio']:   # priority order
    for item in source.get('work_experience', []):
        key = (item['company_name'].strip().lower(),
               item['job_title'].strip().lower())
        if key in seen:
            continue           # lower-priority duplicate — skip
        seen.add(key)
        all_items.append(item)

all_items.sort(key=lambda x: str(x.get('start_date', '')), reverse=True)
```

- **Skills:** `set.union()` across all sources — every unique skill from any source survives
- **Work Experience:** hash-dedup by `(company, title)` tuple; sort by `start_date` descending
- **Education:** same pattern by `(institution, degree)`
- **Dynamic sections:** first-write-wins for scalars; list union with string-keyed set for arrays

**Complexity:** O(n) dedup pass + O(n log n) sort. Priority encoding is implicit in iteration order.

---

### 4. Greedy Knapsack — Web Scrape Budget

`CompanyIntelAnalyzer._fetch_multiple_pages()` uses a greedy approach to stay within the LLM context budget:

```python
PAGES   = ['/', '/about', '/careers', '/engineering', '/blog', '/team']
BUDGET  = 15_000  # characters

content = ""
for path in PAGES:
    text = trafilatura.fetch_url(company_url + path)
    if text:
        content += text
    if len(content) >= BUDGET:
        break
```

`trafilatura` strips nav, headers, ads, and footers — so the 15k budget is signal-dense article text, not boilerplate. The LLM is then instructed to say "Unknown" rather than hallucinate anything not in the context.

**Concept:** Greedy approximation of the bounded knapsack problem (maximize information density within a fixed token budget).

---

### 5. Semantic Entity Resolution Before Diff

The `DiscrepancyAnalyzer` doesn't do naive field-by-field comparison. It first resolves entity identity across sources before diffing:

> *"Ingelt Board" and "InGelt Board" are the SAME company. "NYU" and "New York University" are the SAME institution. Align them first."*

This is **fuzzy entity resolution** — the same problem that database deduplication systems solve with edit distance (Levenshtein), Jaccard similarity, or BK-trees. Here it's delegated to the LLM as a semantic normalization pass, enabling the structured diff to operate on correctly aligned entities.

The output is a typed `ProfileDiscrepancy` with per-item status: `match` / `mismatch` / `partial`, plus a `consistency_score` (0–100).

---

### 6. JD Tone Detection → Cover Letter Mode Routing

The `auto` cover letter mode runs a classification pre-step before generation:

```
JD Text → JDToneAnalyzer → JDToneAnalysis {
    recommended_mode: "disruptive" | "storyline" | "regular",
    confidence: 0.0–1.0,
    tone_signals: ["moves fast", "startup culture", ...],
    detected_industry: "fintech"
}
→ used as actual generation mode
```

Each mode runs at a different temperature calibrated to the task:

| Mode | Temperature | Rationale |
|---|---|---|
| Regular | 0.60 | Factual, structured, low variance |
| Storyline | 0.70 | Narrative flow, controlled creativity |
| Disruptive | 0.85 | Deliberate unpredictability, rhythm variation |

**Concept:** Multi-class routing + temperature as a hyperparameter — analogous to setting the exploration parameter in ε-greedy or beam search width.

---

## Systems Design Highlights

### Async/Thread Boundary Management

Blocking LLM calls (synchronous HTTP under the hood) are offloaded to a thread pool so they don't stall the event loop:

```python
result = await loop.run_in_executor(
    None, lambda: extract_profile(unified_profile, llm)
)
```

Database writes use short-lived sessions opened and closed per write to avoid holding connections across long async tasks:

```python
def db_write(fn):
    db = SessionLocal()
    try:
        fn(db)
        db.commit()
    finally:
        db.close()
```

---

### Cross-Process WebSocket Bridge (Redis Pub/Sub)

Celery workers run in a separate process — they can't write directly to a WebSocket. Redis pub/sub bridges the gap:

```
Celery Task
    └─► notify_job_status()
            └─► Redis PUBLISH "job_updates" {payload}
                    └─► FastAPI subscriber
                            └─► manager.send_to_user()
                                    └─► WebSocket → Client
```

The async pipeline path (FastAPI BackgroundTasks) skips Redis and calls `manager.send_to_user()` directly, since it shares the event loop. Both paths produce identical event shapes on the frontend.

---

### Session-Scoped Multiplexed WebSocket

`useGlobalWebSocket` maintains **one** persistent socket per authenticated session, then routes events to N consumers by type:

```typescript
subscribeToJobLens(sessionId, handler)   // per-pipeline-run listener
subscribeToDiscrepancy(handler)           // module-level emitter
// job_update events → Zustand store directly
```

A new pipeline run subscribes by its `sessionId` — only its step events fire its handler. Other concurrent runs don't cross-contaminate.

---

### Dependency Injection via Factory Method

```python
# API layer: resolves provider from user prefs, injects downstream
llm = LLMClient.from_user_settings({
    "llm_provider": user.llm_provider,
    "llm_model":    user.llm_model
})

# All engine modules receive llm as a parameter — nothing self-initializes
result = analyze_match(extracted_profile, parsed_jd, llm)
```

Swapping from Gemini to Grok is a user setting, not a code change. No module reaches for environment variables or instantiates its own client.

---

### JSON Columns — Schema-Flexible Storage

All AI-generated structured data lives in JSON columns rather than normalized tables:

```
joblens_sessions:
  extracted_profile  JSON   ← full ExtractedProfile model dump
  parsed_jd          JSON   ← full ParsedJD model dump
  company_intel      JSON
  match_analysis     JSON
  contact_strategy   JSON
  action_plan        JSON
  current_step       INT    ← pipeline progress without deserializing blobs
```

With 6 pipeline steps × ~15–20 fields per model, normalization would require 90+ columns and constant migration churn during active development. JSON columns let the Pydantic schema evolve freely; `current_step` tracks progress cheaply.

`ensure_sqlite_schema()` on startup handles additive column migrations that SQLAlchemy's `create_all` doesn't manage on existing tables.

---

### Startup Race Condition Fix (Token Hydration)

On page reload, Zustand's `persist` middleware reads from localStorage — but `api.ts` (which attaches the Bearer token to every request) initializes before the store rehydrates. Fix: `onRehydrateStorage` runs synchronously during hydration and pushes the token into `api.ts` before any outbound request fires.

```typescript
onRehydrateStorage: () => (state) => {
    if (state?.token) setApiToken(state.token);  // sync, before first request
}
```

Same class of bug as a DB connection pool being used before it's ready.

---

## LLM Engineering

### Structured Output — No Parsing, No `json.loads()`

Every LLM call returns a typed Pydantic model via `instructor`. The call either gives you a `MatchAnalysis` or raises — there's no string parsing, no `.get()`, no field extraction anywhere in engine code.

```python
result: MatchAnalysis = llm.complete(
    response_model=MatchAnalysis,
    messages=[...],
    temperature=0.0,
)
# result.overall_score, result.technical_fit, etc. — fully typed
```

This eliminates an entire class of runtime bugs: missing fields, unexpected types, silent `None` values from failed parses.

---

### Model-Task Assignment (Deliberate, Not Default)

| Task | Model | Temperature | Rationale |
|---|---|---|---|
| Qualification Check | `gemini-2.5-pro` | 0.0 | Semantic reasoning on nuanced claims |
| Match Analysis | `gemini-2.5-pro` | 0.3 | Scoring needs consistency |
| Keyword Match | `gemini-2.5-flash` | 0.0 | Pattern match — speed matters |
| Formatting Check | `gemini-2.5-flash` | 0.0 | Rule-based, deterministic |
| Action Plan | user-selected | 0.5 | Synthesis needs some creativity |
| Disruptive Cover Letter | user-selected | 0.85 | Deliberate variance is the point |
| Profile Unification | `deepseek-chat` | 0.0 | Cost-efficient, runs once on upload |

---

### Evidence-Grounded Prompting

`QualificationChecker` system prompt enforces a hard constraint:

> *"The `evidence` field must NEVER be empty. For matched items, quote the exact resume text that demonstrates the qualification. For unmatched items, state specifically what is missing."*

This forces the LLM to ground every ✓/✗ judgment in actual text, dramatically reducing hallucinated matches. It's not UX polish — it's an epistemic constraint.

Similarly, `KeywordMatcher` is forbidden from using array index notation in suggestions (`work_experience[0]`). All suggestions must reference sections by human-readable keys (`"Software Engineer at Acme Corp"`).

---

### Profile Extract Caching

After a user uploads their profile, `ExtractedProfile` is stored on the `UserProfile` record. Every subsequent JobLens run reuses this directly — Step 1 skips the LLM call entirely. One upload, zero re-extractions until the profile changes.

---

## Cost Evaluation

### JobLens Pipeline — Per-Run Cost Estimate

| Step | Model (default) | Input tokens | Output tokens | Est. cost |
|---|---|---|---|---|
| Step 1: Profile Extract | *(cache hit — $0)* | — | — | **$0.000** |
| Step 2: JD Parse | Gemini Flash | ~2,000 | ~800 | ~$0.001 |
| Step 3: Company Intel | Gemini Flash | ~5,000 | ~1,200 | ~$0.002 |
| Step 4: Match Analysis | Gemini Pro | ~4,000 | ~1,000 | ~$0.015 |
| Step 5: Contact Strategy | Gemini Flash | ~3,000 | ~800 | ~$0.001 |
| Step 6: Action Plan | Gemini Pro | ~6,000 | ~2,000 | ~$0.027 |
| **Total (cached profile)** | | **~20,000** | **~5,800** | **~$0.046** |

> First run (no cache): add ~$0.004 for Step 1 profile extraction.

---

### Resume Analysis Pipeline — Per-Run Cost Estimate

| Module | Model | Est. cost |
|---|---|---|
| Qualification Check | Gemini 2.5 Pro | ~$0.018 |
| Keyword Match | Gemini 2.5 Flash | ~$0.004 |
| Formatting Check | Gemini 2.5 Flash | ~$0.002 |
| **Total per analysis** | | **~$0.024** |

---

### Cover Letter — Per-Generation Cost Estimate

| Mode | Extra steps | Est. cost |
|---|---|---|
| Regular / Storyline / Disruptive | None | ~$0.012 |
| Auto (with tone detection pre-step) | +1 JDToneAnalyzer call | ~$0.015 |
| Custom (with PromptEnhancer pre-step) | +1 enhancement call | ~$0.016 |

---

### Provider Cost Comparison (Full JobLens Run)

| Provider | Price (in/out per M tokens) | Est. cost/run |
|---|---|---|
| Gemini 2.5 Flash (all steps) | $0.15 / $0.60 | **~$0.008** |
| Gemini 2.5 Pro (all steps) | $1.25 / $10.00 | **~$0.10** |
| Grok-3 (all steps) | $3.00 / $15.00 | **~$0.17** |
| Mixed (Flash + Pro as assigned) | — | **~$0.046** |

---

### Cost at Scale

| Users | Runs/month/user | Monthly LLM cost (mixed) |
|---|---|---|
| 100 | 10 | ~$46 |
| 1,000 | 10 | ~$460 |
| 10,000 | 10 | ~$4,600 |

**Key lever: profile caching.** Step 1 is skipped on every run after first upload. For a user who submits 10 jobs/month, this saves ~$0.04 per user per month — roughly one free run per user per 10 uses.

**Infrastructure costs are near-zero** at this scale: Redis pub/sub payloads are <1KB each; SQLite has no server overhead; Celery workers are I/O-bound (waiting on LLM APIs), not CPU-bound.

---

## What's Next

From `SUGGESTION_BOX.md`:

```
- Job Scraper        — Auto-pull JDs from LinkedIn, Indeed
- Interview Prep AI  — Structured mock interview with feedback
- Salary Negotiation — Data-driven offer evaluation tool
```

The infrastructure is already built for all three. JobLens Step 6 already generates interview prep questions. The contact strategy module already models outreach. The pipeline just needs new steps, not new architecture.

---

*Codebase reviewed: May 2026*
