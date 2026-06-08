# ineedajob.pro

An open-source, AI-powered job application assistant. Paste a job link, upload your resume, and get a match score, gap analysis, tailored resume suggestions, a cover letter, and a list of people to reach out to — all in one run.

Built with a BYOK (Bring Your Own Key) model: you connect your own LLM provider keys and the app never stores or proxies your credentials beyond encrypting them at rest.

---

## Features

- **Job analysis** — extracts requirements, skills, responsibilities, and salary signals from any job posting
- **Resume parsing** — ingests PDF and DOCX resumes into a structured profile
- **Match scoring** — scores your profile against a job and explains the gaps
- **Resume actions** — specific Add / Update / Remove suggestions to close the gaps
- **Cover letter generation** — Professional, Creative, and Storytelling tone modes
- **Company intelligence** — summarizes the company from public sources before you apply
- **Reachout discovery** — finds LinkedIn contacts at the target company to cold-message
- **Application tracking** — Kanban board to manage your pipeline
- **Hopper extension** — Chrome extension that auto-captures jobs as you browse

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Zustand, Framer Motion |
| API | FastAPI, SQLAlchemy, Pydantic |
| Engine | Python, `instructor` (structured LLM output), PyMuPDF |
| Auth | Google OAuth 2.0 → stateless HS256 JWT |
| Database | SQLite (local dev) / PostgreSQL via Supabase (production) |
| File storage | Local filesystem (dev) / Supabase Storage (production) |
| Real-time | WebSockets (per-job analysis progress stream) |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Google OAuth 2.0 client](https://console.cloud.google.com/) (for login)
- At least one LLM provider API key (see [BYOK](#byok--bring-your-own-key))

### 1. Clone and configure

```bash
git clone https://github.com/hellonish/ineedajob.pro.git
cd ineedajob.pro
cp .env.example .env
```

Edit `.env` — the required fields to get running locally:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
APP_ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
BACKEND_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
BYOK_REQUIRED=false
XAI_API_KEY=...          # or any other provider key below
```

See [Configuration](#configuration) for all options.

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn api.main:app --reload
```

The API is now running at `http://localhost:8000`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is now running at `http://localhost:3000`.

### 4. One-command start (after first setup)

```bash
./ineedajob.sh
```

Starts the backend and frontend together.

---

## Configuration

All configuration is through `.env`. The full reference is in [`.env.example`](.env.example). Key variables:

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth credentials |
| `JWT_SECRET_KEY` | Yes | Long random string for signing JWTs |
| `APP_ENCRYPTION_KEY` | Yes | Fernet key for encrypting stored API keys at rest |
| `BACKEND_URL` / `FRONTEND_URL` | Yes | Public URLs (no trailing slash) |
| `BYOK_REQUIRED` | No | `true` = every user must add their own key; `false` = server keys are used as fallback |
| `XAI_API_KEY` | No | Server-side xAI (Grok) fallback key |
| `DEEPSEEK_API_KEY` | No | Server-side DeepSeek fallback key |
| `DATABASE_URL` | No | Defaults to local SQLite; set to a Postgres URI for production |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | No | Required for Supabase file storage in production |
| `GOOGLE_CSE_API_KEY` / `GOOGLE_CSE_ID` | No | Enables Google Custom Search for reachout (falls back to DuckDuckGo otherwise) |

---

## BYOK — Bring Your Own Key

Users connect their own API keys from the Settings → AI Providers page. Keys are encrypted at rest with Fernet (`APP_ENCRYPTION_KEY`) and decrypted only in memory at inference time. The last four characters are stored for display; the plaintext is never logged or returned.

Supported providers:

| Provider | Reasoning model | Fast model |
|---|---|---|
| Anthropic | claude-opus-4-5 | claude-haiku-4-5 |
| OpenAI | gpt-4o | gpt-4o-mini |
| Google Gemini | gemini-2.5-pro | gemini-2.5-flash |
| xAI (Grok) | grok-3 | grok-3-fast |
| DeepSeek | deepseek-reasoner | deepseek-chat |

"Use recommended setup" automatically routes reasoning-heavy tasks (match scoring, cover letter) to the best available reasoning model, and fast tasks (parsing, extraction) to the best available fast model, based on which keys the user has added.

Per-task routing is defined in `engine/model_registry.py` and `api/llm_config.json`.

---

## Hopper Extension

`hopper-extension/` is a Chrome extension (Manifest V3) that detects job application pages and automatically sends them to your ineedajob.pro dashboard.

To install locally:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `hopper-extension/` directory
4. Open the extension settings and point it at your backend URL

---

## Project Structure

```
.
├── api/                  # FastAPI backend
│   ├── routers/          # Route handlers (auth, jobs, profile, cover letters, …)
│   ├── billing/          # Usage metering and gateway
│   ├── models.py         # SQLAlchemy models
│   └── main.py           # App entrypoint
├── engine/               # AI pipeline (provider-agnostic)
│   ├── joblens/          # Core pipeline: job_description, job_match, company_intel, reachout
│   ├── cover_letter/     # Cover letter generation
│   ├── profile/          # Resume ingestion and extraction
│   ├── providers.py      # LLM client implementations
│   ├── model_registry.py # Provider/model catalogue and task routing
│   └── inference.py      # Typed inference calls with token budgets
├── frontend/             # Next.js app
│   └── src/
│       ├── app/          # Pages (jobs, profile, settings, cover letters, …)
│       ├── components/   # UI components
│       └── utils/        # API client, state store, cache
├── hopper-extension/     # Chrome extension
├── nginx/                # Nginx config for production reverse proxy
├── ineedajob.sh          # Start backend + frontend (local dev)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## License

MIT
