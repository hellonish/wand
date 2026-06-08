'use client';

import { useEffect, useState, use, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import {
    api,
    isApiError,
    Job,
    JobLensSession,
    type CompanyIntelResult,
    type JobDescriptionBreakdownResult,
    type JobMatchResult,
    type ReachoutResult,
    type UnifiedProfile,
} from '@/utils/api';
import Header from '@/components/Header';
import { subscribeToJobLens } from '@/hooks/useGlobalWebSocket';
import { joblensCache } from '@/utils/cache';
import ConfirmationModal from '@/components/ConfirmationModal';

// ─── Step metadata ────────────────────────────────────────────────────────────

const STEPS = [
    { key: 'profile',         label: 'Profile snapshot',     description: 'Career documents and structured data used to assess this role.' },
    { key: 'job_description', label: 'Job description',      description: 'Key requirements, skills, and signals extracted from the posting.' },
    { key: 'company_intel',   label: 'Company intel',        description: 'Engineering culture, team structure, and signals from public sources.' },
    { key: 'match_analysis',  label: 'Match analysis',       description: 'Fit score with skill evidence, responsibility gaps, and constraint checks.' },
    { key: 'resume_actions',  label: 'Resume actions',       description: 'Targeted resume tailoring — what to update, replace, or cut for this role.' },
    { key: 'reachout',        label: 'Reachout candidates',  description: 'Contacts worth reaching out to, with role context and suggested angles.' },
] as const;

type StepKey = typeof STEPS[number]['key'];
type StepStatus = 'idle' | 'running' | 'done' | 'error';

const SESSION_FIELD: Record<StepKey, keyof JobLensSession> = {
    profile:         'profile_snapshot',
    job_description: 'job_description',
    company_intel:   'company_intel',
    match_analysis:  'match_analysis',
    resume_actions:  'resume_actions',
    reachout:        'reachout',
};

const STATUS_OPTIONS = [
    { value: 'tracked',   label: 'Tracked' },
    { value: 'applied',   label: 'Applied' },
    { value: 'interview', label: 'Interview' },
    { value: 'offer',     label: 'Offer' },
    { value: 'rejected',  label: 'Rejected' },
    { value: 'archived',  label: 'Archived' },
];

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
    analyzing: 'Analyzing…',
};

const PIPELINE_STATUS_LABELS: Record<string, string> = {
    queued: 'Queued',
    analyzing: 'Analyzing…',
};

// ─── Score band helpers ───────────────────────────────────────────────────────

function scoreToBand(score: number): 'strong' | 'good' | 'partial' | 'weak' {
    if (score >= 80) return 'strong';
    if (score >= 70) return 'good';
    if (score >= 55) return 'partial';
    return 'weak';
}

const BAND_COLOR = { strong: 'var(--strong)', good: 'var(--good)', partial: 'var(--partial)', weak: 'var(--weak)' };
const BAND_LABEL = { strong: 'Strong', good: 'Good', partial: 'Partial', weak: 'Weak' };

// ─── timeAgo ─────────────────────────────────────────────────────────────────

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

// ─── hashHue ─────────────────────────────────────────────────────────────────

function hashHue(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
}

// ─── Helpers for data extraction ─────────────────────────────────────────────

const s = (val: unknown, fallback = '—'): string =>
    val != null && val !== '' ? String(val) : fallback;

function arr<T = unknown>(val: unknown): T[] {
    return Array.isArray(val) ? (val as T[]) : [];
}

function obj(val: unknown): Record<string, unknown> {
    return val && typeof val === 'object' && !Array.isArray(val) ? val as Record<string, unknown> : {};
}

function labelize(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function compact(values: unknown[]): string[] {
    return values.map(v => s(v, '')).filter(Boolean);
}

// ─── CompanyMark ─────────────────────────────────────────────────────────────

function CompanyMark({ name, size = 28 }: { name: string; size?: number }) {
    const hue = hashHue(name);
    const label = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return (
        <div style={{
            width: size, height: size, borderRadius: 'var(--radius-sm)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `oklch(0.92 0.05 ${hue} / 0.55)`, color: `oklch(0.30 0.08 ${hue})`,
            fontFamily: 'var(--font-mono)', fontSize: size * 0.38, fontWeight: 600,
            letterSpacing: '0.02em', flexShrink: 0, border: '1px solid var(--border-soft)',
        }}>
            {label}
        </div>
    );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, flexShrink: 0 }}>
                    {right}
                </div>
            )}
        </div>
    );
}

// ─── ScoreRing ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 56, stroke = 4 }: { score: number; size?: number; stroke?: number }) {
    const band = scoreToBand(score);
    const color = BAND_COLOR[band];
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const dash = (score / 100) * c;
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={stroke} />
                <circle
                    cx={size / 2} cy={size / 2} r={r} fill="none"
                    stroke={color} strokeWidth={stroke}
                    strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{ transition: 'stroke-dasharray 600ms ease' }}
                />
            </svg>
            <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: size * 0.28, fontWeight: 500,
                color: 'var(--text)', letterSpacing: '-0.02em',
            }}>
                {score}
            </div>
        </div>
    );
}

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({ tone, children, size = 'md' }: { tone: string; children: React.ReactNode; size?: 'sm' | 'md' }) {
    const toneMap: Record<string, { bg: string; fg: string }> = {
        strong:  { bg: 'var(--strong-soft)',  fg: 'var(--strong)' },
        good:    { bg: 'var(--good-soft)',    fg: 'var(--good)' },
        partial: { bg: 'var(--partial-soft)', fg: 'var(--partial)' },
        weak:    { bg: 'var(--weak-soft)',    fg: 'var(--weak)' },
        accent:  { bg: 'var(--accent-soft)',  fg: 'var(--accent-ink)' },
        neutral: { bg: 'var(--surface-2)',    fg: 'var(--text-2)' },
        ghost:   { bg: 'transparent',         fg: 'var(--text-3)' },
    };
    const { bg, fg } = toneMap[tone] || toneMap.neutral;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center',
            height: size === 'sm' ? 18 : 22, padding: size === 'sm' ? '0 6px' : '0 8px',
            borderRadius: 999, background: bg, color: fg,
            fontFamily: 'var(--font-mono)', fontSize: size === 'sm' ? 10.5 : 11.5, fontWeight: 500,
            letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>
            {children}
        </span>
    );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--pad-card)',
            ...style,
        }}>
            {children}
        </div>
    );
}

// ─── SectionTitle ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-3)', marginTop: 4, marginBottom: 6,
        }}>
            {children}
        </div>
    );
}

// ─── FactGrid ─────────────────────────────────────────────────────────────────

function FactGrid({ items }: { items: Array<[string, unknown]> }) {
    const visible = items.filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0));
    if (visible.length === 0) return null;
    return (
        <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0,
            border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)',
            overflow: 'hidden', background: 'var(--bg-tint)', marginBottom: 14,
        }}>
            {visible.map(([k, v], i) => (
                <div key={k} style={{
                    padding: '10px 12px',
                    borderRight: (i + 1) % 4 === 0 ? 'none' : '1px solid var(--border-soft)',
                    borderTop: i >= 4 ? '1px solid var(--border-soft)' : 'none',
                }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', marginBottom: 2 }}>{k}</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 2 }}>
                        {Array.isArray(v) ? v.join(', ') : s(v)}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── SignalList ───────────────────────────────────────────────────────────────

function SignalList({ title, items, tone = 'neutral' }: { title: string; items: string[]; tone?: string }) {
    return (
        <div>
            <SectionTitle>{title}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
                        <span style={{
                            width: 4, height: 4, borderRadius: 999, marginTop: 8, flexShrink: 0,
                            background: tone === 'accent' ? 'var(--accent)' : 'var(--text-4)',
                        }} />
                        {item}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── TagCloud ─────────────────────────────────────────────────────────────────

function TagCloud({ items, tone = 'neutral' }: { items: string[]; tone?: string }) {
    const toneMap: Record<string, { bg: string; fg: string }> = {
        neutral: { bg: 'var(--surface-2)',    fg: 'var(--text-2)' },
        accent:  { bg: 'var(--accent-soft)',  fg: 'var(--accent-ink)' },
        ghost:   { bg: 'var(--bg-tint)',      fg: 'var(--text-3)' },
    };
    const { bg, fg } = toneMap[tone] || toneMap.neutral;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {items.map((item, i) => (
                <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center',
                    height: 22, padding: '0 8px', borderRadius: 999,
                    background: bg, color: fg,
                    fontFamily: 'var(--font-mono)', fontSize: 11, border: '1px solid var(--border-soft)',
                }}>
                    {item}
                </span>
            ))}
        </div>
    );
}

// ─── SkeletonLines ────────────────────────────────────────────────────────────

function SkeletonLines({ lines = 3 }: { lines?: number }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' }}>
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="wand-shimmer" style={{
                    height: 10, borderRadius: 999,
                    background: 'linear-gradient(90deg, var(--surface-2) 0%, var(--bg-tint) 50%, var(--surface-2) 100%)',
                    backgroundSize: '200% 100%', width: `${85 - i * 10}%`,
                }} />
            ))}
        </div>
    );
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

function Warnings({ items }: { items?: string[] }) {
    if (!items?.length) return null;
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: 12, borderRadius: 'var(--radius-sm)',
            background: 'var(--partial-soft)', border: '1px solid transparent',
            color: 'var(--partial)', marginTop: 12,
        }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Notes from extraction</div>
            {items.map((w, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>{w}</div>
            ))}
        </div>
    );
}

// ─── Module state glyph ───────────────────────────────────────────────────────

