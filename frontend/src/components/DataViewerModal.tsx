'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface DataViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    data: unknown;
}

export default function DataViewerModal({ isOpen, onClose, title, data }: DataViewerModalProps) {
    // Close on escape key
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm transition-opacity"
                />

                {/* Modal */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-4xl max-h-[90vh] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--card-bg)]">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                            {title}
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                                    alert('Copied to clipboard!');
                                }}
                                title="Copy JSON"
                                style={{
                                    width: 32, height: 32, padding: 0,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: 'var(--radius)',
                                    color: 'var(--text-2)',
                                    transition: 'all 140ms ease',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; }}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                            </button>
                            <button
                                onClick={onClose}
                                style={{
                                    width: 32, height: 32, padding: 0,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: 'var(--radius)',
                                    color: 'var(--text-2)',
                                    transition: 'all 140ms ease',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)'; }}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-6 bg-[var(--bg-primary)]">
                        <pre className="text-sm font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                            {JSON.stringify(data, null, 2)}
                        </pre>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
