'use client';

/**
 * ProfileDocumentReminder
 *
 * Floating bottom-right reminder shown to authenticated users who have not yet
 * uploaded any profile documents. Dismissible with a 24-hour snooze stored in
 * localStorage. Disappears permanently once the user has at least one document.
 */

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api } from '@/utils/api';

const SNOOZE_KEY = 'wand_profile_reminder_snoozed_until';
const SNOOZE_MS = 24 * 60 * 60 * 1000; // 24 hours

export default function ProfileDocumentReminder() {
    const { isAuthenticated, _hasHydrated } = useStore();
    const router = useRouter();
    const pathname = usePathname();
    const [visible, setVisible] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!_hasHydrated || !isAuthenticated) return;
        // Don't show on the profile page — user is already there
        if (pathname?.startsWith('/profile')) return;

        // Respect active snooze
        const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
        if (Date.now() < snoozedUntil) return;

        // Small delay so the reminder doesn't compete with initial page content
        const timer = setTimeout(() => {
            api.getProfileFiles()
                .then(r => {
                    if (r.total === 0) setVisible(true);
                })
                .catch(() => {/* silently ignore */});
        }, 1500);

        return () => clearTimeout(timer);
    }, [_hasHydrated, isAuthenticated, pathname]);

    const handleDismiss = () => {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
        setDismissed(true);
        // Fade out, then hide
        setTimeout(() => setVisible(false), 300);
    };

    const handleUpload = () => {
        handleDismiss();
        router.push('/profile');
    };

    if (!visible) return null;

    return (
        <div
            style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                zIndex: 9000,
                width: 320,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-2)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                opacity: dismissed ? 0 : 1,
                transform: dismissed ? 'translateY(8px)' : 'translateY(0)',
                transition: 'opacity 280ms ease, transform 280ms ease',
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Document icon */}
                    <div style={{
                        width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent-soft)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--accent-ink)' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                        Upload your resume
                    </span>
                </div>
                {/* Close / snooze button */}
                <button
                    onClick={handleDismiss}
                    title="Dismiss for 24 hours"
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-3)', padding: 2, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 4, transition: 'color 120ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
                >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Body */}
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                Add your resume or LinkedIn export so JobLens can score your fit and generate tailored applications.
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button
                    onClick={handleUpload}
                    style={{
                        flex: 1, height: 32,
                        background: 'var(--btn-primary)', color: 'var(--on-btn-primary)',
                        border: 'none', borderRadius: 'var(--radius-sm)',
                        fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                        transition: 'opacity 120ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                >
                    Upload documents
                </button>
                <button
                    onClick={handleDismiss}
                    style={{
                        height: 32, padding: '0 12px',
                        background: 'var(--surface-2)', color: 'var(--text-2)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        fontSize: 12.5, cursor: 'pointer',
                        transition: 'background 120ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tint)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                >
                    Later
                </button>
            </div>
        </div>
    );
}
