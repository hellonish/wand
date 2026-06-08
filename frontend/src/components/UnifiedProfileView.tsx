'use client';

import { useState } from 'react';

interface ContactInfo {
    email?: string | null;
    phone?: string | null;
    linkedin_url?: string | null;
    portfolio_url?: string | null;
    github_url?: string | null;
}

interface ProfileBasics {
    name?: string | null;
    title?: string | null;
    summary?: string | null;
    location?: string | null;
    contact_info?: ContactInfo | null;
}

interface UnifiedWorkExperienceItem {
    job_title?: string | null;
    company_name?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    is_current?: boolean;
    location?: string | null;
    description?: string[] | string | null;
    achievements?: string[] | null;
}

interface UnifiedEducationItem {
    institution?: string | null;
    degree?: string | null;
    major?: string | null;
    graduation_year?: string | null;
}

interface UnifiedProfileSection {
    title: string;
    pointers: string[];
}

interface UnifiedProfile {
    basics?: ProfileBasics | null;
    work_experience?: UnifiedWorkExperienceItem[] | null;
    education?: UnifiedEducationItem[] | null;
    skills?: string[] | null;
    additional_sections?: UnifiedProfileSection[] | null;
    dynamic_sections?: Record<string, unknown> | null;
}

interface UnifiedProfileViewProps {
    profile: UnifiedProfile;
    dim?: boolean;
}

