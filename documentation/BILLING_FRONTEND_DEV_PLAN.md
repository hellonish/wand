# Wand — Billing Frontend: Developer Hand-off Spec

**Status:** ready to implement.
**Audience:** the implementing frontend developer.
**How to read this:** this is a *specification*, not a suggestion. Every file path, type,
token, and behavior is given. **Do not invent UI, copy, libraries, or styling that isn't
written here. Do not "improve" the design system. If something is genuinely undefined, stop
and ask — do not assume.**

The backend is **done and live** (see [BILLING_DEV_PLAN.md](BILLING_DEV_PLAN.md)). Your job
is purely the frontend that consumes it. You are adding to an existing Next.js app.

---

## 1. Current state — conventions you MUST follow

The frontend lives in `frontend/`. Stack (do **not** add to it):

- **Next.js 14 App Router**, TypeScript. Pages are `frontend/src/app/<route>/page.tsx`, all
  start with `'use client'`.
- **State:** Zustand store at `frontend/src/utils/store.ts` (`useStore`). Holds `user`,
  `token`, `theme`, etc. Persisted to `localStorage` key `wand-storage`.
- **API:** single module `frontend/src/utils/api.ts`. A `fetchWithAuth(url, options)` wrapper
  + a grouped `api` object (`api.getJobs()`, `api.createCoverLetter(...)`, …) + exported
  TypeScript `interface`s. Auth token comes from `localStorage` automatically inside
  `fetchWithAuth`. **Never call `fetch` directly in a page — always go through `api`.**
- **Existing dependencies only:** `framer-motion`, `react-markdown`, `zustand`, `next`,
  `react`. **Do NOT `npm install` anything.** No UI kit, no Stripe.js, no toast library.
- **Styling — THE most important rule:** there is **no Tailwind config and no component
  library**. Styling is done with **inline `style={{ ... }}` using CSS custom-property design
  tokens** defined in `frontend/src/app/globals.css`. Tailwind utility classes are used only
  for layout primitives (`flex`, `gap`, positioning). **Match this exactly.** The full token
  list you may use is in §9. Do not hard-code hex colors, do not introduce CSS modules, do
  not add a `tailwind.config`.
- **Page shell pattern (copy this for the new page):**
  ```tsx
  return (
    <main style={{ minHeight: '100vh' }}>
      <Header />
      {/* sticky title bar */}
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
                    background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)',
                     fontSize: 'calc(var(--display-scale, 0.92) * 28px)', fontWeight: 500,
                     letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>Billing</h1>
        <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>
          Manage your plan, credits, and usage.
        </div>
      </div>
      <div style={{ padding: '28px 24px 100px', maxWidth: 720, display: 'flex',
                    flexDirection: 'column', gap: 36 }}>
        {/* content */}
      </div>
    </main>
  );
  ```
  `<Header />` renders the sidebar; the sidebar auto-offsets `main` via CSS in `globals.css`
  (`body:has(.wand-console-sidebar) main`). You do **not** add left margin yourself.
- **Auth guard pattern (copy from settings page):** at the top of the page component,
  `const { user, isAuthenticated, _hasHydrated } = useStore();` and
  `useEffect(() => { if (_hasHydrated && !isAuthenticated) router.push('/'); }, [...])`, then
  `if (!_hasHydrated || !isAuthenticated || !user) return null;`.
