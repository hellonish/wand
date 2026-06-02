'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, type Plan, type UsageEvent, isApiError } from '@/utils/api';
import Header from '@/components/Header';

// ── Icons ──────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }: { name: string; size?: number }) {
    const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (name) {
        case 'sparkles': return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/></svg>;
        case 'check':    return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
        case 'alert':    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
        case 'external': return <svg {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
        default: return null;
    }
}

// ── Section eyebrow (matches settings page pattern exactly) ────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-3)' }}>
            {children}
        </div>
    );
}

// ── "What credits buy" helper copy — only place with hard-coded numbers ────
const PLAN_HELPER: Record<string, string> = {
    free:    '2 profile builds · 5 analyses · 3 cover letters',
    starter: '1 profile build · 15 analyses · 8 cover letters',
    pro:     '3 profile builds · 35 analyses · 25 cover letters',
    max:     '5 profile builds · 60 analyses · 40 cover letters',
};

// ── Task label humanizer ───────────────────────────────────────────────────
function humanizeTask(t: string): string {
    const map: Record<string, string> = {
        job_analysis: 'Job analysis', cover_letter: 'Cover letter',
        profile_build: 'Profile build', reachout: 'Reachout',
        job_analysis_retry: 'Analysis retry', cover_letter_tone: 'JD tone check',
        profile_upload: 'Profile upload',
    };
    return map[t] ?? t;
}

