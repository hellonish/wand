'use client';

import { useState, useEffect, useCallback } from 'react';

export interface CareerDoc {
    id: string;
    title: string;
    content: string; // stored as markdown
    createdAt: string;
    updatedAt: string;
}

const STORAGE_KEY = 'wand_career_docs';

function readDocs(): CareerDoc[] {
    if (typeof window === 'undefined') return [];
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function writeDocs(docs: CareerDoc[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

export function useCareerDocs() {
    const [docs, setDocs] = useState<CareerDoc[]>([]);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setDocs(readDocs());
        setHydrated(true);
    }, []);

    const createDoc = useCallback((title = 'Untitled'): CareerDoc => {
        const doc: CareerDoc = {
            id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
            title,
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const next = [doc, ...readDocs()];
        writeDocs(next);
        setDocs(next);
        return doc;
    }, []);

    const updateDoc = useCallback((id: string, changes: Partial<Pick<CareerDoc, 'title' | 'content'>>) => {
        const current = readDocs();
        const next = current.map(d =>
            d.id === id ? { ...d, ...changes, updatedAt: new Date().toISOString() } : d
        );
        writeDocs(next);
        setDocs(next);
    }, []);

    // Write to localStorage immediately without triggering a state update (no re-render).
    // Use this on every keystroke to ensure refreshing never loses unsaved content.
    const persistDoc = useCallback((id: string, changes: Partial<Pick<CareerDoc, 'title' | 'content'>>) => {
        const current = readDocs();
        const next = current.map(d =>
            d.id === id ? { ...d, ...changes, updatedAt: new Date().toISOString() } : d
        );
        writeDocs(next);
    }, []);

    const deleteDoc = useCallback((id: string) => {
        const next = readDocs().filter(d => d.id !== id);
        writeDocs(next);
        setDocs(next);
    }, []);

    const getDoc = useCallback((id: string): CareerDoc | undefined => {
        return readDocs().find(d => d.id === id);
    }, []);

    return { docs, hydrated, createDoc, updateDoc, persistDoc, deleteDoc, getDoc };
}
