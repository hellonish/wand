'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import Header from '@/components/Header';
import CareerContextEditor from '@/components/CareerContextEditor';
import { useCareerDocs, CareerDoc } from '@/hooks/useCareerDocs';

function timeAgo(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export default function CareerContextDocPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const isNew = id === 'new';

    const { isAuthenticated, _hasHydrated } = useStore();
    const { createDoc, updateDoc, persistDoc, deleteDoc, getDoc, hydrated } = useCareerDocs();

    const [doc, setDoc] = useState<CareerDoc | null>(null);
    const [title, setTitle] = useState('Untitled');
    const [content, setContent] = useState('');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<string | null>(null);
    const [showDelete, setShowDelete] = useState(false);
    const docIdRef = useRef<string | null>(isNew ? null : id);
    const titleRef = useRef(title);
    titleRef.current = title;

    // Redirect if not authenticated
    useEffect(() => {
        if (_hasHydrated && !isAuthenticated) router.push('/');
    }, [_hasHydrated, isAuthenticated, router]);

    // Load or create doc once localStorage is ready
    useEffect(() => {
        if (!hydrated) return;

        if (isNew) {
            // Create immediately so we have an ID to update
            const newDoc = createDoc('Untitled');
            docIdRef.current = newDoc.id;
            setDoc(newDoc);
            setTitle(newDoc.title);
            setContent(newDoc.content);
            // Replace URL so back-nav works correctly
            router.replace(`/profile/career-context/${newDoc.id}`);
        } else {
            const existing = getDoc(id);
            if (!existing) {
                router.replace('/profile');
                return;
            }
            docIdRef.current = existing.id;
            setDoc(existing);
            setTitle(existing.title);
            setContent(existing.content);
            if (existing.updatedAt) setLastSaved(existing.updatedAt);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hydrated]);

    const handleSave = useCallback(() => {
        const docId = docIdRef.current;
        if (!docId) return;
        setSaving(true);
        updateDoc(docId, { title: titleRef.current, content });
        setLastSaved(new Date().toISOString());
        setSaved(true);
        setSaving(false);
        setTimeout(() => setSaved(false), 2500);
    }, [content, updateDoc]);

    // Keyboard save
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleSave]);

    // Persist to localStorage immediately on every change (crash-safe, no re-render)
    useEffect(() => {
        if (!docIdRef.current || !hydrated || !doc) return;
        persistDoc(docIdRef.current, { title: titleRef.current, content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, title]);

    // Debounced state sync + "last saved" UI indicator (2s)
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!docIdRef.current || !hydrated || !doc) return;
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
            updateDoc(docIdRef.current!, { title: titleRef.current, content });
            setLastSaved(new Date().toISOString());
        }, 2000);
        return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, title]);

    const handleDelete = () => {
        if (!docIdRef.current) return;
        deleteDoc(docIdRef.current);
        router.push('/profile');
    };

    if (!_hasHydrated || !isAuthenticated || !hydrated) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
                <Header />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
                    <div className="wand-spin" style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
                </div>
            </div>
        );
    }

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
            <Header />

            {/* Top bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 24px',
                borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                {/* Back */}
                <button
                    onClick={() => { handleSave(); router.push('/profile?docs=1'); }}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        height: 32, padding: '0 10px', fontSize: 13, fontWeight: 500,
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface)', color: 'var(--text-2)',
                        cursor: 'pointer', flexShrink: 0,
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Profile
                </button>

                {/* Title */}
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={handleSave}
                    placeholder="Untitled"
                    style={{
                        flex: 1, minWidth: 0,
                        fontFamily: 'var(--font-display)',
                        fontSize: 'calc(var(--display-scale, 0.92) * 18px)',
                        fontWeight: 500, color: 'var(--text)',
                        letterSpacing: '-0.01em',
                        background: 'transparent', border: 'none', outline: 'none',
                        padding: '2px 4px',
                        borderRadius: 'var(--radius-xs)',
                    }}
                />

                {/* Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {lastSaved && (
                        <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                            {saved ? '✓ Saved' : `Saved ${timeAgo(lastSaved)}`}
                        </span>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500,
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                            background: saved ? 'var(--strong-soft)' : 'var(--surface)',
                            color: saved ? 'var(--strong)' : 'var(--text)',
                            cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 140ms',
                        }}
                    >
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                    </button>

                    {/* Delete */}
                    {!isNew && (
                        showDelete ? (
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Delete this doc?</span>
                                <button onClick={handleDelete} style={{ height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500, border: '1px solid var(--weak)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--weak)', cursor: 'pointer' }}>Yes, delete</button>
                                <button onClick={() => setShowDelete(false)} style={{ height: 28, padding: '0 10px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>Cancel</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowDelete(true)}
                                title="Delete document"
                                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                                    <path d="M10 11v6M14 11v6"/>
                                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                </svg>
                            </button>
                        )
                    )}
                </div>
            </div>

            {/* Editor — full page, centered document width */}
            <div style={{ flex: 1, maxWidth: 760, width: '100%', margin: '0 auto', padding: '0 24px' }}>
                <CareerContextEditor
                    value={content}
                    onChange={setContent}
                    placeholder="Start writing…&#10;&#10;Paste any Markdown and it formats automatically."
                    fullPage
                />
            </div>
        </main>
    );
}
