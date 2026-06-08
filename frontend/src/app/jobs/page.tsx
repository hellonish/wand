'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, JobListItem } from '@/utils/api';
import Header from '@/components/Header';
import ConfirmationModal from '@/components/ConfirmationModal';
import AddJobModal from '@/components/AddJobModal';

// ─── Filter config ────────────────────────────────────────────────────────────

const JOB_FILTERS = [
    { key: 'all',       label: 'All' },
    { key: 'tracked',   label: 'Tracked' },
    { key: 'applied',   label: 'Applied' },
    { key: 'interview', label: 'Interview' },
    { key: 'offer',     label: 'Offer' },
    { key: 'rejected',  label: 'Rejected' },
    { key: 'archived',  label: 'Archived' },
];

// ─── Status pill config ───────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
    tracked:   'neutral',
    applied:   'accent',
    interview: 'good',
    offer:     'strong',
    rejected:  'weak',
    archived:  'ghost',
    queued:    'partial',
    analyzing: 'partial',
};

const STATUS_LABEL: Record<string, string> = {
    tracked:   'Tracked',
    applied:   'Applied',
    interview: 'Interview',
    offer:     'Offer',
    rejected:  'Rejected',
    archived:  'Archived',
    queued:    'Queued',
    analyzing: 'Analyzing',
};

const TONE_STYLES: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: 'var(--surface-2)',   fg: 'var(--text-2)' },
    accent:  { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
    good:    { bg: 'var(--good-soft)',   fg: 'var(--good)' },
    strong:  { bg: 'var(--strong-soft)', fg: 'var(--strong)' },
    partial: { bg: 'var(--partial-soft)',fg: 'var(--partial)' },
    weak:    { bg: 'var(--weak-soft)',   fg: 'var(--weak)' },
    ghost:   { bg: 'transparent',        fg: 'var(--text-3)' },
};

// ─── Score band helpers ───────────────────────────────────────────────────────

function scoreToBand(score: number): 'strong' | 'good' | 'partial' | 'weak' {
    if (score >= 80) return 'strong';
    if (score >= 70) return 'good';
    if (score >= 55) return 'partial';
    return 'weak';
}

const BAND_COLOR = {
    strong:  'var(--strong)',
    good:    'var(--good)',
    partial: 'var(--partial)',
    weak:    'var(--weak)',
};

// ─── timeAgo helper ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return `${Math.floor(d / 30)}mo`;
}

// ─── hashHue helper ───────────────────────────────────────────────────────────

function hashHue(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
}

// ─── Components ───────────────────────────────────────────────────────────────

function CompanyMark({ name, size = 28 }: { name: string; size?: number }) {
    const hue = hashHue(name);
    const label = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: 'var(--radius-sm)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `oklch(0.92 0.05 ${hue} / 0.55)`,
            color: `oklch(0.30 0.08 ${hue})`,
            fontFamily: 'var(--font-mono)', fontSize: size * 0.38, fontWeight: 600,
            letterSpacing: '0.02em', flexShrink: 0, border: '1px solid var(--border-soft)',
        }}>{label}</div>
    );
}

function StatusPill({ status }: { status: string }) {
    const tone = STATUS_TONE[status] || 'neutral';
    const styles = TONE_STYLES[tone] || TONE_STYLES.neutral;
    const label = STATUS_LABEL[status] || status;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center',
            height: 20, padding: '0 7px',
            borderRadius: 999,
            background: styles.bg, color: styles.fg,
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500,
            letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>
            {label}
        </span>
    );
}

function ScoreCell({ score }: { score: number | undefined }) {
    if (score == null) {
        return (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-4)' }}>—</span>
        );
    }
    const band = scoreToBand(score);
    const color = BAND_COLOR[band];
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
                width: 28, height: 4, borderRadius: 999,
                background: 'var(--surface-2)', overflow: 'hidden', flexShrink: 0,
            }}>
                <span style={{
                    display: 'block', height: '100%',
                    width: `${score}%`, background: color,
                }} />
            </span>
            <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 12.5,
                color: 'var(--text)', minWidth: 22, textAlign: 'right',
            }}>
                {score}
            </span>
        </span>
    );
}

