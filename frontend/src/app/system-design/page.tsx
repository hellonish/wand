import Header from '@/components/Header';

const platformFeatures = [
    {
        title: 'Application tracking',
        detail: 'A kanban-style job tracker stores each opportunity, status, notes, parsed job data, score, and linked JobLens session.',
    },
    {
        title: 'AI job analysis',
        detail: 'A pasted job description becomes a multi-step intelligence pipeline: JD parse, company intel, match analysis, contacts, and action plan.',
    },
    {
        title: 'Profile ingestion',
        detail: 'Resume PDFs, LinkedIn exports, portfolios, and additional notes are parsed into structured source records and merged into one profile.',
    },
    {
        title: 'Resume optimization',
        detail: 'The analysis engine compares profile evidence against requirements, skills, keywords, and formatting quality, then generates targeted edits.',
    },
    {
        title: 'Cover-letter generation',
        detail: 'The cover-letter engine classifies JD tone, chooses a writing mode, optionally uses company news, and stores editable generated letters.',
    },
    {
        title: 'Real-time progress',
        detail: 'Long-running work streams through WebSocket events so the UI can update each step as soon as it finishes.',
    },
];

const architectureLayers = [
    {
        layer: 'Frontend',
        path: 'frontend/src',
        role: 'Owns browser interaction, page composition, optimistic UI state, persisted auth state, and real-time event subscriptions.',
        pieces: ['Next.js App Router', 'React components', 'Zustand store', 'typed API facade', 'global WebSocket hook'],
    },
    {
        layer: 'API',
        path: 'api',
        role: 'Owns authentication, request validation, route contracts, database sessions, file IO, orchestration, and response shaping.',
        pieces: ['FastAPI routers', 'Pydantic schemas', 'SQLAlchemy models', 'JWT auth', 'BackgroundTasks', 'WebSocket endpoint'],
    },
    {
        layer: 'Async Processing',
        path: 'api/routers/jobs.py, api/websocket.py',
        role: 'Separates slow model work from request/response paths and reports progress through the API process.',
        pieces: ['FastAPI BackgroundTasks', 'asyncio.gather', 'ConnectionManager', 'per-step WebSocket messages'],
    },
    {
        layer: 'AI Engine',
        path: 'engine',
        role: 'Contains pure domain workflows for parsing, scoring, unifying, comparing, researching, and generating structured outputs.',
        pieces: ['Pydantic models', 'LLMClient', 'profile parsers', 'analysis modules', 'JobLens modules', 'cover-letter modules'],
    },
    {
        layer: 'Persistence',
        path: 'api/models.py, wand.db, api/uploads',
        role: 'Stores durable user records, job state, AI payloads, profile file metadata, raw uploaded files, and versioned resume snapshots.',
        pieces: ['SQLite with WAL', 'JSON columns', 'user-scoped upload folders', 'ResumeHistory append log', 'JobLensSession step payloads'],
    },
];

const workflows = [
    {
        title: 'JobLens full pipeline',
        summary: 'A user action creates durable state first, then fills in data as independent work completes.',
        steps: [
            'POST /api/jobs writes a placeholder Job with status analyzing.',
            'The same request creates an internal JobLensSession linked to that job.',
            'FastAPI BackgroundTasks starts run_job_analysis_background after the response is prepared.',
            'Wave 1 ensures a unified profile exists and parses the JD concurrently.',
            'Wave 2 runs company intelligence, match analysis, and reachout concurrently.',
            'Each completed step is persisted and emitted to the browser over WebSocket.',
        ],
        concepts: ['DAG scheduling', 'fan-out/fan-in', 'event-driven UI', 'checkpointed state', 'latency hiding'],
    },
    {
        title: 'Profile unification',
        summary: 'Multiple noisy sources are normalized before downstream features depend on them.',
        steps: [
            'Upload validates file type, size, and ownership.',
            'A parser is selected based on source type and extension.',
            'Parsed source data is saved per file in ProfileFile.',
            'POST /api/profile/unified merges all parsed sources into one canonical profile.',
            'A cached extracted profile is generated for repeated JobLens runs.',
        ],
        concepts: ['schema normalization', 'entity resolution', 'deduplication', 'cache materialization', 'source-of-truth design'],
    },
    {
        title: 'Cover-letter generation',
        summary: 'A content-generation request is routed by tone, mode, and context.',
        steps: [
            'The UI sends a job-linked or free-form generation request.',
            'The API resolves job posting context and optional company news.',
            'Auto mode runs JD tone analysis before generation.',
            'Custom mode enhances the user prompt into a stronger instruction set.',
            'The generated structured content is saved as a CoverLetter record.',
        ],
        concepts: ['classification before generation', 'prompt routing', 'context enrichment', 'structured output', 'editable persistence'],
    },
];

