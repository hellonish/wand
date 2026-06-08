'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ProfileFile, type ProfileFileType } from '@/utils/api';

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ProfileFileListProps {
    files: ProfileFile[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    onDelete: (fileId: string) => void;
    onEdit: (fileId: string, data: { file_type?: ProfileFileType; additional_context?: string }) => void;
    onPreview: (fileId: string) => void;
    onViewData: (title: string, data: unknown) => void;
}

export default function ProfileFileList({
    files, total, page, pageSize, totalPages,
    onPageChange, onPageSizeChange, onDelete, onEdit, onPreview, onViewData,
}: ProfileFileListProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editType, setEditType] = useState<ProfileFileType>('other');
    const [editContext, setEditContext] = useState('');
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
    const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    // Close on scroll so the menu doesn't drift away from its anchor
    useEffect(() => {
        if (!openMenuId) return;
        const close = () => setOpenMenuId(null);
        window.addEventListener('scroll', close, true);
        return () => window.removeEventListener('scroll', close, true);
    }, [openMenuId]);

    const openMenu = (id: string) => {
        const btn = btnRefs.current[id];
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        setMenuPos({
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right,
        });
        setOpenMenuId(id);
    };

    const startEdit = (f: ProfileFile) => {
        setEditingId(f.id);
        setEditType(f.file_type);
        setEditContext(f.additional_context || '');
        setOpenMenuId(null);
    };

    const saveEdit = () => {
        if (!editingId) return;
        onEdit(editingId, { file_type: editType, additional_context: editContext });
        setEditingId(null);
    };

    if (files.length === 0) {
        return (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No files uploaded yet. Upload your first file above.</p>
            </div>
        );
    }

    return (
        <div>
            {files.map((f, i) => {
                const ext = f.filename.split('.').pop()?.toUpperCase() ?? '—';
                const isEditing = editingId === f.id;
                const isLast = i === files.length - 1;
                const isParsed = !!f.parsed_data;

                return (
                    <div
                        key={f.id}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '34px 1fr auto',
                            gap: 12,
                            alignItems: 'center',
                            padding: '12px 14px',
                            borderBottom: isLast ? 'none' : '1px solid var(--border-soft)',
                            position: 'relative',
                        }}
                    >
                        {/* File type icon */}
                        <div style={{
                            width: 30, height: 36, borderRadius: 'var(--radius-xs)',
                            background: 'var(--bg-tint)', border: '1px solid var(--border-soft)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-2)', fontWeight: 600,
                            flexShrink: 0,
                        }}>
                            {ext}
                        </div>

                        {/* Main info */}
                        <div style={{ minWidth: 0 }}>
                            {isEditing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                                        placeholder="Context…"
                                        style={{ height: 26, padding: '0 8px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
                                    />
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                                            {f.filename}
                                        </span>
                                        {/* Type pill */}
                                        <span style={{
                                            height: 20, padding: '0 7px', display: 'inline-flex', alignItems: 'center',
                                            fontSize: 10.5, fontWeight: 500,
                                            border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
                                            color: 'var(--text-3)', background: 'transparent', flexShrink: 0,
                                        }}>
                                            {f.file_type}
                                        </span>
                                        {/* Parsed pill */}
                                        {isParsed ? (
                                            <span style={{
                                                height: 20, padding: '0 7px', display: 'inline-flex', alignItems: 'center',
                                                fontSize: 10.5, fontWeight: 500, flexShrink: 0,
                                                background: 'var(--strong-soft)', color: 'var(--strong)',
                                                borderRadius: 'var(--radius-xs)',
                                            }}>
                                                parsed
                                            </span>
                                        ) : (
                                            <span style={{
                                                height: 20, padding: '0 7px', display: 'inline-flex', alignItems: 'center',
                                                fontSize: 10.5, fontWeight: 500, flexShrink: 0,
                                                background: 'var(--partial-soft)', color: 'var(--partial)',
                                                borderRadius: 'var(--radius-xs)',
                                            }}>
                                                <span className="wand-pulse">parsing</span>
                                            </span>
                                        )}
                                    </div>
                                    {f.additional_context && (
                                        <div style={{ fontSize: 11.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {f.additional_context}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            {isEditing ? (
                                <>
                                    <button
                                        onClick={saveEdit}
                                        style={{ height: 26, padding: '0 10px', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid transparent', cursor: 'pointer' }}
                                    >Save</button>
                                    <button
                                        onClick={() => setEditingId(null)}
                                        style={{ height: 26, padding: '0 8px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--text-3)', background: 'transparent', cursor: 'pointer' }}
                                    >Cancel</button>
                                </>
                            ) : (
                                <>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', marginRight: 4 }}>
                                        {formatFileSize(f.file_size)}
                                    </span>
                                    {/* Preview */}
                                    <button
                                        onClick={() => onPreview(f.id)}
                                        title="Preview"
                                        style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                    </button>
                                    {/* Kebab menu */}
                                    <button
                                        ref={el => { btnRefs.current[f.id] = el; }}
                                        onClick={() => openMenuId === f.id ? setOpenMenuId(null) : openMenu(f.id)}
                                        style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-soft)', background: openMenuId === f.id ? 'var(--bg-tint)' : 'transparent', cursor: 'pointer', color: 'var(--text-3)' }}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                                        </svg>
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Kebab dropdown — rendered in a portal so it escapes overflow:hidden parents */}
            {openMenuId && menuPos && typeof document !== 'undefined' && createPortal(
                <>
                    <div onClick={() => setOpenMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
                    <div style={{
                        position: 'fixed',
                        top: menuPos.top,
                        right: menuPos.right,
                        zIndex: 1001,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        boxShadow: 'var(--shadow-2)',
                        minWidth: 168,
                        overflow: 'hidden',
                    }}>
                        {(() => {
                            const f = files.find(x => x.id === openMenuId);
                            if (!f) return null;
                            const isParsed = !!f.parsed_data;
                            return (
                                <>
                                    <MenuItem onClick={() => startEdit(f)}>Edit context</MenuItem>
                                    {isParsed && (
                                        <MenuItem onClick={() => { onViewData(f.filename, f.parsed_data); setOpenMenuId(null); }}>
                                            View extracted data
                                        </MenuItem>
                                    )}
                                    <MenuItem onClick={() => { onPreview(f.id); setOpenMenuId(null); }}>Download</MenuItem>
                                    <MenuItem danger onClick={() => { onDelete(f.id); setOpenMenuId(null); }}>Delete</MenuItem>
                                </>
                            );
                        })()}
                    </div>
                </>,
                document.body,
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--border-soft)' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                        {page} / {totalPages} ({total} files)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                            value={pageSize}
                            onChange={e => onPageSizeChange(Number(e.target.value))}
                            style={{ height: 26, padding: '0 6px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer' }}
                        >
                            <option value={4}>4 / page</option>
                            <option value={8}>8 / page</option>
                            <option value={12}>12 / page</option>
                        </select>
                        <button
                            onClick={() => onPageChange(page - 1)}
                            disabled={page <= 1}
                            style={{ height: 26, padding: '0 10px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, transition: 'all 140ms' }}
                        >←</button>
                        <button
                            onClick={() => onPageChange(page + 1)}
                            disabled={page >= totalPages}
                            style={{ height: 26, padding: '0 10px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, transition: 'all 140ms' }}
                        >→</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 14px', fontSize: 12.5, cursor: 'pointer',
                background: hovered ? 'var(--bg-tint)' : 'transparent',
                color: danger ? 'var(--weak)' : 'var(--text)',
                border: 'none', borderBottom: '1px solid var(--border-soft)',
                transition: 'background 120ms',
            }}
        >
            {children}
        </button>
    );
}
