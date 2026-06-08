import { gtagEvent } from './gtag';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

// Get auth token from localStorage
function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
}

// Set auth token
export function setToken(token: string): void {
    localStorage.setItem('token', token);
}

// Clear auth token
export function clearToken(): void {
    localStorage.removeItem('token');
}

// Extended RequestInit to support custom options
interface FetchOptions extends RequestInit {
    suppressError?: boolean;
}

// ============ Error types ============

export interface ApiError extends Error {
    code?: string;
    status?: number;
    retryAfter?: number;
    body?: {
        detail?: string;
        needed?: number;
        balance?: number;
        retry_after?: number;
        code?: string;
    };
}

export function isApiError(e: unknown): e is ApiError {
    return e instanceof Error;
}

// Fetch wrapper with auth
async function fetchWithAuth(url: string, options: FetchOptions = {}) {
    const token = getToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });

    if (!response.ok) {
        // If suppressError is true, throw the response so component can handle status codes manually
        // OR return null/custom object? 
        // Better: throw error but component catches it. 
        // Wait, the user wants to suppress CONSOLE error "throw new Error(...)". 
        // If I throw here, it shows in console if uncaught? No, "Uncaught (in promise)" shows.
        // But if I catch it in component, it still might show if browser logs all errors?
        // Actually, the user's stack trace shows `fetchWithAuth` throwing `new Error`.
        // If we want to avoid that specific line throwing for 404s, we can handle it here.

        // If suppressError is true, we want to avoid throwing for 404s so the caller can handle null
        if (options.suppressError && response.status === 404) {
            return null;
        }

        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        const rawDetail = error.detail;
        const detail = Array.isArray(rawDetail)
            ? rawDetail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(', ')
            : typeof rawDetail === 'string'
            ? rawDetail
            : rawDetail != null && typeof rawDetail === 'object'
            ? (rawDetail as { message?: string }).message ?? JSON.stringify(rawDetail)
            : error.message;
        const apiError = new Error(detail || 'Request failed') as ApiError;
        apiError.status = response.status;
        // Attach structured code from the detail object when available (e.g. NO_PROFILE_DOCUMENTS)
        if (rawDetail != null && typeof rawDetail === 'object' && (rawDetail as { code?: string }).code) {
            apiError.code = (rawDetail as { code: string }).code;
        }
        // Extract retry-after for 429s
        if (response.status === 429) {
            const headerRetry = response.headers.get('Retry-After');
            const bodyRetry = rawDetail != null && typeof rawDetail === 'object'
                ? (rawDetail as { retry_after?: number }).retry_after
                : undefined;
            apiError.retryAfter = bodyRetry ?? (headerRetry ? parseInt(headerRetry, 10) : 60);
        }
        throw apiError;
    }

    return response.json();
}

// ============ LLM Provider types ============

export interface LLMProvider {
    provider: string;
    label: string;
    configured: boolean;
    key_last4: string | null;
}

export interface LLMTaskConfig {
    provider: string;
    model: string;
}

export interface LLMModelOption {
    id: string;
    label: string;
}

export interface LLMGroup {
    id: string;
    label: string;
}

