'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, ProfileFileUploadResponse } from '@/utils/api';

interface PendingFile {
    file: File;
    type: string;
    additionalContext: string;
    status: 'pending' | 'uploading' | 'done' | 'error';
    error?: string;
    result?: ProfileFileUploadResponse;
}

const FILE_TYPE_OPTIONS = [
    { value: 'resume', label: 'Resume' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'portfolio', label: 'Portfolio' },
    { value: 'other', label: 'Other' },
];

function guessType(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('resume') || lower.includes('cv')) return 'resume';
    if (lower.includes('linkedin')) return 'linkedin';
    if (lower.includes('portfolio') || lower.endsWith('.html') || lower.endsWith('.htm')) return 'portfolio';
    return 'other';
}

interface FileUploadZoneProps {
    onUploadComplete: () => void;
}

export default function FileUploadZone({ onUploadComplete }: FileUploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [showPanel, setShowPanel] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback((fileList: FileList | File[]) => {
        const newFiles: PendingFile[] = Array.from(fileList).map(file => ({
            file,
            type: guessType(file.name),
            additionalContext: '',
            status: 'pending' as const,
        }));
        setPendingFiles(prev => [...prev, ...newFiles]);
        setShowPanel(true);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    }, [addFiles]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
            e.target.value = '';
        }
    }, [addFiles]);

    const updatePending = (index: number, updates: Partial<PendingFile>) => {
        setPendingFiles(prev => prev.map((f, i) => i === index ? { ...f, ...updates } : f));
    };

    const removePending = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const uploadAll = async () => {
        const indices = pendingFiles
            .map((f, i) => (f.status === 'pending' || f.status === 'error') ? i : -1)
            .filter(i => i >= 0);

        let successCount = 0;
        for (const i of indices) {
            const pf = pendingFiles[i];
            updatePending(i, { status: 'uploading', error: undefined });
            try {
                const result = await api.uploadProfileFileMulti(pf.file, pf.type, pf.additionalContext || undefined);
                updatePending(i, { status: 'done', result });
                successCount++;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Upload failed';
                updatePending(i, { status: 'error', error: msg });
            }
        }

        if (successCount === indices.length && indices.length > 0) {
            setTimeout(() => {
                setPendingFiles([]);
                setShowPanel(false);
                onUploadComplete();
            }, 500);
        }
    };

    const hasPending = pendingFiles.some(f => f.status === 'pending' || f.status === 'error');
    const isUploading = pendingFiles.some(f => f.status === 'uploading');
    const allDone = pendingFiles.length > 0 && pendingFiles.every(f => f.status === 'done');

    return (
        <div>
            <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className="rounded-lg p-6 text-center transition-colors cursor-pointer"
                style={{
                    border: `1.5px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                    background: isDragging ? 'var(--accent-dim)' : 'var(--card)',
                }}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".pdf,.html,.htm,.txt,.doc,.docx"
                    onChange={handleFileInput}
                />
                <div className="flex flex-col items-center gap-2">
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-3)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                    </svg>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                        Drop files here or click to upload
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                        PDF, HTML, TXT — multiple files supported
                    </p>
                </div>
            </div>

            <AnimatePresence>
                {showPanel && pendingFiles.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-3 rounded-lg p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                                    {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} to upload
                                </p>
                                <div className="flex gap-2">
                                    {!allDone && (
                                        <button
                                            onClick={uploadAll}
                                            disabled={!hasPending && !isUploading}
                                            className="text-xs px-3 py-1.5 rounded-md cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            style={{
                                                background: hasPending || isUploading ? 'var(--accent)' : 'var(--surface)',
                                                color: hasPending || isUploading ? '#fff' : 'var(--text-3)',
                                                border: '1px solid transparent',
                                            }}
                                        >
                                            {isUploading ? 'Uploading...' : 'Upload All'}
                                        </button>
                                    )}
                                    {allDone && (
                                        <span className="text-xs px-3 py-1.5" style={{ color: '#22c55e' }}>All uploaded!</span>
                                    )}
                                    <button
                                        onClick={() => { setPendingFiles([]); setShowPanel(false); }}
                                        className="text-xs px-2 py-1.5 rounded-md cursor-pointer"
                                        style={{ color: 'var(--text-3)', background: 'transparent', border: 'none' }}
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {pendingFiles.map((pf, i) => (
                                    <div
                                        key={`${pf.file.name}-${i}`}
                                        className="flex items-center gap-2 rounded-md p-2"
                                        style={{ background: 'var(--surface)' }}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>
                                                {pf.file.name}
                                            </p>
                                            <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                                {(pf.file.size / 1024).toFixed(1)} KB
                                            </p>
                                        </div>

                                        {pf.status === 'pending' && (
                                            <>
                                                <select
                                                    value={pf.type}
                                                    onChange={e => updatePending(i, { type: e.target.value })}
                                                    className="text-xs px-2 py-1 rounded-md"
                                                    style={{
                                                        background: 'var(--card)',
                                                        border: '1px solid var(--border)',
                                                        color: 'var(--text-1)',
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    {FILE_TYPE_OPTIONS.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="text"
                                                    value={pf.additionalContext}
                                                    onChange={e => updatePending(i, { additionalContext: e.target.value })}
                                                    placeholder="Notes..."
                                                    className="text-xs px-2 py-1 rounded-md w-24"
                                                    style={{
                                                        background: 'var(--card)',
                                                        border: '1px solid var(--border)',
                                                        color: 'var(--text-1)',
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                />
                                                <button
                                                    onClick={e => { e.stopPropagation(); removePending(i); }}
                                                    className="text-xs px-1.5 py-1 cursor-pointer"
                                                    style={{ color: '#f87171', background: 'transparent', border: 'none' }}
                                                >
                                                    ×
                                                </button>
                                            </>
                                        )}

                                        {pf.status === 'uploading' && (
                                            <div className="flex items-center gap-1">
                                                <div className="w-3 h-3 rounded-full animate-spin" style={{ border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
                                                <span className="text-xs" style={{ color: 'var(--text-3)' }}>Uploading</span>
                                            </div>
                                        )}

                                        {pf.status === 'done' && (
                                            <span className="text-xs" style={{ color: '#22c55e' }}>✓</span>
                                        )}

                                        {pf.status === 'error' && (
                                            <span className="text-xs" style={{ color: '#f87171' }}>Failed</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
