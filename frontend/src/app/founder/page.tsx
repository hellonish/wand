'use client';

import React from 'react';
import Link from 'next/link';

/**
 * Founder page - personal story and background behind iNeedaJob.pro.
 */

export default function FounderPage() {
    return (
        <main style={{ minHeight: '100vh' }}>
            {/* Minimal public nav */}
            <nav style={{
                position: 'sticky', top: 0, zIndex: 40,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 24px', height: 52,
                background: 'var(--bg)', borderBottom: '1px solid var(--border-soft)',
            }}>
                <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--text)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.svg" alt="iNeedaJob.pro" style={{ width: 26, height: 26, borderRadius: 'var(--radius)', display: 'block' }} />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, letterSpacing: '-0.02em' }}>iNeedaJob.pro</span>
                </Link>
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <Link href="/about" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>
                        About
                    </Link>
                    <Link href="/dashboard" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>
                        Back to app →
                    </Link>
                </div>
            </nav>

            <article
                style={{
                    maxWidth: 760,
                    margin: '0 auto',
                    padding: '56px 24px 120px',
                    color: 'var(--text-2)',
                    fontSize: 15,
                    lineHeight: 1.7,
                }}
            >
                {/* Header */}
                <header style={{ marginBottom: 48 }}>
                    <div
                        style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            fontWeight: 500,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-3)',
                            marginBottom: 12,
                        }}
                    >
                        Founder
                    </div>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'calc(var(--display-scale, 0.92) * 48px)',
                            fontWeight: 500,
                            letterSpacing: '-0.02em',
                            color: 'var(--text)',
                            lineHeight: 1.1,
                            margin: 0,
                        }}
                    >
                        About the Founder
                    </h1>
                </header>

                {/* Founder image and intro */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 32,
                    marginBottom: 48,
                }}>
                    {/* Founder image */}
                    <div style={{
                        width: '100%',
                        maxWidth: 400,
                        aspectRatio: '1 / 1',
                        margin: '0 auto',
                        borderRadius: 'var(--radius, 10px)',
                        overflow: 'hidden',
                        border: '1px solid var(--border-soft)',
                    }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/founder.jpg"
                            alt="Founder"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover'
                            }}
                        />
                    </div>
                </div>

                {/* Story sections */}
                <Section>
                    <H2>Hi, I'm Nishant Sharma</H2>
                    <P>
                        I'm an AI engineer based in New York, and I build production multi-agent systems — the kind that survive real-world data, server limits, and edge cases that break demos. I'm a 2× founder, and this is my second venture solving a problem I've lived through myself.
                    </P>
                    <P>
                        I built iNeedaJob.pro because I was tired of the information asymmetry in job hunting. You spend hours tailoring a resume, hit submit, and get ghosted — not because you're unqualified, but because your application didn't match the keyword scan or you didn't frame your experience the way the ATS expected.
                    </P>
                    <P>
                        This tool exists to close that gap. It gives you honest feedback about where you stand before you apply, so you can fix the gaps or move on with confidence.
                    </P>
                </Section>

                <Section>
                    <H2>The Backstory</H2>
                    <P>
                        I started coding seriously in my undergrad at APJ Abdul Kalam Technical University in Delhi, then moved to New York for my M.S. in Computer Engineering at NYU Tandon (graduated May 2026). Along the way, I've been a founding engineer at a tech consultancy building client platforms, a lead engineer scaling multi-tenant backends for 1,000+ users, and a TA mentoring 100+ grad students through PyTorch training pipelines.
                    </P>
                    <P>
                        I've also applied to hundreds of jobs myself — and I've seen the pattern over and over. The best candidates get filtered out not because they're unqualified, but because their resume doesn't surface the right keywords or doesn't speak the language of the job description. Meanwhile, people who know how to game the system get through.
                    </P>
                    <P>
                        It's not about merit. It's about information asymmetry. And AI is finally good enough to fix that.
                    </P>
                </Section>

                <Section>
                    <H2>Why Now</H2>
                    <P>
                        I built this in January 2026, right as I was finishing my master's and applying to jobs myself. LLMs had finally gotten good enough to do reliable structured extraction and analysis — and more importantly, they were accessible. You can bring your own API key for a few dollars a month and run unlimited analyses.
                    </P>
                    <P>
                        I'd just shipped <a href="https://singularity.hellonish.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>Singularity</a>, a production multi-agent research platform (coded in 13 days, ~25K lines), and I knew how to build agentic pipelines that don't fall apart under load. So I applied the same principles here: plan-before-execute orchestration, typed LLM outputs everywhere, async job pipelines with retries and recovery, and a BYOK model so the platform costs me $0 in inference.
                    </P>
                    <P>
                        I didn't want to build a black-box SaaS that charges per analysis or locks your data behind a paywall. I wanted something you could own, inspect, and self-host. Open source felt like the only honest way to do that. The hosted version at <a href="https://ineedajob.pro" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>ineedajob.pro</a> is free, but if you want full control, clone the repo and run it yourself. No tracking, no lock-in, no surprises.
                    </P>
                </Section>

                <Section>
                    <H2>What I Believe</H2>
                    <ul style={{ margin: '16px 0', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <li style={{ paddingLeft: 4 }}>
                            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>No demo-ware.</strong> Production systems need to survive real-world data, server limits, and edge cases. If it works in a demo but crashes at scale, it's not done.
                        </li>
                        <li style={{ paddingLeft: 4 }}>
                            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>Job hunting should be informed, not guesswork.</strong> You should know where you stand before you apply, not after you get rejected.
                        </li>
                        <li style={{ paddingLeft: 4 }}>
                            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>AI should amplify your judgment, not replace it.</strong> This tool shows you what the ATS and recruiter will see, but you decide what to do with that information.
                        </li>
                        <li style={{ paddingLeft: 4 }}>
                            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>Tools should be transparent and ownable.</strong> You should be able to inspect the code, understand the logic, and modify it if you want. No black boxes, no vendor lock-in.
                        </li>
                        <li style={{ paddingLeft: 4 }}>
                            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>Your data is yours.</strong> We don't sell it, we don't train on it, and we don't hold it hostage. You can delete it anytime.
                        </li>
                    </ul>
                </Section>

                <Section>
                    <H2>What's Next</H2>
                    <P>
                        The platform is live and growing (400 users, 46 DAU as of June 2026), but there's a lot left to build. I'm continuing to improve it based on feedback from people actually using it in their job searches. Current roadmap:
                    </P>
                    <ul style={{ margin: '16px 0', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <li style={{ paddingLeft: 4 }}>Better support for non-traditional career paths — bootcamp grads, career switchers, freelancers who don't fit the standard resume template.</li>
                        <li style={{ paddingLeft: 4 }}>More granular resume editing suggestions tied to specific job requirements, with before/after diffs and prioritization based on impact.</li>
                        <li style={{ paddingLeft: 4 }}>Enhanced company intelligence: team structure, hiring patterns, recent layoffs, funding rounds, and glassdoor sentiment analysis.</li>
                        <li style={{ paddingLeft: 4 }}>Interview prep mode that generates questions based on the job description and your profile gaps, with suggested talking points.</li>
                        <li style={{ paddingLeft: 4 }}>Tighter integration with the Hopper browser extension for one-click job capture and instant analysis.</li>
                    </ul>
                    <P>
                        If you have ideas, feedback, or bug reports, I'd love to hear from you. You can reach me at{' '}
                        <a href="mailto:hellonishantsh@gmail.com" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                            hellonishantsh@gmail.com
                        </a>{' '}
                        or open an issue on{' '}
                        <a href="https://github.com/hellonish/ineedajob.pro" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                            GitHub
                        </a>.
                    </P>
                </Section>

                {/* Footer CTA */}
                <div style={{
                    marginTop: 56,
                    paddingTop: 24,
                    borderTop: '1px solid var(--border-soft)',
                }}>
                    <P>
                        Want to learn more?{' '}
                        <Link href="/about" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                            Read about the product
                        </Link>{' '}
                        or{' '}
                        <Link href="/dashboard" style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                            try it yourself
                        </Link>.
                    </P>
                </div>
            </article>
        </main>
    );
}

// ── Layout components ───────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
    return <section style={{ marginBottom: 40 }}>{children}</section>;
}

function H2({ children }: { children: React.ReactNode }) {
    return (
        <h2
            style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                color: 'var(--text)',
                margin: '0 0 16px',
                lineHeight: 1.2,
            }}
        >
            {children}
        </h2>
    );
}

function P({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '0 0 16px' }}>{children}</p>;
}
