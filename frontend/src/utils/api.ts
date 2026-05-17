const API_BASE = 'http://localhost:8000';

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
        throw new Error(error.detail || 'Request failed');
    }

    return response.json();
}

// ============ Types matching API schemas ============

// User types
export interface User {
    id: string;
    email: string;
    name: string;
    profile_picture?: string;
    llm_provider?: string;
    llm_model?: string;
    created_at?: string;
}

// Qualification item (from AnalysisResult)
export interface QualificationItem {
    name: string;
    matched: boolean;
    evidence: string;
}

// Resume suggestion (from AnalysisResult)
export interface ResumeSuggestion {
    action: 'ADD' | 'UPDATE' | 'DELETE';
    section: string;
    target: string;
    suggestion: string;
    keyword: string;
}

// Chronological issue (from AnalysisResult)
export interface ChronologicalIssue {
    section: string;
    issue_type: string;
    description: string;
}

// Full analysis result from engine
export interface AnalysisResult {
    // Qualification matches
    required_qualifications: QualificationItem[];
    preferred_qualifications: QualificationItem[];
    technical_skills: QualificationItem[];
    soft_skills: QualificationItem[];

    // Formatting issues
    chronological_issues: ChronologicalIssue[];

    // Scores (0-100)
    resume_formatting_score: number;
    keyword_match_score: number;
    qualification_match_score: number;
    skill_match_score: number;
    final_score: number;

    // Resume suggestions
    resume_suggestions: ResumeSuggestion[];

    // Job info
    compensation_and_benefits: string[];
    salary_range: string;

    // Match counts
    required_matched: number;
    required_total: number;
    preferred_matched: number;
    preferred_total: number;
    technical_matched: number;
    technical_total: number;
    soft_matched: number;
    soft_total: number;
}

// Job posting data structure
export interface JobPosting {
    job_title: string;
    company_name: string;
    location?: string;
    job_link?: string;
    required_qualifications?: string[];
    preferred_qualifications?: string[];
    technical_skills?: string[];
    soft_skills?: string[];
    salary_range?: string;
    compensation_and_benefits?: string[];
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
    status: 'tracked' | 'queued' | 'analyzing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'archived';
    final_score?: number;
    company_website?: string;
    joblens_session_id?: string;
    created_at: string;
}

// Full job response (GET /api/jobs/{id})
export interface Job {
    id: string;
    job_posting: JobPosting;
    analysis_result?: AnalysisResult;
    status: 'tracked' | 'queued' | 'analyzing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'archived';
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
    status?: string;
}

// Job update request
export interface JobUpdate {
    status?: 'tracked' | 'queued' | 'analyzing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'archived';
    user_notes?: string;
    job_link?: string | null;
}

// Re-evaluate request/response
export interface ReEvaluateRequest {
    modified_resume: Record<string, unknown>;
}

export interface ReEvaluateResponse {
    qualification_match_score: number;
    skill_match_score: number;
    formatting_score: number;
    keyword_match_score: number;
    final_score: number;