export default function UnifiedProfileView({ profile, dim }: UnifiedProfileViewProps) {
    const [activeTab, setActiveTab] = useState<'overview' | 'experience' | 'education' | 'skills' | 'more'>('overview');

    if (!profile) return null;

    const basics = profile.basics || {};
    const contact = basics.contact_info || {};
    const work = profile.work_experience || [];
    const education = profile.education || [];
    const skills = profile.skills || [];
    const sections = (profile.additional_sections || []).filter(
        s => s && s.title && Array.isArray(s.pointers) && s.pointers.length > 0
    );

    const formatDescription = (description: UnifiedWorkExperienceItem['description']) => {
        if (Array.isArray(description)) return description.join(' ');
        return description || '';
    };

    const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return 'Present';
        try {
            if (/^\d{4}-\d{2}$/.test(dateStr)) {
                const [year, month] = dateStr.split('-');
                return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
            }
            return dateStr;
        } catch {
            return dateStr;
        }
    };

    // Generate avatar initials
    const initials = (basics.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

    const TABS = [
        { id: 'overview', label: 'Overview' },
        { id: 'experience', label: 'Experience' },
        { id: 'education', label: 'Education' },
        { id: 'skills', label: 'Skills' },
        ...(sections.length > 0 ? [{ id: 'more', label: 'More' }] : []),
    ] as const;

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--surface)', opacity: dim ? 0.5 : 1, transition: 'opacity 200ms' }}>
            {/* Header */}
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-tint)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
                    {/* Avatar */}
                    <div style={{
                        width: 48, height: 48, borderRadius: '50%',
                        background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 16, flexShrink: 0,
                    }}>
                        {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--display-scale, 0.92) * 20px)', color: 'var(--text)', fontWeight: 500, letterSpacing: '-0.01em' }}>
                            {basics.name || 'Unified Profile'}
                        </div>
                        {basics.title && (
                            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 1 }}>{basics.title}</div>
                        )}
                        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                            {contact.email && <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{contact.email}</span>}
                            {basics.location && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{basics.location}</span>}
                        </div>
                    </div>
                </div>

                {/* Contact pills */}
                {(contact.linkedin_url || contact.portfolio_url || contact.github_url || contact.phone) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {contact.phone && (
                            <ContactPill>{contact.phone}</ContactPill>
                        )}
                        {contact.linkedin_url && (
                            <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                <ContactPill accent>LinkedIn</ContactPill>
                            </a>
                        )}
                        {contact.portfolio_url && (
                            <a href={contact.portfolio_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                <ContactPill>Portfolio</ContactPill>
                            </a>
                        )}
                        {contact.github_url && (
                            <a href={contact.github_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                <ContactPill>GitHub</ContactPill>
                            </a>
                        )}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--surface)', overflowX: 'auto' }}>
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        style={{
                            padding: '10px 16px', fontSize: 12.5, fontWeight: 500,
                            color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-3)',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                            transition: 'all 140ms', whiteSpace: 'nowrap',
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div style={{ padding: '16px 20px', minHeight: 360 }}>
                {/* Overview */}
                {activeTab === 'overview' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {basics.summary && (
                            <ProfileSection title="Summary">
                                <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{basics.summary}</div>
                            </ProfileSection>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                            <ProfileSection title="Top Skills">
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                    {skills.slice(0, 10).map((skill, i) => (
                                        <SkillPill key={i}>{skill}</SkillPill>
                                    ))}
                                    {skills.length > 10 && (
                                        <span style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '3px 0' }}>+{skills.length - 10} more</span>
                                    )}
                                </div>
                            </ProfileSection>
                            <ProfileSection title="Education">
                                {education.length > 0 ? education.slice(0, 2).map((edu, i) => (
                                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                                        <div style={{ width: 2, minHeight: 36, background: 'var(--border)', borderRadius: 2, flexShrink: 0 }} />
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{edu.institution}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{edu.degree}</div>
                                        </div>
                                    </div>
                                )) : <Empty>No education listed</Empty>}
                            </ProfileSection>
                        </div>
                        <ProfileSection title="Latest Experience">
                            {work.length > 0 ? work.slice(0, 2).map((job, i) => (
                                <div key={i} style={{ background: 'var(--bg-tint)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
                                        <div>
                                            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{job.job_title}</div>
                                            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{job.company_name}</div>
                                        </div>
                                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                            {formatDate(job.start_date)} – {formatDate(job.end_date)}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                        {formatDescription(job.description)}
                                    </div>
                                </div>
                            )) : <Empty>No experience listed</Empty>}
                        </ProfileSection>
                    </div>
                )}

                {/* Experience */}
                {activeTab === 'experience' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {work.length > 0 ? work.map((job, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 14 }}>
                                <div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                                        {formatDate(job.start_date)}<br />— {formatDate(job.end_date)}
                                    </div>
                                    {job.location && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{job.location}</div>}
                                </div>
                                <div>
                                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{job.job_title}</div>
                                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}>{job.company_name}</div>
                                    {job.achievements && job.achievements.length > 0 ? (
                                        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.7 }}>
                                            {job.achievements.map((item, j) => <li key={j}>{item}</li>)}
                                        </ul>
                                    ) : job.description ? (
                                        <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                                            {formatDescription(job.description)}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        )) : <Empty>No work experience found.</Empty>}
                    </div>
                )}

                {/* Education */}
                {activeTab === 'education' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {education.length > 0 ? education.map((edu, i) => (
                            <div key={i} style={{ background: 'var(--bg-tint)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
                                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>{edu.institution}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 2 }}>{edu.degree}</div>
                                {(edu.major || edu.graduation_year) && (
                                    <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                                        {[edu.major, edu.graduation_year].filter(Boolean).join(' · ')}
                                    </div>
                                )}
                            </div>
                        )) : <div style={{ gridColumn: '1 / -1' }}><Empty>No education found.</Empty></div>}
                    </div>
                )}

                {/* Skills */}
                {activeTab === 'skills' && (
                    <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 12 }}>
                            All Skills
                        </div>
                        {skills.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {skills.map((skill, i) => <SkillPill key={i}>{skill}</SkillPill>)}
                            </div>
                        ) : <Empty>No skills extracted.</Empty>}
                    </div>
                )}

                {/* More — dynamic pointer-based sections */}
                {activeTab === 'more' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        {sections.map((section, i) => (
                            <PointerSection key={i} title={section.title} pointers={section.pointers} />
                        ))}
                    </div>
                )}

            </div>
        </div>
    );
}

function PointerSection({ title, pointers }: { title: string; pointers: string[] }) {
    return (
        <ProfileSection title={title}>
            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.7 }}>
                {pointers.map((pointer, i) => <li key={i}>{pointer}</li>)}
            </ul>
        </ProfileSection>
    );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function SkillPill({ children }: { children: React.ReactNode }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center',
            height: 24, padding: '0 9px', fontSize: 11.5, fontWeight: 500,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)',
            color: 'var(--text-2)', background: 'var(--surface-2)',
        }}>
            {children}
        </span>
    );
}

function ContactPill({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center',
            height: 24, padding: '0 10px', fontSize: 12, fontWeight: 500,
            borderRadius: 999, border: accent ? '1px solid var(--accent-soft)' : '1px solid var(--border-soft)',
            background: accent ? 'var(--accent-soft)' : 'var(--surface-2)',
            color: accent ? 'var(--accent-ink)' : 'var(--text-3)',
        }}>
            {children}
        </span>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <p style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic', margin: 0 }}>{children}</p>
    );
}
