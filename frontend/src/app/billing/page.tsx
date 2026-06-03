'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, type Plan, type UsageEvent, type BillingStatus, isApiError } from '@/utils/api';
import Header from '@/components/Header';

// ── Constants ──────────────────────────────────────────────────────────────────

const PLAN_ORDER = ['free', 'starter', 'pro', 'max'] as const;
const planRank = (code: string) => PLAN_ORDER.indexOf(code as typeof PLAN_ORDER[number]);

const PLAN_HELPER: Record<string, string> = {
    free:    '2 profile builds · 5 analyses · 3 cover letters',
    starter: '1 profile build · 15 analyses · 8 cover letters',
    pro:     '3 profile builds · 35 analyses · 25 cover letters',
    max:     '5 profile builds · 60 analyses · 40 cover letters',
};

const PLAN_BLURB: Record<string, string> = {
    free:    'Kick the tires. Enough to analyze a handful of roles.',
    starter: 'For an active search — a steady stream of analyses and letters.',
    pro:     'The full-tilt job hunt. Most people pick this one.',
    max:     'Recruiters, coaches, and the relentlessly ambitious.',
};

const POPULAR_PLAN = 'pro';

const TASK_LABEL: Record<string, string> = {
    job_analysis:       'Job analysis',
    cover_letter:       'Cover letter',
    profile_build:      'Profile build',
    reachout:           'Reachout',
    cover_letter_tone:  'Tone analysis',
    job_analysis_retry: 'Analysis retry',
    profile_upload:     'File upload',
};

const TASK_COLOR: Record<string, string> = {
    profile_build: 'var(--strong)',
    job_analysis:  'var(--accent)',
    cover_letter:  'var(--good)',
    reachout:      'var(--partial)',
};

// ── Formatters ─────────────────────────────────────────────────────────────────

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function capText(caps: Record<string, number> | null) {
    if (!caps || Object.keys(caps).length === 0) return '—';
    const parts = [];
    if (caps.job_analysis != null) parts.push(`${caps.job_analysis} analyses`);
    if (caps.cover_letter != null) parts.push(`${caps.cover_letter} letters`);
    return parts.join(' / ');
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function Icon({ name, size = 16, style }: { name: string; size?: number; style?: React.CSSProperties }) {
    const p: React.SVGProps<SVGSVGElement> = {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round', style,
    };
    switch (name) {
        case 'sparkles':   return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>;
        case 'check':      return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
        case 'alert':      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
        case 'external':   return <svg {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
        case 'plus':       return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
        case 'info':       return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/></svg>;
        case 'x':          return <svg {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>;
        case 'arrow-right':return <svg {...p}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
        case 'star':       return <svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
        case 'download':   return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
        case 'user':       return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>;
        default: return null;
    }
}

// ── Small reusable primitives ───────────────────────────────────────────────────

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)',
            ...style,
        }}>
            {children}
        </div>
    );
}

function SectionHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
            <div>
                <SectionLabel>{eyebrow}</SectionLabel>
                <div style={{
                    marginTop: 4, fontFamily: 'var(--font-display)',
                    fontSize: 'calc(var(--display-scale, 0.92) * 20px)',
                    fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)',
                }}>
                    {title}
                </div>
            </div>
            {action}
        </div>
    );
}

function Btn({
    children, onClick, variant = 'secondary', size = 'md',
    icon, iconRight, disabled, style, title,
}: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md';
    icon?: string;
    iconRight?: string;
    disabled?: boolean;
    style?: React.CSSProperties;
    title?: string;
}) {
    const height = size === 'sm' ? 28 : 32;
    const px = size === 'sm' ? 10 : 14;
    const fs = size === 'sm' ? 12 : 13;
    const iconSz = size === 'sm' ? 12 : 13;

    const base: React.CSSProperties = {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height, padding: `0 ${px}px`, fontSize: fs, fontWeight: 500,
        borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, transition: 'all 140ms ease',
        fontFamily: 'var(--font-body)',
    };

    const variants: Record<string, React.CSSProperties> = {
        primary:   { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--accent)' },
        secondary: { background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid var(--border)' },
        ghost:     { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
    };

    return (
        <button onClick={disabled ? undefined : onClick} disabled={disabled} title={title}
            style={{ ...base, ...variants[variant], ...style }}>
            {icon && <Icon name={icon} size={iconSz} />}
            {children}
            {iconRight && <Icon name={iconRight} size={iconSz} />}
        </button>
    );
}

function Card({ children, style, padding = true }: { children: React.ReactNode; style?: React.CSSProperties; padding?: boolean }) {
    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: padding ? 'var(--pad-card, 20px)' : 0,
            ...style,
        }}>
            {children}
        </div>
    );
}

// ── Banner ─────────────────────────────────────────────────────────────────────

