'use client';

import { useState, useRef, useCallback } from 'react';
import { type ProfileFileType } from '@/utils/api';
import { useStore } from '@/utils/store';

interface StagedFile {
    file: File;
    type: ProfileFileType;
    additionalContext: string;
    sizeError?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const FILE_TYPE_OPTIONS: Array<{ value: ProfileFileType; label: string }> = [
    { value: 'resume', label: 'Resume' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'other', label: 'Other' },
];

function guessType(filename: string): ProfileFileType {
    const lower = filename.toLowerCase();
    if (lower.includes('resume') || lower.includes('cv')) return 'resume';
    if (lower.includes('linkedin')) return 'linkedin';
    return 'other';
}

interface FileUploadZoneProps {
    triggerId?: string;
}

export default function FileUploadZone({ triggerId }: FileUploadZoneProps) {
    const enqueueUploads = useStore(s => s.enqueueUploads);

    const [isDragging, setIsDragging] = useState(false);
    const [staged, setStaged] = useState<StagedFile[]>([]);
    const [showPanel, setShowPanel] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addFiles = useCallback((fileList: FileList | File[]) => {
        const incoming: StagedFile[] = Array.from(fileList).map(file => ({
            file,
            type: guessType(file.name),
            additionalContext: '',
            sizeError: file.size > MAX_FILE_SIZE
                ? `Too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`
                : undefined,
        }));
        setStaged(prev => [...prev, ...incoming]);
        setShowPanel(true);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    }, [addFiles]);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            addFiles(e.target.files);
            e.target.value = '';
        }
    }, [addFiles]);

    const updateStaged = (index: number, updates: Partial<StagedFile>) => {
        setStaged(prev => prev.map((f, i) => i === index ? { ...f, ...updates } : f));
    };

    const removeStaged = (index: number) => {
        setStaged(prev => prev.filter((_, i) => i !== index));
    };

    const handleUploadAll = () => {
        const valid = staged.filter(f => !f.sizeError);
        if (!valid.length) return;
        enqueueUploads(valid);
        setStaged([]);
        setShowPanel(false);
    };

    const hasStageable = staged.some(f => !f.sizeError);

    return (
        <div>
            <input
                ref={fileInputRef}
                id={triggerId}
                type="file"
                style={{ display: 'none' }}
                multiple
                accept=".pdf,.txt,.doc,.docx"
                onChange={handleFileInput}
            />

            {/* Drop zone */}
            <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                    padding: '20px 18px',
                    border: `1.5px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    background: isDragging ? 'var(--accent-soft)' : 'var(--bg-tint)',
                    display: 'flex', alignItems: 'center', gap: 14,
                    transition: 'all 140ms',
                    cursor: 'pointer',
                }}
            >
                <div style={{
                    width: 36, height: 36, borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent)', flexShrink: 0,
                }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Drop files to upload, or click to select</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>PDF, DOCX, TXT · max 10 MB per file</div>
                </div>
                <div style={{ display: 'flex', gap: 5 }} onClick={e => e.stopPropagation()}>
                    {['Resume', 'LinkedIn', 'Other'].map(t => (
                        <span key={t} style={{
                            display: 'inline-flex', alignItems: 'center',
                            height: 22, padding: '0 8px', fontSize: 11, fontWeight: 500,
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-3)', background: 'transparent',
                        }}>{t}</span>
                    ))}
                </div>
            </div>

            {/* Staging panel */}
            {showPanel && staged.length > 0 && (
                <div style={{ marginTop: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                            {staged.length} file{staged.length !== 1 ? 's' : ''} ready
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button
                                onClick={handleUploadAll}
                                disabled={!hasStageable}
                                style={{
                                    height: 28, padding: '0 10px', fontSize: 12.5, fontWeight: 500,
                                    borderRadius: 'var(--radius-sm)',
                                    background: hasStageable ? 'var(--btn-primary)' : 'var(--surface-2)',
                                    color: hasStageable ? 'var(--on-btn-primary)' : 'var(--text-3)',
                                    border: '1px solid transparent',
                                    cursor: hasStageable ? 'pointer' : 'not-allowed',
                                    opacity: hasStageable ? 1 : 0.5,
                                    transition: 'all 140ms',
                                }}
                            >
                                Upload all
                            </button>
                            <button
                                onClick={() => { setStaged([]); setShowPanel(false); }}
                                style={{ fontSize: 12, color: 'var(--text-3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px' }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                        {staged.map((sf, i) => (
                            <div
                                key={`${sf.file.name}-${i}`}
                                style={{
                                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                                    background: sf.sizeError ? 'rgba(239,68,68,0.05)' : 'var(--bg-tint)',
                                    border: `1px solid ${sf.sizeError ? 'rgba(239,68,68,0.3)' : 'var(--border-soft)'}`,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {sf.file.name}
                                        </div>
                                        <div style={{ fontSize: 11.5, color: sf.sizeError ? 'var(--weak)' : 'var(--text-3)' }}>
                                            {sf.sizeError ?? `${(sf.file.size / 1024).toFixed(1)} KB`}
                                        </div>
                                    </div>
                                    {!sf.sizeError && (
                                        <>
                                            <select
                                                value={sf.type}
                                                onChange={e => updateStaged(i, { type: e.target.value as ProfileFileType })}
                                                onClick={e => e.stopPropagation()}
                                                style={{ height: 26, padding: '0 6px', fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
                                            >
                                                {FILE_TYPE_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="text"
                                                value={sf.additionalContext}
                                                onChange={e => updateStaged(i, { additionalContext: e.target.value })}
                                                placeholder="Notes"
                                                onClick={e => e.stopPropagation()}
                                                style={{ height: 26, padding: '0 8px', width: 100, fontSize: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none' }}
                                            />
                                        </>
                                    )}
                                    <button
                                        onClick={() => removeStaged(i)}
                                        style={{ fontSize: 14, color: 'var(--weak)', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                                    >×</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 10, marginBottom: 0 }}>
                        Uploads run in the background — you can freely navigate while they complete.
                    </p>
                </div>
            )}
        </div>
    );
}
