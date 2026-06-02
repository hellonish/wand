'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { api, isApiError } from '@/utils/api';

export interface UpgradePromptState {
    open: boolean;
    kind: 'credits' | 'rate_limit' | 'past_due';
    needed?: number;
    balance?: number;
    retryAfter?: number;
}

interface UpgradePromptProps extends UpgradePromptState {
    onClose: () => void;
}

export default function UpgradePrompt({ open, onClose, kind, needed, balance, retryAfter }: UpgradePromptProps) {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [primaryHovered, setPrimaryHovered] = useState(false);
    const [secondaryHovered, setSecondaryHovered] = useState(false);
    const [working, setWorking] = useState(false);

    useEffect(() => { setMounted(true); return () => setMounted(false); }, []);
    if (!mounted) return null;

    const config = {
        credits: {
            title: 'Out of credits',
            message: `This action needs ${needed ?? '?'} credits — you have ${balance ?? 0}. Upgrade your plan or buy a credit pack to continue.`,
            primaryLabel: 'View plans',
            primaryAction: () => { router.push('/billing'); onClose(); },
            secondaryLabel: 'Buy 250 credits ($4.99)',
            secondaryAction: async () => {
                setWorking(true);
                try { const { url } = await api.createTopup(); window.location.href = url; }
                catch (err) { if (isApiError(err)) { /* ignore */ } }
                finally { setWorking(false); }
            },
        },
        rate_limit: {
            title: 'Daily limit reached',
            message: `You've hit your plan's limit for now. It resets in about ${Math.ceil((retryAfter ?? 3600) / 60)} minutes, or upgrade for higher limits.`,
            primaryLabel: 'View plans',
            primaryAction: () => { router.push('/billing'); onClose(); },
            secondaryLabel: undefined,
            secondaryAction: undefined,
        },
        past_due: {
            title: 'Payment past due',
            message: 'Update your payment method to keep using paid features.',
            primaryLabel: 'Manage billing',
            primaryAction: async () => {
                setWorking(true);
                try { const { url } = await api.createPortal(); window.location.href = url; }
                catch { /* ignore */ }
                finally { setWorking(false); }
            },
            secondaryLabel: undefined,
            secondaryAction: undefined,
        },
    }[kind];

    return createPortal(
        <AnimatePresence>
            {open && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={onClose} className="fixed inset-0 z-[9999]" style={{ background: 'var(--overlay)' }} />
                    <div className="fixed inset-0 flex items-center justify-center z-[10000] pointer-events-none p-4">
                        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                            className="pointer-events-auto w-full overflow-hidden"
                            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 380 }}>
                            <div className="px-5 pt-5 pb-4">
                                <h3 className="text-base font-medium" style={{ color: 'var(--text-1)' }}>{config.title}</h3>
                                <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-2)' }}>{config.message}</p>
                            </div>
                            <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
                                <button onClick={onClose}
                                    onMouseEnter={() => setSecondaryHovered(true)} onMouseLeave={() => setSecondaryHovered(false)}
                                    style={{ height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', transition: 'all 140ms ease', color: secondaryHovered ? 'var(--text-1)' : 'var(--text-2)', background: secondaryHovered ? 'var(--hover)' : 'transparent' }}>
                                    {config.secondaryLabel ?? 'Dismiss'}
                                </button>
                                {config.secondaryAction && config.secondaryLabel && (
                                    <button onClick={config.secondaryAction} disabled={working}
                                        style={{ height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-sm)', cursor: working ? 'not-allowed' : 'pointer', opacity: working ? 0.5 : 1, transition: 'all 140ms ease', background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                                        {working ? '…' : config.secondaryLabel}
                                    </button>
                                )}
                                <button onClick={config.primaryAction} disabled={working}
                                    onMouseEnter={() => setPrimaryHovered(true)} onMouseLeave={() => setPrimaryHovered(false)}
                                    style={{ height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-sm)', cursor: working ? 'not-allowed' : 'pointer', opacity: working ? 0.5 : 1, transition: 'all 140ms ease', background: primaryHovered ? 'var(--accent-dim)' : 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                                    {working ? '…' : config.primaryLabel}
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