type BannerKind = 'success' | 'info' | 'canceled' | 'danger';

function Banner({ kind, text, onClose }: { kind: BannerKind; text: string; onClose?: () => void }) {
    const map: Record<BannerKind, { bg: string; fg: string; icon: string }> = {
        success:  { bg: 'var(--strong-soft)',  fg: 'var(--strong)', icon: 'check' },
        info:     { bg: 'var(--surface-2)',    fg: 'var(--text-2)', icon: 'info' },
        canceled: { bg: 'var(--surface-2)',    fg: 'var(--text-2)', icon: 'info' },
        danger:   { bg: 'var(--weak-soft)',    fg: 'var(--weak)',   icon: 'alert' },
    };
    const t = map[kind];
    return (
        <div className="wand-fadeup" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderRadius: 'var(--radius)', background: t.bg, color: t.fg,
        }}>
            <Icon name={t.icon} size={14} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{text}</span>
            {onClose && (
                <button onClick={onClose} style={{ color: t.fg, display: 'flex', opacity: 0.7 }}>
                    <Icon name="x" size={13} />
                </button>
            )}
        </div>
    );
}

// ── Current Plan Card ──────────────────────────────────────────────────────────

function UsageBar({
    label, remaining, total, color = 'var(--accent)', sublabel,
}: {
    label: string;
    remaining: number;
    total: number;
    color?: string;
    sublabel?: string;
}) {
    const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    const pctNum = Math.round(pct * 100);
    const low = pct < 0.2;
    const barColor = low ? 'var(--weak)' : color;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600, color: low ? 'var(--weak)' : 'var(--text)', letterSpacing: '-0.02em' }}>{pctNum}%</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>left</span>
                </div>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pctNum}%`, background: barColor, borderRadius: 999, transition: 'width 500ms ease' }} />
            </div>
            {sublabel && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{sublabel}</div>}
        </div>
    );
}

function CurrentPlanCard({
    billing, tokens, onManage, onTopup, topupLoading, portalLoading, onChangePlan,
}: {
    billing: BillingStatus;
    tokens: number;
    onManage: () => void;
    onTopup: () => void;
    topupLoading: boolean;
    portalLoading: boolean;
    onChangePlan?: () => void;
}) {
    const isFree = billing.plan_code === 'free';
    const pastDue = billing.status === 'past_due';
    const canceled = billing.status === 'canceled';
    const hasTopup = billing.topup_total > 0;

    const statusTone = pastDue ? 'var(--weak)' : canceled ? 'var(--text-3)' : 'var(--strong)';
    const statusBg   = pastDue ? 'var(--weak-soft)' : canceled ? 'var(--surface-2)' : 'var(--strong-soft)';
    const statusLabel = pastDue ? 'Past due' : canceled ? 'Canceling' : billing.status === 'trialing' ? 'Trial' : 'Active';

    return (
        <Card padding={false} style={{ overflow: 'visible' }}>
            {/* Past-due top banner */}
            {pastDue && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px',
                    background: 'var(--weak-soft)', color: 'var(--weak)',
                    borderBottom: '1px solid var(--border-soft)',
                    borderRadius: 'var(--radius) var(--radius) 0 0',
                }}>
                    <Icon name="alert" size={14} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                        Payment past due — update your card to keep using paid features.
                    </span>
                    <Btn size="sm" variant="secondary" onClick={onManage} disabled={portalLoading}>
                        {portalLoading ? '…' : 'Update payment'}
                    </Btn>
                </div>
            )}

            {/* Canceled-soon banner */}
            {!isFree && billing.cancel_at_period_end && billing.period_end && (
                <div style={{
                    padding: '12px 20px', background: 'var(--weak-soft)',
                    borderBottom: '1px solid var(--border-soft)',
                    fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10,
                    borderRadius: pastDue ? 0 : 'var(--radius) var(--radius) 0 0',
                }}>
                    <Icon name="alert" size={16} style={{ color: 'var(--weak)' }} />
                    <div>
                        Your subscription has been canceled. You have full access until <strong>{fmtDate(billing.period_end)}</strong>.
                    </div>
                </div>
            )}

            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'flex-start' }}>
                {/* Left — plan info + usage bar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <SectionLabel>Current plan</SectionLabel>
                        {!billing.cancel_at_period_end && (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px',
                                borderRadius: 999, fontSize: 10.5, fontWeight: 500,
                                background: statusBg, color: statusTone,
                            }}>
                                {statusLabel}
                            </span>
                        )}
                        {!isFree && billing.cancel_at_period_end && (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px',
                                borderRadius: 999, fontSize: 10.5, fontWeight: 500,
                                background: 'var(--weak-soft)', color: 'var(--weak)',
                            }}>
                                Cancels soon
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'calc(var(--display-scale, 0.92) * 30px)',
                            fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)',
                        }}>
                            {billing.plan_name}
                        </span>
                        {!isFree && onChangePlan && (
                            <button onClick={onChangePlan} style={{
                                fontSize: 12, color: 'var(--text-3)', background: 'none',
                                border: 'none', cursor: 'pointer', padding: '0 2px',
                                textDecoration: 'underline', textUnderlineOffset: 2,
                                fontFamily: 'var(--font-body)',
                            }}>
                                change
                            </button>
                        )}
                    </div>

                    {/* Usage bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 380 }}>
                        <UsageBar
                            label="Main Usage"
                            remaining={billing.grant_balance}
                            total={billing.monthly_credits}
                            color="var(--accent)"
                            sublabel={billing.period_end && !billing.cancel_at_period_end
                                ? `Resets ${fmtDate(billing.period_end)}`
                                : undefined}
                        />
                        {hasTopup && (
                            <UsageBar
                                label="Additional Usage"
                                remaining={billing.topup_remaining}
                                total={billing.topup_total}
                                color="var(--strong)"
                                sublabel="Purchased credits · never expire"
                            />
                        )}
                        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                                {fmtTok(tokens)}
                            </span>{' '}tokens processed this period
                        </div>
                    </div>
                </div>

                {/* Right — action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', minWidth: 184 }}>
                    <Btn variant="primary" icon="plus" onClick={onTopup} disabled={topupLoading}
                        style={{ justifyContent: 'center' }}>
                        {topupLoading ? 'Redirecting…' : 'Top up usage'}
                    </Btn>
                    {!isFree && (
                        <Btn variant="secondary" icon="external" onClick={onManage} disabled={portalLoading}
                            style={{ justifyContent: 'center' }}>
                            {portalLoading ? '…' : billing.cancel_at_period_end ? 'Resume subscription' : 'Manage subscription'}
                        </Btn>
                    )}
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, textAlign: 'center' }}>
                        <Icon name="download" size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        <button onClick={onManage} style={{ color: 'var(--text-3)', textDecoration: 'underline', fontSize: 11.5 }}>
                            Download invoices
                        </button>
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ── Plan Card ──────────────────────────────────────────────────────────────────

function PlanCard({
    plan, billing, onCheckout, checkoutLoading, onManage,
}: {
    plan: Plan;
    billing: BillingStatus | null;
    onCheckout: (code: string) => void;
    checkoutLoading: string | null;
    onManage: () => void;
}) {
    const isCurrent  = billing?.plan_code === plan.code;
    const rank       = planRank(plan.code);
    const curRank    = planRank(billing?.plan_code ?? 'free');
    const isUpgrade  = rank > curRank;
    const isFreePlan = plan.code === 'free';
    const isPopular  = plan.code === POPULAR_PLAN && !isCurrent;
    const highlight  = isCurrent || plan.code === 'pro' || plan.code === 'max';
    const loading    = checkoutLoading === plan.code;

    let cta: React.ReactNode;
    if (isCurrent) {
        cta = (
            <button disabled style={{
                width: '100%', height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500,
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text-3)', cursor: 'not-allowed',
            }}>
                Current plan
            </button>
        );
    } else if (plan.code === billing?.scheduled_downgrade) {
        cta = (
            <button disabled style={{
                width: '100%', height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500,
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text-3)', cursor: 'not-allowed',
            }}>
                Scheduled
            </button>
        );
    } else if (isFreePlan) {
        // Free is the bottom tier — no downgrade CTA needed.
        // If the user is on a paid plan, they cancel via "Manage subscription" instead.
        cta = null;
    } else {
        cta = (
            <button
                onClick={() => onCheckout(plan.code)}
                disabled={loading}
                style={{
                    width: '100%', height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--accent)', background: isUpgrade ? 'var(--accent)' : 'transparent',
                    color: isUpgrade ? 'var(--on-accent)' : 'var(--accent)',
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                }}
            >
                {loading ? '…' : isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
            </button>
        );
    }
    const isBigger = plan.code === 'pro' || plan.code === 'max';

    return (
        <div style={{
            flex: isBigger ? '1.08 1 0' : '1 1 0', minWidth: 160, position: 'relative',
            background: isCurrent ? 'var(--bg-tint)' : 'var(--surface)',
            border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', padding: 18,
            display: 'flex', flexDirection: 'column', gap: 13,
            boxShadow: highlight ? '0 0 0 1px var(--accent)' : 'none',
            transform: isBigger ? 'scale(1.02)' : 'none',
            zIndex: isBigger ? 1 : 0,
            transformOrigin: 'center',
        }}>
            {/* Popular badge */}
            {isPopular && (
                <span style={{
                    position: 'absolute', top: -9, right: 14, height: 18, padding: '0 8px',
                    display: 'inline-flex', alignItems: 'center', borderRadius: 999,
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>
                    Popular
                </span>
            )}

            {/* Name + current check */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)' }}>{plan.name}</span>
                {isCurrent && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
            </div>

            {/* Price */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
                    fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em',
                }}>
                    {plan.price_cents === 0 ? 'Free' : money(plan.price_cents)}
                </span>
                {plan.price_cents > 0 && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>/mo</span>}
            </div>

            {/* Marketing copy */}
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, minHeight: 48 }}>
                <span style={{ color: 'var(--text-3)', fontSize: 11.5 }}>Each month, roughly</span><br />
                {PLAN_HELPER[plan.code] ?? `${plan.monthly_credits} credits`}
            </div>

            <div style={{ height: 1, background: 'var(--border-soft)' }} />

            {/* Caps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <CapLine label="Daily limit" value={capText(plan.daily_caps)} />
                <CapLine label="Weekly limit" value={plan.weekly_caps ? capText(plan.weekly_caps) : '—'} />
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 4 }}>{cta}</div>
        </div>
    );
}

function CapLine({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{label}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-2)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
        </div>
    );
}


// ── Plan Switch Modal (paid users) ─────────────────────────────────────────────

function PlanSwitchModal({
    billing, plans, onCheckout, checkoutLoading, onManage, onClose,
}: {
    billing: BillingStatus | null;
    plans: Plan[];
    onCheckout: (code: string) => void;
    checkoutLoading: string | null;
    onManage: () => void;
    onClose: () => void;
}) {
    const code = billing?.plan_code ?? 'free';
    const isMax = code === 'max';
    const heading = isMax ? "You're on the top plan" : 'Switch your plan';
    const sub = isMax
        ? 'Max is the highest tier. Need more headroom this month? Top up any time.'
        : `You're on ${billing?.plan_name}. Move up or down — changes take effect immediately (upgrade) or at your next billing cycle (downgrade).`;

    return (
        <div
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.45)', zIndex: 900,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(3px)',
            }}
        >
            <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '28px 28px 24px',
                width: 'min(960px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
                position: 'relative',
            }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
                    <div>
                        <SectionLabel>Plans</SectionLabel>
                        <div style={{
                            marginTop: 4, fontFamily: 'var(--font-display)',
                            fontSize: 'calc(var(--display-scale, 0.92) * 20px)',
                            fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)',
                        }}>
                            {heading}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
                            {sub}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ color: 'var(--text-3)', display: 'flex', flexShrink: 0, marginTop: 2 }}>
                        <Icon name="x" size={16} />
                    </button>
                </div>

                {/* Plan cards */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {plans.map(p => (
                        <PlanCard key={p.code} plan={p} billing={billing}
                            onCheckout={onCheckout} checkoutLoading={checkoutLoading} onManage={onManage} />
                    ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
                    <Icon name="info" size={12} />
                    <span>Limits and capacity reset at the start of each billing period. Unused capacity doesn&apos;t roll over; top-ups never expire.</span>
                </div>
            </div>
        </div>
    );
}

// ── Plans Section ──────────────────────────────────────────────────────────────

function PlansSection({
    billing, plans, onCheckout, checkoutLoading, onManage,
}: {
    billing: BillingStatus | null;
    plans: Plan[];
    onCheckout: (code: string) => void;
    checkoutLoading: string | null;
    onManage: () => void;
}) {
    const code    = billing?.plan_code ?? 'free';
    const isFree  = code === 'free';
    const isMax   = code === 'max';
    const heading = isFree ? 'Choose a plan' : isMax ? "You're on the top plan" : 'Upgrade your plan';
    const sub     = isFree
        ? 'Pick a paid plan for higher limits and more monthly capacity.'
        : isMax
            ? 'Max is the highest tier. Need more headroom this month? Top up any time.'
            : `You're on ${billing?.plan_name}. Move up for more analyses, letters, and headroom each month.`;

    return (
        <div>
            <SectionHeader eyebrow="Plans" title={heading} />
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: -8, marginBottom: 16, lineHeight: 1.5, maxWidth: 560 }}>
                {sub}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {plans.map(p => (
                    <PlanCard key={p.code} plan={p} billing={billing}
                        onCheckout={onCheckout} checkoutLoading={checkoutLoading} onManage={onManage} />
                ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
                <Icon name="info" size={12} />
                <span>Limits and capacity reset at the start of each billing period. Unused capacity doesn&apos;t roll over; top-ups never expire.</span>
            </div>
        </div>
    );
}

// ── Usage This Period ──────────────────────────────────────────────────────────

function UsageThisPeriod({ billing, usage }: { billing: BillingStatus; usage: UsageEvent[] }) {
    const charged   = usage.filter(e => e.credits_charged > 0 && !e.failed);
    const taskCount = charged.length;
    const rawPct    = billing.monthly_credits > 0 ? (1 - billing.balance / billing.monthly_credits) * 100 : 0;
    const pctUsedStr = rawPct > 0 && rawPct < 1 ? '<1%' : `${Math.max(0, Math.min(100, Math.round(rawPct)))}%`;
    const tokensIn  = usage.reduce((s, e) => s + e.input_tokens, 0);
    const tokensOut = usage.reduce((s, e) => s + e.output_tokens, 0);

    // Per-task breakdown (tokens)
    const byTask: Record<string, { tokens: number; count: number }> = {};
    usage.forEach(e => {
        byTask[e.task_type] = byTask[e.task_type] ?? { tokens: 0, count: 0 };
        byTask[e.task_type].tokens += e.input_tokens + e.output_tokens;
        byTask[e.task_type].count  += 1;
    });
    const breakdown = Object.entries(byTask).sort((a, b) => b[1].tokens - a[1].tokens);
    const maxTok    = Math.max(1, ...breakdown.map(([, v]) => v.tokens));

    // 21-day rolling bar chart
    const SPAN = 21;
    const nowTs = Date.now();
    const buckets = Array.from({ length: SPAN }, () => 0);
    usage.forEach(e => {
        const dAgo = Math.min(SPAN - 1, Math.max(0, Math.round((nowTs - new Date(e.created_at).getTime()) / 86400000)));
        buckets[dAgo] += e.input_tokens + e.output_tokens;
    });
    const maxDay = Math.max(1, ...buckets);
    const series = buckets.map((v, i) => ({ daysAgo: i, v })).reverse();

    return (
        <div>
            <SectionHeader eyebrow="This period" title="Usage" />
            <Card>
                {/* 4-stat row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
                    <Stat label="Plan used"  value={pctUsedStr}        sub="this period" accent />
                    <Stat label="Tasks run"  value={`${taskCount}`}        sub="billable"   divider />
                    <Stat label="Tokens in"  value={fmtTok(tokensIn)}     sub="prompts"    divider />
                    <Stat label="Tokens out" value={fmtTok(tokensOut)}    sub="generated"  divider />
                </div>

                <div style={{ height: 1, background: 'var(--border-soft)', margin: '18px 0' }} />

                {/* Daily bar chart */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <SectionLabel>Tokens / day</SectionLabel>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                        {billing.current_period_start ? fmtDate(billing.current_period_start) : '21 days'} → today
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 88 }}>
                    {series.map((d, i) => (
                        <div key={i} title={d.v ? `${fmtTok(d.v)} tokens` : 'no activity'}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                            <div style={{
                                height: `${d.v ? Math.max(6, (d.v / maxDay) * 100) : 2}%`,
                                background: d.v ? 'var(--accent)' : 'var(--surface-3)',
                                borderRadius: 'var(--radius-xs)',
                                transition: 'height 400ms ease',
                                opacity: d.v ? 1 : 0.5,
                            }} />
                        </div>
                    ))}
                </div>

                <div style={{ height: 1, background: 'var(--border-soft)', margin: '18px 0' }} />

                {/* Per-task breakdown */}
                <SectionLabel style={{ marginBottom: 12 }}>By task</SectionLabel>
                {breakdown.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No activity yet.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                        {breakdown.map(([task, v]) => {
                            const color = TASK_COLOR[task] ?? 'var(--accent)';
                            return (
                                <div key={task} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, color: 'var(--text-2)' }}>
                                        {TASK_LABEL[task] ?? task}
                                    </span>
                                    <span style={{ width: 30, flexShrink: 0, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                                        ×{v.count}
                                    </span>
                                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', width: `${(v.tokens / maxTok) * 100}%`,
                                            background: color, borderRadius: 999, transition: 'width 500ms ease',
                                        }} />
                                    </div>
                                    <span style={{ width: 64, flexShrink: 0, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                                        {fmtTok(v.tokens)} tok
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    );
}

function Stat({ label, value, sub, accent, divider }: {
    label: string; value: string; sub?: string; accent?: boolean; divider?: boolean;
}) {
    return (
        <div style={{ padding: '0 18px', borderLeft: divider ? '1px solid var(--border-soft)' : 'none' }}>
            <SectionLabel style={{ marginBottom: 8 }}>{label}</SectionLabel>
            <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600,
                letterSpacing: '-0.02em',
                color: accent ? 'var(--accent-ink)' : 'var(--text)',
            }}>
                {value}
            </div>
            {sub && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
        </div>
    );
}

// ── Usage History Table ────────────────────────────────────────────────────────

function UsageHistory({ usage }: { usage: UsageEvent[] }) {
    const [showAll, setShowAll] = useState(false);
    const COLLAPSED = 6;
    const EXPANDED  = 15;
    const rows = usage.slice(0, showAll ? EXPANDED : COLLAPSED);
    const hasMore = usage.length > COLLAPSED;

    return (
        <div>
            <SectionHeader
                eyebrow="Activity"
                title="Recent activity"
                action={hasMore ? (
                    <Btn size="sm" variant="ghost" onClick={() => setShowAll(s => !s)}>
                        {showAll ? 'Show fewer' : 'Show more'}
                    </Btn>
                ) : undefined}
            />
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: -8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name="info" size={12} />
                <span>A rolling view of your most recent tasks — not a complete billing record.</span>
            </div>
            {usage.length === 0 ? (
                <Card style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--text-3)', padding: '24px 18px' }}>
                    No usage yet.
                </Card>
            ) : (
                <Card padding={false} style={{ overflow: 'hidden' }}>
                    {/* Header row */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) 1fr 1fr', gap: 12,
                        padding: '10px 16px', borderBottom: '1px solid var(--border-soft)',
                        background: 'var(--bg-tint)',
                    }}>
                        {['Task', 'Tokens (in / out)', 'When'].map(h => (
                            <span key={h} style={{
                                fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
                                letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)',
                            }}>
                                {h}
                            </span>
                        ))}
                    </div>

                    {rows.map((e, i) => {
                        const color = TASK_COLOR[e.task_type];
                        return (
                            <div key={e.id} style={{
                                display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) 1fr 1fr',
                                gap: 12, alignItems: 'center', padding: '11px 16px',
                                borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-soft)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                                    <span style={{
                                        width: 7, height: 7, borderRadius: 2, flexShrink: 0,
                                        background: color ?? 'var(--text-4)',
                                    }} />
                                    <span style={{
                                        fontSize: 13, color: 'var(--text)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {TASK_LABEL[e.task_type] ?? e.task_type}
                                    </span>
                                    {e.failed && (
                                        <span style={{
                                            fontSize: 10.5, padding: '1px 6px', borderRadius: 999,
                                            background: 'var(--weak-soft)', color: 'var(--weak)', fontWeight: 500,
                                        }}>
                                            failed
                                        </span>
                                    )}
                                    {e.credits_charged === 0 && !e.failed && (
                                        <span style={{
                                            fontSize: 10.5, padding: '1px 6px', borderRadius: 999,
                                            background: 'var(--surface-2)', color: 'var(--text-3)', fontWeight: 500,
                                        }}>
                                            included
                                        </span>
                                    )}
                                </div>
                                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                                    {fmtTok(e.input_tokens)} / {fmtTok(e.output_tokens)}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                                    {fmtDateTime(e.created_at)}
                                </span>
                            </div>
                        );
                    })}
                </Card>
            )}
        </div>
    );
}

// ── Inner page (uses useSearchParams — must be inside Suspense) ────────────────

function BillingPageInner() {
    const router        = useRouter();
    const searchParams  = useSearchParams();
    const { user, isAuthenticated, token, _hasHydrated, billing, fetchBilling } = useStore();

    const [plans,          setPlans]          = useState<Plan[]>([]);
    const [usage,          setUsage]          = useState<UsageEvent[]>([]);
    const [loadingPlans,   setLoadingPlans]   = useState(true);
    const [loadingUsage,   setLoadingUsage]   = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
    const [portalLoading,  setPortalLoading]  = useState(false);
    const [topupLoading,   setTopupLoading]   = useState(false);
    const [banner,         setBanner]         = useState<{ kind: BannerKind; text: string } | null>(null);
    const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [previewPlan,    setPreviewPlan]    = useState<string | null>(null);
    const [previewData,    setPreviewData]    = useState<any | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [showPlanModal,  setShowPlanModal]  = useState(false);

    const showBanner = (kind: BannerKind, text: string) => {
        setBanner({ kind, text });
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        
        // Don't auto-dismiss success or info banners (like upgrade/downgrade confirmations)
        if (kind !== 'success' && kind !== 'info') {
            bannerTimer.current = setTimeout(() => setBanner(null), 7000);
        }
    };
    useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

    // Auth guard
    useEffect(() => {
        if (_hasHydrated && !token) router.push('/');
    }, [_hasHydrated, token, router]);

    // Handle Stripe return query params
    useEffect(() => {
        const success   = searchParams.get('success');
        const topup     = searchParams.get('topup');
        const canceled  = searchParams.get('canceled');
        const downgrade = searchParams.get('downgrade');
        
        if (success === '1') {
            if (downgrade === '1') {
                showBanner('info', 'Your plan downgrade has been scheduled for your next billing cycle.');
            } else {
                showBanner('success', 'Subscription updated successfully.');
            }
            fetchBilling();
            router.replace('/billing');
        } else if (topup === 'success') {
            showBanner('success', 'Usage credits added to your account.');
            // Stripe webhook might take a few seconds, poll a few times
            let attempts = 0;
            const timer = setInterval(() => {
                fetchBilling();
                if (++attempts >= 4) clearInterval(timer);
            }, 2000);
            fetchBilling();
            router.replace('/billing');
        } else if (canceled === '1') {
            showBanner('canceled', 'Checkout canceled — no charge was made.');
            router.replace('/billing');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Handle scheduled downgrade banner
    useEffect(() => {
        if (billing?.scheduled_downgrade && plans.length > 0) {
            const planName = plans.find(p => p.code === billing.scheduled_downgrade)?.name || 'a lower tier';
            showBanner('info', `Your plan downgrade to ${planName} is scheduled for your next billing cycle.`);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [billing?.scheduled_downgrade, plans]);

    // Fetch plans + usage
    const loadData = useCallback(async () => {
        setLoadingPlans(true);
        try { setPlans(await api.getPlans()); } catch { /* ignore */ } finally { setLoadingPlans(false); }
        setLoadingUsage(true);
        try { setUsage(await api.getUsage()); } catch { /* ignore */ } finally { setLoadingUsage(false); }
    }, []);

    useEffect(() => { if (isAuthenticated) { loadData(); fetchBilling(); } }, [isAuthenticated, loadData, fetchBilling]);

    const handleCheckout = async (planCode: string) => {
        if (planCode === billing?.scheduled_downgrade) return;

        if (billing?.plan_code === 'free' || !billing) {
            executeCheckout(planCode);
        } else {
            setShowPlanModal(false);
            setPreviewPlan(planCode);
            setPreviewLoading(true);
            try {
                const data = await api.previewPlanChange(planCode);
                if (data.type === 'new_subscription' || data.type === 'same_plan') {
                    executeCheckout(planCode);
                } else {
                    setPreviewData(data);
                }
            } catch (err) {
                if (isApiError(err)) showBanner('danger', err.message);
                setPreviewPlan(null);
            } finally {
                setPreviewLoading(false);
            }
        }
    };

    const executeCheckout = async (planCode: string) => {
        setCheckoutLoading(planCode);
        try {
            const { url } = await api.createCheckout(planCode);
            window.location.href = url;
        } catch (err) {
            if (isApiError(err) && err.status === 429) {
                const secs = err.retryAfter ?? 60;
                showBanner('danger', `Too many requests — try again in ${Math.ceil(secs / 60)} min.`);
            } else if (isApiError(err)) {
                showBanner('danger', err.message);
            }
            setCheckoutLoading(null);
            setPreviewPlan(null);
        }
    };

    const handlePortal = async () => {
        setPortalLoading(true);
        try {
            const { url } = await api.createPortal();
            window.location.href = url;
        } catch (err) {
            if (isApiError(err) && err.status === 429) {
                const secs = err.retryAfter ?? 60;
                showBanner('danger', `Too many requests — try again in ${Math.ceil(secs / 60)} min.`);
            } else if (isApiError(err)) {
                showBanner('danger', err.message);
            }
            setPortalLoading(false);
        }
    };

    const handleTopup = async () => {
        if (billing?.plan_code === 'free') {
            showBanner('danger', 'Top-ups are only available on paid plans.');
            return;
        }
        setTopupLoading(true);
        try {
            const { url } = await api.createTopup();
            window.location.href = url;
        } catch (err) {
            if (isApiError(err) && err.status === 429) {
                const secs = err.retryAfter ?? 60;
                showBanner('danger', `Too many requests — try again in ${Math.ceil(secs / 60)} min.`);
            } else if (isApiError(err)) {
                showBanner('danger', err.message);
            }
            setTopupLoading(false);
        }
    };

    if (!_hasHydrated || !isAuthenticated || !user) return null;

    const totalTokens = usage.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0);

    return (
        <>
            {/* Sticky title bar */}
            <div style={{
                padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
                background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
            }}>
                <h1 style={{
                    margin: 0, fontFamily: 'var(--font-display)',
                    fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
                    fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1,
                }}>
                    Settings
                </h1>
                <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>
                    Your account, your plan, and how your usage is tracked.
                </div>
            </div>

            <div style={{ padding: '28px 24px 100px', display: 'grid', gridTemplateColumns: '188px minmax(0, 1fr)', gap: 28, alignItems: 'flex-start', maxWidth: 1080 }}>
                {/* Sub-nav */}
                <nav style={{ position: 'sticky', top: 90, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <button
                        onClick={() => router.push('/settings')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px',
                            borderRadius: 'var(--radius-sm)', textAlign: 'left',
                            background: 'transparent', color: 'var(--text-2)',
                            fontSize: 13, fontWeight: 500, transition: 'all 140ms ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <Icon name="user" size={15} />
                        <span style={{ flex: 1 }}>Account</span>
                    </button>
                    <button
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px',
                            borderRadius: 'var(--radius-sm)', textAlign: 'left',
                            background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow-1)',
                            fontSize: 13, fontWeight: 500, transition: 'all 140ms ease',
                        }}
                    >
                        <Icon name="sparkles" size={15} />
                        <span style={{ flex: 1 }}>Billing & usage</span>
                    </button>
                </nav>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 36, minWidth: 0 }}>

                {/* Banner */}
                {banner && (
                    <Banner 
                        kind={banner.kind} 
                        text={banner.text} 
                        onClose={banner.kind === 'success' || banner.kind === 'info' ? undefined : () => setBanner(null)} 
                    />
                )}

                {/* Current plan card */}
                {billing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <CurrentPlanCard
                            billing={billing}
                            tokens={totalTokens}
                            onManage={handlePortal}
                            onTopup={handleTopup}
                            topupLoading={topupLoading}
                            portalLoading={portalLoading}
                            onChangePlan={billing.plan_code !== 'free' ? () => setShowPlanModal(true) : undefined}
                        />
                    </div>
                )}

                {/* Plans section — inline for free users, modal for paid users */}
                {billing?.plan_code === 'free' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {loadingPlans ? (
                            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading plans…</div>
                        ) : (
                            <PlansSection
                                billing={billing}
                                plans={plans}
                                onCheckout={handleCheckout}
                                checkoutLoading={checkoutLoading}
                                onManage={handlePortal}
                            />
                        )}
                    </div>
                )}

                {/* Usage this period */}
                {billing && !loadingUsage && (
                    <UsageThisPeriod billing={billing} usage={usage} />
                )}

                {/* Recent activity */}
                {!loadingUsage && (
                    <UsageHistory usage={usage} />
                )}

                {loadingUsage && (
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading usage…</div>
                )}

                {/* Plan Switch Modal (paid users — plan comparison) */}
                {showPlanModal && !loadingPlans && billing?.plan_code !== 'free' && (
                    <PlanSwitchModal
                        billing={billing}
                        plans={plans}
                        onCheckout={(code) => { handleCheckout(code); }}
                        checkoutLoading={checkoutLoading}
                        onManage={handlePortal}
                        onClose={() => setShowPlanModal(false)}
                    />
                )}

                {/* Plan Change Confirmation Modal */}
                {previewPlan && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.4)', zIndex: 1000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backdropFilter: 'blur(3px)',
                    }}>
                        <Card style={{ width: 440, maxWidth: '90%' }} padding={true}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                                <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                                    Confirm Plan Change
                                </h3>
                                <button onClick={() => { setPreviewPlan(null); setPreviewData(null); }} style={{ opacity: 0.5 }}>
                                    <Icon name="x" size={16} />
                                </button>
                            </div>
                            
                            {previewLoading || !previewData ? (
                                <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Calculating your upcoming charge...</div>
                            ) : (
                                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                                    {previewData.type === 'upgrade' && (
                                        <>
                                            <p style={{ marginBottom: 12 }}>You are upgrading to <strong>{plans.find(p => p.code === previewPlan)?.name}</strong>.</p>
                                            <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 8, marginBottom: 16 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                                                    <span>Due today (prorated)</span>
                                                    <span>{money(previewData.immediate_charge_cents)}</span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    {previewData.type === 'downgrade' && (
                                        <>
                                            <p style={{ marginBottom: 12 }}>You are downgrading to <strong>{plans.find(p => p.code === previewPlan)?.name}</strong>.</p>
                                            <p style={{ marginBottom: 16, color: 'var(--text-2)' }}>You will keep your current plan's limits until the end of your billing cycle.</p>
                                            <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 8, marginBottom: 16 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                                                    <span>Due today</span>
                                                    <span>$0.00</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 10, color: 'var(--text-2)' }}>
                                                    <span>Charge on {fmtDate(previewData.next_cycle_date * 1000)}</span>
                                                    <span>{money(previewData.next_cycle_charge_cents)}</span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    
                                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
                                        <Btn onClick={() => { setPreviewPlan(null); setPreviewData(null); }}>Cancel</Btn>
                                        <Btn variant="primary" onClick={() => executeCheckout(previewPlan)} disabled={checkoutLoading === previewPlan}>
                                            {checkoutLoading === previewPlan ? 'Confirming...' : 'Confirm Change'}
                                        </Btn>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>
                )}
                </div>
            </div>
        </>
    );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BillingPage() {
    return (
        <main style={{ minHeight: '100vh' }}>
            <Header />
            <Suspense fallback={null}>
                <BillingPageInner />
            </Suspense>
        </main>
    );
}