    score_change: number;
    improved: boolean;
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
    unified_profile?: Record<string, unknown>;
    discrepancy_result?: Record<string, unknown>;
    extracted_profile?: Record<string, unknown>;
    additional_context?: string;
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
    file_type: string;
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
    file_type: string;
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

export interface JDToneAnalysis {
    recommended_mode: string;
    confidence: number;
    tone_signals: string[];
    culture_indicators: string[];
    formality_level: string;
    industry: string;
    reasoning: string;
}

export interface ProviderModelInfo {
    default_model: string;
    models: string[];
}

export interface AvailableProviders {
    providers: Record<string, ProviderModelInfo>;
}

export interface Discrepancy {
    id: string;
    unified_profile: Record<string, unknown>;
    result?: Record<string, unknown>;
    created_at: string;
}

export interface DiscrepancyCreate {
    unified_profile: Record<string, unknown>;
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

// Queue Types
export interface QueueJobRequest {
    job_posting: Record<string, unknown>;
    resume: Record<string, unknown>;
    unified_profile?: Record<string, unknown>; // Optional, if using profile data
}

export interface QueueJobResponse {
    job_id: string;
    task_id: string;
    position: number;
    status: string;
}

export interface QueueJobStatus {
    id: string;
    status: string;
    job_title: string;
    company: string;
}

export interface QueueStatusResponse {
    queued: number;
    processing: number;
    jobs: QueueJobStatus[];
}

// ============================================================================
// JobLens Types
// ============================================================================

export interface JobLensSession {
    id: string;
    job_id?: string;
    extracted_profile?: Record<string, unknown>;
    parsed_jd?: Record<string, unknown>;
    company_intel?: Record<string, unknown>;
    match_analysis?: Record<string, unknown>;
    contact_strategy?: Record<string, unknown>;
    action_plan?: Record<string, unknown>;
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
    getLLMProviders: (): Promise<AvailableProviders> => fetch('/api/auth/llm/providers').then(r => r.json()),
    updateUser: (data: { name?: string; profile_picture?: string; llm_provider?: string; llm_model?: string }): Promise<User> =>
        fetchWithAuth('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(data) }),
    deleteAccount: (): Promise<void> => fetchWithAuth('/api/auth/profile', { method: 'DELETE' }),

    // Jobs
    getJobs: (status?: string): Promise<JobListItem[]> => {
        const url = status ? `/api/jobs?status=${status}` : '/api/jobs';
        return fetchWithAuth(url);
    },
    getJob: (id: string, suppressError?: boolean): Promise<Job | null> => fetchWithAuth(`/api/jobs/${id}`, { suppressError }),
    createJob: (data: JobCreate): Promise<Job> =>
        fetchWithAuth('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    trackJob: (data: JobTrackCreate): Promise<Job> =>
        fetchWithAuth('/api/jobs/track', { method: 'POST', body: JSON.stringify(data) }),
    updateJob: (id: string, data: JobUpdate): Promise<Job> =>
        fetchWithAuth(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteJob: (id: string) =>
        fetchWithAuth(`/api/jobs/${id}`, { method: 'DELETE' }),
    reEvaluateJob: (id: string, data: ReEvaluateRequest): Promise<ReEvaluateResponse> =>
        fetchWithAuth(`/api/jobs/${id}/reevaluate`, { method: 'POST', body: JSON.stringify(data) }),
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
    createCoverLetter: (data: CoverLetterCreate): Promise<CoverLetter> =>
        fetchWithAuth('/api/cover-letters', { method: 'POST', body: JSON.stringify(data) }),
    analyzeJDTone: (data: CoverLetterCreate): Promise<JDToneAnalysis> =>
        fetchWithAuth('/api/cover-letters/analyze-jd', { method: 'POST', body: JSON.stringify(data) }),
    deleteCoverLetter: (id: string): Promise<void> => fetchWithAuth(`/api/cover-letters/${id}`, { method: 'DELETE' }),
    updateCoverLetter: (id: string, data: { full_letter?: string; content?: Record<string, unknown> }): Promise<CoverLetter> =>
        fetchWithAuth(`/api/cover-letters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    // Discrepancies
    getDiscrepancies: (): Promise<Discrepancy[]> => fetchWithAuth('/api/discrepancies'),
    getDiscrepancy: (id: string): Promise<Discrepancy> => fetchWithAuth(`/api/discrepancies/${id}`),
    createDiscrepancy: (data: DiscrepancyCreate): Promise<Discrepancy> =>
        fetchWithAuth('/api/discrepancies', { method: 'POST', body: JSON.stringify(data) }),
    deleteDiscrepancy: (id: string): Promise<void> => fetchWithAuth(`/api/discrepancies/${id}`, { method: 'DELETE' }),

    // Profile
    getProfile: (): Promise<UserProfile> => fetchWithAuth('/api/profile'),

    uploadProfileFile: (file: File, type: 'resume' | 'linkedin' | 'portfolio'): Promise<ProfileUploadResponse> => {
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

    createUnifiedProfile: (): Promise<UserProfile> => fetchWithAuth('/api/profile/unified', { method: 'POST' }),

    updateAdditionalContext: (additional_context: string): Promise<UserProfile> =>
        fetchWithAuth('/api/profile/additional-context', { method: 'PATCH', body: JSON.stringify({ additional_context }) }),

    deleteProfileFile: (type: 'resume' | 'linkedin' | 'portfolio'): Promise<UserProfile> =>
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
        file: File, type: string, additionalContext?: string
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
        return res.json();
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

    updateProfileFile: (fileId: string, data: { file_type?: string; additional_context?: string }): Promise<ProfileFile> =>
        fetchWithAuth(`/api/profile/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    downloadProfileFile: async (fileId: string): Promise<Blob> => {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/profile/file/${fileId}/download`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error('Failed to download file');
        return res.blob();
    },

    // News
    getNews: (companyName: string): Promise<NewsResponse> => fetchWithAuth(`/api/news/${encodeURIComponent(companyName)}`),

    // Queue
    queueJob: (data: QueueJobRequest): Promise<QueueJobResponse> =>
        fetchWithAuth('/api/queue/jobs', { method: 'POST', body: JSON.stringify(data) }),

    // Batch queueing
    queueJobsBatch: (data: QueueJobRequest[]): Promise<QueueJobResponse[]> =>
        fetchWithAuth('/api/queue/jobs/batch', { method: 'POST', body: JSON.stringify(data) }),

    getQueueStatus: (): Promise<QueueStatusResponse> => fetchWithAuth('/api/queue/status'),

    cancelJob: (jobId: string): Promise<void> => fetchWithAuth(`/api/queue/jobs/${jobId}`, { method: 'DELETE' }),

    // JobLens
    createJobLensSession: (data: { job_id?: string }): Promise<JobLensSession> =>
        fetchWithAuth('/api/joblens/sessions', { method: 'POST', body: JSON.stringify(data) }),
    getJobLensSessions: (): Promise<JobLensSession[]> =>
        fetchWithAuth('/api/joblens/sessions'),
    getJobLensSession: (id: string): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${id}`),
    deleteJobLensSession: (id: string): Promise<void> =>
        fetchWithAuth(`/api/joblens/sessions/${id}`, { method: 'DELETE' }),

    // JobLens Steps
    joblensExtractProfile: (sessionId: string, data: { portfolio_notes?: string }): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/extract-profile`, { method: 'POST', body: JSON.stringify(data) }),
    joblensParseJD: (sessionId: string, data: { jd_text: string; job_id?: string }): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/parse-jd`, { method: 'POST', body: JSON.stringify(data) }),
    joblensCompanyIntel: (sessionId: string, data: { company_name: string; company_website?: string; additional_notes?: string }): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/company-intel`, { method: 'POST', body: JSON.stringify(data) }),
    joblensMatchAnalysis: (sessionId: string): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/match-analysis`, { method: 'POST', body: JSON.stringify({}) }),
    joblensContacts: (sessionId: string): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/contacts`, { method: 'POST', body: JSON.stringify({}) }),
    joblensActionPlan: (sessionId: string): Promise<JobLensSession> =>
        fetchWithAuth(`/api/joblens/sessions/${sessionId}/action-plan`, { method: 'POST', body: JSON.stringify({}) }),

    // Convenience
    getJobWithSession: async (jobId: string): Promise<{ job: Job | null; session: JobLensSession | null }> => {
        const job = await fetchWithAuth(`/api/jobs/${jobId}`, { suppressError: true });
        if (!job) return { job: null, session: null };
        let session = null;
        if (job.joblens_session_id) {
            try {
                session = await fetchWithAuth(`/api/joblens/sessions/${job.joblens_session_id}`);
            } catch {}
        }
        return { job, session };
    },
};
