// localStorage-backed caches for profile and pipeline data.
// All reads/writes are no-ops during SSR (typeof window === 'undefined').

interface CacheEntry<T> {
    data: T;
    ts: number;
}

class LocalStorageCache<T> {
    private storageKey: string;
    private ttlMs: number;
    private maxEntries: number;

    constructor(storageKey: string, ttlMs: number, maxEntries = Infinity) {
        this.storageKey = storageKey;
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
    }

    private read(): Record<string, CacheEntry<T>> {
        if (typeof window === 'undefined') return {};
        try {
            return JSON.parse(localStorage.getItem(this.storageKey) || '{}');
        } catch {
            return {};
        }
    }

    private write(store: Record<string, CacheEntry<T>>) {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(store));
        } catch {
            // localStorage quota exceeded — clear this cache and retry once
            try {
                localStorage.removeItem(this.storageKey);
                localStorage.setItem(this.storageKey, JSON.stringify(store));
            } catch { /* give up */ }
        }
    }

    get(id: string): T | null {
        const store = this.read();
        const entry = store[id];
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            delete store[id];
            this.write(store);
            return null;
        }
        return entry.data;
    }

    set(id: string, data: T) {
        const store = this.read();
        store[id] = { data, ts: Date.now() };

        // LRU eviction when over capacity
        if (this.maxEntries !== Infinity) {
            const entries = Object.entries(store);
            if (entries.length > this.maxEntries) {
                entries.sort((a, b) => a[1].ts - b[1].ts);
                const excess = entries.slice(0, entries.length - this.maxEntries);
                for (const [k] of excess) delete store[k];
            }
        }

        this.write(store);
    }

    invalidate(id?: string) {
        if (id !== undefined) {
            const store = this.read();
            delete store[id];
            this.write(store);
        } else {
            if (typeof window !== 'undefined') localStorage.removeItem(this.storageKey);
        }
    }
}

// Unified profile — single entry, 5-minute TTL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const profileCache = new LocalStorageCache<any>('wand_profile_cache', 5 * 60 * 1000);

// JobLens sessions — LRU 20 entries, 10-minute TTL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const joblensCache = new LocalStorageCache<any>('wand_joblens_cache', 10 * 60 * 1000, 20);

// Cover letters list — single entry, 3-minute TTL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const coverLettersCache = new LocalStorageCache<any[]>('wand_cl_cache', 3 * 60 * 1000);
