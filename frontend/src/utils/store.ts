import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, api, setToken, clearToken, type ProfileFileType } from './api';
import { uploadFileXHR } from './uploadUtils';

// ─── Upload queue ──────────────────────────────────────────────────────────────

export interface UploadQueueItem {
    id: string;
    filename: string;
    fileSize: number;
    type: ProfileFileType;
    status: 'uploading' | 'parsing' | 'done' | 'error';
    progress: number; // 0–100
    error?: string;
}

interface UploadInput {
    file: File;
    type: ProfileFileType;
    additionalContext: string;
}

interface AppState {
    // Auth
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    _hasHydrated: boolean;

    // Theme
    theme: 'dark' | 'light';

    // Jobs Filter
    jobsFilter: string;

    // Actions
    login: (token: string) => Promise<void>;
    logout: () => void;
    fetchUser: () => Promise<void>;
    toggleTheme: () => void;
    setHasHydrated: (state: boolean) => void;

    // Jobs Filter Actions
    setJobsFilter: (filter: string) => void;

    // Onboarding
    onboardingComplete: boolean;
    setOnboardingComplete: (done: boolean) => void;

    // Upload queue — persists across navigation, not persisted to localStorage
    uploadQueue: UploadQueueItem[];
    uploadCompletedAt: number | null; // timestamp of last completed batch; profile page watches this
    enqueueUploads: (items: UploadInput[]) => void;
    clearCompletedUploads: () => void;

}

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial State
            user: null,
            token: null,
            isAuthenticated: false,
            _hasHydrated: false,
            theme: 'light',
            jobsFilter: 'all',
            onboardingComplete: false,
            uploadQueue: [],
            uploadCompletedAt: null,

            setHasHydrated: (state: boolean) => {
                set({ _hasHydrated: state });
            },

            // Auth Actions
            login: async (token: string) => {
                setToken(token);
                set({ token, isAuthenticated: true });
                await get().fetchUser();
            },

            logout: () => {
                clearToken();
                set({ user: null, token: null, isAuthenticated: false });
            },

            fetchUser: async () => {
                try {
                    const user = await api.getMe();
                    set({ user, isAuthenticated: true, onboardingComplete: !!user.onboarding_completed });
                } catch {
                    get().logout();
                }
            },

            toggleTheme: () => {
                set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' }));
            },

            setJobsFilter: (filter: string) => {
                set({ jobsFilter: filter });
            },

            setOnboardingComplete: (done: boolean) => {
                set({ onboardingComplete: done });
            },

            enqueueUploads: (items: UploadInput[]) => {
                const queueItems: UploadQueueItem[] = items.map(item => ({
                    id: Math.random().toString(36).slice(2, 10),
                    filename: item.file.name,
                    fileSize: item.file.size,
                    type: item.type,
                    status: 'uploading' as const,
                    progress: 0,
                }));

                set(state => ({ uploadQueue: [...state.uploadQueue, ...queueItems] }));

                const updateItem = (id: string, updates: Partial<UploadQueueItem>) => {
                    set(state => ({
                        uploadQueue: state.uploadQueue.map(q =>
                            q.id === id ? { ...q, ...updates } : q
                        ),
                    }));
                };

                const promises = items.map((item, i) => {
                    const id = queueItems[i].id;
                    return uploadFileXHR(
                        item.file,
                        item.type,
                        item.additionalContext || undefined,
                        (pct) => updateItem(id, { progress: pct }),
                        () => updateItem(id, { status: 'parsing', progress: 100 }),
                    ).then(() => {
                        updateItem(id, { status: 'done', progress: 100 });
                    }).catch((err: unknown) => {
                        const msg = err instanceof Error ? err.message : 'Upload failed';
                        updateItem(id, { status: 'error', error: msg });
                    });
                });

                Promise.allSettled(promises).then(() => {
                    set({ uploadCompletedAt: Date.now() });
                });
            },

            clearCompletedUploads: () => {
                set(state => ({
                    uploadQueue: state.uploadQueue.filter(
                        q => q.status !== 'done' && q.status !== 'error'
                    ),
                }));
            },

        }),
        {
            name: 'wand-storage',
            partialize: (state) => ({ token: state.token, theme: state.theme, jobsFilter: state.jobsFilter, onboardingComplete: state.onboardingComplete }),
            onRehydrateStorage: () => (state) => {
                // When store hydrates from localStorage, sync token to api.ts
                if (state) {
                    // Recovery: If store has no token but localStorage does (e.g. from login redirect), use it
                    const rawToken = localStorage.getItem('token');
                    if (!state.token && rawToken) {
                        state.token = rawToken;
                    }

                    // Sync api.ts with store state and mark as authenticated if token exists
                    if (state.token) {
                        setToken(state.token);
                        state.isAuthenticated = true; // optimistic — fetchUser verifies on protected pages
                    } else {
                        clearToken();
                        state.isAuthenticated = false;
                    }

                    state.setHasHydrated(true);
                }
            },
        }
    )
);
