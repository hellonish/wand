# Wand — Billing, Subscriptions & Rate-Limiting: Developer Hand-off Spec

**Status:** final, ready to implement.
**Audience:** the implementing developer.
**How to read this:** this is a *specification*, not a suggestion. Every decision is made
for you. Where you think there's a choice, look in **§2 Non-negotiable rules** — it is
almost certainly answered there. **Do not invent behavior that isn't written here. If
something is genuinely undefined, stop and ask the product owner; do not assume.**

Related docs: [MODELS.md](MODELS.md) (real provider/inference layer),
[MONETIZATION.md](MONETIZATION.md) (economics & rationale — reference only; *this* file is
authoritative).

---

## 1. Current state of the codebase (what already exists)

You are adding to a working FastAPI + SQLAlchemy + SQLite app. Confirmed facts:

- **App entry:** `api/main.py`. Tables are created at import time via
  `Base.metadata.create_all(bind=engine)` then `ensure_sqlite_schema(engine)`. Routers are
  registered with `app.include_router(...)`.
- **DB:** `api/database.py`. SQLite (`wand.db`) in dev, Postgres via `DATABASE_URL` in prod.
  WAL mode + `busy_timeout=5000` already set. Session dependency: `get_db()`.
- **Models:** `api/models.py`. UUID PKs via `generate_uuid()` (`String(36)`). `User` model
  exists (`id`, `email`, `name`, `is_deleted`, `onboarding_completed`, …) with
  relationships to `Job`, `CoverLetter`, `UserProfile`, etc.
- **Auth:** `api/auth.py`. `get_current_user(...) -> User` is the FastAPI dependency for
  authenticated routes. New users are created in `get_or_create_user(db, email, name, picture)`.
- **LLM layer (provider-agnostic, GROK-ONLY for this product):**
  - `engine/providers.py`: `XAIClient` (default `grok-3`) and `DeepSeekClient`. Each exposes
    `complete(response_model, messages, temperature, max_tokens) -> parsed_model`.
    **They currently DISCARD token usage.** This is the #1 thing you will fix.
  - `engine/inference.py`: every LLM call registered with an explicit `max_tokens` budget.
  - `api/llm.py`: `get_llm(task="default")` builds the right client from
    `api/llm_config.json`. **Keep every task on `grok-3`. Do not route anything to DeepSeek.**
- **The endpoints that consume the LLM (where billing hooks in):**

  | User action | Endpoint (file → function) | Engine work runs… |
  |---|---|---|
  | Job analysis (new job) | `POST /api/jobs` → `create_job` (`api/routers/jobs.py:755`) | background: `run_job_analysis_background` (`jobs.py:359`) |
  | Job analysis (re-run) | `POST /api/jobs/{job_id}/analyze` → `analyze_job` (`jobs.py:944`) | same background task |
  | Job analysis (retry failed steps) | `POST /api/jobs/{job_id}/retry-steps` → `retry_steps` (`jobs.py:997`) | `retry_steps_background` (`jobs.py:584`) |
  | Cover letter | `POST /api/cover-letters` → `create_cover_letter` (`api/routers/cover_letters.py:79`) | inline (synchronous) |
  | JD tone helper | `POST /api/cover-letters/analyze-jd` → `analyze_jd` (`cover_letters.py:43`) | inline |
  | Profile file upload+parse | `POST /api/profile/upload` → `upload_file` (`api/routers/profile.py:70`) | inline |
  | Profile build (unify) | `POST /api/profile/unified` → `create_unified` (`profile.py:302`) | inline |

---

## 2. Non-negotiable rules (read before writing any code)

1. **Grok-only.** All tasks use `grok-3`. Do not add, enable, or route to DeepSeek. Do not
   change `api/llm_config.json` providers.
2. **Credits are the single currency.** 1 credit is sold at **$0.02**. A user's balance is
   `SUM(delta)` over the append-only `credit_ledger` table. **Never** store a mutable
   balance integer; **never** UPDATE a balance in place.
3. **Fixed per-task credit price** (the user always pays the same for a task, regardless of
   actual tokens):

   | Task (`task_type`) | Credits charged |
   |---|---|
   | `profile_build` | 30 |
   | `job_analysis` | 12 |
   | `cover_letter` | 4 |
   | `reachout` | 6 |

   These are constants in code (`ESTIMATED_CREDITS`). Do not compute the user-facing charge
   from tokens. (You still record *actual* tokens & cost for analytics — see rule 5.)