function ModuleGlyph({ state }: { state: StepStatus | 'idle' }) {
    if (state === 'done') {
        return (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6.25" stroke="var(--strong)" strokeWidth="1.5" fill="var(--strong-soft)" />
                <path d="M4.5 7L6.5 9L9.5 5.5" stroke="var(--strong)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (state === 'running') {
        return (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="wand-spin">
                <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
            </svg>
        );
    }
    if (state === 'error') {
        return (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6.25" stroke="var(--weak)" strokeWidth="1.5" fill="var(--weak-soft)" />
                <path d="M5 5L9 9M9 5L5 9" stroke="var(--weak)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        );
    }
    // idle / queued
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
    );
}

// ─── Step content renderers ───────────────────────────────────────────────────

function ProfileExtractView({ data }: { data: UnifiedProfile }) {
    const basics = data.basics || {};
    const contact = (basics as Record<string, unknown>).contact_info as Record<string, unknown> || {};
    const experiences = data.work_experience || [];
    const education = data.education || [];
    const skills = (data as Record<string, unknown>).skills as string[] || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
            <FactGrid items={[
                ['Name', (basics as Record<string, unknown>).name],
                ['Title', (basics as Record<string, unknown>).title],
                ['Location', (basics as Record<string, unknown>).location],
                ['Email', contact.email],
                ['LinkedIn', contact.linkedin_url],
                ['Portfolio', contact.portfolio_url],
            ]} />
            {!!(basics as Record<string, unknown>).summary && (
                <div>
                    <SectionTitle>Profile Summary</SectionTitle>
                    <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 720 }}>
                        {s((basics as Record<string, unknown>).summary)}
                    </p>
                </div>
            )}
            {skills.length > 0 && (
                <div>
                    <SectionTitle>Skills</SectionTitle>
                    <TagCloud items={skills} />
                </div>
            )}
            {experiences.length > 0 && (
                <div>
                    <SectionTitle>Recent Experience</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {experiences.slice(0, 3).map((exp, i) => (
                            <div key={i} style={{
                                display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16,
                                padding: '12px 14px', background: 'var(--bg-tint)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                            }}>
                                <div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                                        {compact([exp.start_date, exp.end_date || (exp.is_current ? 'Present' : null)]).join(' – ')}
                                    </div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>{s(exp.location, '')}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>{s(exp.job_title)}</div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 6 }}>{s(exp.company_name)}</div>
                                    {[...(exp.achievements || []), ...(exp.description || [])].slice(0, 4).map((b, j) => (
                                        <p key={j} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0' }}>• {s(b)}</p>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {education.length > 0 && (
                <div>
                    <SectionTitle>Education</SectionTitle>
                    {education.slice(0, 3).map((item, i) => (
                        <p key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, margin: '3px 0' }}>
                            {compact([item.institution, item.degree, item.major, item.graduation_year]).join(' · ')}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

function JDParseView({ data }: { data: JobDescriptionBreakdownResult }) {
    const breakdown = data.breakdown || {};
    const metadata = obj(breakdown.metadata);
    const company = obj(breakdown.company_context);
    const role = obj(breakdown.role_classification);
    const primarySkills = arr<Record<string, unknown>>(breakdown.primary_skills);
    const secondarySkills = arr<Record<string, unknown>>(breakdown.secondary_skills);
    const responsibilities = arr<Record<string, unknown>>(breakdown.responsibilities);
    const qualifications = arr<Record<string, unknown>>(breakdown.qualifications);
    const constraints = arr<Record<string, unknown>>(breakdown.constraints);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
            <FactGrid items={[
                ['Company', metadata.company_name],
                ['Role', metadata.job_title],
                ['Seniority', metadata.seniority_level],
                ['Work Mode', metadata.work_mode],
                ['Employment', metadata.employment_type],
                ['Location', metadata.location],
                ['Experience', compact([metadata.years_of_experience_min, metadata.years_of_experience_max]).join(' – ')],
                ['Track', role.primary_track],
            ]} />
            {!!company.summary && (
                <div>
                    <SectionTitle>Company Context</SectionTitle>
                    <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{s(company.summary)}</p>
                    <TagCloud items={compact([company.industry, company.company_stage_or_scale, ...arr<string>(company.domain_signals)])} />
                </div>
            )}
            {primarySkills.length > 0 && (
                <div>
                    <SectionTitle>Primary Skills</SectionTitle>
                    <TagCloud items={primarySkills.map(sk => s(sk.name)).filter(n => n !== '—')} tone="accent" />
                </div>
            )}
            {secondarySkills.length > 0 && (
                <div>
                    <SectionTitle>Secondary Skills</SectionTitle>
                    <TagCloud items={secondarySkills.map(sk => s(sk.name)).filter(n => n !== '—')} />
                </div>
            )}
            {responsibilities.length > 0 && (
                <div>
                    <SectionTitle>Responsibilities</SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
                        {responsibilities.map((r, i) => (
                            <li key={i}>{compact([r.action, r.object, r.context]).join(' ')}</li>
                        ))}
                    </ul>
                </div>
            )}
            {(qualifications.length > 0 || constraints.length > 0) && (
                <div>
                    <SectionTitle>Requirements & Constraints</SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
                        {qualifications.map((q, i) => <li key={`q-${i}`}>{compact([q.text, q.importance]).join(' · ')}</li>)}
                        {constraints.map((c, i) => <li key={`c-${i}`}>{compact([c.text, c.category, c.is_must_have ? 'must have' : null]).join(' · ')}</li>)}
                    </ul>
                </div>
            )}
            {arr<string>(breakdown.keywords).length > 0 && (
                <div>
                    <SectionTitle>Keywords</SectionTitle>
                    <TagCloud items={arr<string>(breakdown.keywords)} tone="accent" />
                </div>
            )}
        </div>
    );
}

function CompanyIntelView({ data }: { data: CompanyIntelResult }) {
    const identity = obj(data.identity);
    const engineering = obj(data.engineering_presence);
    const tech = obj(data.technical_signals);
    const culture = obj(data.engineering_culture);
    const hiring = obj(data.hiring_signals);
    const products = data.product_signals || [];

    const techGroups = [
        ['Languages', arr<string>(tech.programming_languages)],
        ['Frameworks', arr<string>(tech.frameworks)],
        ['Cloud', arr<string>(tech.cloud)],
        ['Infrastructure', arr<string>(tech.infrastructure)],
        ['Databases', arr<string>(tech.databases)],
        ['Data / AI / ML', arr<string>(tech.data_ai_ml)],
        ['Architecture', arr<string>(tech.architecture_patterns)],
    ].filter(([, vals]) => (vals as string[]).length > 0) as Array<[string, string[]]>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
            {!!identity.name && (
                <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 18px)', color: 'var(--text)' }}>{s(identity.name)}</div>
                    {!!identity.short_description && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5, maxWidth: 720 }}>{s(identity.short_description)}</p>}
                    {!!identity.mission && <p style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic', marginTop: 6, lineHeight: 1.5 }}>"{s(identity.mission)}"</p>}
                </div>
            )}
            <FactGrid items={[
                ['Industry', identity.industry],
                ['Stage', identity.company_stage_or_scale],
                ['Founded', identity.founded],
                ['HQ', identity.headquarters_or_distribution],
            ]} />
            {products.length > 0 && (
                <div>
                    <SectionTitle>Product Signals</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {products.slice(0, 4).map((p, i) => (
                            <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-tint)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)' }}>
                                <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>{s(p.name, 'Product signal')}</div>
                                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>{s(p.description)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {techGroups.length > 0 && (
                <div>
                    <SectionTitle>Technical Signals</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {techGroups.map(([cat, vals]) => (
                            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', width: 90, flexShrink: 0 }}>{cat.toLowerCase()}</span>
                                <TagCloud items={vals} tone="ghost" />
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <SignalList title="Culture" items={[
                    ...arr<string>(culture.values),
                    ...arr<string>(culture.working_style),
                    ...arr<string>(culture.quality_signals),
                ]} />
                <SignalList title="Hiring Signals" items={[
                    ...arr<string>(hiring.team_structure),
                    ...arr<string>(hiring.hiring_locations),
                    s(hiring.remote_or_work_mode, ''),
                ].filter(Boolean)} tone="accent" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                    Sources: {(data.source_pages || []).length} pages
                </span>
            </div>
        </div>
    );
}

function EvidenceStrengthDots({ strength }: { strength: number }) {
    return (
        <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map(n => (
                <span key={n} style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: n <= strength ? 'var(--accent)' : 'var(--surface-2)',
                    flexShrink: 0,
                }} />
            ))}
        </span>
    );
}

function MatchAnalysisView({ data }: { data: JobMatchResult }) {
    const summary = data.summary || {};
    const overallScore = (summary.total_score as number) ?? 0;
    const scores = arr<Record<string, unknown>>(data.score_components);
    const constraints = arr<Record<string, unknown>>(data.constraints);
    const skillMatches = arr<Record<string, unknown>>(data.skill_matches);
    const responsibilityMatches = arr<Record<string, unknown>>(data.responsibility_matches);
    const actions = [
        ...arr<Record<string, unknown>>(data.selected_actions),
        ...arr<Record<string, unknown>>(data.update_actions),
        ...arr<Record<string, unknown>>(data.replace_actions),
        ...arr<Record<string, unknown>>(data.delete_actions),
    ];
    const [activeTab, setActiveTab] = useState<'skills' | 'responsibilities' | 'constraints' | 'actions'>('skills');
    const [expandedSkill, setExpandedSkill] = useState<number | null>(null);
    const [expandedResp, setExpandedResp] = useState<number | null>(null);
    const band = scoreToBand(overallScore);

    const CONSTRAINT_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
        pass:            { bg: 'var(--strong-soft)', color: 'var(--strong)',   label: 'pass' },
        risk:            { bg: 'var(--partial-soft)', color: 'var(--partial)', label: 'risk' },
        fail:            { bg: 'var(--weak-soft)',    color: 'var(--weak)',    label: 'fail' },
        unknown:         { bg: 'var(--surface-2)',    color: 'var(--text-3)', label: '?' },
        not_applicable:  { bg: 'var(--surface-2)',    color: 'var(--text-3)', label: 'n/a' },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 14 }}>
            {/* Score components */}
            {scores.length > 0 && (
                <div>
                    <SectionTitle>Score Components</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                        {scores.map((sc, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 54px', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{s(sc.name)}</span>
                                <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', borderRadius: 999,
                                        width: `${Math.round((Number(sc.score || 0) / Number(sc.max_score || 1)) * 100)}%`,
                                        background: BAND_COLOR[scoreToBand(Math.round((Number(sc.score || 0) / Number(sc.max_score || 1)) * 100))],
                                        transition: 'width 600ms ease',
                                    }} />
                                </div>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text)', textAlign: 'right' }}>
                                    {Math.round((Number(sc.score || 0) / Number(sc.max_score || 1)) * 100)}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Strongest / gaps */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 'var(--radius-sm)', background: 'var(--strong-soft)', border: '1px solid transparent' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--strong)', marginBottom: 6 }}>Strongest matches</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
                        {(summary.strongest_matches as string[] || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>
                <div style={{ padding: 12, borderRadius: 'var(--radius-sm)', background: 'var(--weak-soft)', border: '1px solid transparent' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--weak)', marginBottom: 6 }}>Biggest gaps</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)' }}>
                        {(summary.biggest_gaps as string[] || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                </div>
            </div>

            {!!summary.hard_constraint_summary && (
                <div style={{ padding: '10px 14px', background: 'var(--partial-soft)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--partial)' }}>
                    {s(summary.hard_constraint_summary)}
                </div>
            )}

            {/* Tabs */}
            <div>
                <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-soft)', marginBottom: 12 }}>
                    {(['skills', 'responsibilities', 'constraints', 'actions'] as const).map(tab => {
                        const labels: Record<string, string> = {
                            skills: `Skills · ${skillMatches.length}`,
                            responsibilities: `Responsibilities · ${responsibilityMatches.length}`,
                            constraints: `Constraints · ${constraints.length}`,
                            actions: `Resume actions · ${actions.length}`,
                        };
                        const active = activeTab === tab;
                        return (
                            <button key={tab} onClick={() => setActiveTab(tab)} style={{
                                padding: '8px 12px', fontSize: 12.5, fontWeight: 500,
                                color: active ? 'var(--text)' : 'var(--text-3)',
                                marginBottom: -1, transition: 'all 140ms', cursor: 'pointer',
                                background: 'none', border: 'none',
                                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                            }}>
                                {labels[tab]}
                            </button>
                        );
                    })}
                </div>

                {activeTab === 'skills' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {skillMatches.slice(0, 20).map((sk, i) => {
                            const matchLevel = s(sk.match_level);
                            const isMissing = matchLevel === 'missing';
                            const isExpanded = expandedSkill === i;
                            const evidence = arr<Record<string, unknown>>(sk.profile_evidence);
                            const hasDetail = evidence.length > 0 || !!(sk.gap || sk.action_hint);
                            return (
                                <div key={i} style={{
                                    padding: '10px 12px', background: 'var(--bg-tint)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                    cursor: hasDetail ? 'pointer' : 'default',
                                }} onClick={() => hasDetail && setExpandedSkill(isExpanded ? null : i)}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{s(sk.jd_skill)}</span>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px', borderRadius: 999,
                                            fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap',
                                            background: isMissing ? 'var(--weak-soft)' : 'var(--strong-soft)',
                                            color: isMissing ? 'var(--weak)' : 'var(--strong)',
                                        }}>{matchLevel}</span>
                                        {hasDetail && (
                                            <span style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                                                {isExpanded ? '▲' : '▼'}
                                            </span>
                                        )}
                                    </div>
                                    {isExpanded && (
                                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {evidence.map((ev, j) => (
                                                <div key={j} style={{
                                                    padding: '7px 10px', background: 'var(--surface)',
                                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                                    display: 'flex', flexDirection: 'column', gap: 3,
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <EvidenceStrengthDots strength={Number(ev.strength ?? 0)} />
                                                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                                                            {s(ev.evidence_type, 'evidence')} · {s(ev.profile_field, '')}
                                                        </span>
                                                    </div>
                                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{s(ev.text)}</p>
                                                    {!!ev.explanation && (
                                                        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>{s(ev.explanation)}</p>
                                                    )}
                                                </div>
                                            ))}
                                            {!!(sk.gap || sk.action_hint) && (
                                                <p style={{ margin: 0, fontSize: 12, color: 'var(--partial)', lineHeight: 1.5 }}>
                                                    {s(sk.gap || sk.action_hint)}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'responsibilities' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {responsibilityMatches.slice(0, 15).map((r, i) => {
                            const isExpanded = expandedResp === i;
                            const evidence = arr<Record<string, unknown>>(r.profile_evidence);
                            const hasDetail = evidence.length > 0 || !!(r.gap || r.action_hint);
                            const matchLevel = s(r.match_level);
                            const evidenceScore = Number(r.evidence_score ?? 0);
                            return (
                                <div key={i} style={{
                                    padding: '10px 12px', background: 'var(--bg-tint)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                    cursor: hasDetail ? 'pointer' : 'default',
                                }} onClick={() => hasDetail && setExpandedResp(isExpanded ? null : i)}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{s(r.target)}</span>
                                        <EvidenceStrengthDots strength={evidenceScore} />
                                        <Pill tone={matchLevel === 'missing' ? 'weak' : matchLevel === 'strong' || matchLevel === 'exact' ? 'strong' : 'partial'} size="sm">
                                            {matchLevel}
                                        </Pill>
                                        {hasDetail && (
                                            <span style={{ fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                                                {isExpanded ? '▲' : '▼'}
                                            </span>
                                        )}
                                    </div>
                                    {isExpanded && (
                                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {evidence.map((ev, j) => (
                                                <div key={j} style={{
                                                    padding: '7px 10px', background: 'var(--surface)',
                                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                                    display: 'flex', flexDirection: 'column', gap: 3,
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <EvidenceStrengthDots strength={Number(ev.strength ?? 0)} />
                                                        <span style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                                                            {s(ev.evidence_type, 'evidence')} · {s(ev.profile_field, '')}
                                                        </span>
                                                    </div>
                                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>{s(ev.text)}</p>
                                                    {!!ev.explanation && (
                                                        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.4 }}>{s(ev.explanation)}</p>
                                                    )}
                                                </div>
                                            ))}
                                            {!!(r.gap || r.action_hint) && (
                                                <p style={{ margin: 0, fontSize: 12, color: 'var(--partial)', lineHeight: 1.5 }}>
                                                    {s(r.gap || r.action_hint)}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'constraints' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {constraints.length === 0 ? (
                            <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>No constraints checked.</p>
                        ) : constraints.map((c, i) => {
                            const statusKey = s(c.status, 'unknown');
                            const style = CONSTRAINT_STATUS_STYLE[statusKey] ?? CONSTRAINT_STATUS_STYLE.unknown;
                            return (
                                <div key={i} style={{
                                    padding: '10px 12px', background: 'var(--bg-tint)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px', borderRadius: 999,
                                            fontFamily: 'var(--font-mono)', fontSize: 10.5, whiteSpace: 'nowrap', flexShrink: 0,
                                            background: style.bg, color: style.color,
                                        }}>{style.label}</span>
                                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{s(c.constraint)}</span>
                                    </div>
                                    {!!c.risk_or_gap && (
                                        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                                            {s(c.risk_or_gap)}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'actions' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {actions.slice(0, 10).map((a, i) => (
                            <div key={i} style={{
                                padding: '10px 12px', background: 'var(--bg-tint)',
                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                                        {labelize(s(a.action_type, 'update'))} {s(a.target_section, '')}
                                    </span>
                                    <Pill tone={s(a.priority) === 'high' ? 'weak' : s(a.priority) === 'medium' ? 'partial' : 'ghost'} size="sm">
                                        {s(a.priority)}
                                    </Pill>
                                </div>
                                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>{s(a.reason)}</p>
                                {!!a.suggested_text && (
                                    <p style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>{s(a.suggested_text)}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

const PERSONA_LABEL: Record<string, string> = {
    technical_recruiter:  'Technical Recruiter',
    recruiter:            'Recruiter',
    talent_acquisition:   'Talent Acquisition',
    engineering_leader:   'Engineering Leader',
    hiring_manager:       'Hiring Manager',
    senior_management:    'Senior Management',
    peer_engineer:        'Peer Engineer',
    school_alumni:        'School Alumni',
    founder:              'Founder',
    other:                'Other',
};

function personaLabel(raw: string): string {
    return PERSONA_LABEL[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function ContactStrategyView({ data }: { data: ReachoutResult }) {
    const contacts = data.candidates || [];
    const queries = arr<Record<string, unknown>>(data.search_plan?.queries);
    const linkedinUrls = arr<string>(data.linkedin_search_urls);
    const company = s(data.search_plan?.company_name || (data.input as Record<string, unknown>)?.company_name);

    // Group queries by persona, preserving all queries per group
    const queryGroups: Record<string, { intent: string; queries: Record<string, unknown>[] }> = {};
    for (const q of queries) {
        const persona = s(q.target_persona, 'other');
        if (!queryGroups[persona]) queryGroups[persona] = { intent: s(q.intent), queries: [] };
        queryGroups[persona].queries.push(q);
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 14 }}>

            {/* Contacts */}
            {contacts.length > 0 ? (
                <div>
                    <SectionTitle>{contacts.length} contact{contacts.length !== 1 ? 's' : ''} found{company ? ` at ${company}` : ''}</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {contacts.map((c, i) => {
                            const confidenceNum = c.confidence != null ? Math.round(Number(c.confidence) * 100) : null;
                            const confBand = confidenceNum != null ? scoreToBand(confidenceNum) : 'weak';
                            const name = s(c.full_name || c.title);
                            const initials = name.split(' ').filter(Boolean).map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?';
                            const persona = s(c.persona || c.confidence_band || '');
                            return (
                                <div key={i} style={{
                                    display: 'grid', gridTemplateColumns: '40px 1fr auto',
                                    gap: 12, alignItems: 'start',
                                    padding: '12px 14px', background: 'var(--bg-tint)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: '50%', marginTop: 1,
                                        background: 'var(--surface-2)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'var(--text-2)', fontFamily: 'var(--font-mono)',
                                        fontWeight: 600, fontSize: 12, flexShrink: 0,
                                    }}>
                                        {initials}
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>{name}</span>
                                            {persona && PERSONA_LABEL[persona] && (
                                                <span style={{
                                                    fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
                                                    background: 'var(--accent-soft)', color: 'var(--accent)',
                                                    fontFamily: 'var(--font-mono)',
                                                }}>
                                                    {personaLabel(persona)}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>
                                            {compact([c.current_title, c.company]).join(' · ')}
                                        </div>
                                        {arr<string>(c.confidence_reasons).slice(0, 1).map((r, j) => (
                                            <p key={j} style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>{r}</p>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                                        {confidenceNum != null && (
                                            <span style={{
                                                fontFamily: 'var(--font-mono)', fontSize: 12,
                                                color: BAND_COLOR[confBand], fontWeight: 600,
                                            }}>
                                                {confidenceNum}%
                                            </span>
                                        )}
                                        {!!c.profile_url && (
                                            <a
                                                href={s(c.profile_url)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                style={{
                                                    fontSize: 12, color: 'var(--accent)',
                                                    textDecoration: 'none', whiteSpace: 'nowrap',
                                                }}
                                            >
                                                LinkedIn →
                                            </a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* No direct profiles — show LinkedIn fallback prominently */
                linkedinUrls.length > 0 ? (
                    <div>
                        <SectionTitle>Search manually on LinkedIn</SectionTitle>
                        <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
                            Automated search didn't surface direct profiles. Open these pre-built searches on LinkedIn to find contacts yourself.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {linkedinUrls.map((url, i) => {
                                const raw = decodeURIComponent(url.split('keywords=')[1] || url);
                                // Trim site: directives for a readable label
                                const label = raw.replace(/site:\S+\s*/gi, '').replace(/"/g, '').trim();
                                return (
                                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 12px', background: 'var(--bg-tint)',
                                            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                            textDecoration: 'none', gap: 10,
                                        }}
                                    >
                                        <span style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {label}
                                        </span>
                                        <span style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>Open →</span>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 4 }}>No contacts found for this company.</p>
                )
            )}

            {/* Queries grouped by persona — always shown inline */}
            {Object.keys(queryGroups).length > 0 && (
                <div>
                    <SectionTitle>Queries</SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                        {Object.entries(queryGroups).map(([persona, group]) => (
                            <div key={persona} style={{
                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-soft)',
                                overflow: 'hidden',
                            }}>
                                {/* Context header */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px', background: 'var(--surface-2)',
                                    borderBottom: '1px solid var(--border-soft)',
                                }}>
                                    <span style={{
                                        fontSize: 10.5, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                                        background: 'var(--surface)', color: 'var(--text-2)',
                                        fontFamily: 'var(--font-mono)', border: '1px solid var(--border-soft)',
                                    }}>
                                        {personaLabel(persona)}
                                    </span>
                                    {group.intent && (
                                        <span style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
                                            {group.intent}
                                        </span>
                                    )}
                                </div>
                                {/* Queries for this persona */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    {group.queries.map((q, i) => {
                                        const queryText = s(q.query);
                                        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(queryText)}`;
                                        return (
                                            <div key={i} style={{
                                                padding: '9px 12px', background: 'var(--bg-tint)',
                                                borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined,
                                                display: 'flex', alignItems: 'baseline', gap: 10,
                                            }}>
                                                <a
                                                    href={googleUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={e => e.stopPropagation()}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        textDecoration: 'none', flexShrink: 0,
                                                    }}
                                                >
                                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                                    </svg>
                                                    <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--accent)', whiteSpace: 'nowrap' }}>Search Google</span>
                                                </a>
                                                <p style={{
                                                    margin: 0, fontSize: 11, color: 'var(--text-3)',
                                                    fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.5,
                                                }}>
                                                    {queryText}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

interface EvidenceItem {
    profile_field: string;
    text: string;
    evidence_type: string;
    strength: number;
    explanation?: string;
}

interface ActionItem {
    action_type: string;
    priority: string;
    target_section: string;
    target_text?: string;
    suggested_text?: string;
    reason: string;
    jd_alignment: string[] | string;
    expected_score_impact?: string;
    profile_evidence?: EvidenceItem[];
}


// ─── Robust resume parsing + cross-line highlighting ─────────────────────────
// PDF-extracted resume text is messy: sentences wrap across physical lines,
// section headers are Title Case (not just ALL CAPS), and skill lists use dots
// without surrounding spaces (Python·TypeScript). These helpers reassemble the
// text into logical lines and match action target_text in a whitespace/dot-
// insensitive way so highlights land even when the source breaks awkwardly.

const RESUME_SECTIONS = new Set([
    'summary', 'professional summary', 'objective', 'profile', 'about',
    'experience', 'work experience', 'professional experience', 'employment',
    'employment history', 'education', 'skills', 'technical skills', 'core skills',
    'core competencies', 'competencies', 'projects', 'personal projects',
    'certifications', 'certificates', 'awards', 'honors', 'publications',
    'leadership', 'volunteer', 'volunteering', 'interests', 'languages',
    'contact', 'references', 'activities', 'achievements',
]);

function isMainSection(line: string): boolean {
    const t = line.trim().replace(/:$/, '');
    if (!t || t.length > 40) return false;
    if (RESUME_SECTIONS.has(t.toLowerCase())) return true;
    // ALL CAPS short label (e.g. "WORK EXPERIENCE")
    if (t.length <= 30 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/[@/]/.test(t) && !/\d/.test(t)) return true;
    return false;
}

const BULLET_RE = /^([•‣◦●○▪]|[-–—*]\s|·\s)\s*/;

function isBullet(line: string): boolean {
    return BULLET_RE.test(line.trim());
}

function isDateLine(line: string): boolean {
    const t = line.trim();
    if (t.length > 42) return false;
    if (!/\b(19|20)\d{2}\b/.test(t)) return false;
    return /[–—-]/.test(t) || /present/i.test(t) ||
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(t);
}

// Join wrapped continuation lines back into single logical lines. Only joins
// when the next line clearly continues a sentence (starts lowercase or with
// continuation punctuation) and isn't a new structural element — conservative
// to avoid swallowing Title-Case headers/titles.
function assembleLines(text: string): string[] {
    const lines = text.split('\n').map(l => l.trim());
    const out: string[] = [];
    for (const cur of lines) {
        if (cur === '') {
            if (out.length && out[out.length - 1] === '') continue;
            out.push('');
            continue;
        }
        const prev = out.length ? out[out.length - 1] : '';
        const prevReal = prev !== '';
        const startsContinuation = /^[a-z]/.test(cur) || /^[,;:)\]&]/.test(cur);
        const curStructural = isBullet(cur) || isMainSection(cur) || isDateLine(cur);
        const prevStop = prev === '' || isMainSection(prev) || isDateLine(prev);
        if (prevReal && !curStructural && !prevStop && startsContinuation) {
            out[out.length - 1] = prev + ' ' + cur;
        } else {
            out.push(cur);
        }
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
}

// Beautify inline dot separators for display (Python·TS → Python · TS).
function prettify(s: string): string {
    return s.replace(/\s*·\s*/g, ' · ');
}

// Build a normalized form of `text` (lowercase, dots→space, collapsed
// whitespace) plus a map from each normalized char back to its original index,
// enabling whitespace/dot-insensitive substring matching with accurate spans.
function normalizeForMatch(s: string): { norm: string; map: number[] } {
    let norm = '';
    const map: number[] = [];
    let prevSpace = true; // treat string start as space to trim leading
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '·' || /\s/.test(ch)) {
            if (prevSpace) continue;
            norm += ' ';
            map.push(i);
            prevSpace = true;
        } else {
            norm += ch.toLowerCase();
            map.push(i);
            prevSpace = false;
        }
    }
    return { norm, map };
}

function normalizeNeedle(s: string): string {
    return s.replace(/[·\s]+/g, ' ').trim().toLowerCase();
}


function ResumeMappingView({ actions, profile }: {
    actions: Record<string, unknown>;
    profile: UnifiedProfile | null;
}) {
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

    // Build unified action list: selected first, then rest (deduped)
    const _rawUpdates = (actions.update_actions as ActionItem[] | undefined) ?? [];
    const _rawReplaces = (actions.replace_actions as ActionItem[] | undefined) ?? [];
    const _rawDeletes = (actions.delete_actions as ActionItem[] | undefined) ?? [];
    const _rawSelected = (actions.selected_actions as ActionItem[] | undefined) ?? [];
    const _seen = new Set<string>();
    const _union: ActionItem[] = [];
    for (const a of [..._rawUpdates, ..._rawReplaces, ..._rawDeletes]) {
        const key = (a.target_text ?? '') + a.action_type;
        if (!_seen.has(key)) { _seen.add(key); _union.push(a); }
    }
    const _selKeys = new Set(_rawSelected.map(a => (a.target_text ?? '') + a.action_type));
    const allActions: ActionItem[] = [
        ..._rawSelected,
        ..._union.filter(a => !_selKeys.has((a.target_text ?? '') + a.action_type)),
    ];

    const selectedResumeText = actions.selected_resume_text as string | null | undefined;
    const selectedResumeFilename = actions.selected_resume_filename as string | null | undefined;

    if (actions._skipped) {
        const reason = actions._reason as string | undefined;
        const isExtractionFailed = reason === 'extraction_failed';
        return (
            <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--partial)" strokeWidth="1.5">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500, margin: 0 }}>
                    {isExtractionFailed ? 'Could not read resume' : 'No resume on file'}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, maxWidth: 380, lineHeight: 1.6 }}>
                    {isExtractionFailed
                        ? 'Your resume is tagged but the text could not be extracted — the file may be a scanned image or password-protected PDF. Try re-uploading a text-based PDF.'
                        : <>Tag one of your uploaded documents as a <strong>resume</strong> so Hopper can suggest targeted edits for this role.</>
                    }
                </p>
                <a href="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, height: 32, padding: '0 14px', background: 'var(--partial-soft)', color: 'var(--partial)', border: '1px solid var(--partial)', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
                    {isExtractionFailed ? 'Re-upload resume →' : 'Go to Profile →'}
                </a>
            </div>
        );
    }

    function handleCopy(i: number, text: string) {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedIdx(i);
            setTimeout(() => setCopiedIdx(null), 1500);
        });
    }

    function normalizeJdAlignment(val: unknown): string[] {
        if (Array.isArray(val)) return val.map(String);
        if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
        return [];
    }

    // Find the first action whose target_text fuzzy-matches a given text string.
    function findLineAction(text: string): { action: ActionItem; idx: number } | null {
        const display = prettify(isBullet(text) ? text.replace(BULLET_RE, '') : text);
        const { norm } = normalizeForMatch(display);
        for (let i = 0; i < allActions.length; i++) {
            const a = allActions[i];
            if (!a.target_text) continue;
            const needle = normalizeNeedle(a.target_text);
            if (needle.length < 3) continue;
            if (norm.includes(needle)) return { action: a, idx: i };
        }
        return null;
    }

    // Render a diff block: old line (red/struck) + new line (green/copy) + evidence panel.
    function renderDiffBlock(
        originalText: string,
        action: ActionItem,
        actionIdx: number,
        key: string,
    ): React.ReactNode {
        const isDelete = action.action_type === 'delete';
        const jdChips = normalizeJdAlignment(action.jd_alignment);
        const isExpanded = expandedIdx === actionIdx;
        const isCopied = copiedIdx === actionIdx;
        const useBullet = isBullet(originalText);
        const displayOld = prettify(useBullet ? originalText.replace(BULLET_RE, '') : originalText);

        return (
            <div key={key} style={{ marginBottom: 10 }}>
                {/* OLD — dimmed + strikethrough */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    {useBullet && <span style={{ color: '#ef4444', fontSize: 15, lineHeight: '1.5', flexShrink: 0, opacity: 0.4, userSelect: 'none' }}>•</span>}
                    <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.65, color: '#b0b0b0', textDecoration: 'line-through', background: 'rgba(239,68,68,0.07)', borderLeft: '3px solid rgba(239,68,68,0.4)', padding: '3px 8px', borderRadius: '2px 0 0 2px' }}>
                        {displayOld}
                    </div>
                </div>

                {/* NEW — green, click to copy */}
                {!isDelete && action.suggested_text && (
                    <div onClick={() => handleCopy(actionIdx, action.suggested_text!)} title="Click to copy"
                        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 3, cursor: 'pointer' }}>
                        {useBullet && <span style={{ color: '#10b981', fontSize: 15, lineHeight: '1.5', flexShrink: 0, opacity: 0.85, userSelect: 'none' }}>•</span>}
                        <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.65, color: '#064e3b', background: isCopied ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.1)', borderLeft: '3px solid #10b981', padding: '3px 60px 3px 8px', borderRadius: '2px 0 0 2px', position: 'relative', transition: 'background 0.15s' }}>
                            {action.suggested_text}
                            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: isCopied ? '#10b981' : '#9ca3af', fontWeight: isCopied ? 600 : 400, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                                {isCopied ? '✓ copied' : 'click to copy'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Evidence toggle row */}
                <div style={{ marginTop: 5, paddingLeft: useBullet ? 23 : 0 }}>
                    <button onClick={() => setExpandedIdx(isExpanded ? null : actionIdx)}
                        style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                        <span style={{ fontSize: 9, color: 'var(--text-4)', paddingTop: 2, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic', textAlign: 'left', lineHeight: 1.4 }}>{action.reason}</span>
                    </button>

                    {isExpanded && (
                        <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {jdChips.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0, paddingTop: 3 }}>JD requires</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {jdChips.map((chip, j) => (
                                            <span key={j} style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{chip}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {(action.profile_evidence ?? []).length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Evidence from your profile</span>
                                    {(action.profile_evidence ?? []).map((ev, k) => (
                                        <div key={k} style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: 10, color: 'var(--text-4)', flexShrink: 0, background: 'var(--bg-tint)', padding: '1px 5px', borderRadius: 3 }}>{ev.profile_field}</span>
                                            <span style={{ lineHeight: 1.5 }}>{ev.text}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {action.expected_score_impact && (
                                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                    <span style={{ fontWeight: 600 }}>Impact: </span>{action.expected_score_impact}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Render a single resume text line — diff block if an action matches, plain otherwise.
    function renderResumeLine(lineText: string, lineIdx: number): React.ReactNode {
        if (!lineText) return <div key={`blank-${lineIdx}`} style={{ height: 9 }} />;

        const match = findLineAction(lineText);
        if (match) return renderDiffBlock(lineText, match.action, match.idx, `diff-${lineIdx}`);

        if (isMainSection(lineText)) {
            const label = lineText.replace(/:$/, '');
            return (
                <div key={`sec-${lineIdx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: lineIdx === 0 ? 0 : 20, marginBottom: 9 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--accent)', opacity: 0.2 }} />
                </div>
            );
        }
        if (isBullet(lineText)) {
            return (
                <div key={`bul-${lineIdx}`} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--accent)', fontSize: 15, lineHeight: '1.5', flexShrink: 0, opacity: 0.65, userSelect: 'none' }}>•</span>
                    <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.65 }}>{prettify(lineText.replace(BULLET_RE, ''))}</div>
                </div>
            );
        }
        if (isDateLine(lineText)) {
            return <div key={`date-${lineIdx}`} style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, marginTop: -2, letterSpacing: '0.01em' }}>{lineText}</div>;
        }
        return <div key={`line-${lineIdx}`} style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.6, marginBottom: 3 }}>{prettify(lineText)}</div>;
    }

    const basics = profile?.basics;
    const contact = basics?.contact_info;
    const paperSection: React.CSSProperties = { marginBottom: 18 };
    const paperHeading: React.CSSProperties = {
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: '#374151', borderBottom: '1px solid #d1d5db', paddingBottom: 4, marginBottom: 8,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
    const paperBase: React.CSSProperties = {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 12.5, color: '#111827', lineHeight: 1.55,
    };

    return (
        <div style={{ paddingTop: 12 }}>
            {/* Header: filename chip + legend + count */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {selectedResumeFilename && (
                        <div style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            {selectedResumeFilename}
                        </div>
                    )}
                    {allActions.length > 0 && (
                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-3)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ display: 'inline-block', width: 10, height: 2, background: 'rgba(239,68,68,0.55)', borderRadius: 1 }} />
                                removed
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ display: 'inline-block', width: 10, height: 2, background: '#10b981', borderRadius: 1 }} />
                                updated · click to copy
                            </span>
                        </div>
                    )}
                </div>
                {allActions.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {allActions.filter(a => a.target_text).length} suggested changes
                    </span>
                )}
            </div>

            {/* Full-width resume paper */}
            <div style={{ background: '#ffffff', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)', padding: '22px 24px', ...paperBase }}>
                {selectedResumeText ? (
                    assembleLines(selectedResumeText).map((line, i) => renderResumeLine(line, i))
                ) : !profile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: '#9ca3af' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span style={{ fontSize: 13, textAlign: 'center', maxWidth: 240 }}>Profile data unavailable — upload your resume to see the resume map</span>
                    </div>
                ) : (
                    /* Profile-data fallback (no resume file parsed yet) */
                    <>
                        <p style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', marginBottom: 16, marginTop: 0 }}>
                            Parsed from your profile data — layout differs from your actual document
                        </p>
                        <div style={paperSection}>
                            {basics?.name && <div style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{basics.name}</div>}
                            {basics?.title && <div style={{ fontSize: 13, color: '#374151', marginTop: 1 }}>{basics.title}</div>}
                            <div style={{ fontSize: 11.5, color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 4 }}>
                                {contact?.email && <span>{contact.email}</span>}
                                {contact?.phone && <span>{contact.phone}</span>}
                                {contact?.linkedin_url && <span>{contact.linkedin_url}</span>}
                                {basics?.location && <span>{basics.location}</span>}
                            </div>
                        </div>

                        {basics?.summary && (
                            <div style={paperSection}>
                                <div style={paperHeading}>Summary</div>
                                {(() => {
                                    const m = findLineAction(basics.summary);
                                    return m
                                        ? renderDiffBlock(basics.summary, m.action, m.idx, 'pf-summary')
                                        : <p style={{ margin: 0, fontSize: 12.5, color: '#374151', lineHeight: 1.6 }}>{basics.summary}</p>;
                                })()}
                            </div>
                        )}

                        {(profile.work_experience?.length ?? 0) > 0 && (
                            <div style={paperSection}>
                                <div style={paperHeading}>Experience</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {profile.work_experience!.map((exp, i) => (
                                        <div key={i}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                                <span style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{exp.job_title ?? ''}</span>
                                                <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', marginLeft: 8 }}>
                                                    {[exp.start_date, exp.is_current ? 'Present' : exp.end_date].filter(Boolean).join(' – ')}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                                                {[exp.company_name, exp.location].filter(Boolean).join(' · ')}
                                            </div>
                                            {[...(exp.description ?? []), ...(exp.achievements ?? [])].map((line, j) => {
                                                const m = findLineAction(line);
                                                if (m) return renderDiffBlock(line, m.action, m.idx, `pf-exp-${i}-${j}`);
                                                return (
                                                    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                                                        <span style={{ color: 'var(--accent)', fontSize: 15, lineHeight: '1.5', flexShrink: 0, opacity: 0.65, userSelect: 'none' }}>•</span>
                                                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{line}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(profile.skills?.length ?? 0) > 0 && (
                            <div style={paperSection}>
                                <div style={paperHeading}>Skills</div>
                                <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
                                    {profile.skills!.map((skill, i) => {
                                        const m = findLineAction(skill);
                                        if (m) return renderDiffBlock(skill, m.action, m.idx, `pf-sk-${i}`);
                                        return (
                                            <span key={i}>
                                                {skill}
                                                {i < profile.skills!.length - 1 && <span style={{ color: '#d1d5db', margin: '0 4px' }}>·</span>}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {(profile.education?.length ?? 0) > 0 && (
                            <div style={paperSection}>
                                <div style={paperHeading}>Education</div>
                                {profile.education!.map((edu, i) => (
                                    <div key={i} style={{ marginBottom: 6 }}>
                                        <div style={{ fontWeight: 600, fontSize: 12.5, color: '#111827' }}>{edu.institution ?? ''}</div>
                                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                                            {[edu.degree, edu.major, edu.graduation_year].filter(Boolean).join(' · ')}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function StepContent({ stepKey, data, profile }: { stepKey: StepKey; data: Record<string, unknown>; profile?: UnifiedProfile | null }) {
    switch (stepKey) {
        case 'profile':         return <ProfileExtractView data={data as unknown as UnifiedProfile} />;
        case 'job_description': return <JDParseView data={data as unknown as JobDescriptionBreakdownResult} />;
        case 'company_intel':   return <CompanyIntelView data={data as unknown as CompanyIntelResult} />;
        case 'match_analysis':  return <MatchAnalysisView data={data as unknown as JobMatchResult} />;
        case 'resume_actions':  return <ResumeMappingView actions={data} profile={profile ?? null} />;
        case 'reachout':        return <ContactStrategyView data={data as unknown as ReachoutResult} />;
        default:                return null;
    }
}

// ─── Timeline module ──────────────────────────────────────────────────────────

function TimelineModule({
    meta, state, session, stepKey, index, isLast, errorMessage, onRetry,
}: {
    meta: typeof STEPS[number];
    state: StepStatus;
    session: JobLensSession | null;
    stepKey: StepKey;
    index: number;
    isLast: boolean;
    errorMessage?: string;
    onRetry?: (stepKey: StepKey) => void;
}) {
    const [open, setOpen] = useState(
        state === 'done' && (stepKey === 'match_analysis' || stepKey === 'job_description')
    );
    const data = session?.[SESSION_FIELD[stepKey]] as Record<string, unknown> | undefined;

    useEffect(() => {
        if (state === 'running') setOpen(true);
        if (state === 'done' && stepKey === 'match_analysis') setOpen(true);
    }, [state, stepKey]);

    const canOpen = state !== 'idle';
    const isRunning = state === 'running';

    return (
        <div className="wand-fadeup" style={{ position: 'relative', paddingLeft: 48 }}>
            {/* Rail line */}
            {!isLast && (
                <div style={{
                    position: 'absolute', left: 17, top: 40, bottom: -18, width: 1.5,
                    background: 'var(--border)',
                }} />
            )}

            {/* Circle glyph */}
            <div style={{
                position: 'absolute', left: 0, top: 12,
                width: 36, display: 'flex', justifyContent: 'center',
            }}>
                <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${isRunning ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                    <ModuleGlyph state={state} />
                </div>
            </div>

            {/* Card */}
            <div style={{
                background: state === 'idle' ? 'var(--bg-tint)' : 'var(--surface)',
                opacity: state === 'idle' ? 0.6 : 1,
                border: `1px solid ${isRunning ? 'var(--accent)' : state === 'error' ? 'var(--weak)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
            }}>
                {/* Header row — split into expand area + re-run button */}
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <button
                        onClick={() => canOpen && setOpen(o => !o)}
                        style={{
                            flex: 1, display: 'flex', alignItems: 'center', gap: 12,
                            padding: '14px 18px',
                            cursor: canOpen ? 'pointer' : 'default',
                            background: 'none', border: 'none', textAlign: 'left',
                            minWidth: 0,
                        }}
                    >
                        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                                    0{index + 1}
                                </span>
                                <span style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text)' }}>{meta.label}</span>
                                {state === 'running' && <Pill tone="accent" size="sm"><span className="wand-pulse">running</span></Pill>}
                                {state === 'done'    && <Pill tone="strong" size="sm">done</Pill>}
                                {state === 'error'   && <Pill tone="weak" size="sm">failed</Pill>}
                                {state === 'idle'    && <Pill tone="ghost" size="sm">queued</Pill>}
                            </div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>{meta.description}</div>
                        </div>
                        {canOpen && (
                            <svg
                                width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--text-3)', flexShrink: 0, transition: 'transform 160ms', transform: open ? 'rotate(180deg)' : 'none' }}
                            >
                                <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>

                    {/* Re-run button — shown on done + error, hidden while running */}
                    {(state === 'done' || state === 'error' || state === 'idle') && !isRunning && onRetry && (
                        <>
                            <div style={{ width: 1, background: 'var(--border-soft)', margin: '10px 0' }} />
                            <button
                                onClick={e => { e.stopPropagation(); onRetry(stepKey); }}
                                title={state === 'error' ? 'Retry this step' : 'Re-run this step'}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 48, flexShrink: 0,
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: state === 'error' ? 'var(--weak)' : 'var(--text-4)',
                                    transition: 'color 120ms, background 120ms',
                                    borderRadius: '0 var(--radius-lg) var(--radius-lg) 0',
                                }}
                                onMouseEnter={e => {
                                    const el = e.currentTarget as HTMLButtonElement;
                                    el.style.color = state === 'error' ? 'var(--weak)' : 'var(--text-2)';
                                    el.style.background = 'var(--bg-tint)';
                                }}
                                onMouseLeave={e => {
                                    const el = e.currentTarget as HTMLButtonElement;
                                    el.style.color = state === 'error' ? 'var(--weak)' : 'var(--text-4)';
                                    el.style.background = 'none';
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>

                {/* Progress bar when running */}
                {isRunning && (
                    <div style={{ height: 2, background: 'var(--surface-2)', overflow: 'hidden' }}>
                        <div className="wand-shimmer" style={{ height: '100%', width: '100%' }} />
                    </div>
                )}

                {/* Body */}
                {open && canOpen && (
                    <div style={{ padding: '4px 18px 18px', borderTop: '1px solid var(--border-soft)' }}>
                        {isRunning && !data ? (
                            <SkeletonLines lines={4} />
                        ) : data ? (
                            <StepContent stepKey={stepKey} data={data} profile={session?.profile_snapshot as UnifiedProfile | null | undefined} />
                        ) : state === 'error' ? (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 0' }}>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                                    <circle cx="7" cy="7" r="6.25" stroke="var(--weak)" strokeWidth="1.5" fill="var(--weak-soft)" />
                                    <path d="M5 5L9 9M9 5L5 9" stroke="var(--weak)" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                                <p style={{ fontSize: 13, color: 'var(--weak)', margin: 0, lineHeight: 1.5 }}>
                                    {errorMessage || 'This step failed.'}{' '}
                                    <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Use the re-run button above to try again.</span>
                                </p>
                            </div>
                        ) : (
                            <p style={{ fontSize: 13, color: 'var(--text-3)', padding: '16px 0' }}>No data yet.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── ScoreSummary card ────────────────────────────────────────────────────────

function ScoreSummary({
    job, session, isProcessing, onRunJobLens, hasProfileDocs,
}: {
    job: Job;
    session: JobLensSession | null;
    isProcessing: boolean;
    onRunJobLens: () => void;
    hasProfileDocs: boolean;
}) {
    if (isProcessing) {
        return (
            <Card style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{
                    width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
                    border: '3px solid var(--accent)', borderTopColor: 'transparent',
                }} className="wand-spin" />
                <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 4 }}>Analyzing</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 20px)', color: 'var(--text)', lineHeight: 1.3 }}>
                        Hopper is reading the job description, gathering company intel, and scoring your match.
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>
                        Module results appear below as they finish. You can read completed sections immediately.
                    </p>
                </div>
            </Card>
        );
    }

    const matchScore = session?.match_analysis?.summary?.total_score ?? job.analysis_result?.final_score;
    const headline = session?.match_analysis?.summary?.headline ?? job.analysis_result?.headline;

    if (matchScore == null) {
        return (
            <Card>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>Match</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 20px)', color: 'var(--text-2)', lineHeight: 1.3 }}>
                    No analysis yet. This job is tracked manually — run JobLens to get a score.
                </div>
                <button
                    onClick={onRunJobLens}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14,
                        height: 34, padding: '0 16px',
                        background: hasProfileDocs ? 'var(--accent)' : 'var(--surface-2)',
                        color: hasProfileDocs ? 'var(--on-accent)' : 'var(--text-2)',
                        border: hasProfileDocs ? 'none' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        transition: 'opacity 120ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                >
                    {hasProfileDocs ? '✦ Run JobLens' : '↑ Upload profile to run JobLens'}
                </button>
            </Card>
        );
    }

    const score = matchScore as number;
    const band = scoreToBand(score);

    return (
        <Card style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 22, alignItems: 'center' }}>
            <ScoreRing score={score} size={72} stroke={5} />
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>Match</div>
                    <Pill tone={band}>{BAND_LABEL[band]}</Pill>
                </div>
                {headline && (
                    <div style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'calc(var(--display-scale, 0.92) * 20px)',
                        color: 'var(--text)', lineHeight: 1.3, maxWidth: 540,
                    }}>
                        {headline}
                    </div>
                )}
            </div>
        </Card>
    );
}

// ─── Notes panel ─────────────────────────────────────────────────────────────

function NotesPanel({
    notes, onChange, onBlur, savedAt,
}: {
    notes: string;
    onChange: (v: string) => void;
    onBlur: () => void;
    savedAt: Date | null;
}) {
    return (
        <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>Notes</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                    {savedAt ? `saved · ${timeAgo(savedAt.toISOString())}` : 'unsaved'}
                </span>
            </div>
            <textarea
                value={notes}
                onChange={e => onChange(e.target.value)}
                onBlur={onBlur}
                rows={6}
                placeholder="Your notes while reviewing this role…"
                style={{
                    width: '100%', resize: 'vertical', minHeight: 100,
                    background: 'transparent', border: '1px dashed var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: 10,
                    fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text)',
                    outline: 'none', lineHeight: 1.5,
                }}
            />
        </Card>
    );
}

// ─── Actions panel ────────────────────────────────────────────────────────────

function ActionsPanel({ job, router }: { job: Job; router: ReturnType<typeof useRouter> }) {
    const postingUrl = job.job_posting?.job_link;
    return (
        <Card>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', display: 'block', marginBottom: 10 }}>Next actions</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <ActionLink label="Draft cover letter" hint="Generate a tailored cover letter" icon="mail"
                    onClick={() => router.push('/cover-letters')} />
                {postingUrl && (
                    <ActionLink label="Open original posting" icon="link"
                        onClick={() => window.open(postingUrl, '_blank', 'noopener,noreferrer')} />
                )}
            </div>
        </Card>
    );
}

function ActionLink({ label, hint, icon, onClick }: { label: string; hint?: string; icon: string; onClick?: () => void }) {
    const [hovered, setHovered] = useState(false);
    const iconEl = icon === 'mail'
        ? <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        : <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
                borderRadius: 'var(--radius-xs)', transition: 'background 100ms',
                background: hovered ? 'var(--bg-tint)' : 'transparent',
                border: 'none', cursor: onClick ? 'pointer' : 'default', textAlign: 'left',
                width: '100%',
            }}
        >
            <div style={{
                width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
                {iconEl}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>{label}</div>
                {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{hint}</div>}
            </div>
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
        </button>
    );
}

// ─── Constraints card ─────────────────────────────────────────────────────────

function ConstraintsCard({ text }: { text: string }) {
    return (
        <Card>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Constraints</span>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>{text}</div>
        </Card>
    );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const { token, _hasHydrated } = useStore();

    const [job, setJob] = useState<Job | null>(null);
    const [session, setSession] = useState<JobLensSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [stepStatuses, setStepStatuses] = useState<Record<StepKey, StepStatus>>({
        profile: 'idle', job_description: 'idle', company_intel: 'idle',
        match_analysis: 'idle', resume_actions: 'idle', reachout: 'idle',
    });
    const [stepErrors, setStepErrors] = useState<Partial<Record<StepKey, string>>>({});
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showNoProfileModal, setShowNoProfileModal] = useState(false);
    const [notes, setNotes] = useState('');
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const [profileDocCount, setProfileDocCount] = useState<number | null>(null);
    const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!_hasHydrated) return;
        if (!token) { router.push('/'); return; }
        load();
        api.getProfileFiles().then(r => setProfileDocCount(r.total)).catch(() => setProfileDocCount(0));
    }, [_hasHydrated, token, id, router]);

    const load = async (silent = false) => {
        // Serve from LRU cache immediately for fast revisits
        if (!silent) {
            const cached = joblensCache.get(id) as { job: Job; session: JobLensSession | null } | null;
            if (cached) {
                setJob(cached.job);
                setNotes(cached.job.user_notes || '');
                if (cached.session) {
                    setSession(cached.session);
                    initStepStatuses(cached.session, cached.job.status === 'analyzing');
                }
            } else {
                setLoading(true);
            }
        }

        try {
            const { job: j, session: s } = await api.getJobWithSession(id);
            if (!j) { router.push('/jobs'); return; }
            // Only cache completed/stable sessions (not actively analyzing)
            if (j.status !== 'analyzing') {
                joblensCache.set(id, { job: j, session: s });
            }
            setJob(j);
            setNotes(j.user_notes || '');
            setSession(prev => {
                if (prev && s && prev.id === s.id) {
                    // Merge, but never overwrite a non-null WS-delivered field with null from
                    // a polling response that hasn't seen the DB write yet.
                    const merged = { ...prev } as Record<string, unknown>;
                    for (const key of Object.keys(s) as (keyof JobLensSession)[]) {
                        if (s[key] != null || prev[key] == null) {
                            merged[key] = s[key];
                        }
                    }
                    return merged as unknown as JobLensSession;
                }
                return s;
            });
            if (s) initStepStatuses(s, j.status === 'analyzing');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const initStepStatuses = (s: JobLensSession, isAnalyzing = false) => {
        // Rules:
        //   hasData                     → 'done' (DB confirmed)
        //   no data, was done/running/error → keep that status (WS may be ahead of DB)
        //   no data, isAnalyzing        → 'running' (pipeline is active; step is in-flight or queued)
        //   otherwise                   → 'idle'
        const keep = (prev: StepStatus, hasData: boolean): StepStatus => {
            if (hasData) return 'done';
            if (prev === 'done' || prev === 'running' || prev === 'error') return prev;
            return isAnalyzing ? 'running' : 'idle';
        };
        setStepStatuses(prev => ({
            profile:         keep(prev.profile,         !!s.profile_snapshot),
            job_description: keep(prev.job_description, !!s.job_description),
            company_intel:   keep(prev.company_intel,   !!s.company_intel),
            match_analysis:  keep(prev.match_analysis,  !!s.match_analysis),
            resume_actions:  keep(prev.resume_actions,  !!s.resume_actions),
            reachout:        keep(prev.reachout,        !!s.reachout),
        }));
    };

    // Live WebSocket subscription
    useEffect(() => {
        if (!session?.id) return;
        const unsub = subscribeToJobLens(session.id, (data) => {
            const type = data.type as string;
            const step = data.step as StepKey | undefined;

            if (type === 'joblens_step_started' && step) {
                setStepStatuses(prev => ({ ...prev, [step]: 'running' }));
            } else if (type === 'joblens_step_complete' && step) {
                const stepData = data.data as Record<string, unknown>;
                setStepStatuses(prev => ({ ...prev, [step]: 'done' }));
                setSession(prev => {
                    if (!prev) return prev;
                    return { ...prev, [SESSION_FIELD[step]]: stepData };
                });
            } else if (type === 'joblens_step_failed' && step) {
                setStepStatuses(prev => ({ ...prev, [step]: 'error' }));
                const rawErr = (data.error as string) || '';
                const isInternalError = /is not defined|has no attribute|Traceback|TypeError:|AttributeError:|NameError:|ValueError:|KeyError:|IndexError:|Exception:/i.test(rawErr);
                const errMsg = isInternalError ? 'An internal error occurred.' : (rawErr || 'Step failed.');
                if (isInternalError) console.error('[joblens step error]', step, rawErr);
                setStepErrors(prev => ({ ...prev, [step]: errMsg }));
            } else if (type === 'joblens_pipeline_complete') {
                load(true);
            } else if (type === 'joblens_pipeline_failed') {
                // Any step still 'running' when the pipeline fails didn't get its own
                // step_failed event — move it to 'error' so retry buttons appear.
                setStepStatuses(prev => {
                    const next = { ...prev } as Record<StepKey, StepStatus>;
                    for (const k of Object.keys(next) as StepKey[]) {
                        if (next[k] === 'running') next[k] = 'error';
                    }
                    return next;
                });
                load(true);
            }
        });
        return unsub;
    }, [session?.id]);

    // Polling fallback while analysis is running — ensures UI catches up
    // even if WS events are missed (e.g. tab backgrounded, connection blip).
    // Uses silent=true so no loading spinner fires during polls.
    useEffect(() => {
        if (job?.status !== 'analyzing') return;
        const interval = setInterval(() => { load(true); }, 4000);
        return () => clearInterval(interval);
    }, [job?.status]);

    const handleStatusChange = async (newStatus: string) => {
        if (!job) return;
        try {
            const updated = await api.updateJob(job.id, { status: newStatus as Job['status'] });
            setJob(updated);
        } catch {}
        setStatusDropdownOpen(false);
    };

    const handleNotesChange = (v: string) => {
        setNotes(v);
        setSavedAt(null);
    };

    const handleNotesSave = async () => {
        if (!job) return;
        try {
            await api.updateJob(job.id, { user_notes: notes });
            setSavedAt(new Date());
        } catch {}
    };

    const handleDelete = async () => {
        if (!job) return;
        await api.deleteJob(job.id);
        router.push('/jobs');
    };

    const handleRetryStep = async (stepKey: StepKey) => {
        if (!job || !session) return;
        // Immediately set the step to running and clear its error
        setStepStatuses(prev => ({ ...prev, [stepKey]: 'running' }));
        setStepErrors(prev => { const next = { ...prev }; delete next[stepKey]; return next; });
        try {
            await api.retrySteps(job.id, [stepKey]);
        } catch (err) {
            if (isApiError(err) && err.status === 429) {
                const secs = err.retryAfter ?? 60;
                setRateLimitMsg(`Too many requests — try again in ${Math.ceil(secs / 60)} min.`);
                setTimeout(() => setRateLimitMsg(null), secs * 1000);
            } else {
                console.error('Failed to retry step:', stepKey, err);
            }
            setStepStatuses(prev => ({ ...prev, [stepKey]: 'error' }));
            setStepErrors(prev => ({ ...prev, [stepKey]: 'Failed to start retry.' }));
        }
    };

    const handleRunJobLens = async () => {
        if (!job) return;
        if (profileDocCount === 0) {
            setShowNoProfileModal(true);
            return;
        }
        try {
            joblensCache.invalidate(job.id); // new run invalidates stale cache
            const updatedJob = await api.runJobLens(job.id);
            setJob(updatedJob);

            // Subscribe to the new session IMMEDIATELY — before load() returns —
            // so we don't miss Wave 1 WS events (profile + job_description step_started).
            if (updatedJob.joblens_session_id) {
                setSession(prev => {
                    // Preserve full session data if we already have it, just update ID
                    if (prev?.id === updatedJob.joblens_session_id) return prev;
                    return { id: updatedJob.joblens_session_id } as typeof prev;
                });
            }

            // Reset all step statuses and errors for the new run
            setStepStatuses({ profile: 'idle', job_description: 'idle', company_intel: 'idle', match_analysis: 'idle', resume_actions: 'idle', reachout: 'idle' });
            setStepErrors({});

            // Full session load (fills in any data already available)
            await load();
        } catch (err) {
            if (isApiError(err) && err.status === 429) {
                const secs = err.retryAfter ?? 60;
                setRateLimitMsg(`Too many requests — try again in ${Math.ceil(secs / 60)} min.`);
                setTimeout(() => setRateLimitMsg(null), secs * 1000);
            } else {
                console.error('Failed to run JobLens:', err);
            }
        }
    };

    if (!_hasHydrated || loading) {
        return (
            <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
                <Header />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
                    <div className="wand-spin" style={{
                        width: 24, height: 24, borderRadius: '50%',
                        border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                    }} />
                </div>
            </div>
        );
    }

    if (!job) return null;

    const companyName = (job.job_posting?.company_name as string) || 'Unknown';
    const jobTitle    = (job.job_posting?.job_title as string) || 'Untitled Position';
    const location    = (job.job_posting?.location as string) || '';
    const postingUrl  = job.job_posting?.job_link;
    const isPipelineStatus = job.status === 'queued' || job.status === 'analyzing';
    const isAnalyzing = STEPS.some(s => stepStatuses[s.key] === 'running');
    const constraintsSummary = session?.match_analysis?.summary?.hard_constraint_summary;
    const hasProfileDocs = profileDocCount !== null && profileDocCount > 0;

    return (
        <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
            <Header />

            <TopBar
                breadcrumb={
                    <>
                        <button
                            onClick={() => router.push('/dashboard')}
                            style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
                        >
                            Dashboard
                        </button>
                        <span>/</span>
                        <button
                            onClick={() => router.push('/jobs')}
                            style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
                        >
                            Jobs
                        </button>
                        <span>/</span>
                        <span style={{ color: 'var(--text-2)' }}>{companyName}</span>
                    </>
                }
                title={jobTitle}
                subtitle={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <CompanyMark name={companyName} size={18} />
                            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{companyName}</span>
                        </span>
                        {location && (
                            <>
                                <span style={{ color: 'var(--text-4)' }}>·</span>
                                <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{location}</span>
                            </>
                        )}
                        {postingUrl && (
                            <>
                                <span style={{ color: 'var(--text-4)' }}>·</span>
                                <a
                                    href={postingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'var(--accent)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                >
                                    Original posting
                                    <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                </a>
                            </>
                        )}
                    </span>
                }
                right={
                    <>
                        {/* Status control */}
                        {isPipelineStatus ? (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px',
                                background: 'var(--partial-soft)', color: 'var(--partial)',
                                border: '1px solid var(--partial)', borderRadius: 'var(--radius-sm)',
                                fontSize: 12.5, fontFamily: 'var(--font-mono)',
                            }}>
                                <span className="wand-pulse">{PIPELINE_STATUS_LABELS[job.status]}</span>
                            </span>
                        ) : (
                            <div style={{ position: 'relative' }}>
                                <button
                                    onClick={() => setStatusDropdownOpen(o => !o)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px',
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <span style={{
                                        width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                                        background: STATUS_TONE[job.status] === 'accent' ? 'var(--accent)'
                                            : STATUS_TONE[job.status] === 'strong' ? 'var(--strong)'
                                            : STATUS_TONE[job.status] === 'good' ? 'var(--good)'
                                            : STATUS_TONE[job.status] === 'weak' ? 'var(--weak)'
                                            : 'var(--text-3)',
                                    }} />
                                    {STATUS_LABEL[job.status]}
                                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                                {statusDropdownOpen && (
                                    <>
                                        <div
                                            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                                            onClick={() => setStatusDropdownOpen(false)}
                                        />
                                        <div style={{
                                            position: 'absolute', right: 0, top: '100%', marginTop: 4,
                                            width: 180, zIndex: 50,
                                            background: 'var(--surface)', border: '1px solid var(--border)',
                                            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-2)',
                                            overflow: 'hidden',
                                        }}>
                                            {STATUS_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => handleStatusChange(opt.value)}
                                                    style={{
                                                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                                        padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                                                        background: job.status === opt.value ? 'var(--bg-tint)' : 'transparent',
                                                        color: 'var(--text)', border: 'none', textAlign: 'left',
                                                    }}
                                                    onMouseEnter={e => { if (job.status !== opt.value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tint)'; }}
                                                    onMouseLeave={e => { if (job.status !== opt.value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                                                >
                                                    {job.status === opt.value && (
                                                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                    {job.status !== opt.value && <span style={{ width: 12, flexShrink: 0 }} />}
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Cover letter button */}
                        <button
                            onClick={() => router.push('/cover-letters')}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-2)',
                                cursor: 'pointer', transition: 'all 120ms',
                            }}
                            onMouseEnter={e => {
                                const el = e.currentTarget as HTMLButtonElement;
                                el.style.color = 'var(--text)';
                                el.style.borderColor = 'var(--accent)';
                            }}
                            onMouseLeave={e => {
                                const el = e.currentTarget as HTMLButtonElement;
                                el.style.color = 'var(--text-2)';
                                el.style.borderColor = 'var(--border)';
                            }}
                        >
                            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Cover letter
                        </button>

                        {/* Delete */}
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            title="Delete job"
                            style={{
                                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'transparent', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)', color: 'var(--text-3)', cursor: 'pointer',
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
                                el.style.borderColor = 'var(--border)';
                            }}
                        >
                            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </>
                }
            />

            {/* Two-column layout */}
            <div style={{ padding: '20px 24px 100px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'flex-start' }}>

                {/* MAIN — score card + timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Analyzing banner */}
                    {isAnalyzing && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', background: 'var(--accent-soft)',
                            border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)',
                        }}>
                            <span className="wand-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'block' }} />
                            <p style={{ fontSize: 13, color: 'var(--accent-ink)' }}>
                                JobLens pipeline is running — results appear as each step completes
                            </p>
                        </div>
                    )}

                    {/* Rate limit banner */}
                    {rateLimitMsg && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                            background: 'var(--surface-2)', border: '1px solid var(--border)',
                            fontSize: 13, color: 'var(--text-2)',
                        }}>
                            {rateLimitMsg}
                        </div>
                    )}

                    {/* Score summary */}
                    <ScoreSummary
                        job={job}
                        session={session}
                        isProcessing={isPipelineStatus}
                        onRunJobLens={handleRunJobLens}
                        hasProfileDocs={hasProfileDocs}
                    />

                    {/* Timeline */}
                    <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                            {STEPS.map((step, idx) => (
                                <TimelineModule
                                    key={step.key}
                                    meta={step}
                                    state={stepStatuses[step.key]}
                                    session={session}
                                    stepKey={step.key}
                                    index={idx}
                                    isLast={idx === STEPS.length - 1}
                                    errorMessage={stepErrors[step.key]}
                                    onRetry={session && !isPipelineStatus && !isAnalyzing ? handleRetryStep : undefined}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* SIDEBAR — notes + actions + constraints */}
                <div style={{ position: 'sticky', top: 90, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <NotesPanel
                        notes={notes}
                        onChange={handleNotesChange}
                        onBlur={handleNotesSave}
                        savedAt={savedAt}
                    />
                    <ActionsPanel job={job} router={router} />
                    {constraintsSummary && (
                        <ConstraintsCard text={s(constraintsSummary)} />
                    )}
                </div>
            </div>

            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleDelete}
                title="Delete Job"
                message="Are you sure you want to delete this job and all its analysis data?"
                confirmLabel="Delete"
                isDestructive={true}
            />

            <ConfirmationModal
                isOpen={showNoProfileModal}
                onClose={() => setShowNoProfileModal(false)}
                onConfirm={() => router.push('/profile')}
                title="No profile documents"
                message="Upload at least one document — resume, LinkedIn export, or portfolio — before running job analysis. JobLens needs your career data to score your fit and generate recommendations."
                confirmLabel="Go to Profile"
                cancelLabel="Cancel"
            />
        </main>
    );
}
