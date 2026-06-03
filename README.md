# Wand 🪄

**Wand** is an intelligent AI-powered career assistant that helps users analyze job postings, optimize their resumes, and generate tailored cover letters. It leverages advanced LLMs (Gemini 2.5 Pro & Flash) to provide deep insights and actionable feedback.

## 🚀 Features

- **Job Analysis**: deeply analyzes job descriptions to extract requirements, skills, and expected salary.
- **Resume Parsing**: Extracts structured data from PDF resumes using AI.
- **Gap Analysis**: Compares your resume against job requirements to identify missing qualifications and keywords.
- **Resume Optimization**: Provides specific "Add", "Update", or "Delete" suggestions to tailor your resume.
- **Cover Letter Generation**: improved cover letters (Professional, Creative, Storytelling modes) tailored to the specific job.
- **Application Tracking**: Kanban-style board to track job applications.

## 🏗️ Architecture

The project is organized into three main components:

### 1. Frontend (`/frontend`)
The user interface built with **Next.js 14**, **TypeScript**, and **Tailwind CSS**.
- **Tech Stack**: Next.js, React, Zustand (State Management), Framer Motion (Animations).
- **Key Functionality**: Job dashboard, interactive resume editor, analysis visualization, real-time updates via WebSockets.

### 2. API (`/api`)
The backend REST API built with **FastAPI**.
- **Tech Stack**: FastAPI, SQLAlchemy (SQLite), Pydantic.
- **Key Functionality**: Data persistence, request orchestration, file handling, and communication with the Engine.
- **Async work**: Uses FastAPI `BackgroundTasks` and WebSocket progress events for long-running JobLens analysis.

### 3. Engine (`/engine`)
The intelligence core of the application.
- **Tech Stack**: Python, `instructor` (Structured Output), PyMuPDF.
- **AI Models** — the engine is **provider-agnostic**. All inference flows through a single client
  interface (`engine/providers.py`) and per-task model routing (`api/llm.py`). Swapping providers is a
  config change, no code change:
    - **xAI Grok** (`grok-3`, default): structured output via `instructor` JSON mode. Used for all tasks
      out of the box (reasoning + extraction).
    - **DeepSeek** (`deepseek-chat`): OpenAI-compatible JSON-mode path. A cheaper alternative; can be
      routed per task (e.g. parsing/extraction) to cut cost.
    - Any OpenAI-compatible provider can be added as a subclass with its base URL and env vars.
- **Modules**:
    - `job/parser`: Extracts structured job data.
    - `analysis/qualification_check`: validatates resume claims against requirements.
    - `analysis/formatting_check`: Reviews resume formatting and chronology.
    - `cover_letter/generator`: Generates personalized cover letters.

## 🛠️ Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- An LLM provider API key — **xAI (`XAI_API_KEY`)** by default, or **DeepSeek (`DEEPSEEK_API_KEY`)**

### Backend Setup
1. Navigate to root directory.
2. Create virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set environment variables in `.env`:
   ```env
   # Default provider (xAI Grok)
   XAI_API_KEY=your_key_here
   # Optional: override the default model
   XAI_MODEL=grok-3

   # Optional alternative provider (DeepSeek)
   DEEPSEEK_API_KEY=your_key_here
   DEEPSEEK_MODEL=deepseek-chat
   ```
   Provider/model routing per task is controlled by `api/llm_config.json` (see `api/llm.py`).
   API keys are read from the environment only — never stored in app or user config.
5. Start the server:
   ```bash
   uvicorn api.main:app --reload
   ```

### Frontend Setup
1. Navigate to frontend:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start dev server:
   ```bash
   npm run dev
   ```

## 🧠 AI Model Configuration

The engine is **provider-agnostic**. Every inference call is registered in `engine/inference.py`
with an explicit token budget, and the model/provider for each task is resolved at runtime by
`api/llm.py` from `api/llm_config.json`:

- **Default**: every task routes to **xAI `grok-3`**.
- **Per-task routing**: each task family (`profile`, `job_description`, `company_intel`, `job_match`,
  `reachout`, `cover_letter`, `cover_letter_tone`) can point at a different provider/model. For example,
  route high-volume extraction tasks to **DeepSeek** to cut cost while keeping `grok-3` for the
  user-facing cover letter.
- **Adding a provider**: subclass in `engine/providers.py` with its base URL + env-var names.

## 📄 License
MIT