const apiGroups = [
    {
        name: 'Auth API',
        endpoints: '/api/auth/google, /api/auth/google/callback, /api/auth/me, /api/auth/profile',
        purpose: 'Handles Google OAuth, JWT session creation, current-user lookup, and profile updates.',
    },
    {
        name: 'Jobs API',
        endpoints: '/api/jobs, /api/jobs/{id}, /api/jobs/{id}/analysis, /api/jobs/track',
        purpose: 'Creates tracked or AI-analyzed jobs, exposes job detail/list views, updates status and notes, and returns linked analysis results.',
    },
    {
        name: 'Profile API',
        endpoints: '/api/profile, /api/profile/upload, /api/profile/files, /api/profile/unified',
        purpose: 'Manages uploaded files, parsed source records, additional context, downloads, deletes, and unified profile creation.',
    },
    {
        name: 'Support APIs',
        endpoints: '/api/cover-letters, /api/news, /ws/{token}',
        purpose: 'Power generated letters, company-news enrichment, and real-time progress delivery.',
    },
];

const databaseTables = [
    {
        table: 'users',
        role: 'Identity root for all owned data. Stores email, name, picture, and selected LLM provider/model.',
        relationship: 'One user owns jobs, cover letters, profile files, profile, and JobLens sessions.',
    },
    {
        table: 'jobs',
        role: 'Core application entity. Stores status, notes, company website, job posting JSON, analysis result JSON, and linked session id.',
        relationship: 'Belongs to user; has many resume history records and cover letters.',
    },
    {
        table: 'joblens_sessions',
        role: 'Pipeline checkpoint table. Each major step has its own JSON column so partial completion can be stored and rendered.',
        relationship: 'Belongs to user and optionally links to a job.',
    },
    {
        table: 'profile_files',
        role: 'File catalog. Stores original filename, disk path, type, size, parsed JSON, and per-file context.',
        relationship: 'Belongs to user; feeds profile unification.',
    },
    {
        table: 'user_profiles',
        role: 'Materialized profile record. Stores legacy file paths, parsed source data, unified profile JSON, cached extracted profile, and additional context.',
        relationship: 'One profile per user.',
    },
    {
        table: 'resume_history',
        role: 'Append-only score history. Stores each evaluated resume version and score for a job.',
        relationship: 'Belongs to job; supports re-evaluation deltas.',
    },
    {
        table: 'cover_letters',
        role: 'Generated artifacts. Store user-facing AI outputs as JSON so they remain editable and inspectable.',
        relationship: 'Belong to user; cover letters may link to jobs.',
    },
];

const storageChoices = [
    {
        title: 'Relational ownership, JSON intelligence',
        detail: 'Ownership, lifecycle, timestamps, and foreign keys live in SQL tables. AI payloads stay in JSON columns because they are nested, schema-rich, and likely to evolve.',
    },
    {
        title: 'Local file storage for uploaded sources',
        detail: 'Uploaded documents are written under user-scoped folders in api/uploads. Database rows store metadata and file paths while parsers store structured output.',
    },
    {
        title: 'SQLite WAL for local concurrency',
        detail: 'WAL mode and busy_timeout reduce local lock contention between API requests and background work. This is pragmatic for development but not the final production storage architecture.',
    },
    {
        title: 'Materialized caches',
        detail: 'The unified profile and extracted profile are cached because they are reused across jobs. This turns repeated expensive model work into a database read.',
    },
];

const frontendChoices = [
    {
        title: 'App Router pages as feature boundaries',
        detail: 'Each feature has a route directory: dashboard, jobs, profile, cover letters, settings, and this hidden system-design route.',
    },
    {
        title: 'A typed API facade',
        detail: 'frontend/src/utils/api.ts centralizes endpoint paths, request bodies, response types, auth headers, upload logic, and error handling.',
    },
    {
        title: 'Zustand for session-level state',
        detail: 'Auth token, user, theme, and jobs filter persist through reloads without pushing every interaction into the backend.',
    },
    {
        title: 'Single global WebSocket',
        detail: 'useGlobalWebSocket opens one authenticated connection and routes events to per-session JobLens subscribers.',
    },
    {
        title: 'Progressive rendering',
        detail: 'Job detail pages can show started, completed, and failed states for each pipeline step instead of blocking on one monolithic result.',
    },
];