4. **Reserve → settle.** Debit `ESTIMATED_CREDITS[task]` **before** the LLM work. After the
   work: on success, finalize (net-zero, since price is fixed); on **any** failure/exception,
   **refund the full reservation**. A user must never be charged for a failed task.
5. **Always record real usage.** Every LLM-backed request — *even the free ones* — writes one
   `UsageEvent` row with real `input_tokens`, `output_tokens`, `raw_cost_usd` (what we paid
   Grok), and `credits_charged` (0 for free endpoints). This is how we monitor margin.
6. **What is charged vs free** (do not deviate):

   | Endpoint | Charged? | `task_type` | Counts against limit |
   |---|---|---|---|
   | `POST /api/jobs` | **12 credits** | `job_analysis` | job analysis daily/weekly |
   | `POST /api/jobs/{id}/analyze` | **12 credits** | `job_analysis` | job analysis daily/weekly |
   | `POST /api/jobs/{id}/retry-steps` | **FREE** (already paid) | `job_analysis_retry` | per-minute burst only |
   | `POST /api/cover-letters` | **4 credits** | `cover_letter` | cover letter daily/weekly |
   | `POST /api/cover-letters/analyze-jd` | **FREE** (internal helper) | `cover_letter_tone` | per-minute burst only |
   | `POST /api/profile/unified` | **30 credits** | `profile_build` | profile build daily |
   | `POST /api/profile/upload` | **FREE**, but hard-capped | `profile_upload` | upload daily cap + max active files |

   - `profile_build` (the 30-credit charge at `/unified`) is intended to cover the **entire**
     build cycle including the per-file parsing done at `/upload`. That is why `/upload` is
     free. To stop someone uploading 1000 files (free token burn) without ever unifying,
     `/upload` is hard-capped: **max 8 uploads/day** and **max 12 active (non-deleted) files
     per user**. Exceeding → 429.
7. **Idempotency.** Every ledger write carries a `ref` string. Reserve uses a unique
   per-request id. Stripe grants use the Stripe `event.id` / `invoice.id`. Re-processing the
   same `ref` must be a no-op (check before insert).
8. **No double-charge on job analysis.** `create_job` and `analyze_job` each reserve once;
   the matching background task settles/refunds exactly once. `retry-steps` never charges.
9. **Insufficient balance → HTTP 402.** Rate-limit exceeded → **HTTP 429**. Both include the
   headers/body specified in §8. Never silently proceed.

---

## 3. Final product spec — tiers (GROK-ONLY)

> **Pricing updated Jun 2026** to match live Stripe products.
> Starter $5.99 / Pro $14.99 / Max $24.99 / Credits top-up $4.99.
> Top tier renamed **Power → Max** (Stripe product: "Max").
> Limits resized to maintain ~54–55% worst-case margin at new prices.

| | **Free** | **Starter $5.99** | **Pro $14.99** | **Max $24.99** |
|---|---|---|---|---|
| Profile builds / mo | 2 | 1 | 3 | 5 |
| Job analyses / mo | 5 | 15 | 35 | 60 |
| Cover letters / mo | 3 | 8 | 25 | 40 |
| **Monthly credits (grant)** | **132** | **242** | **610** | **1,030** |
| Daily cap | 5 actions/day (any) | 4 anl / 3 ltr | 7 anl / 5 ltr | 15 anl / 10 ltr |
| Weekly cap | — | 10 anl / 6 ltr | 20 anl / 12 ltr | 30 anl / 20 ltr |
| Profile-build daily cap | 1 | 1 | 2 | 3 |
| Upload daily cap | 8 | 8 | 12 | 20 |
| Per-minute burst | 30 credits | 30 | 60 | 120 |
| Price (Stripe) | $0 | $5.99 | $14.99 | $24.99 |

**Monthly credits are the hard monthly ceiling.** The per-task monthly numbers above are the
*representative* allocation at this credit price (what a typical mix buys); they are **not**
separately enforced counters. Credits are fungible across tasks. This is safe because every
task's credit price covers its own Grok cost. **Hard monthly enforcement =
credit balance. Hard sub-monthly enforcement = the daily/weekly/burst counters.** Do not
build per-task *monthly* counters.

Credit math (verify): `profile_build 30 + job_analysis 12 + cover_letter 4`.
Starter = `1·30 + 15·12 + 8·4 = 242`. Pro = `3·30 + 35·12 + 25·4 = 610`. ✔

**Top-ups:** one-time purchase **$4.99 → 250 credits** ($4.99/250 = $0.01996 ≈ $0.02/credit).
Top-up credits are added to the ledger (`kind="topup"`) and **do not expire** at period end
(only the monthly *grant* expires — see §6).

