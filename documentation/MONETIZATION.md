# Wand — Monetization Plan: Payments, Gateway, Rate Limiting, Subscriptions

> Full economic model + architecture for charging users. Grounded in the real
> per-task token budgets (`engine/inference.py`) and the provider-agnostic client
> layer (`engine/providers.py`, `api/llm.py`). **All provider prices below must be
> re-checked against live pricing before launch** — they are June-2026 reference
> figures and they move.

---

> **⚠️ SHIPPED DECISION (supersedes the hybrid recommendation below):** The product
> ships **Grok-only — no DeepSeek mix.** Final tier limits, margins, and the build spec
> live in [BILLING_DEV_PLAN.md](BILLING_DEV_PLAN.md), which is **authoritative**. The
> DeepSeek/hybrid analysis in §2–§3 below is retained as reference for *why* model choice
> drives margin and as a future option — it is **not** the current plan.

## 0. TL;DR

1. **Don't sell tokens. Sell tasks, meter tokens internally.** Users understand "150
   cover letters/month", not "1.5M tokens".
2. **Model choice dominates margin.** On the same task, **Grok-3 costs ~12–13× more
   than DeepSeek**. Route high-volume tasks (profile, job analysis, reachout) to
   DeepSeek; keep the user-facing cover letter on Grok. This is already a one-line
   config change in `api/llm_config.json`.
3. **Three rate-limit windows** stacked: per-minute (abuse/burst), daily + weekly
   (bound worst-case spend), monthly (the subscription entitlement).
4. **Reserve → settle** credit accounting: debit an estimate before the LLM call,
   reconcile to actual token cost after. An append-only ledger is the source of truth.
5. **Stripe** for payments (Checkout + Customer Portal + webhooks). Stripe is the
   billing source of truth; mirror the minimum locally.

---

## 1. The cost basis (exact math)

### 1.1 Provider pricing (per 1M tokens — VERIFY LIVE)

| Model | Input $/1M | Output $/1M |
|---|---|---|
| **Grok-3** (xAI) | 3.00 | 15.00 |
| **DeepSeek-chat** (V3, cache-miss) | 0.27 | 1.10 |

DeepSeek cached input is ~$0.07/1M — repeated system prompts/schemas get cheaper, so
real DeepSeek cost is usually *below* the figures here. Grok has no published prompt-
cache discount in this model, so treat Grok numbers as the worst case.

### 1.2 What a "task" costs in tokens

A user-facing **task** is a chain of engine calls. Token estimates below combine the
real output ceilings from `engine/inference.py` with realistic input sizes (resume +
job description + injected JSON schema). Output rarely hits the cap, so these are
*typical*, not worst-case.

| Task | Engine calls | Input tok | Output tok | Total |
|---|---|---|---|---|
| **Job Analysis** | `break_down_job_description` + `extract_company_intel` + `match_profile_to_job` | 10,500 | 6,700 | **17,200** |
| **Cover Letter** | `analyze_jd_tone` + `write_cover_letter` | 4,500 | 1,700 | **6,200** |
| **Profile Build** (onboarding / resume change) | `parse_profile` + `extract_long_form` + `merge` + `unify` | 21,000 | 22,000 | **43,000** |
| **Reachout** (optional) | `plan_reachout_queries` + `validate_reachout_candidates` | 5,500 | 2,800 | **8,300** |

### 1.3 Cost per task (input×in_rate + output×out_rate)

| Task | Grok-3 | DeepSeek | Ratio |
|---|---|---|---|
| Job Analysis | `10,500·3 + 6,700·15` /1M = **$0.132** | `10,500·0.27 + 6,700·1.10` /1M = **$0.0102** | 13× |
| Cover Letter | **$0.039** | **$0.0031** | 12× |
| Profile Build | **$0.393** | **$0.0299** | 13× |
| Reachout | **$0.0585** | **$0.0046** | 13× |

**Worked example (Job Analysis, Grok-3):**
`(10,500 × $3.00/1,000,000) + (6,700 × $15.00/1,000,000)`
`= $0.0315 + $0.1005 = $0.132`

### 1.4 Tokens per $1 (blended at the Job-Analysis in:out ratio)

| Model | Blended $/1k tok | **Tokens per $1** |
|---|---|---|
| Grok-3 | $0.132 / 17.2 = **$0.00767** | **~130,000** |
| DeepSeek | $0.0102 / 17.2 = **$0.000593** | **~1,690,000** |

This is the headline answer to *"how many tokens for how much money"*: **$1 buys ~130k
Grok tokens or ~1.69M DeepSeek tokens.** Equivalently, **$1 ≈ 7.6 Job Analyses on Grok
or ~98 on DeepSeek.**

