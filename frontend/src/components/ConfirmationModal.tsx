'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
}

export default function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    isDestructive = false
}: ConfirmationModalProps) {
    const [mounted, setMounted] = useState(false);
    const [cancelHovered, setCancelHovered] = useState(false);
    const [confirmHovered, setConfirmHovered] = useState(false);
    const [confirmWorking, setConfirmWorking] = useState(false);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    if (!mounted) return null;

    const confirmStyle: React.CSSProperties = isDestructive
        ? {
            background: confirmHovered ? 'var(--danger-dim)' : 'transparent',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
        }
        : {
            background: confirmHovered ? 'var(--accent-dim)' : 'var(--accent-dim)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
        };

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[9999]"
                        style={{ background: 'var(--overlay)' }}
                    />

                    {/* Modal */}
                    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            className="pointer-events-auto w-full overflow-hidden"
                            style={{
                                background: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '10px',
                                maxWidth: '360px',
                            }}
                        >
                            {/* Content */}
                            <div className="px-5 pt-5 pb-4">
                                <h3
                                    className="text-base font-medium"
                                    style={{ color: 'var(--text-1)' }}
                                >
                                    {title}
                                </h3>
                                <p
                                    className="text-sm leading-relaxed mt-1"
                                    style={{ color: 'var(--text-2)' }}
                                >
                                    {message}
                                </p>
                            </div>

                            {/* Footer */}
                            <div
                                className="flex justify-end gap-2 px-5 py-4"
                                style={{ borderTop: '1px solid var(--border)' }}
                            >
                                <button
                                    onClick={onClose}
                                    onMouseEnter={() => setCancelHovered(true)}
                                    onMouseLeave={() => setCancelHovered(false)}
                                    style={{
                                        height: 32,
                                        padding: '0 12px',
                                        fontSize: 13,
                                        fontWeight: 500,
                                        borderRadius: 'var(--radius-sm)',
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 140ms ease',
                                        color: cancelHovered ? 'var(--text-1)' : 'var(--text-2)',
                                        background: cancelHovered ? 'var(--hover)' : 'transparent',
                                    }}
                                >
                                    {cancelLabel}
                                </button>
                                <button
                                    type="button"
                                    disabled={confirmWorking}
                                    onClick={async () => {
                                        setConfirmWorking(true);
                                        try {
                                            await Promise.resolve(onConfirm());
                                            onClose();
                                        } catch {
                                            /* Caller may toast; keep modal open */
                                        } finally {
                                            setConfirmWorking(false);
                                        }
                                    }}
                                    onMouseEnter={() => setConfirmHovered(true)}
                                    onMouseLeave={() => setConfirmHovered(false)}
                                    style={{
                                        height: 32,
                                        padding: '0 12px',
                                        fontSize: 13,
                                        fontWeight: 500,
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: confirmWorking ? 'not-allowed' : 'pointer',
                                        opacity: confirmWorking ? 0.5 : 1,
                                        transition: 'all 140ms ease',
                                        ...confirmStyle,
                                    }}
                                >
                                    {confirmWorking ? '…' : confirmLabel}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>,
        document.body
    );
}