const systemPrinciples = [
    {
        name: 'Separation of concerns',
        explanation: 'Pages render workflows, routers enforce contracts and persistence, engine modules perform domain work, and background tasks execute slow workflows.',
    },
    {
        name: 'Durable state before async work',
        explanation: 'The API creates Job and JobLensSession records before starting slow analysis so progress and failure always have a record to attach to.',
    },
    {
        name: 'Idempotent direction of travel',
        explanation: 'Pipeline steps write their own output columns. This makes retry/resume possible even if the current implementation does not fully expose it yet.',
    },
    {
        name: 'Human-readable intermediate data',
        explanation: 'Structured JSON payloads are persisted at every major boundary, which makes debugging, UI rendering, and future migrations easier.',
    },
    {
        name: 'Progress over blocking',
        explanation: 'Long model calls are moved out of the request path or run in parallel waves, and the UI is informed by events.',
    },
    {
        name: 'User-scoped isolation',
        explanation: 'Most REST queries filter by current_user.id, and persisted artifacts are modeled as children of a user.',
    },
];

const csConcepts = [
    {
        concept: 'Directed acyclic graph',
        use: 'JobLens is a dependency graph: parse JD and profile extraction unblock match analysis; match analysis unlocks action planning.',
    },
    {
        concept: 'Parallelism and fan-in',
        use: 'asyncio.gather runs independent model calls at the same time, then joins results before dependent steps run.',
    },
    {
        concept: 'Caching and materialization',
        use: 'Unified profile and extracted profile records avoid repeating expensive parsing and model calls.',
    },
    {
        concept: 'Entity resolution',
        use: 'Profile unification aligns companies, schools, roles, and skills across inconsistent sources.',
    },
    {
        concept: 'Weighted scoring',
        use: 'Resume analysis combines qualification, skill, keyword, and formatting scores through explicit weights.',
    },
    {
        concept: 'Append-only history',
        use: 'ResumeHistory preserves previous resume versions and scores so re-evaluation can calculate deltas.',
    },
    {
        concept: 'Schema validation',
        use: 'Pydantic models validate API data and LLM outputs, replacing brittle string parsing with typed contracts.',
    },
];

const notableLibraries = [
    {
        name: 'Next.js and React',
        role: 'Route-based UI, client components, dynamic job detail pages, and reusable workflow surfaces.',
    },
    {
        name: 'Tailwind CSS',
        role: 'Utility styling layered on top of project theme variables for dense, consistent UI layout.',
    },
    {
        name: 'Zustand',
        role: 'Small persisted client store for auth, theme, and filters without a large state framework.',
    },
    {
        name: 'Framer Motion',
        role: 'List transitions, modal animations, and smooth kanban updates.',
    },
    {
        name: 'FastAPI',
        role: 'Typed Python API framework with dependency injection for auth and database sessions.',
    },
    {
        name: 'SQLAlchemy',
        role: 'ORM models, relationships, sessions, and SQLite/Postgres-compatible persistence.',
    },
    {
        name: 'Pydantic',
        role: 'API schemas and engine output contracts, including structured AI result models.',
    },
    {
        name: 'PyMuPDF and trafilatura',
        role: 'Document and web-content extraction for resumes, PDFs, portfolios, and company pages.',
    },
    {
        name: 'OpenAI-compatible clients with instructor-style structured output',
        role: 'Provider-agnostic LLM calls that return typed models rather than raw text blobs.',
    },
];

const moduleGroups = [
    {
        title: 'Frontend modules',
        modules: [
            ['Dashboard', 'Loads jobs, shows stats, and renders the board.'],
            ['Jobs pages', 'List jobs, inspect one job, subscribe to JobLens progress, edit notes, and trigger resume/cover-letter flows.'],
            ['Profile page', 'Uploads files, shows parsed source data, manages context, and asks the backend to create a unified profile.'],
            ['Cover-letter pages', 'Collect generation mode and context, call tone analysis, save output, and support editing.'],
            ['Shared components', 'Header, modals, kanban board/cards, resume editor, file upload zone, profile file list, and report viewers.'],
        ],
    },
    {
        title: 'API modules',
        modules: [
            ['auth router', 'OAuth, JWTs, current user, and profile settings.'],
            ['jobs router', 'Job CRUD plus the automatic profile, JD, match, company, and reachout pipeline.'],
            ['profile router', 'File uploads, file catalog, downloads, deletes, source parsing, and profile unification.'],
            ['ws router', 'Authenticated socket endpoint backed by the in-process connection manager.'],
        ],
    },
    {
        title: 'Engine modules',
        modules: [
            ['job', 'Raw JD to structured job posting.'],
            ['analysis', 'Qualification matching, formatting check, keyword matching, weighted score, and re-evaluation.'],
            ['joblens', 'Profile extraction, JD parse, company intelligence, match analysis, contacts, and action plan.'],
            ['profile', 'Resume, LinkedIn, and portfolio parsing plus unification.'],
            ['cover_letter', 'Tone detection, prompt enhancement, and mode-specific generation.'],
            ['models/llm', 'Provider abstraction and structured model-call boundary.'],
        ],
    },
];

