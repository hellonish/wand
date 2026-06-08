'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileFile, type ProfileFileType } from '@/utils/api';
import { useStore } from '@/utils/store';
import { useCareerDocs } from '@/hooks/useCareerDocs';

interface ManageDocumentsPanelProps {
    files: ProfileFile[];
    filesLoading?: boolean;
    onDelete: (fileId: string) => void;
    onEdit: (fileId: string, data: { file_type?: ProfileFileType; additional_context?: string }) => void;
    onPreview: (fileId: string) => void;
}

const CATEGORIES: Array<{
    type: ProfileFileType;
    label: string;
    description: string;
    hint: string;
    icon: React.ReactNode;
}> = [
    {
        type: 'resume',
        label: 'Resume',
        description: 'Your primary resume or CV. Used for line-by-line tailoring suggestions.',
        hint: 'PDF or DOCX recommended',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
            </svg>
        ),
    },
    {
        type: 'linkedin',
        label: 'LinkedIn',
        description: 'Export your LinkedIn profile to enrich your work history and connections.',
        hint: 'LinkedIn → More → Save to PDF',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6z" />
                <rect x="2" y="9" width="4" height="12" />
                <circle cx="4" cy="4" r="2" />
            </svg>
        ),
    },
    {
        type: 'other',
        label: 'Other',
        description: 'Certificates, references, cover letters, or anything else relevant.',
        hint: 'Any supported format',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <polyline points="13 2 13 9 20 9" />
            </svg>
        ),
    },
];

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function CategorySection({
    category, files, onDelete, onEdit, onPreview,
}: {
    category: typeof CATEGORIES[number];
    files: ProfileFile[];
    onDelete: (id: string) => void;
    onEdit: (id: string, data: { file_type?: ProfileFileType; additional_context?: string }) => void;
    onPreview: (id: string) => void;
}) {
    const enqueueUploads = useStore(s => s.enqueueUploads);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editType, setEditType] = useState<ProfileFileType>(category.type);
    const [editContext, setEditContext] = useState('');
    const [isDragging, setIsDragging] = useState(false);

    const handleFiles = useCallback((incoming: FileList | File[]) => {
        const arr = Array.from(incoming);
        enqueueUploads(arr.map(file => ({ file, type: category.type, additionalContext: '' })));
    }, [enqueueUploads, category.type]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    const startEdit = (f: ProfileFile) => {
        setEditingId(f.id);
        setEditType(f.file_type as ProfileFileType);
        setEditContext(f.additional_context || '');
    };

    const saveEdit = () => {
        if (!editingId) return;
        onEdit(editingId, { file_type: editType, additional_context: editContext });
        setEditingId(null);
    };

    return (
        <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
            onDrop={handleDrop}
            style={{
                borderRadius: 'var(--radius)',
                border: `1.5px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                background: isDragging ? 'var(--accent-soft)' : 'var(--surface)',
                overflow: 'hidden',
                transition: 'border-color 140ms, background 140ms',
            }}
        >
            {/* Category header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                background: isDragging ? 'transparent' : 'var(--bg-tint)',
                borderBottom: (files.length > 0 && !isDragging) ? '1px solid var(--border-soft)' : 'none',
            }}>
                <div style={{
                    width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-2)', flexShrink: 0,
                }}>
                    {category.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{category.label}</span>
                        {files.length > 0 && (
                            <span style={{
                                fontSize: 11, fontWeight: 500,
                                background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                                padding: '1px 6px', borderRadius: 999,
                            }}>{files.length}</span>
                        )}
                        <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginLeft: 2 }}>{category.description}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                        {isDragging ? `Drop to upload as ${category.label}` : category.hint}
                    </div>
                </div>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--text-2)',
                        cursor: 'pointer', flexShrink: 0,
                        transition: 'all 140ms',
                    }}
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Upload
                </button>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.html,.htm,.txt,.doc,.docx"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = ''; } }}
            />

            {/* File list */}
            {files.length > 0 && !isDragging && (
                <div>
                    {files.map((f, i) => {
                        const ext = f.filename.split('.').pop()?.toUpperCase() ?? '—';
                        const isParsed = !!f.parsed_data;
                        const isEditing = editingId === f.id;
                        const isLast = i === files.length - 1;

                        return (
                            <div key={f.id} style={{
                                display: 'grid', gridTemplateColumns: '28px 1fr auto',
                                gap: 10, alignItems: 'center',
                                padding: '10px 16px',
                                borderBottom: isLast ? 'none' : '1px solid var(--border-soft)',
                            }}>
                                <div style={{
                                    width: 26, height: 32, borderRadius: 'var(--radius-xs)',
                                    background: 'var(--bg-tint)', border: '1px solid var(--border-soft)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: 'var(--font-mono)', fontSize: 8.5, color: 'var(--text-3)', fontWeight: 600,
                                }}>{ext}</div>

                                <div style={{ minWidth: 0 }}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                            <select
                                                value={editType}
                                                onChange={e => setEditType(e.target.value as ProfileFileType)}
                                                style={{ height: 26, padding: '0 6px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
                                            >
                                                <option value="resume">Resume</option>
                                                <option value="linkedin">LinkedIn</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <input
                                                type="text"
                                                value={editContext}
                                                onChange={e => setEditContext(e.target.value)}
                                                placeholder="Add a note (optional)"
                                                style={{ height: 26, padding: '0 8px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
                                            />
                                            <div style={{ display: 'flex', gap: 5 }}>
                                                <button onClick={saveEdit} style={{ height: 24, padding: '0 8px', fontSize: 11.5, fontWeight: 500, borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer' }}>Save</button>
                                                <button onClick={() => setEditingId(null)} style={{ height: 24, padding: '0 8px', fontSize: 11.5, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--text-3)', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                                                <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                                                    {f.filename}
                                                </span>
                                                <span style={{
                                                    height: 18, padding: '0 5px', display: 'inline-flex', alignItems: 'center',
                                                    fontSize: 10, fontWeight: 500, flexShrink: 0,
                                                    background: isParsed ? 'var(--strong-soft)' : 'var(--partial-soft)',
                                                    color: isParsed ? 'var(--strong)' : 'var(--partial)',
                                                    borderRadius: 'var(--radius-xs)',
                                                }}>
                                                    {isParsed ? 'parsed' : <span className="wand-pulse">parsing</span>}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                                                {formatFileSize(f.file_size)}
                                                {f.additional_context && ` · ${f.additional_context}`}
                                            </div>
                                        </>
                                    )}
                                </div>

                                {!isEditing && (
                                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                        <button
                                            onClick={() => onPreview(f.id)}
                                            title="Download"
                                            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                                <polyline points="15 3 21 3 21 9" />
                                                <line x1="10" y1="14" x2="21" y2="3" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => startEdit(f)}
                                            title="Edit"
                                            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => onDelete(f.id)}
                                            title="Delete"
                                            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--weak)' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                                <path d="M10 11v6M14 11v6" />
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty nudge */}
            {files.length === 0 && !isDragging && (
                <div
                    style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    No files yet — click Upload or drop files here
                </div>
            )}
        </div>
    );
}

function CareerContextCategory() {
    const router = useRouter();
    const { docs, deleteDoc } = useCareerDocs();
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const handleNew = () => router.push('/profile/career-context/new');
    const handleOpen = (id: string) => router.push(`/profile/career-context/${id}`);

    const timeAgo = (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    };

    return (
        <div style={{
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            background: 'var(--surface)', overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                background: 'var(--bg-tint)',
                borderBottom: docs.length > 0 ? '1px solid var(--border-soft)' : 'none',
            }}>
                <div style={{
                    width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--text-2)', flexShrink: 0,
                }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>Career Context</span>
                        {docs.length > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 500, background: 'var(--accent-soft)', color: 'var(--accent-ink)', padding: '1px 6px', borderRadius: 999 }}>
                                {docs.length}
                            </span>
                        )}
                        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Notes and context Hopper uses to understand you</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                        Created on platform · supports Markdown
                    </div>
                </div>
                <button
                    onClick={handleNew}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', color: 'var(--text-2)',
                        cursor: 'pointer', flexShrink: 0,
                    }}
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New document
                </button>
            </div>

            {/* Doc list */}
            {docs.length > 0 && (
                <div>
                    {docs.map((doc, i) => {
                        const isLast = i === docs.length - 1;
                        const wordCount = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;

                        return (
                            <div key={doc.id} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 16px',
                                borderBottom: isLast ? 'none' : '1px solid var(--border-soft)',
                                cursor: 'pointer',
                            }}>
                                {/* Doc icon */}
                                <div style={{
                                    width: 26, height: 32, borderRadius: 'var(--radius-xs)',
                                    background: 'var(--accent-soft)', border: '1px solid transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'var(--accent-ink)', flexShrink: 0,
                                }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                                        <polyline points="14 2 14 8 20 8"/>
                                        <line x1="16" y1="13" x2="8" y2="13"/>
                                        <line x1="16" y1="17" x2="8" y2="17"/>
                                    </svg>
                                </div>

                                {/* Info */}
                                <div style={{ flex: 1, minWidth: 0 }} onClick={() => handleOpen(doc.id)}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {doc.title || 'Untitled'}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                                        {wordCount > 0 ? `${wordCount}w · ` : ''}{timeAgo(doc.updatedAt)}
                                    </div>
                                </div>

                                {/* Actions */}
                                {confirmDelete === doc.id ? (
                                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                                        <button onClick={() => { deleteDoc(doc.id); setConfirmDelete(null); }} style={{ height: 24, padding: '0 8px', fontSize: 11.5, fontWeight: 500, border: '1px solid var(--weak)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--weak)', cursor: 'pointer' }}>Delete</button>
                                        <button onClick={() => setConfirmDelete(null)} style={{ height: 24, padding: '0 8px', fontSize: 11.5, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}>Cancel</button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                        <button
                                            onClick={() => handleOpen(doc.id)}
                                            title="Open"
                                            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => setConfirmDelete(doc.id)}
                                            title="Delete"
                                            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--weak)' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                <polyline points="3 6 5 6 21 6"/>
                                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                                                <path d="M10 11v6M14 11v6"/>
                                            </svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty nudge */}
            {docs.length === 0 && (
                <div
                    onClick={handleNew}
                    style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Create your first career context document
                </div>
            )}
        </div>
    );
}

export default function ManageDocumentsPanel({
    files, filesLoading, onDelete, onEdit, onPreview,
}: ManageDocumentsPanelProps) {
    const filesByType = (type: ProfileFileType) => files.filter(f => f.file_type === type);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filesLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: 'var(--text-3)', fontSize: 12.5 }}>
                    <div className="wand-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', flexShrink: 0 }} />
                    Loading your documents…
                </div>
            )}

            {/* Upload categories */}
            {CATEGORIES.map(cat => (
                <CategorySection
                    key={cat.type}
                    category={cat}
                    files={filesByType(cat.type)}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onPreview={onPreview}
                />
            ))}

            {/* Career Context — platform-created docs */}
            <CareerContextCategory />
        </div>
    );
}
