'use client';

/**
 * Shared chrome + typography primitives for the legal pages
 * (Terms, Privacy, Refunds). Keeps all three visually consistent
 * and matches the rest of the app's design tokens.
 */

import React from 'react';
import Link from 'next/link';

export const LEGAL_EFFECTIVE_DATE = 'June 4, 2026';
export const LEGAL_COMPANY = 'iNeedaJob.pro';
// TODO: replace with the registered legal entity name once incorporated.
export const LEGAL_ENTITY = 'iNeedaJob.pro';
// TODO: replace with the governing-law jurisdiction once decided.
export const LEGAL_JURISDICTION = '[Your State / Country]';

// ── Page wrapper ────────────────────────────────────────────────────────────

export function LegalPage({
    title,
    subtitle,
    updated = LEGAL_EFFECTIVE_DATE,
    children,
}: {
    title: string;
    subtitle?: string;
    updated?: string;
    children: React.ReactNode;
}) {
    return (
        <main style={{ minHeight: '100vh' }}>
            {/* Minimal public nav — no sidebar, no auth */}
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
                <Link href="/dashboard" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>
                    Back to app →
                </Link>
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
                {/* Title block */}
                <header style={{ marginBottom: 36 }}>
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
                        Legal
                    </div>
                    <h1
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 'calc(var(--display-scale, 0.92) * 40px)',
                            fontWeight: 500,
                            letterSpacing: '-0.02em',
                            color: 'var(--text)',
                            lineHeight: 1.1,
                            margin: 0,
                        }}
                    >
                        {title}
                    </h1>
                    {subtitle && (
                        <p style={{ marginTop: 12, fontSize: 15.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                            {subtitle}
                        </p>
                    )}
                    <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-3)' }}>
                        Last updated: {updated}
                    </div>
                </header>

                {children}

                {/* Cross-links */}
                <nav
                    style={{
                        marginTop: 56,
                        paddingTop: 24,
                        borderTop: '1px solid var(--border-soft)',
                        display: 'flex',
                        gap: 20,
                        flexWrap: 'wrap',
                        fontSize: 14,
                    }}
                >
                    <LegalNavLink href="/terms">Terms of Service</LegalNavLink>
                    <LegalNavLink href="/privacy">Privacy Policy</LegalNavLink>
                </nav>
            </article>
        </main>
    );
}

function LegalNavLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <Link
            href={href}
            style={{ color: 'var(--text-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
            {children}
        </Link>
    );
}

// ── Typography primitives ───────────────────────────────────────────────────

export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <h2
            id={id}
            style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(var(--display-scale, 0.92) * 24px)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                color: 'var(--text)',
                margin: '44px 0 14px',
                scrollMarginTop: 90,
            }}
        >
            {children}
        </h2>
    );
}

export function H3({ children }: { children: React.ReactNode }) {
    return (
        <h3
            style={{
                fontSize: 16.5,
                fontWeight: 600,
                color: 'var(--text)',
                margin: '26px 0 10px',
            }}
        >
            {children}
        </h3>
    );
}

export function P({ children }: { children: React.ReactNode }) {
    return <p style={{ margin: '0 0 16px' }}>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
    return <ul style={{ margin: '0 0 16px', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
    return <li style={{ paddingLeft: 4 }}>{children}</li>;
}

export function Strong({ children }: { children: React.ReactNode }) {
    return <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{children}</strong>;
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
    const external = href.startsWith('http');
    return (
        <a
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            style={{ color: 'var(--accent, var(--text))', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
            {children}
        </a>
    );
}

/** A muted callout box for important notices. */
export function Note({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                margin: '0 0 16px',
                padding: '14px 16px',
                background: 'var(--surface-2, var(--surface))',
                border: '1px solid var(--border-soft, var(--border))',
                borderRadius: 'var(--radius, 10px)',
                fontSize: 14,
                color: 'var(--text-2)',
                lineHeight: 1.6,
            }}
        >
            {children}
        </div>
    );
}