**Stripe env var for top tier:** `STRIPE_PRICE_MAX` (was `STRIPE_PRICE_POWER` — renamed to
match the Stripe product name "Max").

### Margins (for reference; do not "optimize" these without product sign-off)

| Tier | Worst-case COGS | Margin @ worst | Margin @ ~40% use |
|---|---|---|---|
| Free | $1.56 | — (CAC) | — |
| Starter $5.99 | $2.69 | **55.2%** | ~82% |
| Pro $14.99 | $6.77 | **54.8%** | ~82% |
| Max $24.99 | $11.45 | **54.2%** | ~82% |

Grok-3 unit costs: profile_build **$0.393**, job_analysis **$0.132**, cover_letter **$0.039**
(input·$3/1M + output·$15/1M; see §5 for token assumptions).

Worked example — **Pro worst case:** `3×0.393 + 35×0.132 + 25×0.039 = 1.179 + 4.620 + 0.975
= $6.774` → margin `(14.99 − 6.774)/14.99 = 54.8%`.

---

## 4. Data model — add to `api/models.py`

Add these classes. Use the existing import style; you must add `UniqueConstraint` to the
SQLAlchemy import line:
`from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Float, JSON, Boolean, UniqueConstraint`

```python
class Plan(Base):
    __tablename__ = "plans"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    code = Column(String, unique=True, nullable=False)          # "free"|"starter"|"pro"|"power"
    name = Column(String, nullable=False)
    price_cents = Column(Integer, nullable=False, default=0)
    stripe_price_id = Column(String, nullable=True)             # None for free
    monthly_credits = Column(Integer, nullable=False)
    daily_caps = Column(JSON, nullable=False)                   # see seed below
    weekly_caps = Column(JSON, nullable=True)
    profile_build_daily_cap = Column(Integer, nullable=False, default=1)
    upload_daily_cap = Column(Integer, nullable=False, default=8)
    per_min_burst = Column(Integer, nullable=False, default=30) # in credits

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)
    plan_id = Column(String(36), ForeignKey("plans.id"), nullable=False)
    stripe_customer_id = Column(String, nullable=True, index=True)
    stripe_subscription_id = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default="active")   # trialing|active|past_due|canceled
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)        # used for Free lazy reset (§6)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("User", back_populates="subscription")
    plan = relationship("Plan")

class CreditLedger(Base):                # APPEND-ONLY. balance = SUM(delta) WHERE user_id=?
    __tablename__ = "credit_ledger"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    delta = Column(Integer, nullable=False)                     # +grant/+topup/+refund, -reserve
    kind = Column(String, nullable=False)                       # grant|topup|reserve|refund|expire
    task_type = Column(String, nullable=True)
    ref = Column(String, nullable=False, index=True)            # idempotency key (unique per logical op)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("ref", "kind", name="uq_ledger_ref_kind"),)

class UsageEvent(Base):                   # one row per LLM-backed request (incl. free ones)
    __tablename__ = "usage_events"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    task_type = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="grok")
    model = Column(String, nullable=False, default="grok-3")
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    raw_cost_usd = Column(Float, nullable=False, default=0.0)   # what WE paid
    credits_charged = Column(Integer, nullable=False, default=0)
    ref = Column(String, nullable=True, index=True)             # ties to the reservation
    created_at = Column(DateTime, default=datetime.utcnow)

class RateWindow(Base):                   # fixed-window counters (SQLite MVP)
    __tablename__ = "rate_windows"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    window_key = Column(String, nullable=False)  # "{scope}:{task}:{period}" e.g. "daily:job_analysis:2026-06-01"
    count = Column(Integer, nullable=False, default=0)
    limit = Column(Integer, nullable=False)
    resets_at = Column(DateTime, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "window_key", name="uq_user_window"),)

class ProcessedWebhook(Base):             # Stripe idempotency
    __tablename__ = "processed_webhooks"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    stripe_event_id = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

Add to the existing `User` class relationships block:
```python
    subscription = relationship("Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan")
