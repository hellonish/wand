'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, CoverLetter, JobListItem, JDToneAnalysis, Job, isApiError } from '@/utils/api';
import { coverLettersCache } from '@/utils/cache';
import Header from '@/components/Header';

// ── Shared primitives ─────────────────────────────────────────────────────────

function TopBar({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
    return (
        <div style={{
            padding: '18px 24px 12px', borderBottom: '1px solid var(--border-soft)',
            background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 28px)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.1 }}>{title}</h1>
                {subtitle && <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: 720, lineHeight: 1.4 }}>{subtitle}</div>}
            </div>
            {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>{right}</div>}
        </div>
    );
}

function Btn({ children, variant = 'secondary', size = 'md', icon, onClick, disabled, style }: {
    children?: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'soft'; size?: 'sm' | 'md' | 'lg';
    icon?: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties;
}) {
    const sizes = { sm: { h: 28, px: 10, fs: 12.5 }, md: { h: 34, px: 14, fs: 13.5 }, lg: { h: 42, px: 18, fs: 14.5 } };
    const s = sizes[size];
    const vs = {
        primary: { background: 'var(--btn-primary)', color: 'var(--on-btn-primary)', border: '1px solid var(--btn-primary)' },
        secondary: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
        ghost: { background: 'transparent', color: 'var(--text-2)', border: '1px solid transparent' },
        soft: { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid transparent' },
    };
    return (
        <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: s.h, padding: `0 ${s.px}px`, borderRadius: 'var(--radius-sm)', fontSize: s.fs, fontWeight: 500, transition: 'all 140ms ease', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', ...vs[variant], ...style }}>
            {icon}{children}
        </button>
    );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODES = [
    { key: 'auto', label: 'Auto', desc: 'Hopper reads the job and selects the tone that best fits.' },
    { key: 'storyline', label: 'Storyline', desc: 'A narrative connecting your career journey to this opportunity.' },
    { key: 'disruptive', label: 'Disruptive', desc: 'Direct and unconventional — leads with impact over formality.' },
    { key: 'regular', label: 'Regular', desc: 'Standard professional format — universally appropriate.' },
    { key: 'custom', label: 'Custom', desc: 'Describe your angle — Hopper shapes it into a polished letter.' },
] as const;

type ModeKey = typeof MODES[number]['key'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CoverLettersPage() {
    const router = useRouter();
    const { token, isAuthenticated, _hasHydrated } = useStore();

    const [letters, setLetters] = useState<CoverLetter[]>([]);
    const [jobs, setJobs] = useState<JobListItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [mode, setMode] = useState<ModeKey>('auto');
    const [customPrompt, setCustomPrompt] = useState('');
    const [generating, setGenerating] = useState(false);
    const [letterText, setLetterText] = useState('');
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);

    const [toneAnalysis, setToneAnalysis] = useState<JDToneAnalysis | null>(null);

    // New letter modal state
    const [showNewModal, setShowNewModal] = useState(false);
    const [modalTab, setModalTab] = useState<'jobs' | 'paste'>('jobs');
    const [modalSearch, setModalSearch] = useState('');
    const [pastedJd, setPastedJd] = useState('');
    const [pastedCompany, setPastedCompany] = useState('');

    // Draft state — job selected from picker OR raw JD pasted
    const [draftJobId, setDraftJobId] = useState<string | null>(null);
    const [draftJobDetail, setDraftJobDetail] = useState<Job | null>(null);
    const [draftJdText, setDraftJdText] = useState<string | null>(null);
    const [draftCompanyName, setDraftCompanyName] = useState<string | null>(null);

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) { router.push('/'); return; }
        loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, _hasHydrated]);

    const loadData = async () => {
        // Serve cached letters immediately to avoid blank screen on revisit
        const cachedLetters = coverLettersCache.get('all') as CoverLetter[] | null;
        if (cachedLetters && cachedLetters.length > 0) {
            setLetters(cachedLetters);
            setLoading(false);
            const first = cachedLetters[0];
            setActiveId(first.id);
            setMode((first.mode as ModeKey) || 'auto');
            const fullLetter = (first.content as Record<string, unknown>)?.full_letter;
            setLetterText(typeof fullLetter === 'string' ? fullLetter : '');
        }

        try {
            const [fetchedLetters, fetchedJobs] = await Promise.all([
                api.getCoverLetters().catch(() => [] as CoverLetter[]),
                api.getJobs().catch(() => [] as JobListItem[])
            ]);
            coverLettersCache.set('all', fetchedLetters);
            setLetters(fetchedLetters);
            setJobs(fetchedJobs);
            if (fetchedLetters.length > 0) {
                const first = fetchedLetters[0];
                setActiveId(first.id);
                setMode((first.mode as ModeKey) || 'auto');
                const fullLetter = (first.content as Record<string, unknown>)?.full_letter;
                setLetterText(typeof fullLetter === 'string' ? fullLetter : '');
            }
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    };

    const activeLetter = letters.find(l => l.id === activeId) ?? null;
    const resolvedJobId = activeLetter?.job_id ?? draftJobId;
    const activeJob = resolvedJobId ? jobs.find(j => j.id === resolvedJobId) ?? null : null;
    const canGenerate = !generating && (!!resolvedJobId || !!draftJdText);

    const selectLetter = useCallback((letter: CoverLetter) => {
        setActiveId(letter.id);
        setDraftJobId(null);
        setDraftJobDetail(null);
        setMode((letter.mode as ModeKey) || 'auto');
        const fullLetter = (letter.content as Record<string, unknown>)?.full_letter;
        setLetterText(typeof fullLetter === 'string' ? fullLetter : '');
        setToneAnalysis(null);
    }, []);

    // Fetch tone analysis when a job is active and mode is auto
    useEffect(() => {
        if (!resolvedJobId || mode !== 'auto') return;
        api.analyzeJDTone({ job_id: resolvedJobId }).then(setToneAnalysis).catch(() => {});
    }, [resolvedJobId, mode]);

    const handleGenerate = async () => {
        const jobId = activeLetter?.job_id ?? draftJobId;
        const isPastedFlow = !jobId && !!draftJdText;
        if (!jobId && !isPastedFlow) return;
        setGenerating(true);
        try {
            let jdText: string | undefined;
            let companyName: string | undefined;

            if (isPastedFlow) {
                // Pasted JD path — no job_id
                jdText = draftJdText ?? undefined;
                companyName = draftCompanyName ?? undefined;
            } else {
                // Existing job path — resolve JD from job record
                if (draftJobDetail?.job_posting?.raw_jd) {
                    jdText = draftJobDetail.job_posting.raw_jd;
                } else {
                    const listItem = jobs.find(j => j.id === jobId);
                    if (listItem?.job_posting?.raw_jd) {
                        jdText = listItem.job_posting.raw_jd;
                    } else {
                        const full = await api.getJob(jobId!);
                        jdText = full?.job_posting?.raw_jd;
                    }
                }
                companyName = activeJob?.job_posting?.company_name;
            }

            const result = await api.createCoverLetter({
                job_id: jobId ?? undefined,
                mode,
                custom_prompt: mode === 'custom' ? customPrompt : undefined,
                jd_text: jdText,
                company_name: companyName,
            });
            const fullLetter = (result.content as Record<string, unknown>)?.full_letter;
            if (typeof fullLetter === 'string') setLetterText(fullLetter);

            // Reload letters list and update cache
            const updatedLetters = await api.getCoverLetters().catch(() => letters);
            coverLettersCache.set('all', updatedLetters);
            setLetters(updatedLetters);
            setActiveId(result.id);
            setDraftJobId(null);
            setDraftJobDetail(null);
            setDraftJdText(null);
            setDraftCompanyName(null);

            // Promote job to "applied" if it was only "tracked"
            if (jobId) {
                const jobInList = jobs.find(j => j.id === jobId);
                if (jobInList && jobInList.status === 'tracked') {
                    await api.updateJob(jobId, { status: 'applied' }).catch(() => {});
                    setJobs(prev => prev.map(j =>
                        j.id === jobId ? { ...j, status: 'applied' as const } : j
                    ));
                }
            }
        } catch (err) {
            if (isApiError(err)) {
                console.error("API error:", err.message);
            } else {
                console.error(err);
            }
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async () => {
        if (!activeId) return;
        try {
            await api.updateCoverLetter(activeId, { full_letter: letterText });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
        } catch { /* ignore */ }
    };

    const handleCopy = () => {
        navigator.clipboard?.writeText(letterText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleDownloadPdf = () => {
        if (!letterText) return;
        import('jspdf').then(({ jsPDF }) => {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
            const marginLeft = 1;
            const marginTop = 1;
            const contentWidth = 6.5;
            const lineHeight = 0.22;
            doc.setFont('times', 'normal');
            doc.setFontSize(11);
            const lines = doc.splitTextToSize(letterText, contentWidth);
            let y = marginTop;
            lines.forEach((line: string) => {
                if (y > 10) { doc.addPage(); y = marginTop; }
                doc.text(line, marginLeft, y);
                y += lineHeight;
            });
            const company = activeJob?.job_posting?.company_name?.replace(/[^a-z0-9]/gi, '_') || 'Cover_Letter';
            doc.save(`Cover_Letter_${company}.pdf`);
        });
    };

    const handlePasteJd = () => {
        if (!pastedJd.trim()) return;
        setShowNewModal(false);
        setActiveId(null);
        setLetterText('');
        setToneAnalysis(null);
        setDraftJobId(null);
        setDraftJobDetail(null);
        setDraftJdText(pastedJd.trim());
        setDraftCompanyName(pastedCompany.trim() || null);
        setPastedJd('');
        setPastedCompany('');
    };

    const handleSelectJob = async (jobId: string) => {
        setShowNewModal(false);
        setModalSearch('');

        // If there's already a letter for this job, just select it
        const existing = letters.find(l => l.job_id === jobId);
        if (existing) {
            selectLetter(existing);
            return;
        }

        // Otherwise set as draft and fetch full job details for the JD
        setActiveId(null);
        setLetterText('');
        setToneAnalysis(null);
        setDraftJobId(jobId);
        const full = await api.getJob(jobId).catch(() => null);
        setDraftJobDetail(full);
    };

    const filteredJobs = jobs.filter(job => {
        if (!modalSearch.trim()) return true;
        const q = modalSearch.toLowerCase();
        return (job.job_posting?.job_title || '').toLowerCase().includes(q)
            || (job.job_posting?.company_name || '').toLowerCase().includes(q);
    });

    if (!_hasHydrated || !isAuthenticated || loading) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
                <Header />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
                    <div className="wand-spin" style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
                </div>
            </div>
        );
    }

    const activeMode = MODES.find(m => m.key === mode);

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
            <Header />

            <TopBar
                title="Cover letters"
                subtitle="Write, refine, and manage cover letters for your applications. Choose a tone, edit freely, then share or download."
                right={
                    <Btn icon={<PlusIcon />} onClick={() => setShowNewModal(true)}>New letter</Btn>
                }
            />

            {letters.length === 0 && !draftJobId && !draftJdText ? (
                <div style={{ padding: '80px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>No cover letters yet. Start from a tracked job or paste a job description.</div>
                    <button
                        onClick={() => setShowNewModal(true)}
                        style={{ fontSize: 13.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                        Create your first one →
                    </button>
                </div>
            ) : (
                <div style={{ padding: '20px 24px 100px', display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr) 280px', gap: 16, alignItems: 'flex-start' }}>
                    {/* LEFT — history */}
                    <div style={{ position: 'sticky', top: 90 }}>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-soft)' }}>
                                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>History</div>
                            </div>
                            {letters.map(letter => {
                                const isActive = letter.id === activeId;
                                const job = jobs.find(j => j.id === letter.job_id);
                                const role = job?.job_posting?.job_title
                                    || (letter.content as Record<string, unknown>)?.job_title as string
                                    || 'Cover Letter';
                                const company = job?.job_posting?.company_name
                                    || (letter.content as Record<string, unknown>)?.company_name as string
                                    || '';
                                return (
                                    <button
                                        key={letter.id}
                                        onClick={() => selectLetter(letter)}
                                        style={{
                                            display: 'block', width: '100%', textAlign: 'left',
                                            padding: '12px 14px',
                                            background: isActive ? 'var(--bg-tint)' : 'transparent',
                                            transition: 'all 120ms',
                                            cursor: 'pointer',
                                            border: 'none',
                                            borderBottomStyle: 'solid',
                                            borderBottomWidth: 1,
                                            borderBottomColor: 'var(--border-soft)',
                                            borderLeftStyle: 'solid',
                                            borderLeftWidth: 2,
                                            borderLeftColor: isActive ? 'var(--accent)' : 'transparent',
                                        }}
                                    >
                                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</div>
                                        {company && <div style={{ fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>{company}</div>}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center',
                                                height: 18, padding: '0 7px', fontSize: 10.5, fontWeight: 500,
                                                border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
                                                color: 'var(--text-3)', background: 'transparent',
                                            }}>{letter.mode}</span>
                                            <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{timeAgo(letter.updated_at)}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* MIDDLE — writing canvas */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {/* Mode strip */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: 5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', flexWrap: 'wrap' }}>
                            {MODES.map(m => {
                                const isActive = mode === m.key;
                                return (
                                    <button
                                        key={m.key}
                                        onClick={() => setMode(m.key)}
                                        title={m.desc}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                            height: 28, padding: '0 11px', borderRadius: 'var(--radius-sm)',
                                            background: isActive ? 'var(--text)' : 'transparent',
                                            color: isActive ? 'var(--bg)' : 'var(--text-2)',
                                            fontSize: 12.5, fontWeight: 500,
                                            border: 'none', cursor: 'pointer',
                                            transition: 'all 140ms',
                                        }}
                                    >
                                        {m.key === 'auto' && <SparklesIcon />}
                                        {m.label}
                                        {m.key === 'auto' && isActive && toneAnalysis && (
                                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, opacity: 0.7 }}>
                                                → {toneAnalysis.recommended_mode}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                            <div style={{ marginLeft: 'auto' }}>
                                <Btn
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleGenerate}
                                    disabled={!canGenerate}
                                >
                                    {generating ? 'Generating…' : letterText ? 'Regenerate' : 'Generate'}
                                </Btn>
                            </div>
                        </div>

                        {/* Custom prompt */}
                        {mode === 'custom' && (
                            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
                                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                                    Custom prompt
                                </div>
                                <textarea
                                    value={customPrompt}
                                    onChange={e => setCustomPrompt(e.target.value)}
                                    rows={3}
                                    placeholder="e.g. Write this as if I'm responding to a previous email from Anya. Use 2 paragraphs max."
                                    style={{
                                        width: '100%', resize: 'vertical', minHeight: 70,
                                        background: 'var(--bg-tint)', border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm)', padding: 10,
                                        fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'var(--font-body)',
                                        lineHeight: 1.5, boxSizing: 'border-box',
                                    }}
                                />
                            </div>
                        )}

                        {/* Writing canvas */}
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', position: 'relative' }}>
                            {/* Toolbar */}
                            <div style={{ padding: '9px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-tint)' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {activeJob && (
                                        <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                                            {activeJob.job_posting.job_title} · <span style={{ color: 'var(--text)' }}>{activeJob.job_posting.company_name}</span>
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    <Btn size="sm" variant="ghost" onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</Btn>
                                    <Btn
                                        size="sm"
                                        variant="soft"
                                        icon={<DownloadIcon />}
                                        onClick={handleDownloadPdf}
                                        disabled={!letterText}
                                    >
                                        Download PDF
                                    </Btn>
                                    <Btn size="sm" variant="secondary" onClick={handleSave}>{saved ? 'Saved' : 'Save'}</Btn>
                                </div>
                            </div>

                            {/* Shimmer bar when generating */}
                            {generating && (
                                <div style={{ position: 'absolute', top: 47, left: 0, right: 0, height: 2, background: 'var(--surface-2)', overflow: 'hidden', zIndex: 2 }}>
                                    <div className="wand-shimmer" style={{ height: '100%', width: '100%' }} />
                                </div>
                            )}

                            {/* Paper area */}
                            <div style={{ padding: '40px 56px', background: 'var(--surface)', minHeight: 520, position: 'relative' }}>
                                {/* Faux page line */}
                                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(to right, var(--border-soft) 1px, transparent 1px) 56px 0 / 100% 100%' }} />
                                {(draftJobId || draftJdText) && !letterText && !generating ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 480, gap: 12, position: 'relative', zIndex: 1 }}>
                                        {draftJdText ? (
                                            <>
                                                <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
                                                    Ready to generate
                                                    {draftCompanyName ? <> for <span style={{ color: 'var(--text)', fontWeight: 500 }}>{draftCompanyName}</span></> : null}
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Job description attached · unified profile loaded · choose a mode above, then hit Generate</div>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
                                                    Ready to generate for <span style={{ color: 'var(--text)', fontWeight: 500 }}>{activeJob?.job_posting.job_title ?? 'this role'}</span>
                                                    {activeJob?.job_posting.company_name ? <> at <span style={{ color: 'var(--text)', fontWeight: 500 }}>{activeJob.job_posting.company_name}</span></> : null}
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Job description attached · unified profile loaded · choose a mode above, then hit Generate</div>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <textarea
                                        value={letterText}
                                        onChange={e => setLetterText(e.target.value)}
                                        placeholder={generating ? '' : 'Generate a draft, then edit freely here.'}
                                        style={{
                                            width: '100%', minHeight: 480, resize: 'none',
                                            background: 'transparent', border: 'none', outline: 'none',
                                            fontFamily: 'var(--font-display)', fontSize: 16.5, lineHeight: 1.7,
                                            color: 'var(--text)', whiteSpace: 'pre-wrap', letterSpacing: '-0.005em',
                                            position: 'relative', zIndex: 1,
                                            paddingLeft: 20, paddingRight: 40, boxSizing: 'border-box',
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT — tone & context panel */}
                    <div style={{ position: 'sticky', top: 90, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {/* Auto mode: tone analysis */}
                        {mode === 'auto' && (
                            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    <SparklesIcon />
                                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Tone analysis</span>
                                    {toneAnalysis && (
                                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                                            {Math.round(toneAnalysis.confidence * 100)}% conf.
                                        </span>
                                    )}
                                </div>

                                {toneAnalysis ? (
                                    <>
                                        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 3 }}>Recommended</div>
                                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 22px)', color: 'var(--text)', marginBottom: 8, textTransform: 'capitalize' }}>
                                            {toneAnalysis.recommended_mode}
                                        </div>
                                        <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 12 }}>
                                            {toneAnalysis.reasoning}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            <ToneRow label="Tone" items={toneAnalysis.tone_signals} />
                                            <ToneRow label="Culture" items={toneAnalysis.culture_indicators} />
                                            <ToneRow label="Formality" items={[toneAnalysis.formality_level]} />
                                            <ToneRow label="Industry" items={[toneAnalysis.industry]} />
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic' }}>
                                        {activeLetter?.job_id ? 'Loading tone analysis…' : 'Select a job-linked letter to see tone analysis.'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Non-auto, non-custom: mode description */}
                        {mode !== 'auto' && mode !== 'custom' && activeMode && (
                            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
                                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                                    {activeMode.label} mode
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{activeMode.desc}</div>
                            </div>
                        )}

                        {/* Context used */}
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
                            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>
                                Context used
                            </div>
                            <ContextItem label="Your unified profile" hint="skills, experience & preferences" />
                            {draftJdText ? (
                                <>
                                    <ContextItem label="Job description" hint="full text attached" />
                                    {draftCompanyName && <ContextItem label={draftCompanyName} hint="company name provided" />}
                                </>
                            ) : resolvedJobId ? (
                                <>
                                    <ContextItem
                                        label={activeJob?.job_posting.company_name || 'Company'}
                                        hint={activeJob?.job_posting.job_title || 'Job description attached'}
                                    />
                                    <ContextItem label="Job description" hint={draftJobDetail?.job_posting?.raw_jd ? 'full JD attached' : 'via job record'} />
                                    <ContextItem label="Company intel" hint="from JobLens analysis" />
                                </>
                            ) : (
                                <ContextItem label="No job linked" hint="Select a job or paste a job description" />
                            )}
                        </div>
                    </div>
                </div>
            )}


            {/* New letter modal */}
            {showNewModal && (
                <div
                    onClick={() => { setShowNewModal(false); setModalSearch(''); setPastedJd(''); setPastedCompany(''); }}
                    style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / 0.35)', backdropFilter: 'blur(3px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        className="wand-fadeup"
                        style={{ width: '100%', maxWidth: 520, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-2)', overflow: 'hidden', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
                    >
                        {/* Header */}
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>New cover letter</span>
                            <button onClick={() => { setShowNewModal(false); setModalSearch(''); setPastedJd(''); setPastedCompany(''); }} style={{ fontSize: 18, color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}>×</button>
                        </div>

                        {/* Tab strip */}
                        <div style={{ display: 'flex', gap: 3, padding: '10px 16px 0', background: 'var(--bg-tint)', borderBottom: '1px solid var(--border-soft)' }}>
                            {([['jobs', 'From tracked job'], ['paste', 'Paste job description']] as const).map(([tab, label]) => (
                                <button
                                    key={tab}
                                    onClick={() => setModalTab(tab)}
                                    style={{
                                        height: 32, padding: '0 12px', fontSize: 13, fontWeight: 500,
                                        borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                                        background: modalTab === tab ? 'var(--surface)' : 'transparent',
                                        color: modalTab === tab ? 'var(--text)' : 'var(--text-3)',
                                        borderBottom: modalTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                                        cursor: 'pointer', transition: 'all 120ms',
                                    }}
                                >{label}</button>
                            ))}
                        </div>

                        {/* Tab: From tracked job */}
                        {modalTab === 'jobs' && (
                            <>
                                <div style={{ padding: '12px 16px' }}>
                                    <input
                                        type="text"
                                        placeholder="Search by title, company…"
                                        value={modalSearch}
                                        onChange={e => setModalSearch(e.target.value)}
                                        autoFocus
                                        style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-tint)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}>
                                    {filteredJobs.length === 0 ? (
                                        <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
                                            {modalSearch ? 'No matching jobs.' : 'No tracked jobs found.'}
                                        </div>
                                    ) : filteredJobs.map((job, idx) => (
                                        <button
                                            key={job.id}
                                            onClick={() => handleSelectJob(job.id)}
                                            style={{
                                                display: 'block', width: '100%', textAlign: 'left',
                                                padding: '10px 16px', cursor: 'pointer', background: 'transparent', border: 'none',
                                                borderBottom: idx < filteredJobs.length - 1 ? '1px solid var(--border-soft)' : 'none',
                                                transition: 'background 120ms',
                                            }}
                                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tint)'; }}
                                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                                        >
                                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{job.job_posting.job_title}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{job.job_posting.company_name}</div>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {/* Tab: Paste JD */}
                        {modalTab === 'paste' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, flex: 1, overflowY: 'auto' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                                        Job description <span style={{ color: 'var(--weak)' }}>*</span>
                                    </label>
                                    <textarea
                                        autoFocus
                                        value={pastedJd}
                                        onChange={e => setPastedJd(e.target.value)}
                                        placeholder="Paste the full job description here…"
                                        rows={10}
                                        style={{
                                            resize: 'vertical', minHeight: 180, padding: 10,
                                            background: 'var(--bg-tint)', border: '1px solid var(--border)',
                                            borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)',
                                            outline: 'none', fontFamily: 'var(--font-body)', lineHeight: 1.5,
                                            transition: 'border-color 140ms',
                                        }}
                                        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                                        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                                        Company name <span style={{ color: 'var(--text-4)' }}>(optional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={pastedCompany}
                                        onChange={e => setPastedCompany(e.target.value)}
                                        placeholder="e.g. Acme Corp"
                                        style={{
                                            height: 34, padding: '0 10px', fontSize: 13,
                                            background: 'var(--bg-tint)', border: '1px solid var(--border)',
                                            borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
                                            transition: 'border-color 140ms',
                                        }}
                                        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                                        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                                    />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                                    <button
                                        onClick={handlePasteJd}
                                        disabled={!pastedJd.trim()}
                                        style={{
                                            height: 34, padding: '0 18px', fontSize: 13, fontWeight: 500,
                                            borderRadius: 'var(--radius-sm)', border: 'none',
                                            background: pastedJd.trim() ? 'var(--btn-primary)' : 'var(--surface-2)',
                                            color: pastedJd.trim() ? 'var(--on-btn-primary)' : 'var(--text-3)',
                                            cursor: pastedJd.trim() ? 'pointer' : 'not-allowed',
                                            transition: 'all 140ms ease',
                                        }}
                                    >
                                        Use this job description →
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToneRow({ label, items }: { label: string; items: string[] }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', width: 64, flexShrink: 0, marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {items.filter(Boolean).map(item => (
                    <span key={item} style={{
                        display: 'inline-flex', alignItems: 'center',
                        height: 20, padding: '0 7px', fontSize: 11, fontWeight: 500,
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-2)', background: 'transparent',
                    }}>{item}</span>
                ))}
            </div>
        </div>
    );
}

function ContextItem({ label, hint }: { label: string; hint?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border-soft)' }}>
            <div style={{ width: 24, height: 24, borderRadius: 'var(--radius-xs)', background: 'var(--bg-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-2)' }}>
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                {hint && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{hint}</div>}
            </div>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--strong)', flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
            </svg>
        </div>
    );
}

function PlusIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

function SparklesIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
            <path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
        </svg>
    );
}