function TopBar({
    title, subtitle, right, breadcrumb,
}: {
    title: string;
    subtitle?: React.ReactNode;
    right?: React.ReactNode;
    breadcrumb?: React.ReactNode;
}) {
    return (
        <div style={{
            padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
            background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                {breadcrumb && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>
                        {breadcrumb}
                    </div>
                )}
                <h1 style={{
                    margin: 0,
                    fontFamily: 'var(--font-display)',
                    fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
                    fontWeight: 500, letterSpacing: '-0.02em',
                    color: 'var(--text)', lineHeight: 1.1,
                }}>
                    {title}
                </h1>
                {subtitle && (
                    <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: 720, lineHeight: 1.4 }}>
                        {subtitle}
                    </div>
                )}
            </div>
            {right && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                    {right}
                </div>
            )}
        </div>
    );
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: 'asc' | 'desc' }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            {dir === 'asc'
                ? <path d="M5 2L9 7H1L5 2Z" fill="currentColor" />
                : <path d="M5 8L1 3H9L5 8Z" fill="currentColor" />
            }
        </svg>
    );
}

// ─── Table columns config ─────────────────────────────────────────────────────

const COLS = [
    { key: 'company',  label: 'Company',  width: '20%', align: 'left' as const },
    { key: 'title',    label: 'Role',     width: '30%', align: 'left' as const },
    { key: 'status',   label: 'Status',   width: '12%', align: 'left' as const },
    { key: 'score',    label: 'Score',    width: '10%', align: 'right' as const },
    { key: 'location', label: 'Location', width: '14%', align: 'left' as const },
    { key: 'updated',  label: 'Updated',  width: '8%',  align: 'right' as const },
    { key: '_',        label: '',         width: '6%',  align: 'right' as const },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function JobsPage() {
    const router = useRouter();
    const { isAuthenticated, token, _hasHydrated, fetchUser, user, jobsFilter, setJobsFilter } = useStore();
    const [jobs, setJobs] = useState<JobListItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'updated', dir: 'desc' });
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [hoveredRow, setHoveredRow] = useState<string | null>(null);

    const effectiveJobsFilter = JOB_FILTERS.some(f => f.key === jobsFilter) ? jobsFilter : 'all';

    useEffect(() => {
        if (!_hasHydrated) return;
        if (token && !user) { fetchUser(); return; }
        if (!token) { router.push('/'); return; }
        if (isAuthenticated) loadJobs();
    }, [_hasHydrated, isAuthenticated, token, user, fetchUser, router]);

    useEffect(() => {
        if (_hasHydrated && effectiveJobsFilter !== jobsFilter) {
            setJobsFilter('all');
        }
    }, [_hasHydrated, effectiveJobsFilter, jobsFilter, setJobsFilter]);

    const loadJobs = async () => {
        setIsLoading(true);
        try {
            const data = await api.getJobs();
            setJobs(data);
        } catch (error) {
            console.error('Failed to load jobs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!showDeleteConfirm) return;
        try {
            await api.deleteJob(showDeleteConfirm);
            setJobs(jobs.filter(j => j.id !== showDeleteConfirm));
        } catch (error) {
            console.error('Failed to delete job:', error);
            throw error;
        }
    };

    // Exclude pipeline-only jobs from user view
    const userVisibleJobs = useMemo(() => jobs.filter(j =>
        j.status === 'tracked' || j.status === 'applied' || j.status === 'interview' ||
        j.status === 'offer' || j.status === 'rejected' || j.status === 'archived'
    ), [jobs]);

    const filteredJobs = useMemo(() => {
        let result = [...userVisibleJobs];
        if (effectiveJobsFilter !== 'all') result = result.filter(j => j.status === effectiveJobsFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(j => {
                const title = (j.job_posting?.job_title || '').toLowerCase();
                const company = (j.job_posting?.company_name || '').toLowerCase();
                return title.includes(q) || company.includes(q);
            });
        }
        result.sort((a, b) => {
            const dir = sort.dir === 'asc' ? 1 : -1;
            if (sort.key === 'company') {
                const av = (a.job_posting?.company_name || '').toLowerCase();
                const bv = (b.job_posting?.company_name || '').toLowerCase();
                return av < bv ? -dir : av > bv ? dir : 0;
            }
            if (sort.key === 'title') {
                const av = (a.job_posting?.job_title || '').toLowerCase();
                const bv = (b.job_posting?.job_title || '').toLowerCase();
                return av < bv ? -dir : av > bv ? dir : 0;
            }
            if (sort.key === 'status') {
                return a.status < b.status ? -dir : a.status > b.status ? dir : 0;
            }
            if (sort.key === 'score') {
                const av = a.final_score ?? -1;
                const bv = b.final_score ?? -1;
                return (av - bv) * dir;
            }
            if (sort.key === 'location') {
                const av = (a.job_posting?.location || '').toLowerCase();
                const bv = (b.job_posting?.location || '').toLowerCase();
                return av < bv ? -dir : av > bv ? dir : 0;
            }
            // default: updated / created_at
            return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        });
        return result;
    }, [userVisibleJobs, effectiveJobsFilter, searchQuery, sort]);

    const counts = useMemo(() => {
        const c: Record<string, number> = { all: userVisibleJobs.length };
        userVisibleJobs.forEach(j => { c[j.status] = (c[j.status] || 0) + 1; });
        return c;
    }, [userVisibleJobs]);

    const handleSort = (key: string) => {
        if (key === '_') return;
        setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
    };

    if (!_hasHydrated || !isAuthenticated) return null;

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
            <Header />

            <TopBar
                title="Jobs"
                subtitle="Your complete job inventory. Search, filter, and track progress across all opportunities."
                right={
                    <>
                        {/* Search input */}
                        <div style={{ position: 'relative' }}>
                            <svg
                                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                style={{
                                    position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                                    color: 'var(--text-3)', pointerEvents: 'none',
                                }}
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search title, company…"
                                style={{
                                    height: 34, paddingLeft: 30, paddingRight: 12,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)', fontSize: 13,
                                    color: 'var(--text)', outline: 'none', width: 240,
                                }}
                                onFocus={e => { e.target.style.borderColor = 'var(--accent)'; }}
                                onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
                            />
                        </div>
                        {/* Add button */}
                        <button
                            onClick={() => setShowAddModal(true)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                height: 34, padding: '0 14px',
                                background: 'var(--text)', color: 'var(--bg)',
                                border: '1px solid var(--text)',
                                borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                                cursor: 'pointer', transition: 'opacity 120ms',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                            Add
                        </button>
                    </>
                }
            />

            <div style={{ padding: '16px 24px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Filter pills */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {JOB_FILTERS.map(f => {
                        const active = effectiveJobsFilter === f.key;
                        return (
                            <button
                                key={f.key}
                                onClick={() => setJobsFilter(f.key)}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 8,
                                    height: 30, padding: '0 12px', borderRadius: 999,
                                    background: active ? 'var(--text)' : 'var(--surface)',
                                    color: active ? 'var(--bg)' : 'var(--text-2)',
                                    border: `1px solid ${active ? 'var(--text)' : 'var(--border)'}`,
                                    fontSize: 12.5, fontWeight: 500,
                                    transition: 'all 140ms ease', cursor: 'pointer',
                                }}
                            >
                                {f.label}
                                <span style={{
                                    fontFamily: 'var(--font-mono)', fontSize: 11,
                                    color: active ? 'var(--bg)' : 'var(--text-3)', opacity: 0.8,
                                }}>
                                    {counts[f.key] || 0}
                                </span>
                            </button>
                        );
                    })}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            {filteredJobs.length} result{filteredJobs.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                {/* Table */}
                {isLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                        <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                            animation: 'spin 0.7s linear infinite',
                        }} className="wand-spin" />
                    </div>
                ) : filteredJobs.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12 }}>
                        <p style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
                            {searchQuery || effectiveJobsFilter !== 'all' ? 'No jobs match your filters.' : 'No jobs tracked yet. Add a job to get started.'}
                        </p>
                        {!searchQuery && effectiveJobsFilter === 'all' && (
                            <button
                                onClick={() => setShowAddModal(true)}
                                style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                Add a job →
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{
                        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                        background: 'var(--surface)', overflow: 'hidden',
                    }}>
                        {/* Table header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: COLS.map(c => c.width).join(' '),
                            padding: '10px 14px', gap: 12,
                            borderBottom: '1px solid var(--border-soft)',
                            background: 'var(--bg-tint)',
                        }}>
                            {COLS.map(c => (
                                <button
                                    key={c.key}
                                    onClick={() => handleSort(c.key)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                                        fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
                                        letterSpacing: '0.08em', textTransform: 'uppercase',
                                        color: sort.key === c.key ? 'var(--text)' : 'var(--text-3)',
                                        cursor: c.key === '_' ? 'default' : 'pointer',
                                        background: 'none', border: 'none', padding: 0,
                                    }}
                                >
                                    {c.label}
                                    {sort.key === c.key && <SortIcon dir={sort.dir} />}
                                </button>
                            ))}
                        </div>

                        {/* Rows */}
                        {filteredJobs.map((job, idx) => {
                            const title = job.job_posting?.job_title || 'Untitled Position';
                            const company = job.job_posting?.company_name || 'Unknown';
                            const location = job.job_posting?.location || '';
                            const isLast = idx === filteredJobs.length - 1;
                            const isHovered = hoveredRow === job.id;

                            return (
                                <div
                                    key={job.id}
                                    onClick={() => router.push(`/jobs/${job.id}`)}
                                    onMouseEnter={() => setHoveredRow(job.id)}
                                    onMouseLeave={() => setHoveredRow(null)}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: COLS.map(c => c.width).join(' '),
                                        padding: 'var(--pad-row, 12px 14px)',
                                        borderBottom: isLast ? 'none' : '1px solid var(--border-soft)',
                                        gap: 12, alignItems: 'center',
                                        cursor: 'pointer',
                                        background: isHovered ? 'var(--bg-tint)' : 'transparent',
                                        transition: 'background 100ms',
                                    }}
                                >
                                    {/* Company */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                        <CompanyMark name={company} size={26} />
                                        <span style={{
                                            fontSize: 13, color: 'var(--text)', fontWeight: 500,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {company}
                                        </span>
                                    </div>

                                    {/* Role */}
                                    <div style={{
                                        fontSize: 13, color: 'var(--text)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {title}
                                    </div>

                                    {/* Status */}
                                    <div>
                                        <StatusPill status={job.status} />
                                    </div>

                                    {/* Score */}
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <ScoreCell score={job.final_score} />
                                    </div>

                                    {/* Location */}
                                    <div style={{
                                        fontSize: 12, color: 'var(--text-2)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {location || '—'}
                                    </div>

                                    {/* Updated */}
                                    <div style={{
                                        fontSize: 11.5, fontFamily: 'var(--font-mono)',
                                        color: 'var(--text-3)', textAlign: 'right',
                                    }}>
                                        {timeAgo(job.created_at)}
                                    </div>

                                    {/* Actions (kebab on hover) */}
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', opacity: isHovered ? 1 : 0, transition: 'opacity 140ms' }}>
                                        <button
                                            onClick={e => { e.stopPropagation(); setShowDeleteConfirm(job.id); }}
                                            title="Delete"
                                            style={{
                                                width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'var(--text-3)', background: 'transparent',
                                                border: '1px solid var(--border-soft)', cursor: 'pointer',
                                                transition: 'all 120ms',
                                            }}
                                            onMouseEnter={e => {
                                                const el = e.currentTarget as HTMLButtonElement;
                                                el.style.color = 'var(--weak)';
                                                el.style.background = 'var(--weak-soft)';
                                                el.style.borderColor = 'var(--weak)';
                                            }}
                                            onMouseLeave={e => {
                                                const el = e.currentTarget as HTMLButtonElement;
                                                el.style.color = 'var(--text-3)';
                                                el.style.background = 'transparent';
                                                el.style.borderColor = 'var(--border-soft)';
                                            }}
                                        >
                                            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <ConfirmationModal
                isOpen={!!showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(null)}
                onConfirm={handleConfirmDelete}
                title="Delete Job"
                message="Are you sure you want to delete this job? This action cannot be undone."
                confirmLabel="Delete"
                isDestructive={true}
            />

            <AddJobModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onJobCreated={(jobId) => {
                    setShowAddModal(false);
                    router.push(`/jobs/${jobId}`);
                }}
                onJobTracked={() => {
                    setShowAddModal(false);
                    loadJobs();
                }}
            />
        </main>
    );
}
