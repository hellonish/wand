'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { api, JobTrackCreate, type JobStatus, isApiError } from '@/utils/api';
import { useStore } from '@/utils/store';

/** Status options for the Track mode dropdown. */
const STATUS_OPTIONS = ['tracked', 'applied', 'interview', 'offer', 'rejected', 'archived'] as const;

/** Mode toggle between AI analysis and manual tracking. */
type AddMode = 'analyze' | 'track';

export interface AddJobModalProps {
    /** Whether the modal is visible. */
    isOpen: boolean;
    /** Closes the modal (parent should set isOpen to false). */
    onClose: () => void;
    /** Called after a job is successfully created via "Analyze with AI". */
    onJobCreated?: (jobId: string) => void;
    /** Called after a job is successfully logged via "Just Track". */
    onJobTracked?: () => void;
    /** Which mode to open the modal in (defaults to 'analyze'). */
    initialMode?: AddMode;
}

/**
 * Shared "Add Job" modal with two modes:
 * 1. **Analyze with AI** — paste a JD + optional company website to kick off the full pipeline.
 * 2. **Just Track** — manually log a job with title, company, URL, location, and status.
 *
 * Rendered into `document.body` via a React portal.
 */
export default function AddJobModal({ isOpen, onClose, onJobCreated, onJobTracked, initialMode = 'analyze' }: AddJobModalProps) {
    // ── All hooks MUST be called before any early return (Rules of Hooks) ──

    const router = useRouter();

    // SSR guard
    const [mounted, setMounted] = useState(false);

    // Mode
    const [addMode, setAddMode] = useState<AddMode>(initialMode);

    // Error banner
    const [errorCode, setErrorCode] = useState<string | null>(null);

    // Analyze-mode state
    const [jdText, setJdText] = useState('');
    const [companyWebsite, setCompanyWebsite] = useState('');

    // Track-mode state
    const [trackTitle, setTrackTitle] = useState('');
    const [trackCompany, setTrackCompany] = useState('');
    const [trackUrl, setTrackUrl] = useState('');
    const [trackLocation, setTrackLocation] = useState('');
    const [trackStatus, setTrackStatus] = useState<JobStatus>('tracked');

    // Shared
    const [isCreating, setIsCreating] = useState(false);

    // Upgrade prompt

    // SSR mount effect
    useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

    // Sync mode when modal opens
    useEffect(() => { if (isOpen) setAddMode(initialMode); }, [isOpen, initialMode]);

    /** Reset every form field and switch back to the default mode. */
    const resetForm = useCallback(() => {
        setAddMode(initialMode);
        setJdText('');
        setCompanyWebsite('');
        setTrackTitle('');
        setTrackCompany('');
        setTrackUrl('');
        setTrackLocation('');
        setTrackStatus('tracked');
        setErrorCode(null);
    }, []);

    /** Close the modal and reset form state. */
    const handleClose = useCallback(() => {
        if (isCreating) return;
        resetForm();
        onClose();
    }, [isCreating, resetForm, onClose]);

    // ── SSR guard — after all hooks, before any conditional returns ────
    if (!mounted) return null;

    // ── Handlers ───────────────────────────────────────────────────────

    const handleCreateJob = async () => {
        if (!jdText.trim() || isCreating) return;
        setIsCreating(true);
        setErrorCode(null);
        try {
            const newJob = await api.createJob({
                jd_text: jdText.trim(),
                company_website: companyWebsite.trim() || undefined,
            });
            resetForm();
            onClose();
            onJobCreated?.(newJob.id);
        } catch (error) {
            if (isApiError(error)) {
                const code = error.body?.code;
                if (code) {
                    setErrorCode(code);
                } else {
                    console.error('Failed to create job:', error);
                }
            } else {
                console.error('Failed to create job:', error);
            }
        } finally {
            setIsCreating(false);
        }
    };

    const handleTrackJob = async () => {
        if (!trackTitle.trim() || !trackCompany.trim() || isCreating) return;
        setIsCreating(true);
        try {
            const payload: JobTrackCreate = {
                job_title: trackTitle.trim(),
                company_name: trackCompany.trim(),
                job_url: trackUrl.trim() || undefined,
                location: trackLocation.trim() || undefined,
                status: trackStatus,
            };
            await api.trackJob(payload);
            resetForm();
            onClose();
            onJobTracked?.();
        } catch (error) {
            if (isApiError(error) && error.status === 429) {
            } else {
                console.error('Failed to track job:', error);
            }
        } finally {
            setIsCreating(false);
        }
    };

    // ── Helpers ────────────────────────────────────────────────────────

    const canAnalyze = jdText.trim().length > 0;
    const canTrack = trackTitle.trim().length > 0 && trackCompany.trim().length > 0;

    // ── Render ─────────────────────────────────────────────────────────

    return (
        <>
        {createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleClose}
                        className="absolute inset-0"
                        style={{ background: 'var(--overlay)' }}
                    />

                    {/* Dialog */}
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        className="relative w-full max-w-2xl rounded-xl flex flex-col"
                        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                    >
                        {/* ── Header ─────────────────────────────────────── */}
                        <div
                            className="flex items-center justify-between px-5 py-4"
                            style={{ borderBottom: '1px solid var(--border)' }}
                        >
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-1)' }}>
                                Add Job
                            </h2>
                            <button
                                onClick={handleClose}
                                style={{ color: 'var(--text-3)', background: 'none', border: 'none' }}
                                className="text-lg leading-none cursor-pointer"
                            >
                                ×
                            </button>
                        </div>

                        {/* ── Mode toggle ─────────────────────────────────── */}
                        <div className="px-5 pt-4">
                            <div
                                className="flex w-full"
                                style={{
                                    background: 'var(--bg-tint)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius)',
                                    padding: 3,
                                    gap: 3,
                                }}
                            >
                                {([
                                    { key: 'analyze' as const, label: 'Analyze with JobLens', desc: 'Full analysis — fit score, gaps, and recommendations' },
                                    { key: 'track' as const, label: 'Track a job', desc: 'Save the job without analysis' },
                                ]).map(opt => {
                                    const active = addMode === opt.key;
                                    return (
                                        <button
                                            key={opt.key}
                                            onClick={() => setAddMode(opt.key)}
                                            style={{
                                                flex: 1, display: 'flex', flexDirection: 'column',
                                                alignItems: 'center', gap: 2,
                                                padding: '9px 12px',
                                                borderRadius: 'calc(var(--radius) - 1px)',
                                                background: active ? 'var(--surface)' : 'transparent',
                                                boxShadow: active ? 'var(--shadow-2)' : 'none',
                                                color: active ? 'var(--text)' : 'var(--text-3)',
                                                border: 'none',
                                                cursor: active ? 'default' : 'pointer',
                                                transition: 'all 140ms ease',
                                            }}
                                        >
                                            <span style={{ fontSize: 13.5, fontWeight: active ? 500 : 400 }}>{opt.label}</span>
                                            <span style={{ fontSize: 11.5, color: active ? 'var(--text-3)' : 'var(--text-4)' }}>{opt.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ── Body — Analyze mode ─────────────────────────── */}
                        {addMode === 'analyze' && (
                            <div className="px-5 py-4 flex flex-col gap-4">
                                <div>
                                    <label
                                        className="block text-xs mb-1.5"
                                        style={{ color: 'var(--text-2)' }}
                                    >
                                        Job description{' '}
                                        <span style={{ color: 'var(--accent)' }}>*</span>
                                    </label>
                                    <textarea
                                        value={jdText}
                                        onChange={e => setJdText(e.target.value)}
                                        placeholder="Paste the complete job description…"
                                        rows={9}
                                        className="w-full rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none transition-colors"
                                        style={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--text-1)',
                                        }}
                                        onFocus={e => {
                                            (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border-strong)';
                                        }}
                                        onBlur={e => {
                                            (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border)';
                                        }}
                                    />
                                </div>
                                <div>
                                    <label
                                        className="block text-xs mb-1.5"
                                        style={{ color: 'var(--text-2)' }}
                                    >
                                        Company Website{' '}
                                        <span style={{ color: 'var(--text-3)' }}>(optional)</span>
                                    </label>
                                    <input
                                        type="url"
                                        value={companyWebsite}
                                        onChange={e => setCompanyWebsite(e.target.value)}
                                        placeholder="https://company.com"
                                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
                                        style={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--text-1)',
                                        }}
                                        onFocus={e => {
                                            (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)';
                                        }}
                                        onBlur={e => {
                                            (e.target as HTMLInputElement).style.borderColor = 'var(--border)';
                                        }}
                                    />
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                                        Optional — helps Hopper gather company context and culture
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* ── Body — Track mode ──────────────────────────── */}
                        {addMode === 'track' && (
                            <div className="px-5 py-4 flex flex-col gap-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label
                                            className="block text-xs mb-1.5"
                                            style={{ color: 'var(--text-2)' }}
                                        >
                                            Job title{' '}
                                            <span style={{ color: 'var(--accent)' }}>*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={trackTitle}
                                            onChange={e => setTrackTitle(e.target.value)}
                                            placeholder="Software Engineer"
                                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
                                            style={{
                                                background: 'var(--surface)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--text-1)',
                                            }}
                                            onFocus={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)';
                                            }}
                                            onBlur={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border)';
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="block text-xs mb-1.5"
                                            style={{ color: 'var(--text-2)' }}
                                        >
                                            Company{' '}
                                            <span style={{ color: 'var(--accent)' }}>*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={trackCompany}
                                            onChange={e => setTrackCompany(e.target.value)}
                                            placeholder="Example Corp"
                                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
                                            style={{
                                                background: 'var(--surface)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--text-1)',
                                            }}
                                            onFocus={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)';
                                            }}
                                            onBlur={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border)';
                                            }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label
                                        className="block text-xs mb-1.5"
                                        style={{ color: 'var(--text-2)' }}
                                    >
                                        Job URL{' '}
                                        <span style={{ color: 'var(--text-3)' }}>(optional)</span>
                                    </label>
                                    <input
                                        type="url"
                                        value={trackUrl}
                                        onChange={e => setTrackUrl(e.target.value)}
                                        placeholder="https://..."
                                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
                                        style={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            color: 'var(--text-1)',
                                        }}
                                        onFocus={e => {
                                            (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)';
                                        }}
                                        onBlur={e => {
                                            (e.target as HTMLInputElement).style.borderColor = 'var(--border)';
                                        }}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label
                                            className="block text-xs mb-1.5"
                                            style={{ color: 'var(--text-2)' }}
                                        >
                                            Location{' '}
                                            <span style={{ color: 'var(--text-3)' }}>(optional)</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={trackLocation}
                                            onChange={e => setTrackLocation(e.target.value)}
                                            placeholder="San Francisco, CA"
                                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors"
                                            style={{
                                                background: 'var(--surface)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--text-1)',
                                            }}
                                            onFocus={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)';
                                            }}
                                            onBlur={e => {
                                                (e.target as HTMLInputElement).style.borderColor = 'var(--border)';
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            className="block text-xs mb-1.5"
                                            style={{ color: 'var(--text-2)' }}
                                        >
                                            Status
                                        </label>
                                        <select
                                            value={trackStatus}
                                        onChange={e => setTrackStatus(e.target.value as JobStatus)}
                                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors cursor-pointer"
                                            style={{
                                                background: 'var(--surface)',
                                                border: '1px solid var(--border)',
                                                color: 'var(--text-1)',
                                            }}
                                        >
                                            {STATUS_OPTIONS.map(status => (
                                                <option key={status} value={status}>
                                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Error banner ────────────────────────────────── */}
                        {errorCode === 'NO_PROFILE_DOCUMENTS' && (
                            <div
                                className="mx-5 mb-1 rounded-lg flex items-start gap-3 px-4 py-3"
                                style={{
                                    background: 'rgba(245, 158, 11, 0.08)',
                                    border: '1px solid rgba(245, 158, 11, 0.35)',
                                }}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(217,119,6,1)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(180,100,0,1)', margin: 0, marginBottom: 4 }}>
                                        No profile documents found
                                    </p>
                                    <p style={{ fontSize: 12.5, color: 'rgba(180,100,0,0.85)', margin: 0, lineHeight: 1.55 }}>
                                        Upload at least one document — resume or LinkedIn export — so Hopper can build your profile before analysis.
                                    </p>
                                    <button
                                        onClick={() => { resetForm(); onClose(); router.push('/profile'); }}
                                        style={{
                                            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
                                            height: 28, padding: '0 12px',
                                            background: 'rgba(245,158,11,0.15)', color: 'rgba(180,100,0,1)',
                                            border: '1px solid rgba(245,158,11,0.4)', borderRadius: 'var(--radius-sm)',
                                            fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                                        }}
                                    >
                                        Go to Profile →
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Footer ─────────────────────────────────────── */}
                        <div
                            className="flex items-center justify-end gap-2 px-5 py-4"
                            style={{ borderTop: '1px solid var(--border)' }}
                        >
                            <button
                                onClick={handleClose}
                                disabled={isCreating}
                                style={{
                                    height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500,
                                    color: 'var(--text-2)', background: 'var(--surface)',
                                    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer', transition: 'all 140ms ease',
                                }}
                            >
                                Cancel
                            </button>

                            {addMode === 'analyze' ? (
                                <button
                                    onClick={handleCreateJob}
                                    disabled={!canAnalyze || isCreating}
                                    style={{
                                        height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500,
                                        background: canAnalyze && !isCreating ? 'var(--btn-primary)' : 'var(--surface-2)',
                                        color: canAnalyze && !isCreating ? 'var(--on-btn-primary)' : 'var(--text-3)',
                                        border: '1px solid transparent',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: canAnalyze && !isCreating ? 'pointer' : 'not-allowed',
                                        transition: 'all 140ms ease',
                                    }}
                                >
                                    {isCreating ? 'Analyzing…' : 'Start analysis'}
                                </button>
                            ) : (
                                <button
                                    onClick={handleTrackJob}
                                    disabled={!canTrack || isCreating}
                                    style={{
                                        height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500,
                                        background: canTrack && !isCreating ? 'var(--btn-primary)' : 'var(--surface-2)',
                                        color: canTrack && !isCreating ? 'var(--on-btn-primary)' : 'var(--text-3)',
                                        border: '1px solid transparent',
                                        borderRadius: 'var(--radius-sm)',
                                        cursor: canTrack && !isCreating ? 'pointer' : 'not-allowed',
                                        transition: 'all 140ms ease',
                                    }}
                                >
                                    {isCreating ? 'Tracking…' : 'Track job'}
                                </button>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
        )}
        </>
    );
}