- **Reusable pieces that already exist** (reuse, don't rebuild): `components/Header.tsx`,
  `components/ConfirmationModal.tsx` (modal pattern + `createPortal` + framer-motion),
  `components/UserAvatar.tsx`.

---

## 2. Non-negotiable rules

1. **No new npm dependencies.** Stripe redirects are plain `window.location.href = url` — we
   never load Stripe.js. The backend returns a hosted-checkout `url`; you just navigate to it.
2. **All network calls go through `api` in `utils/api.ts`.** No raw `fetch` in pages.
3. **Styling = inline styles + tokens from §9 only.** No hex, no new global CSS, no Tailwind config.
4. **Currency display:** prices come from the API as `price_cents` (integer). Render as
   `$${(price_cents/100).toFixed(2)}`. Never hard-code "$5.99" — read from the API.
5. **Credits are integers.** Render plainly (e.g. `242 credits`). Never invent a "$ value".
6. **Never compute or assume plan limits in the frontend.** Read `daily_caps`, `weekly_caps`,
   `monthly_credits` from the API response. The only place hard-coded numbers are allowed is
   the static "what credits buy" helper copy in §5.4 (clearly marked).
7. **Do not change backend code or routes.** If you think the backend is wrong, stop and ask.
8. **Plan codes are exactly:** `free`, `starter`, `pro`, `max`. (The top tier is `max`, not
   "power".) Use these strings verbatim.

---

## 3. Backend API contract (exact — do not guess shapes)

Base URL: `process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'` (already handled
inside `fetchWithAuth`). All require the auth header except where noted.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/billing/me` | — | `BillingStatus` (see below) |
| GET | `/api/billing/plans` | — | `Plan[]` (public, but sending auth is harmless) |
| POST | `/api/billing/checkout` | `{ "plan_code": "starter"\|"pro"\|"max" }` | `{ "url": string }` |
| POST | `/api/billing/portal` | — | `{ "url": string }` |
| POST | `/api/billing/topup` | — | `{ "url": string }` |
| GET | `/api/billing/usage` | — | `UsageEvent[]` (last 50, newest first) |

**`BillingStatus`** (from `GET /api/billing/me`):
```json
{
  "plan_code": "starter",
  "plan_name": "Starter",
  "status": "active",            // active | trialing | past_due | canceled
  "balance": 242,
  "period_end": "2026-07-02T02:56:32",   // ISO string or null
  "daily_caps": {"job_analysis": 4, "cover_letter": 3},  // OR {"actions": 5} for free
  "weekly_caps": {"job_analysis": 10, "cover_letter": 6}, // OR null
  "monthly_credits": 242
}
```

**`Plan`** (array item from `GET /api/billing/plans`):
```json
{
  "code": "starter",
  "name": "Starter",
  "price_cents": 599,
  "monthly_credits": 242,
  "daily_caps": {"job_analysis": 4, "cover_letter": 3},
  "weekly_caps": {"job_analysis": 10, "cover_letter": 6}
}
```

**`UsageEvent`** (array item from `GET /api/billing/usage`):
```json
{
  "id": "uuid",
  "task_type": "job_analysis",   // job_analysis | cover_letter | profile_build | reachout | *_retry | cover_letter_tone | profile_upload
  "provider": "grok",
  "model": "grok-3",
  "input_tokens": 10500,
  "output_tokens": 6700,
  "raw_cost_usd": 0.132,
  "credits_charged": 12,
  "failed": false,
  "created_at": "2026-06-01T22:56:38"
}
```

**Error responses (critical for §6):**
- **402 Insufficient credits:** body
  `{"detail": {"detail": "Insufficient credits", "needed": 12, "balance": 4, "upgrade_url": "/billing", "topup_url": "/billing/topup"}}`
- **402 Past due:** body
  `{"detail": {"detail": "Your subscription payment is past due. Please update your payment method.", "portal_url": "/billing/portal"}}`
- **429 Rate limited:** body
  `{"detail": {"detail": "Rate limit reached for window 'daily:job_analysis:...'", "retry_after": 53}}`
  plus header `Retry-After: 53`.

> Note the **nested** shape: the JSON top-level key is `detail`, and its value is itself an
> object that *also* has a `detail` string. `fetchWithAuth` must preserve this — see §4.1.

---

## 4. Phase 1 — API layer (`frontend/src/utils/api.ts`)

### 4.1 Enhance `fetchWithAuth` to preserve status + structured error body

Currently `fetchWithAuth` flattens the error to a string, which destroys the `needed` /
`balance` / `retry_after` fields. Modify the error branch so the thrown `Error` also carries
`.status` (number) and `.body` (the parsed structured detail object).

Find the existing error-construction block and add these two lines before `throw apiError;`:
```ts
const apiError = new Error(detail || 'Request failed') as Error & {
    code?: string; status?: number; body?: unknown;
};
apiError.status = response.status;                       // ADD
apiError.body = (rawDetail && typeof rawDetail === 'object') ? rawDetail : undefined;  // ADD
// ... existing code that sets apiError.code ...
throw apiError;
```
Also export a typed helper so pages can read these without `any`:
```ts
export interface ApiError extends Error {
    code?: string;
    status?: number;
    body?: {
        detail?: string;
        needed?: number;
        balance?: number;
        retry_after?: number;
        upgrade_url?: string;
        topup_url?: string;
        portal_url?: string;
    };
}
export function isApiError(e: unknown): e is ApiError { return e instanceof Error; }
```

### 4.2 Add types (place near the other exported interfaces)

```ts
export interface CapMap { [task: string]: number; }

export interface Plan {
    code: 'free' | 'starter' | 'pro' | 'max';
    name: string;
    price_cents: number;
    monthly_credits: number;
    daily_caps: CapMap;
    weekly_caps: CapMap | null;
}

export interface BillingStatus {
    plan_code: 'free' | 'starter' | 'pro' | 'max';
    plan_name: string;
    status: 'active' | 'trialing' | 'past_due' | 'canceled';
    balance: number;
    period_end: string | null;
    daily_caps: CapMap;
    weekly_caps: CapMap | null;
    monthly_credits: number;
}

export interface UsageEvent {
    id: string;
    task_type: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    raw_cost_usd: number;
    credits_charged: number;
    failed: boolean;
    created_at: string;
}
```

### 4.3 Add methods (inside the `api` object)

```ts
// ── Billing ──
getBillingStatus: (): Promise<BillingStatus> => fetchWithAuth('/api/billing/me'),
getPlans: (): Promise<Plan[]> => fetchWithAuth('/api/billing/plans'),
getUsage: (): Promise<UsageEvent[]> => fetchWithAuth('/api/billing/usage'),
createCheckout: (planCode: string): Promise<{ url: string }> =>
    fetchWithAuth('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan_code: planCode }) }),
createPortal: (): Promise<{ url: string }> =>
    fetchWithAuth('/api/billing/portal', { method: 'POST' }),
createTopup: (): Promise<{ url: string }> =>
    fetchWithAuth('/api/billing/topup', { method: 'POST' }),
```

---

## 5. Phase 2–4 — store, badge, and the `/billing` page

### 5.1 Store slice (`frontend/src/utils/store.ts`)

Add to the `AppState` interface and the store body:
```ts
// in AppState:
billing: BillingStatus | null;
fetchBilling: () => Promise<void>;

// in the store body (initial state): billing: null,

// action:
fetchBilling: async () => {
    try {
        const billing = await api.getBillingStatus();
        set({ billing });
    } catch {
        /* not fatal — leave billing as-is */
    }
},
```
Import `BillingStatus` from `./api`. **Do not** add `billing` to `partialize` (it must always
be fetched fresh, never read from localStorage).

In `frontend/src/app/layout.tsx`, where it already calls `fetchUser()` on hydration, also
call `fetchBilling()`:
```ts
useEffect(() => {
    if (_hasHydrated && token && useStore.getState().user === null) {
        fetchUser();
    }
    if (_hasHydrated && token) {
        useStore.getState().fetchBilling();
    }
}, [_hasHydrated, token, fetchUser]);
```

### 5.2 Credit badge in `components/Header.tsx`

Add a clickable pill showing the balance, in **two** places:
1. **Sidebar** — directly above the user card in the bottom section (only when `!collapsed`).
2. **Mobile topbar** — before the theme toggle.

Read balance from the store: `const { billing } = useStore();`. Render:
```tsx
{billing && (
  <button
    onClick={() => router.push('/billing')}
    title="Billing & credits"
    style={{
      display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px',
      borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)',
      color: 'var(--accent-ink)', fontSize: 12, fontWeight: 500,
      border: '1px solid var(--accent-border)', cursor: 'pointer', width: '100%',
      justifyContent: 'center',
    }}
  >
    <Icon name="sparkles" size={13} />
    {billing.balance} credits
  </button>
)}
```
(The `sparkles` icon already exists in `Header.tsx`'s `Icon`.) For the collapsed sidebar, show
only the icon (no number). For the mobile topbar, render a compact version (icon + number, height 32, no full width).

### 5.3 Add the nav link

In `Header.tsx`, add to `NAV_LINKS`:
```ts
{ href: '/billing', label: 'Billing', icon: 'sparkles' as IconName },
```
(Place it last, after Cover letters.)

### 5.4 The `/billing` page (`frontend/src/app/billing/page.tsx`)

New file. `'use client'`. Use the page-shell pattern from §1. Sections, top to bottom:

**A. Current plan card** — a `var(--surface)` card (`border: 1px solid var(--border)`,
`borderRadius: var(--radius)`, padding 20). Show, reading from `useStore().billing`:
- Plan name (large, `var(--text)`), and `status` as a small pill. If `status === 'past_due'`,
  show a `var(--danger)` banner: "Payment past due — update your card" + a **Manage billing**
  button (calls `api.createPortal()` → `window.location.href = url`).
- Balance: `{balance} credits` (big number, `var(--accent-ink)`).
- Renewal: "Renews {period_end formatted}" — format with
  `new Date(period_end).toLocaleDateString()`. If `null`, omit.
- For paid plans (`plan_code !== 'free'`): a **Manage subscription** button → `createPortal`.
- Always: a **Buy credits** button → `createTopup()` → redirect. Label it
  "Buy 250 credits ($4.99)".

**B. Plans grid** — fetch with `api.getPlans()` in a `useEffect`. Render the 4 plans
left-to-right (responsive: wrap on mobile via `flexWrap: 'wrap'`, each card `flex: '1 1 160px'`).
Each plan card:
- Name + price: `$${(price_cents/100).toFixed(2)}` with "/mo" (omit "/mo" and show "Free" for
  `price_cents === 0`).
- `{monthly_credits} credits / month`.
- **"What that buys" helper line** (this is the ONLY place static numbers are allowed; they are
  the representative allocation, not enforced):
  | code | helper copy |
  |---|---|
  | `free` | "2 profile builds · 5 analyses · 3 cover letters" |
  | `starter` | "1 profile build · 15 analyses · 8 cover letters" |
  | `pro` | "3 profile builds · 35 analyses · 25 cover letters" |
  | `max` | "5 profile builds · 60 analyses · 40 cover letters" |
- The current plan (`plan.code === billing.plan_code`) shows a "Current plan" label and a
  disabled button. Other paid plans show an **Upgrade** / **Switch** button →
  `api.createCheckout(plan.code)` → `window.location.href = url`. The `free` plan card never
  has a CTA (you can't "buy" free).
- Use `var(--accent)` border to highlight the current plan card.

**C. Usage history** — `api.getUsage()` in a `useEffect`. A simple table/list of the last 50
events: columns **Task** (humanize `task_type`: `job_analysis` → "Job analysis"), **Credits**
(`credits_charged`, show "—" if 0), **Date** (`new Date(created_at).toLocaleString()`), and a
small muted **failed** tag when `failed === true`. Use the row styling from the settings
`SettingRow` (surface bg, border, radius). If the list is empty, show "No usage yet."

**D. Query-param handling** — on mount, read `useSearchParams()`:
- `?success=1` → green banner "Subscription updated." then `fetchBilling()`.
- `?topup=success` → green banner "Credits added." then `fetchBilling()`.
- `?canceled=1` → muted banner "Checkout canceled." (no refetch needed)
After showing, strip the param with `router.replace('/billing')` so a refresh doesn't repeat it.

> **Redirect mechanism for ALL Stripe actions:** the backend returns `{ url }`. Navigate with
> `window.location.href = url`. Do not open a new tab, do not use `router.push` (it's an
> external Stripe URL).

---

## 6. Phase 5 — 402 / 429 handling at spend points

When a credit-spending action fails with 402 or 429, the user must see a clear prompt, not a
raw error string.

### 6.1 New component `frontend/src/components/UpgradePrompt.tsx`
Model it on `ConfirmationModal.tsx` (same `createPortal` + framer-motion + token styling).
Props:
```ts
interface UpgradePromptProps {
    isOpen: boolean;
    onClose: () => void;
    kind: 'credits' | 'rate_limit' | 'past_due';
    needed?: number; balance?: number; retryAfter?: number;  // from ApiError.body
}
```
Copy per `kind`:
- `credits`: title "Out of credits", message "This action needs {needed} credits — you have
  {balance}. Upgrade your plan or buy a credit pack to continue." Primary button "View plans"
  → `router.push('/billing')`. Secondary "Buy credits" → `api.createTopup()` redirect.
- `rate_limit`: title "Daily limit reached", message "You've hit your plan's limit for now. It
  resets in about {Math.ceil(retryAfter/60)} minutes, or upgrade for higher limits." Primary
  "View plans" → `/billing`.
- `past_due`: title "Payment past due", message "Update your payment method to keep using paid
  features." Primary "Manage billing" → `api.createPortal()` redirect.

### 6.2 Wire it into the 5 spend call sites

Each of these currently does `await api.createX(...)` inside a `try/catch`. In the `catch`,
inspect the error and open `UpgradePrompt` instead of (or in addition to) the existing error
message. The exact files and lines:

| Spend action | File | ~line |
|---|---|---|
| `createJob` (job_analysis) | `frontend/src/components/AddJobModal.tsx` | 94 |
| `createCoverLetter` | `frontend/src/app/cover-letters/page.tsx` | 180 |
| `createCoverLetter` | `frontend/src/app/cover-letters/quick/page.tsx` | 124 |
| `createCoverLetter` | `frontend/src/app/jobs/[id]/cover-letter/page.tsx` | 103 |
| `createUnifiedProfile` (profile_build) | `frontend/src/app/profile/page.tsx` | 221 |

In each `catch (err)`:
```ts
import { isApiError } from '@/utils/api';
// ...
catch (err) {
    if (isApiError(err) && err.status === 402 && err.body?.portal_url) {
        setUpgrade({ open: true, kind: 'past_due' });
    } else if (isApiError(err) && err.status === 402) {
        setUpgrade({ open: true, kind: 'credits', needed: err.body?.needed, balance: err.body?.balance });
    } else if (isApiError(err) && err.status === 429) {
        setUpgrade({ open: true, kind: 'rate_limit', retryAfter: err.body?.retry_after });
    } else {
        /* keep the existing error-handling/toast for that page */
    }
}
```
Add the matching `const [upgrade, setUpgrade] = useState<{open:boolean; kind:'credits'|'rate_limit'|'past_due'; needed?:number; balance?:number; retryAfter?:number}>({open:false, kind:'credits'})`
state and render `<UpgradePrompt isOpen={upgrade.open} onClose={() => setUpgrade(s => ({...s, open:false}))} {...upgrade} />` near the end of each component.

### 6.3 Refresh the badge after spending
After any **successful** spend (`createJob`, `createCoverLetter`, `createUnifiedProfile`), call
`useStore.getState().fetchBilling()` so the header credit badge updates immediately. Add this
right after the success path in each of the 5 sites.

---

## 7. Build order
1. **Phase 1** — `api.ts` types + methods + `fetchWithAuth` error enrichment. (Nothing renders
   without this.)
2. **Phase 2** — store `billing` slice + `layout.tsx` fetch.
3. **Phase 4** — `/billing` page (the main deliverable).
4. **Phase 3** — Header badge + nav link.
5. **Phase 5** — `UpgradePrompt` + wire the 5 spend sites + post-spend `fetchBilling()`.
6. **Typecheck:** `cd frontend && npm run typecheck` must pass with zero errors. Then
   `npm run lint`.

---

## 8. Acceptance criteria (must all be true)
- `/billing` renders: current plan, balance, 4 plan cards, usage history.
- Clicking **Upgrade** on a paid plan redirects to a real Stripe Checkout URL.
- After returning from Stripe with `?success=1`, a banner shows and the balance updates.
- **Buy credits** and **Manage subscription** redirect to Stripe.
- Header shows a live credit badge that links to `/billing` and updates after spending.
- Spending with insufficient credits opens the `credits` UpgradePrompt (not a raw error).
- Hitting a rate limit opens the `rate_limit` prompt with the reset estimate.
- `past_due` status shows the banner + Manage billing CTA.
- Prices and limits are read from the API (no hard-coded `$5.99` etc. except the §5.4 helper copy).
- `npm run typecheck` and `npm run lint` pass.
- Visual style is indistinguishable from the settings page (tokens, radii, fonts).

---

## 9. Allowed design tokens (from `globals.css` — use ONLY these for color/spacing)

| Purpose | Token |
|---|---|
| Page bg | `var(--bg)`, `var(--bg-tint)` |
| Card / surface | `var(--surface)`, `var(--surface-2)`, `var(--card)`, `var(--hover)` |
| Borders | `var(--border)`, `var(--border-soft)` |
| Text | `var(--text)` / `var(--text-1)`, `var(--text-2)`, `var(--text-3)` |
| Accent (primary) | `var(--accent)`, `var(--accent-soft)`/`--accent-dim`, `var(--accent-ink)`, `var(--accent-border)` |
| Success (green banners) | `var(--success)`, `var(--success-dim)`, `var(--success-border)` |
| Warning | `var(--warning)`, `var(--warning-dim)` |
| Danger (past_due) | `var(--danger)`, `var(--danger-dim)`, `var(--danger-border)` |
| Overlay (modal backdrop) | `var(--overlay)` |
| Radii | `var(--radius-sm)`, `var(--radius)`, `var(--radius-lg)` |
| Fonts | `var(--font-display)` (titles), `var(--font-body)` (default), `var(--font-mono)` (labels/eyebrows) |
| Shadow | `var(--shadow-1)` |

Section eyebrow label style (copy from settings `Section`):
`fontFamily: var(--font-mono); fontSize: 10.5; fontWeight: 500; letterSpacing: 0.08em; textTransform: uppercase; color: var(--text-3)`.

---

## 10. Explicitly OUT of scope (do NOT build)
- Stripe.js / embedded card forms — we only redirect to hosted Checkout.
- A toast library — use inline banners + the `UpgradePrompt` modal.
- Editing plan prices/limits in the UI — those are backend-owned.
- Annual billing, coupons, proration UI — backend doesn't expose them.
- Any change to backend files or routes.

## 11. If anything is ambiguous
Stop and ask the product owner. Do not assume copy, colors, or flows that aren't written here.
