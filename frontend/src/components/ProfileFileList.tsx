'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ProfileFile } from '@/utils/api';

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    resume: { bg: 'rgba(59,130,246,0.08)', text: '#3b82f6', border: 'rgba(59,130,246,0.2)' },
    linkedin: { bg: 'rgba(6,182,212,0.08)', text: '#06b6d4', border: 'rgba(6,182,212,0.2)' },
    portfolio: { bg: 'rgba(168,85,247,0.08)', text: '#a855f7', border: 'rgba(168,85,247,0.2)' },
    other: { bg: 'var(--surface)', text: 'var(--text-3)', border: 'var(--border)' },
};

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
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
    onEdit: (fileId: string, data: { file_type?: string; additional_context?: string }) => void;
    onPreview: (fileId: string) => void;
    onViewData: (title: string, data: unknown) => void;
}

export default function ProfileFileList({
    files, total, page, pageSize, totalPages,
    onPageChange, onPageSizeChange, onDelete, onEdit, onPreview, onViewData,
}: ProfileFileListProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editType, setEditType] = useState('');
    const [editContext, setEditContext] = useState('');
    const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

    const startEdit = (f: ProfileFile) => {
        setEditingId(f.id);
        setEditType(f.file_type);
        setEditContext(f.additional_context || '');
    };

    const saveEdit = () => {
        if (!editingId) return;
        onEdit(editingId, { file_type: editType, additional_context: editContext });
        setEditingId(null);
    };

    if (files.length === 0) {
        return (
            <div className="rounded-lg p-8 text-center" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                <p className="text-sm" style={{ color: 'var(--text-3)' }}>No files uploaded yet. Upload your first file above.</p>
            </div>
        );
    }

    return (
        <div>
            <AnimatePresence mode="wait">
                <motion.div
                    key={page}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2"
                >
                    {files.map((f) => {
                        const tc = TYPE_COLORS[f.file_type] || TYPE_COLORS.other;
                        const isEditing = editingId === f.id;

                        return (
                            <div
                                key={f.id}
                                className="rounded-lg p-3 flex items-center gap-3"
                                style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
                                            {f.filename}
                                        </span>
                                        <span
                                            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                                            style={{ background: tc.bg, color: tc.text, border: `1px solid ${tc.border}` }}
                                        >
                                            {f.file_type}
                                        </span>
                                        {f.parsed_data && (
                                            <span
                                                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                                                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                                            >
                                                Parsed
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-3)' }}>
                                        <span>{formatFileSize(f.file_size)}</span>
                                        <span>{formatDate(f.created_at)}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {isEditing ? (
                                        <>
                                            <select
                                                value={editType}
                                                onChange={e => setEditType(e.target.value)}
                                                className="text-xs px-2 py-1 rounded-md"
                                                style={{
                                                    background: 'var(--surface)',
                                                    border: '1px solid var(--border)',
                                                    color: 'var(--text-1)',
                                                }}
                                            >
                                                <option value="resume">Resume</option>
                                                <option value="linkedin">LinkedIn</option>
                                                <option value="portfolio">Portfolio</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <input
                                                type="text"
                                                value={editContext}
                                                onChange={e => setEditContext(e.target.value)}
                                                placeholder="Context..."
                                                className="text-xs px-2 py-1 rounded-md w-28"
                                                style={{
                                                    background: 'var(--surface)',
                                                    border: '1px solid var(--border)',
                                                    color: 'var(--text-1)',
                                                }}
                                            />
                                            <button
                                                onClick={saveEdit}
                                                className="text-xs px-2 py-1 rounded-md cursor-pointer"
                                                style={{
                                                    background: 'var(--accent-dim)',
                                                    color: 'var(--accent)',
                                                    border: '1px solid var(--accent-border)',
                                                }}
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={() => setEditingId(null)}
                                                className="text-xs px-2 py-1 rounded-md cursor-pointer"
                                                style={{ border: '1px solid var(--border)', color: 'var(--text-3)', background: 'transparent' }}
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <ActionButton
                                                label="Preview"
                                                id={`preview-${f.id}`}
                                                hoveredBtn={hoveredBtn}
                                                setHoveredBtn={setHoveredBtn}
                                                onClick={() => onPreview(f.id)}
                                            />
                                            {f.parsed_data && (
                                                <ActionButton
                                                    label="View Data"
                                                    id={`data-${f.id}`}
                                                    hoveredBtn={hoveredBtn}
                                                    setHoveredBtn={setHoveredBtn}
                                                    onClick={() => onViewData(f.filename, f.parsed_data)}
                                                />
                                            )}
                                            <ActionButton
                                                label="Edit"
                                                id={`edit-${f.id}`}
                                                hoveredBtn={hoveredBtn}
                                                setHoveredBtn={setHoveredBtn}
                                                onClick={() => startEdit(f)}
                                            />
                                            <button
                                                onClick={() => onDelete(f.id)}
                                                className="px-2 py-1 text-xs rounded-md cursor-pointer transition-colors"
                                                style={{ border: '1px solid transparent', color: '#f87171', background: 'rgba(239,68,68,0.08)' }}
                                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.15)'; }}
                                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
                                            >
                                                Remove
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                        Page {page} of {totalPages} ({total} file{total !== 1 ? 's' : ''})
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={pageSize}
                        onChange={e => onPageSizeChange(Number(e.target.value))}
                        className="text-xs px-2 py-1 rounded-md"
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-2)',
                        }}
                    >
                        <option value={4}>4 per page</option>
                        <option value={8}>8 per page</option>
                        <option value={12}>12 per page</option>
                    </select>
                    <button
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                        className="text-xs px-3 py-1.5 rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent' }}
                        onMouseEnter={e => { if (page > 1) (e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                        Previous
                    </button>
                    <button
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= totalPages}
                        className="text-xs px-3 py-1.5 rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'transparent' }}
                        onMouseEnter={e => { if (page < totalPages) (e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}

function ActionButton({ label, id, hoveredBtn, setHoveredBtn, onClick }: {
    label: string;
    id: string;
    hoveredBtn: string | null;
    setHoveredBtn: (id: string | null) => void;
    onClick: () => void;
}) {
    const isHovered = hoveredBtn === id;
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHoveredBtn(id)}
            onMouseLeave={() => setHoveredBtn(null)}
            className="text-xs px-2 py-1 rounded-md cursor-pointer transition-colors"
            style={{
                border: '1px solid var(--border)',
                color: isHovered ? 'var(--text-1)' : 'var(--text-2)',
                background: 'transparent',
            }}
        >
            {label}
        </button>
    );
}