const incompleteItems = [
    'FastAPI BackgroundTasks are not durable across API process restarts; production orchestration should add retryable job state.',
    'Local upload storage should move to object storage with signed URLs, checksums, and lifecycle cleanup.',
    'SQLite additive schema checks should become explicit migrations before the data model grows further.',
];

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
    return (
        <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
                {eyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-1)' }}>
                {title}
            </h2>
            {children && (
                <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-2)' }}>
                    {children}
                </p>
            )}
        </div>
    );
}

function Pill({ children }: { children: React.ReactNode }) {
    return (
        <span
            className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium"
            style={{
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
            }}
        >
            {children}
        </span>
    );
}

export default function SystemDesignPage() {
    return (
        <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
            <Header />

            <div className="mx-auto max-w-7xl px-6 py-8">
                <section className="grid gap-8 border-b pb-10 lg:grid-cols-[1.1fr_0.9fr]" style={{ borderColor: 'var(--border)' }}>
                    <div>
                        <div className="mb-4 flex flex-wrap gap-2">
                            <Pill>System architecture</Pill>
                            <Pill>Parallel workflows</Pill>
                            <Pill>Typed AI pipelines</Pill>
                            <Pill>Async processing</Pill>
                            <Pill>Data modeling</Pill>
                        </div>
                        <h1 className="max-w-4xl text-4xl font-semibold leading-tight md:text-5xl" style={{ color: 'var(--text-1)' }}>
                            Hopper system design
                        </h1>
                        <p className="mt-5 max-w-3xl text-base leading-7" style={{ color: 'var(--text-2)' }}>
                            Hopper is an AI career intelligence platform built around a layered architecture: a Next.js client, a FastAPI orchestration layer, SQL-backed persistence, file storage, in-process background workflows, WebSocket progress events, and a Python AI engine. The main design challenge is coordinating many slow, structured, partially dependent workflows while keeping the product interactive.
                        </p>
                    </div>

                    <div className="rounded-lg border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>End-to-end connection model</p>
                        <div className="mt-5 space-y-3 text-sm">
                            {['Browser UI and local persisted state', 'REST requests for durable writes', 'FastAPI routes and auth dependencies', 'Database rows plus uploaded file metadata', 'Background workers and async pipeline waves', 'Engine modules returning typed AI outputs', 'WebSocket events back into page-level subscribers'].map(item => (
                                <div key={item} className="rounded-md border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-1)' }}>
                                    {item}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="py-10">
                    <SectionTitle eyebrow="Platform" title="What the platform does">
                        The product is not just a resume analyzer. It is a system for turning unstructured career data and job descriptions into structured, comparable, editable, and trackable application intelligence.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {platformFeatures.map(feature => (
                            <article key={feature.title} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{feature.title}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{feature.detail}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Architecture" title="Layers and responsibilities">
                        Each layer has a clear job. The browser handles interaction, the API owns trust boundaries, workers handle slow work, the engine owns intelligence, and storage keeps the system recoverable.
                    </SectionTitle>

                    <div className="mt-7 space-y-4">
                        {architectureLayers.map(layer => (
                            <article key={layer.layer} className="grid gap-4 rounded-lg border p-5 lg:grid-cols-[180px_1fr_1fr]" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <div>
                                    <h3 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>{layer.layer}</h3>
                                    <code className="mt-2 inline-block rounded-md px-2 py-1 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>{layer.path}</code>
                                </div>
                                <p className="text-sm leading-6" style={{ color: 'var(--text-2)' }}>{layer.role}</p>
                                <div className="flex flex-wrap gap-2">
                                    {layer.pieces.map(piece => <Pill key={piece}>{piece}</Pill>)}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Workflows" title="Parallel workflows and orchestration">
                        The important workflows create durable records first, then run slow work in parallel or in workers. That gives the frontend something stable to render while the system fills in results.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 lg:grid-cols-2">
                        {workflows.map(flow => (
                            <article key={flow.title} className="rounded-lg border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>{flow.title}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{flow.summary}</p>
                                <ol className="mt-4 space-y-3">
                                    {flow.steps.map((step, index) => (
                                        <li key={step} className="grid grid-cols-[28px_1fr] gap-3 text-sm">
                                            <span className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                                                {index + 1}
                                            </span>
                                            <span style={{ color: 'var(--text-2)' }}>{step}</span>
                                        </li>
                                    ))}
                                </ol>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {flow.concepts.map(concept => <Pill key={concept}>{concept}</Pill>)}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="APIs" title="API surface and contracts">
                        The API is organized by product capability. Each router validates input, resolves the current user, performs scoped database access, and calls the engine or worker layer only when needed.
                    </SectionTitle>

                    <div className="mt-7 overflow-hidden rounded-lg border" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                        {apiGroups.map(group => (
                            <div key={group.name} className="grid gap-3 border-b p-4 last:border-b-0 lg:grid-cols-[180px_1fr_1fr]" style={{ borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{group.name}</h3>
                                <code className="text-xs leading-5" style={{ color: 'var(--accent)' }}>{group.endpoints}</code>
                                <p className="text-sm leading-6" style={{ color: 'var(--text-2)' }}>{group.purpose}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Database" title="Data model and persistence choices">
                        The database uses relational ownership for core entities and JSON payloads for AI results. That is a deliberate hybrid model: stable product objects are relational, evolving intelligence is document-shaped.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 lg:grid-cols-2">
                        {databaseTables.map(table => (
                            <article key={table.table} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="font-mono text-sm font-semibold" style={{ color: 'var(--accent)' }}>{table.table}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-1)' }}>{table.role}</p>
                                <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-2)' }}>{table.relationship}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Storage" title="Files, JSON payloads, and cached materializations">
                        Storage has three shapes: SQL rows for ownership and lifecycle, raw files on disk for uploaded sources, and JSON payloads for AI-generated structured state.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2">
                        {storageChoices.map(choice => (
                            <article key={choice.title} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{choice.title}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{choice.detail}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Frontend" title="How the UI connects to the system">
                        The frontend is designed around feature routes, reusable workflow components, a small persisted store, and a single event stream for background progress.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {frontendChoices.map(choice => (
                            <article key={choice.title} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{choice.title}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{choice.detail}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Principles" title="System design principles used">
                        The codebase applies practical distributed-systems ideas even though it is still a local application: isolate slow work, persist checkpoints, stream progress, validate schemas, and separate durable state from derived intelligence.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {systemPrinciples.map(principle => (
                            <article key={principle.name} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{principle.name}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{principle.explanation}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="CS Fundamentals" title="Computer science concepts in the implementation">
                        These are the concrete fundamentals represented in the platform, not just abstract buzzwords.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2">
                        {csConcepts.map(item => (
                            <article key={item.concept} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{item.concept}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{item.use}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Implementation" title="Notable libraries and what they enabled">
                        The complex behavior comes from combining focused libraries rather than building every subsystem from scratch.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {notableLibraries.map(library => (
                            <article key={library.name} className="rounded-lg border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{library.name}</h3>
                                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-2)' }}>{library.role}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Parts" title="Discussion of each major part">
                        This is the project broken down by actual code ownership.
                    </SectionTitle>

                    <div className="mt-7 grid gap-4 lg:grid-cols-3">
                        {moduleGroups.map(group => (
                            <article key={group.title} className="rounded-lg border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                                <h3 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>{group.title}</h3>
                                <div className="mt-4 space-y-3">
                                    {group.modules.map(([name, detail]) => (
                                        <div key={name} className="rounded-md border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                                            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{name}</p>
                                            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-2)' }}>{detail}</p>
                                        </div>
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="border-t py-10" style={{ borderColor: 'var(--border)' }}>
                    <SectionTitle eyebrow="Scalability" title="What needs to be hardened next">
                        These are architectural improvements that follow directly from the current design.
                    </SectionTitle>

                    <div className="mt-7 grid gap-3 md:grid-cols-2">
                        {incompleteItems.map(item => (
                            <div key={item} className="rounded-lg border p-4 text-sm leading-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                                {item}
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