---

## 2. From tokens → a credit users understand

Expose a single virtual unit — a **credit** — and price each task in credits. Keep the
credit price fixed so model-cost variance becomes *your margin*, not the user's problem.

**Definition used here:** sell credits at **$0.02 each** (so $20 = 1,000 credits).

Task price (fixed, user-facing) and the cost it must cover:

| Task | Credits charged | Revenue @ $0.02 | Grok cost → margin | DeepSeek cost → margin |
|---|---|---|---|---|
| Cover Letter | 4 | $0.08 | $0.039 → **51%** | $0.0031 → **96%** |
| Job Analysis | 12 | $0.24 | $0.132 → **45%** | $0.0102 → **96%** |
| Reachout | 6 | $0.12 | $0.0585 → **51%** | $0.0046 → **96%** |
| Profile Build | 30 | $0.60 | $0.393 → **34%** | $0.0299 → **95%** |

**Read this carefully:** on Grok-only, margins are a thin 34–51% — a heavy user erodes
profit. On DeepSeek they're 95%+. Hence the **hybrid routing** recommendation below.

### Recommended hybrid routing (config-only change)

| Task | Route to | Reason |
|---|---|---|
| Profile Build | DeepSeek | High token volume, structured extraction — quality difference negligible |
| Job Analysis | DeepSeek | High volume, internal scoring |
| Reachout | DeepSeek | High volume, internal |
| **Cover Letter** | **Grok-3** | User-facing artifact, quality is the product |

`api/llm_config.json`:
```json
{
  "provider": "grok",
  "models": {
    "default": "grok-3",
    "profile": "deepseek-chat",
    "job_description": "deepseek-chat",
    "company_intel": "deepseek-chat",
    "job_match": "deepseek-chat",
    "reachout": "deepseek-chat",
    "cover_letter": "grok-3",
    "cover_letter_tone": "deepseek-chat"
  }
}
```
(For `deepseek-chat` you must also set `provider` per-task or extend `build_llm_from_settings`
to pick the provider from the model name — see §6 implementation notes.)

**Hybrid cost per task** (used for all tier math below):

| Task | Hybrid cost |
|---|---|
| Profile Build | $0.030 |
| Job Analysis | $0.010 |
| Reachout | $0.005 |
| Cover Letter | $0.039 |

---

## 3. Subscription tiers (exact economics)

Each tier = a monthly **entitlement** + **daily/weekly caps** (the caps bound worst-case
spend so one power user can't drain a month's COGS in a day). "Worst-case COGS" assumes
100% of the monthly entitlement is consumed; "Expected COGS" assumes ~40% utilization
(typical SaaS breakage — most users never exhaust their plan).

| | **Free** | **Starter $12** | **Pro $29** | **Power $79** |
|---|---|---|---|---|
| Profile builds / mo | 1 | 2 | 5 | 10 |
| Job analyses / mo | 10 | 60 | 200 | 800 |
| Cover letters / mo | 5 | 40 | 150 | 600 |
| **Daily cap** | 3 analyses / 2 letters | 8 / 6 | 20 / 15 | 60 / 40 |
| **Weekly cap** | 10 / 5 | 25 / 15 | 70 / 50 | 200 / 150 |
| Monthly credits (≈) | 100 | 460 | 1,560 | 6,100 |
| **Worst-case COGS** (hybrid) | $0.33 | $2.22 | $8.00 | $31.7 |
| **Margin @ worst case** | — | **81%** | **72%** | **60%** |
| **Expected COGS** (40% util) | $0.13 | $0.89 | $3.20 | $11.1 |
| **Margin @ expected** | — | **93%** | **89%** | **86%** |

### Worked example — Pro, worst case (hybrid)
`5 profile × $0.030 + 200 analysis × $0.010 + 150 letters × $0.039`
`= $0.150 + $2.00 + $5.85 = $8.00`  → margin `(29 − 8)/29 = 72%`.

### Why hybrid matters — same Pro tier on **Grok-only**
`5×0.393 + 200×0.132 + 150×0.039 = 1.965 + 26.4 + 5.85 = $34.2`  → **margin −18%** (you
*lose* money on a fully-utilized Grok-only Pro user). This single comparison is the
business case for routing.

### Top-ups (overflow without forcing an upgrade)
Sell à-la-carte credit packs at the same $0.02/credit, e.g. **$5 → 250 credits**. Top-up
credits are pure-margin buffer and let heavy users self-serve past the monthly cap.

---