```

### Plan seed values — live (updated Jun 2026 to match Stripe products)

```python
PLAN_SEED = [
  {"code":"free","name":"Free","price_cents":0,"stripe_price_id":None,
   "monthly_credits":132,"daily_caps":{"actions":5},"weekly_caps":None,
   "profile_build_daily_cap":1,"upload_daily_cap":8,"per_min_burst":30},
  {"code":"starter","name":"Starter","price_cents":599,"stripe_price_id":"<env STRIPE_PRICE_STARTER>",
   "monthly_credits":242,"daily_caps":{"job_analysis":4,"cover_letter":3},
   "weekly_caps":{"job_analysis":10,"cover_letter":6},
   "profile_build_daily_cap":1,"upload_daily_cap":8,"per_min_burst":30},
  {"code":"pro","name":"Pro","price_cents":1499,"stripe_price_id":"<env STRIPE_PRICE_PRO>",
   "monthly_credits":610,"daily_caps":{"job_analysis":7,"cover_letter":5},
   "weekly_caps":{"job_analysis":20,"cover_letter":12},
   "profile_build_daily_cap":2,"upload_daily_cap":12,"per_min_burst":60},
  {"code":"max","name":"Max","price_cents":2499,"stripe_price_id":"<env STRIPE_PRICE_MAX>",
   "monthly_credits":1030,"daily_caps":{"job_analysis":15,"cover_letter":10},
   "weekly_caps":{"job_analysis":30,"cover_letter":20},
   "profile_build_daily_cap":3,"upload_daily_cap":20,"per_min_burst":120},
]
```
Free uses a single combined `{"actions": 5}` daily cap (any credit-consuming task counts as
1 action/day). Paid tiers use per-task daily/weekly caps. **Implement both shapes.**

---

## 5. Metering — DO THIS FIRST (everything depends on it)

### 5.1 New file `engine/usage.py`

```python
from dataclasses import dataclass, field

# Grok-3 pricing, USD per token. UPDATE if xAI changes prices.
RATES = {"grok-3": {"in": 3.00/1_000_000, "out": 15.00/1_000_000}}
_FALLBACK = {"in": 3.00/1_000_000, "out": 15.00/1_000_000}

@dataclass
class Usage:
    input_tokens: int
    output_tokens: int
    provider: str
    model: str

@dataclass
class UsageCollector:
    items: list = field(default_factory=list)
    def add(self, u: Usage): self.items.append(u)
    @property
    def input_tokens(self):  return sum(i.input_tokens  for i in self.items)
    @property
    def output_tokens(self): return sum(i.output_tokens for i in self.items)
    def cost_usd(self) -> float:
        total = 0.0
        for i in self.items:
            r = RATES.get(i.model, _FALLBACK)
            total += i.input_tokens*r["in"] + i.output_tokens*r["out"]
        return total
    @property
    def provider(self): return self.items[0].provider if self.items else "grok"
    @property
    def model(self):    return self.items[0].model if self.items else "grok-3"
```

### 5.2 Edit `engine/providers.py`

Both clients must capture usage and append to an optional collector. **This must not change
the return value** of `complete()` (callers still get the parsed model).

- Add to **both** `XAIClient.__init__` and `DeepSeekClient.__init__`:
  ```python
  self.collector = None          # set by api.llm.get_llm(...)
  ```
- Add a shared helper (module-level or on each class):
  ```python
  def _record(client, raw, PROVIDER):
      u = getattr(raw, "usage", None)
      if u is None or client.collector is None: return
      from engine.usage import Usage
      client.collector.add(Usage(
          input_tokens=getattr(u, "prompt_tokens", 0) or 0,
          output_tokens=getattr(u, "completion_tokens", 0) or 0,
          provider=PROVIDER, model=client.model))
  ```
- **XAIClient.complete:** instructor exposes `create_with_completion=True`, which returns
  `(parsed_model, raw_completion)`. Use it so you get `raw_completion.usage`:
  ```python
  result, completion = self._client.chat.completions.create_with_completion(
      model=self.model, response_model=response_model, messages=messages,
      temperature=temperature, max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
      max_retries=max_retries, strict=False)
  _record(self, completion, "grok")
  return result
  ```
- **DeepSeekClient.complete:** it already has `response` with `.usage`. Add
  `_record(self, response, "deepseek")` right before `return response_model.model_validate_json(content)`.

### 5.3 Edit `api/llm.py`

`get_llm` must accept and attach a collector:
```python
def get_llm(task: str = "default", collector=None):
    client = build_llm_from_settings(resolve_llm_settings(task))
    client.collector = collector
    return client
```
**Acceptance:** add a unit test that runs one real (or mocked) `complete()` and asserts the
collector captured non-zero `input_tokens` and `output_tokens`, and that `cost_usd()` matches
the manual formula. **Do not proceed to §6+ until this passes.**

---

## 6. Subscriptions, ledger & credit lifecycle — new package `api/billing/`

Create `api/billing/__init__.py`, `plans.py`, `ledger.py`, `subscriptions.py`,
`gateway.py`, `limits.py`.

### 6.1 `ledger.py`
```python
ESTIMATED_CREDITS = {"profile_build":30, "job_analysis":12, "cover_letter":4, "reachout":6}

