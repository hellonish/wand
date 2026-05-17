'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { api, JobTrackCreate } from '@/utils/api';

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
}

/**
 * Shared "Add Job" modal with two modes:
 * 1. **Analyze with AI** — paste a JD + optional company website to kick off the full pipeline.
 * 2. **Just Track** — manually log a job with title, company, URL, location, and status.
 *
 * Rendered into `document.body` via a React portal.
 */
export default function AddJobModal({ isOpen, onClose, onJobCreated, onJobTracked }: AddJobModalProps) {
    // ── All hooks MUST be called before any early return (Rules of Hooks) ──

    // SSR guard
    const [mounted, setMounted] = useState(false);

    // Mode
    const [addMode, setAddMode] = useState<AddMode>('analyze');

    // Analyze-mode state
    const [jdText, setJdText] = useState('');
    const [companyWebsite, setCompanyWebsite] = useState('');

    // Track-mode state
    const [trackTitle, setTrackTitle] = useState('');
    const [trackCompany, setTrackCompany] = useState('');
    const [trackUrl, setTrackUrl] = useState('');
    const [trackLocation, setTrackLocation] = useState('');
    const [trackStatus, setTrackStatus] = useState<string>('tracked');

    // Shared
    const [isCreating, setIsCreating] = useState(false);

    // SSR mount effect
    useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

    /** Reset every form field and switch back to the default mode. */
    const resetForm = useCallback(() => {
        setAddMode('analyze');
        setJdText('');
        setCompanyWebsite('');
        setTrackTitle('');
        setTrackCompany('');
        setTrackUrl('');
        setTrackLocation('');
        setTrackStatus('tracked');
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
        try {
            const newJob = await api.createJob({
                jd_text: jdText.trim(),
                company_website: companyWebsite.trim() || undefined,
            });
            resetForm();
            onClose();
            onJobCreated?.(newJob.id);
        } catch (error) {
            console.error('Failed to create job:', error);
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
            console.error('Failed to track job:', error);
        } finally {
            setIsCreating(false);
        }
    };

    // ── Helpers ────────────────────────────────────────────────────────

    const canAnalyze = jdText.trim().length > 0;
    const canTrack = trackTitle.trim().length > 0 && trackCompany.trim().length > 0;

    // ── Render ─────────────────────────────────────────────────────────

    return createPortal(
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
                        style={{ background: 'rgba(0,0,0,0.6)' }}
                    />

                    {/* Dialog */}
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        className="relative w-full max-w-lg rounded-xl flex flex-col"
                        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                    >
                        {/* ── Header ─────────────────────────────────────── */}
                        <div
                            className="flex items-center justify-between px-5 py-4"
                            style={{ borderBottom: '1px solid var(--border)' }}
                        >
                            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
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
                                className="flex rounded-lg p-0.5 w-full"
                                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                            >
                                {([
                                    { key: 'analyze' as const, label: 'Analyze with AI', desc: 'Run full 6-step pipeline' },
                                    { key: 'track' as const, label: 'Just Track', desc: 'Log without analysis' },
                                ]).map(opt => (
                                    <button
                                        key={opt.key}
                                        onClick={() => setAddMode(opt.key)}
                                        className="flex-1 flex flex-col items-center py-2 px-3 rounded-md text-xs transition-all cursor-pointer"
                                        style={{
                                            background: addMode === opt.key ? 'var(--card)' : 'transparent',
                                            color: addMode === opt.key ? 'var(--text-1)' : 'var(--text-3)',
                                            border: addMode === opt.key ? '1px solid var(--border)' : '1px solid transparent',
                                            fontWeight: addMode === opt.key ? 500 : 400,
                                        }}
                                    >
                                        <span>{opt.label}</span>
                                        <span
                                            className="text-[10px] mt-0.5"
                                            style={{ color: 'var(--text-3)', opacity: 0.8 }}
                                        >
                                            {opt.desc}
                                        </span>
                                    </button>
                                ))}
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
                                        Job Description{' '}
                                        <span style={{ color: 'var(--accent)' }}>*</span>
                                    </label>
                                    <textarea
                                        value={jdText}
                                        onChange={e => setJdText(e.target.value)}
                                        placeholder="Paste the full job description here..."
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
                                        Used to research company culture and engineering environment
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
                                            Job Title{' '}
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
                                            placeholder="Acme Inc."
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
                                            onChange={e => setTrackStatus(e.target.value)}
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

                        {/* ── Footer ─────────────────────────────────────── */}
                        <div
                            className="flex items-center justify-end gap-2 px-5 py-4"
                            style={{ borderTop: '1px solid var(--border)' }}
                        >
                            <button
                                onClick={handleClose}
                                disabled={isCreating}
                                className="px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors"
                                style={{
                                    color: 'var(--text-2)',
                                    background: 'none',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                Cancel
                            </button>

                            {addMode === 'analyze' ? (
                                <button
                                    onClick={handleCreateJob}
                                    disabled={!canAnalyze || isCreating}
                                    className="px-4 py-1.5 text-sm rounded-md cursor-pointer transition-colors"
                                    style={{
                                        background: canAnalyze && !isCreating ? 'var(--accent)' : 'var(--surface)',
                                        color: canAnalyze && !isCreating ? '#fff' : 'var(--text-3)',
                                        border: '1px solid transparent',
                                        cursor: canAnalyze && !isCreating ? 'pointer' : 'not-allowed',
                                    }}
                                >
                                    {isCreating ? 'Starting analysis...' : 'Analyze Job'}
                                </button>
                            ) : (
                                <button
                                    onClick={handleTrackJob}
                                    disabled={!canTrack || isCreating}
                                    className="px-4 py-1.5 text-sm rounded-md cursor-pointer transition-colors"
                                    style={{
                                        background: canTrack && !isCreating ? 'var(--accent)' : 'var(--surface)',
                                        color: canTrack && !isCreating ? '#fff' : 'var(--text-3)',
                                        border: '1px solid transparent',
                                        cursor: canTrack && !isCreating ? 'pointer' : 'not-allowed',
                                    }}
                                >
                                    {isCreating ? 'Adding...' : 'Add Job'}
                                </button>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