export interface LLMConfig {
    groups: LLMGroup[];
    selection: Record<string, LLMTaskConfig>;          // group_id -> {provider, model}
    models_by_provider: Record<string, LLMModelOption[]>;
    available_providers: string[];
    has_any_key: boolean;
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

// ============ Types matching API schemas ============

// User types
export interface User {
    id: string;
    email: string;
    name: string;
    profile_picture?: string;
    created_at?: string;
    has_profile?: boolean;
    onboarding_completed?: boolean;
}

export type JobStatus = 'tracked' | 'queued' | 'analyzing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'archived';
export type ProfileFileType = 'resume' | 'linkedin' | 'other';

// Job posting data structure
export interface JobPosting {
    job_title: string;
    company_name: string;
    location?: string | null;
    job_link?: string | null;
    raw_jd?: string;
    work_mode?: 'remote' | 'hybrid' | 'onsite' | 'flexible' | 'unspecified';
    employment_type?: 'full_time' | 'part_time' | 'contract' | 'internship' | 'temporary' | 'unspecified';
    seniority_level?: 'intern' | 'entry' | 'junior' | 'mid' | 'senior' | 'staff' | 'lead' | 'manager' | 'unspecified';
    years_of_experience_min?: number | null;
    years_of_experience_max?: number | null;
    role_family?: string | null;
    primary_track?: string | null;
    primary_skills?: string[];
    secondary_skills?: string[];
    responsibilities?: string[];
    constraints?: string[];
    keywords?: string[];
}

export interface JobAnalysisSummary {
    final_score: number;
    match_band: 'strong' | 'good' | 'partial' | 'weak';
    headline: string;
    strongest_matches: string[];
    biggest_gaps: string[];
}

// Resume history entry
export interface ResumeHistoryEntry {
    version: number;
    resume_data: Record<string, unknown>;
    score?: number;
    created_at: string;
}

// Job list response (GET /api/jobs)
export interface JobListItem {
    id: string;
    job_posting: JobPosting;
    status: JobStatus;
    final_score?: number;
    company_website?: string;
    joblens_session_id?: string;
    created_at: string;
    updated_at?: string;
    pipeline_step?: string;
    pipeline_progress?: number;
    current_step?: number;
}

// Full job response (GET /api/jobs/{id})
export interface Job {
    id: string;
    job_posting: JobPosting;
    analysis_result?: JobAnalysisSummary | null;
    status: JobStatus;
    user_notes?: string;
    resume_history?: ResumeHistoryEntry[];
    company_website?: string;
    joblens_session_id?: string;
    created_at: string;
    updated_at?: string;
}

// Job create request
export interface JobCreate {
    jd_text: string;
    company_website?: string;
}

// Simple track job request (no AI pipeline)
export interface JobTrackCreate {
    job_title: string;
    company_name: string;
    job_url?: string;
    location?: string;
    status?: JobStatus;
}

// Job update request
export interface JobUpdate {
    status?: JobStatus;
    user_notes?: string;
    job_link?: string | null;
}

// Profile types
export interface UserProfile {
    id: string;
    user_id: string;
    resume_path?: string;
    linkedin_path?: string;
    portfolio_path?: string;
    resume_data?: Record<string, unknown>;
    linkedin_data?: Record<string, unknown>;
    portfolio_data?: Record<string, unknown>;
    unified_profile?: UnifiedProfile | Record<string, unknown>;
    extracted_profile?: UnifiedProfile | Record<string, unknown>;
    additional_context?: string;
    build_status?: 'idle' | 'building' | 'ready' | 'error';
    updated_at: string;
}

export interface ProfileUploadResponse {
    file_type: string;
    filename: string;
    parsed_data: Record<string, unknown>;
}

export interface ProfileFile {
    id: string;
    filename: string;
    file_type: ProfileFileType;
    file_size: number;
    parsed_data?: Record<string, unknown>;
    additional_context?: string;
    created_at: string;
    updated_at: string;
}

export interface ProfileFileListResponse {
    files: ProfileFile[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

export interface ProfileFileUploadResponse {
    id: string;
    file_type: ProfileFileType;
    filename: string;
    parsed_data?: Record<string, unknown>;
}

// Cover Letter Types
export interface CoverLetter {
    id: string;
    job_id?: string;
    mode: 'storyline' | 'disruptive' | 'regular' | 'auto' | 'custom';
    content: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface CoverLetterCreate {
    job_id?: string;
    mode: string;
    custom_prompt?: string;
    include_news?: boolean;
    jd_text?: string;
    company_name?: string;
}

export interface JDToneAnalyzeRequest {
    job_id?: string;
    jd_text?: string;
    company_name?: string;
    mode?: string;
}

export interface JDToneAnalysis {
    recommended_mode: string;
    confidence: number;
    tone_signals: string[];
    culture_indicators: string[];
    formality_level: string;
    industry: string;
    reasoning: string;
}

// News Types
export interface NewsArticle {
    title: string;
    description: string;
    url: string;
    source: string;
    published_at: string;
}

export interface NewsResponse {
    company_name: string;
    articles: NewsArticle[];
    total_results: number;
}

// ============================================================================
// JobLens Types
// ============================================================================

export interface UnifiedProfile {
    basics?: {
        name?: string | null;
        title?: string | null;
        summary?: string | null;
        contact_info?: {
            email?: string | null;
            phone?: string | null;
            linkedin_url?: string | null;
            portfolio_url?: string | null;
            github_url?: string | null;
        } | null;
        location?: string | null;
    } | null;
    work_experience?: Array<{
        job_title?: string | null;
        company_name?: string | null;
        start_date?: string | null;
        end_date?: string | null;
        is_current?: boolean;
        location?: string | null;
        description?: string[];
        achievements?: string[];
    }>;
    skills?: string[];
    education?: Array<{
        institution?: string | null;
        degree?: string | null;
        major?: string | null;
        graduation_year?: string | null;
    }>;
    additional_sections?: Array<{
        title: string;
        pointers: string[];
    }>;
    dynamic_sections?: Record<string, unknown>;
}

export interface JobDescriptionBreakdownResult {
    input?: { text: string; source_id?: string | null };
    breakdown?: {
        metadata?: Record<string, unknown>;
        company_context?: Record<string, unknown>;
        role_classification?: Record<string, unknown>;
        primary_skills?: Record<string, unknown>[];
        secondary_skills?: Record<string, unknown>[];
        responsibilities?: Record<string, unknown>[];
        qualifications?: Record<string, unknown>[];
        constraints?: Record<string, unknown>[];
        keywords?: string[];
        extraction_notes?: string[];
    };
    warnings?: string[];
}

export interface CompanyIntelResult {
    input?: Record<string, unknown>;
    identity?: Record<string, unknown>;
    product_signals?: Record<string, unknown>[];
    engineering_presence?: Record<string, unknown>;
    technical_signals?: Record<string, unknown>;
    engineering_culture?: Record<string, unknown>;
    hiring_signals?: Record<string, unknown>;
    source_pages?: Record<string, unknown>[];
    extraction_notes?: string[];
    warnings?: string[];
}

export interface JobMatchResult {
    job_title?: string | null;
    company_name?: string | null;
    role_family?: string | null;
    summary?: {
        total_score?: number;
        match_band?: 'strong' | 'good' | 'partial' | 'weak';
        headline?: string;
        strongest_matches?: string[];
        biggest_gaps?: string[];
        hard_constraint_summary?: string | null;
    };
    score_components?: Record<string, unknown>[];
    constraints?: Record<string, unknown>[];
    skill_matches?: Record<string, unknown>[];
    responsibility_matches?: Record<string, unknown>[];
    selected_resume_filename?: string | null;
    update_actions?: Record<string, unknown>[];
    replace_actions?: Record<string, unknown>[];
    delete_actions?: Record<string, unknown>[];
    selected_actions?: Record<string, unknown>[];
    warnings?: string[];
}

export interface ReachoutResult {
    input?: Record<string, unknown>;
    search_plan?: {
        company_name?: string | null;
        company_website?: string | null;
        target_personas?: string[];
        queries?: Record<string, unknown>[];
        negative_filters?: string[];
        search_strategy_notes?: string[];
    };
    raw_results?: Record<string, unknown>[];
    candidates?: Record<string, unknown>[];
    linkedin_search_urls?: string[];
    warnings?: string[];
}

export interface JobLensSession {
    id: string;
    job_id?: string;
    profile_snapshot?: UnifiedProfile | null;
    job_description?: JobDescriptionBreakdownResult | null;
    company_intel?: CompanyIntelResult | null;
    match_analysis?: JobMatchResult | null;     // Phase A: score + evidence
    resume_actions?: Record<string, unknown> | null;  // Phase B: resume tailoring
    reachout?: ReachoutResult | null;
    raw_jd_text?: string;
    company_website?: string;
    current_step: number;
    created_at: string;
    updated_at: string;
}

// ============ API Methods ============

export const api = {
    // Auth
    getMe: (): Promise<User> => fetchWithAuth('/api/auth/me'),
    logout: () => fetchWithAuth('/api/auth/logout', { method: 'POST' }),
    updateUser: (data: { name?: string; profile_picture?: string }): Promise<User> =>
        fetchWithAuth('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(data) }),
    uploadAvatar: (file: File): Promise<User> => {
        const formData = new FormData();
        formData.append('file', file);
        const token = getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return fetch(`${API_BASE}/api/auth/avatar`, { method: 'POST', headers, body: formData })
            .then(async (res) => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
                    throw new Error(err.detail || 'Upload failed');
                }
                return res.json();
            });
    },
    deleteAvatar: (): Promise<User> => fetchWithAuth('/api/auth/avatar', { method: 'DELETE' }),
    completeOnboarding: (): Promise<User> => fetchWithAuth('/api/auth/complete-onboarding', { method: 'POST' }),

    // Jobs
    getJobs: (status?: string): Promise<JobListItem[]> => {
        const url = status ? `/api/jobs?status=${status}` : '/api/jobs';
        return fetchWithAuth(url);
    },
    getJob: (id: string, suppressError?: boolean): Promise<Job | null> => fetchWithAuth(`/api/jobs/${id}`, { suppressError }),
    createJob: async (data: JobCreate): Promise<Job> => {
        const result = await fetchWithAuth('/api/jobs', { method: 'POST', body: JSON.stringify(data) });
        gtagEvent('job_analysis_started');
        return result;
    },
    trackJob: (data: JobTrackCreate): Promise<Job> =>
        fetchWithAuth('/api/jobs/track', { method: 'POST', body: JSON.stringify(data) }),
    updateJob: (id: string, data: JobUpdate): Promise<Job> =>
        fetchWithAuth(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteJob: (id: string) =>
        fetchWithAuth(`/api/jobs/${id}`, { method: 'DELETE' }),
    parseResumeForJob: async (jobId: string, file: File): Promise<{ success: boolean; filename: string; parsed_resume: Record<string, unknown> }> => {
        const formData = new FormData();
        formData.append('file', file);
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}/parse-resume`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ detail: 'Failed to parse resume' }));
            throw new Error(error.detail || 'Failed to parse resume');
        }
        return res.json();
    },
    // Cover Letters
    getCoverLetters: (): Promise<CoverLetter[]> => fetchWithAuth('/api/cover-letters'),
    getCoverLetter: (id: string): Promise<CoverLetter> => fetchWithAuth(`/api/cover-letters/${id}`),
    createCoverLetter: async (data: CoverLetterCreate): Promise<CoverLetter> => {
        const result = await fetchWithAuth('/api/cover-letters', { method: 'POST', body: JSON.stringify(data) });
        gtagEvent('cover_letter_generated', { mode: data.mode });
        return result;
    },
    analyzeJDTone: (data: JDToneAnalyzeRequest): Promise<JDToneAnalysis> =>
        fetchWithAuth('/api/cover-letters/analyze-jd', { method: 'POST', body: JSON.stringify(data) }),
    deleteCoverLetter: (id: string): Promise<void> => fetchWithAuth(`/api/cover-letters/${id}`, { method: 'DELETE' }),
    updateCoverLetter: (id: string, data: { full_letter?: string; content?: Record<string, unknown> }): Promise<CoverLetter> =>
        fetchWithAuth(`/api/cover-letters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    // Profile
    getProfile: (): Promise<UserProfile> => fetchWithAuth('/api/profile'),

    uploadProfileFile: (file: File, type: ProfileFileType): Promise<ProfileUploadResponse> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);

        // Custom handling for FormData
        const token = getToken();
        // Don't set Content-Type header, let browser set it with boundary
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        return fetch(`${API_BASE}/api/profile/upload`, {
            method: 'POST',
            headers,
            body: formData
        }).then(async (res) => {
            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: 'Request failed' }));
                throw new Error(error.detail || 'Request failed');
            }
            return res.json();
        });
    },

    createUnifiedProfile: async (): Promise<UserProfile> => {
        const result = await fetchWithAuth('/api/profile/unified', { method: 'POST' });
        gtagEvent('profile_unified');
        return result;
    },

    updateAdditionalContext: (additional_context: string): Promise<UserProfile> =>
        fetchWithAuth('/api/profile/additional-context', { method: 'PATCH', body: JSON.stringify({ additional_context }) }),

    deleteProfileFile: (type: 'resume' | 'linkedin' | 'other'): Promise<UserProfile> =>
        fetchWithAuth(`/api/profile/${type}`, { method: 'DELETE' }),

    getProfileFileBlob: async (type: string): Promise<Blob> => {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/profile/file/${type}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error('Failed to download file');
        return res.blob();
    },

    uploadProfileFileMulti: async (
        file: File, type: ProfileFileType, additionalContext?: string
    ): Promise<ProfileFileUploadResponse> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);
        if (additionalContext) formData.append('additional_context', additionalContext);

        const token = getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/api/profile/upload`, {
            method: 'POST',
            headers,
            body: formData
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({ detail: 'Request failed' }));
            throw new Error(error.detail || 'Request failed');
        }
        const result = await res.json();
        gtagEvent('file_uploaded', { file_type: type });
        return result;
    },

    getProfileFiles: (page?: number, pageSize?: number, type?: string): Promise<ProfileFileListResponse> => {
        const params = new URLSearchParams();
        if (page) params.set('page', String(page));
        if (pageSize) params.set('page_size', String(pageSize));
        if (type) params.set('type', type);
        const qs = params.toString();
        return fetchWithAuth(`/api/profile/files${qs ? '?' + qs : ''}`);
    },

    getProfileFileById: (fileId: string): Promise<ProfileFile> =>
        fetchWithAuth(`/api/profile/files/${fileId}`),

    deleteProfileFileById: (fileId: string): Promise<void> =>
        fetchWithAuth(`/api/profile/files/${fileId}`, { method: 'DELETE' }),

    updateProfileFile: (fileId: string, data: { file_type?: ProfileFileType; additional_context?: string }): Promise<ProfileFile> =>
        fetchWithAuth(`/api/profile/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    downloadProfileFile: async (fileId: string): Promise<Blob> => {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/profile/file/${fileId}/download`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error('Failed to download file');
        return res.blob();
    },

    // Usage
    getUsage: (): Promise<UsageEvent[]> => fetchWithAuth('/api/llm/usage'),

    // LLM Providers (BYOK)
    getLLMProviders: (): Promise<LLMProvider[]> => fetchWithAuth('/api/llm/providers'),
    saveLLMKey: (provider: string, api_key: string): Promise<{valid: boolean, key_last4: string}> =>
        fetchWithAuth(`/api/llm/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ api_key }) }),
    deleteLLMKey: (provider: string): Promise<{ok: boolean}> =>
        fetchWithAuth(`/api/llm/keys/${provider}`, { method: 'DELETE' }),
    getLLMConfig: (): Promise<LLMConfig> => fetchWithAuth('/api/llm/config'),
    saveLLMConfig: (selection: Record<string, LLMTaskConfig>): Promise<LLMConfig> =>
        fetchWithAuth('/api/llm/config', { method: 'PUT', body: JSON.stringify({ selection }) }),
    applyRecommendedLLM: (): Promise<LLMConfig> =>
        fetchWithAuth('/api/llm/recommended', { method: 'POST' }),

    // News
    getNews: (companyName: string): Promise<NewsResponse> => fetchWithAuth(`/api/news/${encodeURIComponent(companyName)}`),

    // Run JobLens pipeline for a job
    runJobLens: async (jobId: string): Promise<Job> => {
        const result = await fetchWithAuth(`/api/jobs/${jobId}/analyze`, { method: 'POST' });
        gtagEvent('job_analysis_started', { job_id: jobId });
        return result;
    },

    // Retry specific failed steps (does not restart the full pipeline)
    retrySteps: (jobId: string, steps: string[]): Promise<JobLensSession> =>
        fetchWithAuth(`/api/jobs/${jobId}/retry-steps`, {
            method: 'POST',
            body: JSON.stringify({ steps }),
        }),

    // Convenience
    getJobWithSession: async (jobId: string): Promise<{ job: Job | null; session: JobLensSession | null }> => {
        const job = await fetchWithAuth(`/api/jobs/${jobId}`, { suppressError: true });
        if (!job) return { job: null, session: null };
        let session = null;
        if (job.joblens_session_id) {
            try {
                session = await fetchWithAuth(`/api/jobs/${jobId}/analysis`);
            } catch {}
        }
        return { job, session };
    },
};