// ── Inner page (uses useSearchParams — must be inside Suspense) ────────────
function BillingPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, isAuthenticated, _hasHydrated, billing, fetchBilling } = useStore();

    const [plans, setPlans] = useState<Plan[]>([]);
    const [usage, setUsage] = useState<UsageEvent[]>([]);
    const [loadingPlans, setLoadingPlans] = useState(true);
    const [loadingUsage, setLoadingUsage] = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
    const [portalLoading, setPortalLoading] = useState(false);
    const [topupLoading, setTopupLoading] = useState(false);
    const [banner, setBanner] = useState<{ kind: 'success' | 'info' | 'canceled'; text: string } | null>(null);

    // Auth guard
    useEffect(() => {
        if (_hasHydrated && !isAuthenticated) router.push('/');
    }, [_hasHydrated, isAuthenticated, router]);

    // Handle Stripe return query params
    useEffect(() => {
        const success = searchParams.get('success');
        const topup = searchParams.get('topup');
        const canceled = searchParams.get('canceled');
        if (success === '1') {
            setBanner({ kind: 'success', text: 'Subscription updated successfully.' });
            fetchBilling();
            router.replace('/billing');
        } else if (topup === 'success') {
            setBanner({ kind: 'success', text: 'Credits added to your account.' });
            fetchBilling();
            router.replace('/billing');
        } else if (canceled === '1') {
            setBanner({ kind: 'canceled', text: 'Checkout canceled — no charge was made.' });
            router.replace('/billing');
        }
    }, [searchParams, fetchBilling, router]);

    // Fetch plans + usage
    const loadData = useCallback(async () => {
        setLoadingPlans(true);
        try { setPlans(await api.getPlans()); } catch { /* ignore */ } finally { setLoadingPlans(false); }
        setLoadingUsage(true);
        try { setUsage(await api.getUsage()); } catch { /* ignore */ } finally { setLoadingUsage(false); }
    }, []);

    useEffect(() => { if (isAuthenticated) loadData(); }, [isAuthenticated, loadData]);

    const handleCheckout = async (planCode: string) => {
        setCheckoutLoading(planCode);
        try {
            const { url } = await api.createCheckout(planCode);
            window.location.href = url;
        } catch (err) {
            if (isApiError(err)) setBanner({ kind: 'canceled', text: err.message });
        } finally {
            setCheckoutLoading(null);
        }
    };

    const handlePortal = async () => {
        setPortalLoading(true);
        try {
            const { url } = await api.createPortal();
            window.location.href = url;
        } catch (err) {
            if (isApiError(err)) setBanner({ kind: 'canceled', text: err.message });
        } finally {
            setPortalLoading(false);
        }
    };

    const handleTopup = async () => {
        setTopupLoading(true);
        try {
            const { url } = await api.createTopup();
            window.location.href = url;
        } catch (err) {
            if (isApiError(err)) setBanner({ kind: 'canceled', text: err.message });
        } finally {
            setTopupLoading(false);
        }
    };

    if (!_hasHydrated || !isAuthenticated || !user) return null;

    const isPaid = billing?.plan_code !== 'free';
    const isPastDue = billing?.status === 'past_due';

    return (
        <>
            {/* Title bar */}
            <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 28px)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>Billing</h1>
                <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>Manage your plan, credits, and usage.</div>
            </div>

            <div style={{ padding: '28px 24px 100px', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 36 }}>

                {/* ── Banner ── */}
                {banner && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                        borderRadius: 'var(--radius)', border: `1px solid ${banner.kind === 'success' ? 'var(--success-border)' : 'var(--border)'}`,
                        background: banner.kind === 'success' ? 'var(--success-dim)' : 'var(--surface-2)',
                        color: banner.kind === 'success' ? 'var(--success)' : 'var(--text-2)', fontSize: 13.5,
                    }}>
                        {banner.kind === 'success' && <Icon name="check" size={15} />}
                        {banner.text}
                        <button onClick={() => setBanner(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1 }}>×</button>
                    </div>
                )}

                {/* ── Past-due warning ── */}
                {isPastDue && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--danger-border)', background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 13.5 }}>
                        <Icon name="alert" size={15} />
                        Payment past due — update your payment method to continue.
                        <button onClick={handlePortal} disabled={portalLoading} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12.5, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: '1px solid var(--danger-border)', background: 'transparent', color: 'var(--danger)', cursor: portalLoading ? 'not-allowed' : 'pointer' }}>
                            {portalLoading ? '…' : 'Manage billing'}
                        </button>
                    </div>
                )}

                {/* ── Current plan ── */}
                {billing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <SectionLabel>Current plan</SectionLabel>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Plan name + status */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, color: 'var(--text)' }}>{billing.plan_name}</span>
                                <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: billing.status === 'active' ? 'var(--success-dim)' : 'var(--warning-dim)', color: billing.status === 'active' ? 'var(--success)' : 'var(--warning)' }}>
                                    {billing.status}
                                </span>
                            </div>
                            {/* Balance */}
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontSize: 32, fontWeight: 600, color: 'var(--accent-ink)', fontVariantNumeric: 'tabular-nums' }}>{billing.balance}</span>
                                <span style={{ fontSize: 14, color: 'var(--text-3)' }}>credits remaining</span>
                            </div>
                            {/* Period end */}
                            {billing.period_end && (
                                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                                    Renews {new Date(billing.period_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                                </div>
                            )}
                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                                <button onClick={handleTopup} disabled={topupLoading} style={{ height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', cursor: topupLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Icon name="sparkles" size={13} />
                                    {topupLoading ? '…' : 'Buy 250 credits ($4.99)'}
                                </button>
                                {isPaid && (
                                    <button onClick={handlePortal} disabled={portalLoading} style={{ height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: portalLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Icon name="external" size={13} />
                                        {portalLoading ? '…' : 'Manage subscription'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Plans ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionLabel>Plans</SectionLabel>
                    {loadingPlans ? (
                        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading plans…</div>
                    ) : (
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                            {plans.map(plan => {
                                const isCurrent = billing?.plan_code === plan.code;
                                return (
                                    <div key={plan.code} style={{ flex: '1 1 160px', minWidth: 160, background: 'var(--surface)', border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {/* Name */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{plan.name}</span>
                                            {isCurrent && <span style={{ fontSize: 10.5, fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Current</span>}
                                        </div>
                                        {/* Price */}
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                            {plan.price_cents === 0 ? (
                                                <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Free</span>
                                            ) : (
                                                <>
                                                    <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>${(plan.price_cents / 100).toFixed(2)}</span>
                                                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>/mo</span>
                                                </>
                                            )}
                                        </div>
                                        {/* Credits */}
                                        <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{plan.monthly_credits} credits / month</div>
                                        {/* Helper copy */}
                                        <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{PLAN_HELPER[plan.code] ?? ''}</div>
                                        {/* CTA */}
                                        {!isCurrent && plan.code !== 'free' && (
                                            <button onClick={() => handleCheckout(plan.code)} disabled={checkoutLoading === plan.code} style={{ marginTop: 'auto', height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', cursor: checkoutLoading === plan.code ? 'not-allowed' : 'pointer' }}>
                                                {checkoutLoading === plan.code ? '…' : billing?.plan_code === 'free' ? 'Upgrade' : 'Switch'}
                                            </button>
                                        )}
                                        {isCurrent && plan.code !== 'free' && (
                                            <button disabled style={{ marginTop: 'auto', height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 500, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-3)', cursor: 'not-allowed' }}>
                                                Current plan
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Usage history ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionLabel>Usage history</SectionLabel>
                    {loadingUsage ? (
                        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading…</div>
                    ) : usage.length === 0 ? (
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 18px', fontSize: 13.5, color: 'var(--text-3)', textAlign: 'center' as const }}>No usage yet.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {/* Header row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 180px', padding: '8px 18px', fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--text-3)' }}>
                                <span>Task</span><span style={{ textAlign: 'right' as const }}>Credits</span><span style={{ textAlign: 'right' as const }}>Date</span>
                            </div>
                            {usage.map((ev) => (
                                <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 180px', padding: '11px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text)', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {humanizeTask(ev.task_type)}
                                        {ev.failed && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--danger-dim)', color: 'var(--danger)' }}>failed</span>}
                                    </div>
                                    <div style={{ textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', color: ev.credits_charged === 0 ? 'var(--text-3)' : 'var(--text)' }}>
                                        {ev.credits_charged === 0 ? '—' : ev.credits_charged}
                                    </div>
                                    <div style={{ textAlign: 'right' as const, color: 'var(--text-3)', fontSize: 12 }}>
                                        {new Date(ev.created_at).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────
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
