'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/utils/store';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FloatingUploadTray() {
    const { uploadQueue, clearCompletedUploads } = useStore();
    const [minimized, setMinimized] = useState(false);
    const [visible, setVisible] = useState(false);

    const active = uploadQueue.filter(q => q.status === 'uploading' || q.status === 'parsing');
    const done = uploadQueue.filter(q => q.status === 'done');
    const errors = uploadQueue.filter(q => q.status === 'error');
    const allFinished = uploadQueue.length > 0 && active.length === 0;

    // Show tray as soon as something is in the queue
    useEffect(() => {
        if (uploadQueue.length > 0) setVisible(true);
    }, [uploadQueue.length]);

    // Auto-dismiss after everything finishes
    useEffect(() => {
        if (!allFinished) return;
        const timer = setTimeout(() => {
            setVisible(false);
            clearCompletedUploads();
        }, 3500);
        return () => clearTimeout(timer);
    }, [allFinished, clearCompletedUploads]);

    if (!visible || uploadQueue.length === 0) return null;

    const headerLabel = active.length > 0
        ? `Uploading ${active.length} file${active.length !== 1 ? 's' : ''}…`
        : errors.length > 0
            ? `${done.length} uploaded · ${errors.length} failed`
            : `${done.length} file${done.length !== 1 ? 's' : ''} uploaded`;

    return (
        <div
            style={{
                position: 'fixed',
                bottom: 20,
                right: 20,
                zIndex: 9999,
                width: minimized ? 'auto' : 300,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)',
                overflow: 'hidden',
                transition: 'width 200ms ease',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: minimized ? '9px 12px' : '10px 14px',
                    background: 'var(--bg-tint)',
                    borderBottom: minimized ? 'none' : '1px solid var(--border-soft)',
                    cursor: 'pointer',
                    gap: 10,
                }}
                onClick={() => setMinimized(v => !v)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    {active.length > 0 ? (
                        // Spinning indicator
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }}>
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                    ) : errors.length > 0 ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--weak)" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--strong)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    )}
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {headerLabel}
                    </span>
                </div>

                {/* Minimize / expand chevron */}
                <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"
                    style={{ flexShrink: 0, transform: minimized ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}
                >
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>

            {/* File list */}
            {!minimized && (
                <div style={{ maxHeight: 240, overflowY: 'auto', padding: '8px 14px 10px' }}>
                    {uploadQueue.map(item => (
                        <div key={item.id} style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                                <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                    {item.filename}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                                    {formatBytes(item.fileSize)}
                                </span>
                                {item.status === 'done' && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--strong)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                )}
                                {item.status === 'error' && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--weak)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                )}
                            </div>

                            {/* Progress bar — only for active items */}
                            {(item.status === 'uploading' || item.status === 'parsing') && (
                                <>
                                    <div style={{ height: 3, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
                                        {item.status === 'uploading' ? (
                                            <div style={{
                                                height: '100%', width: `${item.progress}%`,
                                                background: 'var(--accent)', borderRadius: 999,
                                                transition: 'width 120ms ease',
                                            }} />
                                        ) : (
                                            <div className="wand-shimmer" style={{ height: '100%', width: '60%' }} />
                                        )}
                                    </div>
                                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                                        {item.status === 'parsing' ? 'Parsing…' : `${item.progress}%`}
                                    </div>
                                </>
                            )}

                            {item.status === 'error' && item.error && (
                                <div style={{ fontSize: 11, color: 'var(--weak)', marginTop: 2 }}>{item.error}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