## 4. Architecture

Four layers, each maps to one of your `tasks.md` items.

```
Request
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. AUTH        identify user (existing api/auth.py)          │
├─────────────────────────────────────────────────────────────┤
│ 2. GATEWAY     resolve plan → check rate limits → RESERVE    │
│                credits → call engine → meter actual tokens   │
│                → SETTLE credits → write usage_event          │
├─────────────────────────────────────────────────────────────┤
│ 3. RATE LIMIT  per-min / daily / weekly / monthly windows    │
├─────────────────────────────────────────────────────────────┤
│ 4. SUBSCRIPTION  plan, entitlement, credit ledger (Stripe)   │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Payments (Stripe)

**Why Stripe:** Checkout, Customer Portal (users manage/cancel themselves), proration,
dunning, and webhooks out of the box. (If your customers are India-first, use
**Razorpay**; if you want a Merchant-of-Record that handles global sales tax/VAT, use
**Paddle/Lemon Squeezy** — same integration shape.)

**Flow:**
1. User clicks *Subscribe* → backend creates a **Checkout Session** for the plan's
   `price_id` → redirect to Stripe.
2. Stripe redirects back; **do not trust the redirect** for state.
3. **Webhooks are the source of truth.** Handle, idempotently (dedupe on `event.id`):
   - `checkout.session.completed` / `customer.subscription.created` → activate plan, grant first credit batch.
   - `customer.subscription.updated` → plan change / proration → adjust entitlement.
   - `invoice.paid` → monthly renewal → **grant the month's credits**.
   - `invoice.payment_failed` → mark `past_due`, soft-limit access.
   - `customer.subscription.deleted` → downgrade to Free at period end.
4. Store the Stripe `customer_id` and `subscription_id` on the user; keep plan/status
   mirrored locally so the hot path never calls Stripe.

**Security:** verify the webhook signature (`Stripe-Signature`), keep secret keys in
server env only (consistent with how `api/llm.py` already treats API keys).

### 4.2 Gateway (app-layer middleware / FastAPI dependency)

Every credit-consuming endpoint (`jobs`, `cover_letters`, `profile`) goes through one
dependency. **Reserve → settle** keeps you safe even though token cost isn't known until
after the call:

```
def metered(task_type):              # FastAPI dependency factory
    def dep(user = Depends(current_user)):
        plan = get_plan(user)
        est  = ESTIMATED_CREDITS[task_type]      # from §2 table
        enforce_rate_limits(user, task_type, est)  # raises 429
        hold = ledger.reserve(user, est)           # raises 402 if insufficient
        return MeterContext(user, task_type, hold)
    return dep
```
After the engine call returns, read the **actual** provider `usage`, convert to credits,
and `ledger.settle(hold, actual_credits)` (refund the difference, or charge a tad more).

A dedicated edge gateway (Kong / APISIX / Cloudflare Workers) is **not needed yet** — an
app-layer dependency is simpler and co-located with the metering logic. Move to an edge
gateway only when you need multi-service quota sharing or sub-ms limit checks.

### 4.3 Rate limiting (token/credit-aware, multi-window)

Requests aren't equal — a Profile Build costs 30 credits, a Cover Letter 4. So **limit
on credits, not request count.** Stack windows:

| Window | Purpose | Algorithm |
|---|---|---|
| per-minute | abuse / runaway loops | token bucket (burst) |
| **daily** | bound worst-case daily spend | fixed window counter |
| **weekly** | smooth usage | fixed window counter |
| **monthly** | the subscription entitlement | fixed window = credit grant |

**Storage:** Redis is ideal (atomic `INCR`+`EXPIRE`, token-bucket via Lua). For an MVP
on your current SQLite stack, a `rate_windows(user_id, window_key, count, resets_at)`
table with a row-level `UPDATE ... WHERE count+cost<=limit` is sufficient — switch to
Redis when concurrency rises.

**Token-bucket math (per-minute burst):** capacity `B`, refill `r` credits/sec. On each
request of cost `c`: refill `tokens = min(B, tokens + r·Δt)`; allow iff `tokens ≥ c`,
then `tokens -= c`. Example Pro: `B = 60`, `r = 1/sec` → bursts of ~5 analyses, steady
~60 credits/min.

**On limit hit:** return **HTTP 429** with `Retry-After` and headers
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (per window). On
empty balance return **HTTP 402 Payment Required** with an upgrade/top-up link.

### 4.4 Subscriptions & credit ledger

- **Append-only `credit_ledger`** is the source of truth for balance (sum of deltas).
  Never mutate a balance column in place — append `grant`, `reserve`, `settle`,
  `refund`, `expire` rows. This gives you a full audit trail and makes disputes trivial.
- **Granting:** on `invoice.paid`, append a `+entitlement` row tagged with the period.
- **Rollover policy:** simplest is **no rollover** (credits expire at period end —
  append an `expire` row). If you allow rollover, cap it (e.g. ≤1 month) to limit
  liability.
- **Upgrades:** Stripe prorates the charge; grant the *delta* of credits immediately.
- **State machine:** `trialing → active → past_due → canceled`. `past_due` keeps
  read access but blocks new credit-consuming tasks.

---

## 5. Data model (SQLAlchemy, fits `api/models.py`)

```python
class Plan(Base):                      # static catalog (or in code)
    id, name, price_cents, stripe_price_id
    monthly_credits, daily_cap, weekly_cap, per_min_burst

