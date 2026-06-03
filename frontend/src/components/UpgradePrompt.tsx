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

function Icon({ name, size = 16 }: { name: string; size?: number }) {
    const p: React.SVGProps<SVGSVGElement> = {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
    };
    switch (name) {
        case 'sparkles': return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>;
        case 'alert':    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
        default: return null;
    }
}

export default function UpgradePrompt({ open, onClose, kind, needed, balance, retryAfter }: UpgradePromptProps) {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [working, setWorking] = useState(false);

    useEffect(() => { setMounted(true); return () => setMounted(false); }, []);
    if (!mounted) return null;

    const isCredits = kind === 'credits';

    const config = {
        credits: {
            icon: 'sparkles',
            iconBg: 'var(--accent-soft)',
            iconFg: 'var(--accent-ink)',
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
            icon: 'alert',
            iconBg: 'var(--partial-soft)',
            iconFg: 'var(--partial)',
            title: 'Daily limit reached',
            message: `You've hit your plan's limit for now. It resets in about ${Math.ceil((retryAfter ?? 3600) / 60)} minutes, or upgrade for higher limits.`,
            primaryLabel: 'View plans',
            primaryAction: () => { router.push('/billing'); onClose(); },
            secondaryLabel: undefined,
            secondaryAction: undefined,
        },
        past_due: {
            icon: 'alert',
            iconBg: 'var(--weak-soft)',
            iconFg: 'var(--weak)',
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
                        <motion.div
                            initial={{ opacity: 0, scale: 0.97, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97, y: 6 }}
                            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
                            className="pointer-events-auto w-full overflow-hidden"
                            style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-lg)', maxWidth: 400,
                                boxShadow: 'var(--shadow-2)',
                            }}>

                            {/* Header */}
                            <div style={{ padding: '20px 22px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                                    background: config.iconBg, color: config.iconFg,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Icon name={config.icon} size={18} />
                                </div>
                                <h3 style={{
                                    margin: 0, fontFamily: 'var(--font-display)',
                                    fontSize: 'calc(var(--display-scale, 0.92) * 19px)',
                                    fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text)',
                                }}>
                                    {config.title}
                                </h3>
                            </div>

                            {/* Body */}
                            <div style={{ padding: '0 22px 16px' }}>
                                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
                                    {config.message}
                                </p>
                            </div>

                            {/* Footer */}
                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', gap: 8,
                                padding: '12px 22px', borderTop: '1px solid var(--border-soft)',
                            }}>
                                <button onClick={onClose} style={{
                                    height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500,
                                    borderRadius: 'var(--radius-sm)', border: 'none',
                                    cursor: 'pointer', transition: 'all 140ms ease',
                                    color: 'var(--text-2)', background: 'transparent',
                                }}>
                                    {config.secondaryLabel ?? 'Dismiss'}
                                </button>

                                {config.secondaryAction && config.secondaryLabel && (
                                    <button onClick={config.secondaryAction} disabled={working} style={{
                                        height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500,
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: working ? 'not-allowed' : 'pointer',
                                        opacity: working ? 0.5 : 1, transition: 'all 140ms ease',
                                        background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                                        border: '1px solid var(--accent)',
                                    }}>
                                        {working ? '…' : config.secondaryLabel}
                                    </button>
                                )}

                                <button onClick={() => { if (!working) config.primaryAction(); }} disabled={working} style={{
                                    height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500,
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: working ? 'not-allowed' : 'pointer',
                                    opacity: working ? 0.5 : 1, transition: 'all 140ms ease',
                                    background: isCredits ? 'var(--accent)' : 'var(--accent-soft)',
                                    color: isCredits ? 'var(--on-accent)' : 'var(--accent-ink)',
                                    border: `1px solid var(--accent)`,
                                }}>
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