def get_balance(db, user_id) -> int:
    return db.query(func.coalesce(func.sum(CreditLedger.delta), 0)).filter(
        CreditLedger.user_id==user_id).scalar() or 0

def _append(db, user_id, delta, kind, ref, task_type=None):
    # idempotent on (ref, kind): if a row already exists, return it, do nothing.
    existing = db.query(CreditLedger).filter_by(ref=ref, kind=kind).first()
    if existing: return existing
    row = CreditLedger(user_id=user_id, delta=delta, kind=kind, ref=ref, task_type=task_type)
    db.add(row); db.commit(); return row

def reserve(db, user_id, task_type, ref) -> int:
    cost = ESTIMATED_CREDITS[task_type]
    if get_balance(db, user_id) < cost:
        raise InsufficientCredits(cost)          # → caller returns HTTP 402
    _append(db, user_id, -cost, "reserve", ref, task_type)
    return cost

def refund(db, user_id, task_type, ref):
    cost = ESTIMATED_CREDITS[task_type]
    _append(db, user_id, +cost, "refund", ref, task_type)   # idempotent

def grant(db, user_id, amount, ref, kind="grant"):
    _append(db, user_id, +amount, kind, ref)

def expire_remaining_grant(db, user_id, ref):
    # No rollover of the monthly GRANT. Top-ups persist (different kind), so only expire
    # the unused portion of the granted balance. Simplest safe rule: bring balance down to
    # the sum of non-grant credits. See §6.3 for the exact policy.
    ...
```
> **Concurrency note (SQLite):** writes are serialized under WAL with `busy_timeout=5000`,
> which is sufficient for MVP. Wrap reserve (balance-check + insert) in a single transaction.
> When you migrate to Postgres, switch the balance check to `SELECT ... FOR UPDATE` on a
> per-user lock row, or move balances to Redis. Do **not** rely on application-level locks.

### 6.2 `subscriptions.py`
```python
def get_or_create_subscription(db, user) -> Subscription:
    sub = db.query(Subscription).filter_by(user_id=user.id).first()
    if sub:
        ensure_free_period_reset(db, sub)   # §6.3
        return sub
    free = db.query(Plan).filter_by(code="free").first()
    now = datetime.utcnow()
    sub = Subscription(user_id=user.id, plan_id=free.id, status="active",
                       current_period_start=now, current_period_end=now + relativedelta(months=1))
    db.add(sub); db.commit(); db.refresh(sub)
    grant(db, user.id, free.monthly_credits, ref=f"free-grant:{user.id}:{now:%Y-%m}")
    return sub
```
Call `get_or_create_subscription` from **`get_or_create_user`** in `api/auth.py` so every
user (new and returning) always has a subscription + current grant.

### 6.3 Monthly credit reset — exact policy (NO ROLLOVER of the grant)

- **Paid plans:** reset is **driven by Stripe `invoice.paid`** (§7). On each paid invoice:
  1. `expire_remaining_grant` — append an `expire` delta that zeroes the *unused granted*
     credits (NOT top-ups).
  2. `grant(monthly_credits)` with `ref = invoice.id`.
  3. Roll `current_period_start/end` from the invoice period.
- **Free plan (no Stripe):** **lazy reset.** `ensure_free_period_reset(db, sub)` runs on every
  request that resolves the subscription: if `now >= current_period_end`, do steps 1–3 with
  `ref = f"free-grant:{user_id}:{YYYY-MM}"` and advance the period by 1 month. (No cron job.)
- **Exact "no rollover" rule:** track granted vs purchased separately by `kind`. Unused
  *grant* expires; *topup* credits persist. Implement `expire_remaining_grant` as:
  `expire_amount = max(0, current_balance - sum(topup_deltas_outstanding))`, appended as a
  negative `expire` delta. If this is ambiguous in your data, **ask** — do not guess.

---

## 7. Payments — Stripe. New router `api/routers/billing.py`

Use the official `stripe` Python SDK. Secrets from env only (never in DB/app config — mirror
how `api/llm.py` treats keys). Register the router in `api/main.py` with the others.

### Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/billing/me` | user | `{plan, status, balance, period_end, caps, usage_today}` |
| GET | `/api/billing/plans` | public | catalog for pricing page |
| POST | `/api/billing/checkout` | user | body `{plan_code}` → Stripe Checkout Session → `{url}` |
| POST | `/api/billing/portal` | user | Stripe Customer Portal session → `{url}` |
| POST | `/api/billing/topup` | user | Checkout for the $5 / 250-credit pack → `{url}` |
| POST | `/api/billing/webhook` | **none** (signature-verified) | Stripe events |