class Subscription(Base):
    user_id (FK, unique)
    plan_id (FK)
    stripe_customer_id, stripe_subscription_id
    status            # trialing|active|past_due|canceled
    current_period_start, current_period_end

class CreditLedger(Base):              # append-only
    id, user_id (FK)
    delta             # +grant / -reserve / +refund ...
    kind              # grant|reserve|settle|refund|expire|topup
    task_type         # nullable
    ref               # request id / stripe invoice id (idempotency)
    created_at
    # balance = SELECT SUM(delta) WHERE user_id = ?

class UsageEvent(Base):                # one row per LLM-backed task
    id, user_id (FK), task_type
    provider, model
    input_tokens, output_tokens
    raw_cost_usd      # what YOU paid
    credits_charged   # what the USER paid
    created_at

class RateWindow(Base):                # MVP without Redis
    user_id (FK), window_key           # e.g. "daily:2026-06-01"
    credits_used, resets_at
```

`UsageEvent` is gold: it gives you real per-user margin, cost dashboards, and the data to
re-tune credit prices.

---

## 6. Metering — the linchpin (implementation note)

You currently **discard token usage**: `XAIClient.complete` returns the `instructor`
object and `DeepSeekClient.complete` returns the parsed Pydantic model — neither surfaces
`response.usage`. **Without real usage you cannot meter accurately.** First change to make:

- **DeepSeek:** the raw `response` already has `.usage` (prompt/completion/total tokens).
  Return it alongside the parsed model.
- **Grok via instructor:** the completion exposes the raw response (e.g.
  `obj._raw_response.usage`) — capture `prompt_tokens` / `completion_tokens` there, or
  call with `create_with_completion` to get both.

Wrap both in a small return type, e.g. `(parsed, Usage(input, output, model, provider))`,
sum usage across the calls in a task, then:

```
raw_cost = input·in_rate + output·out_rate        # §1.1 rates by model
credits  = ceil(raw_cost / 0.02 * MARKUP)          # or fixed per-task from §2
ledger.settle(hold, credits)
UsageEvent.create(..., raw_cost_usd=raw_cost, credits_charged=credits)
```

Use **fixed per-task credit prices (§2)** as the user-facing charge for predictability,
and store the **actual `raw_cost_usd`** in `UsageEvent` so you always know your true
margin and can re-price when provider rates change.

---

## 7. Build order

1. **Metering** — capture `usage` from both providers (§6). Nothing else works without it.
2. **Ledger + UsageEvent** tables; balance = `SUM(delta)`.
3. **Gateway dependency** — reserve/settle around the engine calls in `jobs`,
   `cover_letters`, `profile` routers.
4. **Rate limits** — daily/weekly/monthly counters (SQLite now, Redis later).
5. **Stripe** — Checkout + Customer Portal + webhook handler granting credits on
   `invoice.paid`.
6. **Hybrid routing** — flip `api/llm_config.json` to DeepSeek for high-volume tasks.
7. **Dashboards** — read `UsageEvent` for per-user margin and abuse detection.

---

## 8. Re-deriving the math (so it survives price changes)

Everything above is two formulas. Re-run them whenever provider prices or token sizes change:

```
cost_per_task   = Σ_over_calls (input_tok · in_rate + output_tok · out_rate)
margin          = (price − Σ cost_per_task · expected_count) / price
max_tasks@margin = price · (1 − target_margin) / cost_per_task
```

Example — *"how many cover letters can a $29 Pro user do at ≥75% margin?"* (Grok letters):
`29 · (1 − 0.75) / 0.039 = 7.25 / 0.039 ≈ 185 cover letters/month`. On DeepSeek the same
budget buys `7.25 / 0.0031 ≈ 2,338`. The lever is always the model.