### Webhook handler (the source of truth)
1. Verify signature with `STRIPE_WEBHOOK_SECRET`. Reject if invalid (400).
2. **Idempotency:** if `event.id` exists in `ProcessedWebhook`, return 200 immediately. Else
   insert it (in the same transaction as the side effects).
3. Handle exactly these events (ignore others, return 200):
   - `checkout.session.completed` → if it's a subscription checkout: set
     `stripe_customer_id`, `stripe_subscription_id`, resolve `plan` from the price, set
     `status="active"`. (Credit grant happens on `invoice.paid`, not here.) If it's a top-up
     (one-time): `grant(250, ref=session.id, kind="topup")`.
   - `invoice.paid` → run the §6.3 paid-plan reset (expire grant + grant `monthly_credits`,
     `ref=invoice.id`). Idempotent via ledger `ref`.
   - `customer.subscription.updated` → update `plan_id`/`status`; on plan upgrade, grant the
     **delta** of `monthly_credits` immediately (`ref=f"upgrade:{subscription_id}:{period}"`).
   - `invoice.payment_failed` → `status="past_due"`.
   - `customer.subscription.deleted` → at period end set plan to **free** + `status="canceled"`.
4. **`past_due` behavior:** block all credit-consuming endpoints (return 402 with a "update
   payment method" message + portal link). Read access stays open.

### Stripe setup (you must create these in the Stripe dashboard/test mode)
- One recurring Price per paid plan → put the price IDs in env (`STRIPE_PRICE_STARTER`, etc.).
- One one-time Price for the top-up → `STRIPE_PRICE_TOPUP`.

---

## 8. Rate limiting — `api/billing/limits.py`

Stacked windows, evaluated cheapest-first. **All limits come from the user's `Plan` row.**
Reject the *first* window that fails.

| Scope | window_key | Limit source | Counts |
|---|---|---|---|
| per-minute burst | `min:{task}:{epoch//60}` | `plan.per_min_burst` | credits of the task |
| daily | `daily:{task}:{YYYY-MM-DD}` (or `daily:actions:` for Free) | `plan.daily_caps` | 1 per action |
| weekly | `weekly:{task}:{ISO-year-week}` | `plan.weekly_caps` (paid only) | 1 per action |
| upload daily | `upload:{YYYY-MM-DD}` | `plan.upload_daily_cap` | 1 per upload |
| profile-build daily | `pbuild:{YYYY-MM-DD}` | `plan.profile_build_daily_cap` | 1 per build |

- **Free** uses the combined `daily:actions:{date}` counter with limit 5 (job analysis,
  cover letter, and profile build each increment it by 1). Paid tiers use the per-task daily
  & weekly counters.
- **Monthly entitlement is NOT a rate window** — it is enforced by the credit balance (§3).
- **Atomic increment (SQLite):** upsert the `RateWindow` row (with correct `limit` &
  `resets_at`), then:
  ```sql
  UPDATE rate_windows SET count = count + 1
  WHERE user_id=:u AND window_key=:k AND count + 1 <= limit;
  ```
  0 rows affected ⇒ limit hit ⇒ raise → **HTTP 429**.
- Increment rate windows **at reservation time** (before the LLM call). On task failure +
  refund, also **decrement** the windows you incremented (so a failed task doesn't burn quota).

### Response contracts (exact)
- **429:** headers `Retry-After` (seconds to `resets_at`), `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix ts of the binding window). Body:
  `{"detail":"Rate limit reached for <window>","retry_after":<int>}`.
- **402:** body `{"detail":"Insufficient credits","needed":<int>,"balance":<int>,
  "upgrade_url":"/billing","topup_url":"/billing/topup"}`.

---

## 9. The gateway — `api/billing/gateway.py` and exact endpoint wiring

### 9.1 The dependency
```python
def metered(task_type: str, charge: bool = True):
    def dep(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        sub  = get_or_create_subscription(db, user)
        if sub.status == "past_due":
            raise HTTPException(402, {...})                  # §7 message
        ref  = str(uuid.uuid4())
        enforce_rate_limits(db, user, sub.plan, task_type)   # raises 429 (and increments windows)
        if charge:
            try:
                reserve(db, user.id, task_type, ref)         # raises InsufficientCredits → 402
            except InsufficientCredits as e:
                decrement_rate_windows(db, user, sub.plan, task_type)  # undo the increment
                raise HTTPException(402, {...})
        return MeterContext(user=user, db=db, task_type=task_type, ref=ref, charge=charge,
                            collector=UsageCollector())
    return dep
```
`MeterContext` is a small dataclass carrying everything the handler needs to settle.

### 9.2 Settlement helpers
```python
def settle_success(ctx):
    # fixed price: reservation already debited; nothing more to debit.
    write_usage_event(ctx)                 # real tokens + raw_cost + credits_charged
def settle_failure(ctx):
    if ctx.charge: refund(ctx.db, ctx.user.id, ctx.task_type, ctx.ref)
    decrement_rate_windows(ctx.db, ctx.user, plan_of(ctx), ctx.task_type)
    write_usage_event(ctx, failed=True)    # credits_charged=0 on failure
```
`write_usage_event` reads `ctx.collector` (tokens, cost) and writes one `UsageEvent`.

### 9.3 Exact wiring per endpoint

**A. Cover letter — `create_cover_letter` (`cover_letters.py:79`), synchronous:**
```python
@router.post("", ...)
async def create_cover_letter(..., ctx: MeterContext = Depends(metered("cover_letter"))):
    llm = get_llm("cover_letter", collector=ctx.collector)     # pass collector
    try:
        result = generate_cover_letter(..., llm=llm)           # one client → captures tone+write
        ... persist ...
        settle_success(ctx)
        return ...
    except Exception:
        settle_failure(ctx); raise
```
`generate_cover_letter` uses the single passed-in `llm` for both internal calls, so the
collector captures all tokens. **Verify this**; if it internally calls `get_llm` again,
thread `ctx.collector` into those calls too.

**B. Profile build — `create_unified` (`profile.py:302`), synchronous:** identical pattern
with `metered("profile_build")` and `get_llm("profile", collector=ctx.collector)`.

**C. Job analysis — `create_job` (`jobs.py:755`) & `analyze_job` (`jobs.py:944`), background:**
- Add `ctx: MeterContext = Depends(metered("job_analysis"))` to the endpoint signature.
- Reservation + rate-limit already happened in the dependency. Pass `ctx.ref` (and
  `ctx.user.id`, `ctx.task_type`) into the background task:
  ```python
  background_tasks.add_task(run_job_analysis_background, ..., meter_ref=ctx.ref,
                            meter_user_id=ctx.user.id)
  ```
- Inside `run_job_analysis_background` (`jobs.py:359`):
  - Create one `collector = UsageCollector()` at the top.
  - Replace **every** `get_llm("profile")`, `get_llm("job_description")`,
    `get_llm("company_intel")`, `get_llm("job_match")`, `get_llm("reachout")` call in that
    function with `get_llm(<task>, collector=collector)`.
  - On full success: open a fresh DB session, `write_usage_event(...)` with the collector;
    the reservation stands (no refund).
  - On exception/failure: open a session, `refund(db, meter_user_id, "job_analysis", meter_ref)`,
    decrement the job_analysis rate windows, and write a failed `UsageEvent`.
  > The background task gets its **own** DB session (do not reuse the request session — it's
  > closed by then). Follow the existing pattern already used in that function for `db`.

**D. Free/metered-only endpoints** (`retry-steps`, `/profile/upload`, `/analyze-jd`):
use `metered(task_type, charge=False)` — this still enforces the per-minute burst and the
upload/profile-build daily caps where applicable, threads a collector, and writes a
`UsageEvent` with `credits_charged=0`, but never touches credits.

---

## 10. Migration & backfill (`api/database.py`)

- The new ORM classes are auto-created by the existing `Base.metadata.create_all` in
  `api/main.py` (it's already imported there). For **existing SQLite DBs**, also extend
  `ensure_sqlite_schema()` to be safe, but `create_all` covers brand-new tables.
- Add a one-time **seed + backfill** routine, called once at startup after `create_all`:
  1. Upsert the 4 `Plan` rows from `PLAN_SEED` (match on `code`; fill `stripe_price_id` from env).
  2. For every existing `User` without a `Subscription`: create a Free subscription + initial
     grant (idempotent `ref=f"free-grant:{user_id}:{YYYY-MM}"`).
- For production Postgres, write an Alembic migration instead of relying on `create_all`.
- Add `python-dateutil` (for `relativedelta`) and `stripe` to `requirements.txt`.

---

## 11. Build order (do strictly in this order)

| # | Milestone | Files | Done when… |
|---|---|---|---|
| 1 | **Metering** | `engine/usage.py`, `engine/providers.py`, `api/llm.py` | unit test shows collector captures non-zero in/out tokens + correct `cost_usd()` |
| 2 | **Models + seed/backfill** | `api/models.py`, `api/database.py`, `api/main.py` | tables exist; 4 plans seeded; every existing user has a Free sub + 132-credit grant; `get_balance` correct |
| 3 | **Ledger + subscriptions** | `api/billing/ledger.py`, `subscriptions.py`, `api/auth.py` | reserve/refund/grant idempotent; Free lazy monthly reset works; balance never negative |
| 4 | **Rate limiter** | `api/billing/limits.py` | Free blocked at 6th action/day; paid per-task daily/weekly + burst enforced; 429 headers correct; failed task decrements windows |
| 5 | **Gateway + wiring** | `api/billing/gateway.py`, the 4 charged + 3 free endpoints | charge-on-success, refund-on-failure verified for all four task types incl. background job analysis |
| 6 | **Stripe** | `api/routers/billing.py`, `api/main.py` | test-mode: checkout→`invoice.paid` grants credits; replaying same `event.id` does not double-grant; `past_due` blocks; top-up adds 250 |
| 7 | **Frontend** | `frontend/...` | pricing page, portal link, credit/quota badge from `/api/billing/me`, graceful 402/429 with upgrade CTA |
| 8 | **Dashboards/tests** | tests | margin report from `UsageEvent` (sum `raw_cost_usd` vs revenue); full integration suite green |

Estimate: ~8–10 dev-days. **Milestone 1 blocks all others.**

---

## 12. Test checklist (must all pass before ship)
- **Metering:** tokens captured for every engine call; `raw_cost_usd` matches `input·3/1M + output·15/1M`.
- **Ledger:** balance = `SUM(delta)`; reserve→success keeps debit; reserve→failure refunds fully; replay of same `(ref,kind)` is a no-op; balance never < 0.
- **Rate limits:** Free 6th action/day → 429; paid 7th cover letter/week (Starter) → 429; per-minute burst trips; failed task returns quota; window reset at boundary; headers correct.
- **Credits/entitlement:** user with 0 balance → 402; can't exceed monthly grant; top-up restores access; Free auto-resets next period (lazy).
- **Job analysis (background):** success → 12 credits stay charged + UsageEvent written; mid-pipeline failure → full refund + windows restored + failed UsageEvent; `retry-steps` charges nothing.
- **Stripe:** signature rejection; idempotent webhook (replay → no double grant); `invoice.paid` grants + expires old grant (no rollover) but keeps top-ups; upgrade grants delta; `payment_failed`→past_due blocks; cancel→Free at period end.
- **Concurrency:** two simultaneous reserves on a low balance never overdraft (transaction test).

---

## 13. Explicitly OUT of scope (do NOT build unless asked)
- DeepSeek or any non-Grok routing.
- Usage-based (per-token) end-user pricing — we use fixed per-task credits.
- Per-task **monthly** counters — monthly limit is the credit balance only.
- Credit rollover of the monthly grant — none (top-ups persist).
- Redis / external gateway — SQLite `RateWindow` is the MVP; note the migration path only.
- Annual plans, coupons, referrals, team/seat billing.

---

## 14. Environment variables (add to `.env` and prod config)
```
# Existing — keep Grok-only
XAI_API_KEY=...
XAI_MODEL=grok-3                 # do NOT switch any task to deepseek

# Stripe (prices updated Jun 2026 — top tier is now "Max" not "Power")
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...   # Starter $5.99/mo  (Stripe product: "Starter")
STRIPE_PRICE_PRO=price_...       # Pro    $14.99/mo  (Stripe product: "Pro")
STRIPE_PRICE_MAX=price_...       # Max    $24.99/mo  (Stripe product: "Max")
STRIPE_PRICE_TOPUP=price_...     # Credits $4.99 one-time → 250 credits  ⚠️ see note below
```
`api/llm_config.json` stays all-`grok-3`.

> ⚠️ **STRIPE_PRICE_TOPUP must be a ONE-TIME price** (not recurring/subscription).
> In your Stripe dashboard the "Credits" product currently shows "Per month" — this must
> be changed to a one-time payment price before going live, otherwise users will be charged
> $4.99 every month instead of once. Go to Products → Credits → Add another price →
> select "One time".

---

## 15. If anything here is ambiguous
Stop and ask the product owner. The explicit defaults above exist so you don't have to
guess — but if a real gap appears (e.g. the exact "no-rollover" accounting against top-ups
in §6.3, or whether `generate_cover_letter` spawns its own LLM client), raise it rather than
assuming. A wrong assumption in billing costs real money.
