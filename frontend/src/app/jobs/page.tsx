'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, JobListItem } from '@/utils/api';
import Header from '@/components/Header';
import { motion, AnimatePresence } from 'framer-motion';
import ConfirmationModal from '@/components/ConfirmationModal';
import AddJobModal from '@/components/AddJobModal';

const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'tracked', label: 'Tracked' },
    { value: 'applied', label: 'Applied' },
    { value: 'interview', label: 'Interview' },
    { value: 'offer', label: 'Offer' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'archived', label: 'Archived' },
];

const STATUS_META: Record<string, { label: string; dotColor: string; textColor: string }> = {
    tracked:   { label: 'Tracked',   dotColor: '#52525b', textColor: '#71717a' },
    queued:    { label: 'Queued',    dotColor: '#52525b', textColor: '#71717a' },
    analyzing: { label: 'Analyzing', dotColor: '#818cf8', textColor: '#818cf8' },
    applied:   { label: 'Applied',   dotColor: '#0ea5e9', textColor: '#0ea5e9' },
    interview: { label: 'Interview', dotColor: '#f59e0b', textColor: '#f59e0b' },
    offer:     { label: 'Offer',     dotColor: '#22c55e', textColor: '#22c55e' },
    rejected:  { label: 'Rejected',  dotColor: '#52525b', textColor: '#52525b' },
    archived:  { label: 'Archived',  dotColor: '#a1a1aa', textColor: '#a1a1aa' },
};

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ScoreCell({ score }: { score: number | undefined }) {
    if (score === undefined || score === null) {
        return <span className="text-sm font-mono" style={{ color: 'var(--text-3)' }}>—</span>;
    }
    const color =
        score >= 80 ? '#22c55e' :
        score >= 60 ? '#f59e0b' :
        'var(--text-3)';
    return (
        <span className="text-sm font-mono tabular-nums" style={{ color }}>
            {score}
        </span>
    );
}

function CompanyInitials({ name }: { name: string }) {
    const initials = name
        .split(' ')
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase();
    return (
        <div
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-semibold"
            style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-3)',
            }}
        >
            {initials}
        </div>
    );
}

export default function JobsPage() {
    const router = useRouter();
    const { isAuthenticated, token, _hasHydrated, fetchUser, user, jobsFilter, setJobsFilter } = useStore();
    const [jobs, setJobs] = useState<JobListItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);

    useEffect(() => {
        if (!_hasHydrated) return;
        if (token && !user) { fetchUser(); return; }
        if (!token) { router.push('/'); return; }
        if (isAuthenticated) loadJobs();
    }, [_hasHydrated, isAuthenticated, token, user, fetchUser, router]);

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

    const filteredJobs = jobs.filter(job => {
        if (jobsFilter !== 'all' && job.status !== jobsFilter) return false;
        if (searchQuery.trim()) {
            const title = (job.job_posting?.job_title || '').toLowerCase();
            const company = (job.job_posting?.company_name || '').toLowerCase();
            const q = searchQuery.toLowerCase();
            return title.includes(q) || company.includes(q);
        }
        return true;
    });

    const counts: Record<string, number> = { all: jobs.length };
    jobs.forEach(j => { counts[j.status] = (counts[j.status] || 0) + 1; });

    if (!_hasHydrated || !isAuthenticated) return null;

    return (
        <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
            <Header />

            <div className="max-w-screen-xl mx-auto px-8 py-6">

                {/* Page header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
                            Jobs
                        </h1>
                        <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {jobs.length} tracked
                        </p>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
                        style={{
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-2)',
                            background: 'transparent',
                        }}
                        onMouseEnter={e => {
                            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-border)';
                        }}
                        onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
                        }}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Job
                    </button>
                </div>

                {/* Filter tabs + Search */}
                <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-0">
                        {STATUS_OPTIONS.map(opt => {
                            const active = jobsFilter === opt.value;
                            const count = counts[opt.value] ?? 0;
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => setJobsFilter(opt.value)}
                                    className="flex items-center gap-1.5 px-3 py-2 text-sm transition-colors cursor-pointer relative"
                                    style={{
                                        color: active ? 'var(--accent)' : 'var(--text-3)',
                                        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                                        background: 'transparent',
                                    }}
                                    onMouseEnter={e => {
                                        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
                                    }}
                                    onMouseLeave={e => {
                                        if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
                                    }}
                                >
                                    {opt.label}
                                    {count > 0 && (
                                        <span
                                            className="text-[10px] tabular-nums px-1 py-0.5 rounded"
                                            style={{
                                                color: active ? 'var(--accent)' : 'var(--text-3)',
                                                background: 'var(--surface)',
                                            }}
                                        >
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <svg
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                            style={{ color: 'var(--text-3)' }}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search..."
                            className="w-52 pl-8 pr-3 py-1.5 text-xs rounded-md transition-colors focus:outline-none"
                            style={{
                                background: 'var(--card)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-1)',
                            }}
                            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--border-strong)'; }}
                            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)'; }}
                        />
                    </div>
                </div>

                {/* Table */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div
                            className="w-5 h-5 rounded-full animate-spin"
                            style={{
                                border: '2px solid var(--border-strong)',
                                borderTopColor: 'var(--accent)',
                            }}
                        />
                    </div>
                ) : filteredJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                            {searchQuery || jobsFilter !== 'all' ? 'No jobs match your filters.' : 'No jobs yet.'}
                        </p>
                        {!searchQuery && jobsFilter === 'all' && (
                            <button
                                onClick={() => router.push('/dashboard')}
                                className="text-xs transition-colors cursor-pointer"
                                style={{ color: 'var(--text-3)' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)'; }}
                            >
                                Add your first job →
                            </button>
                        )}
                    </div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                        className="rounded-lg overflow-hidden"
                        style={{ border: '1px solid var(--border)' }}
                    >
                        {/* Table header */}
                        <div
                            className="grid items-center"
                            style={{
                                gridTemplateColumns: '32px 180px 1fr 100px 60px 140px 80px 60px',
                                background: 'var(--surface)',
                                borderBottom: '1px solid var(--border)',
                            }}
                        >
                            {['#', 'Company', 'Role', 'Status', 'Match', 'Location', 'Added', ''].map((h, i) => (
                                <div
                                    key={i}
                                    className="px-3 py-2.5 text-[10px] uppercase tracking-widest"
                                    style={{ color: 'var(--text-3)' }}
                                >
                                    {h}
                                </div>
                            ))}
                        </div>

                        {/* Rows */}
                        <AnimatePresence initial={false}>
                            {filteredJobs.map((job, idx) => {
                                const title = job.job_posting?.job_title || 'Untitled Position';
                                const company = job.job_posting?.company_name || 'Unknown';
                                const location = job.job_posting?.location || '';
                                const meta = STATUS_META[job.status] || STATUS_META.tracked;
                                const isLast = idx === filteredJobs.length - 1;

                                return (
                                    <motion.div
                                        key={job.id}
                                        layout
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.1 }}
                                        onClick={() => router.push(`/jobs/${job.id}`)}
                                        className="grid items-center group cursor-pointer transition-colors duration-100"
                                        style={{
                                            gridTemplateColumns: '32px 180px 1fr 100px 60px 140px 80px 60px',
                                            background: 'var(--bg)',
                                            borderBottom: isLast ? 'none' : '1px solid var(--border)',
                                        }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hover)'; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)'; }}
                                    >
                                        {/* # */}
                                        <div className="px-3 py-3 text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>
                                            {idx + 1}
                                        </div>

                                        {/* Company */}
                                        <div className="px-3 py-3 flex items-center gap-2 min-w-0">
                                            <CompanyInitials name={company} />
                                            <span className="text-sm truncate" style={{ color: 'var(--text-1)' }}>
                                                {company}
                                            </span>
                                        </div>

                                        {/* Role */}
                                        <div className="px-3 py-3 min-w-0">
                                            <span className="text-sm truncate block" style={{ color: 'var(--text-1)' }}>
                                                {title}
                                            </span>
                                            {location && (
                                                <span className="text-xs mt-0.5 truncate block" style={{ color: 'var(--text-3)' }}>
                                                    {location}
                                                </span>
                                            )}
                                        </div>

                                        {/* Status */}
                                        <div className="px-3 py-3">
                                            <span className="flex items-center gap-1.5">
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                                    style={{ background: meta.dotColor }}
                                                />
                                                <span className="text-xs" style={{ color: meta.textColor }}>
                                                    {meta.label}
                                                </span>
                                            </span>
                                        </div>

                                        {/* Match */}
                                        <div className="px-3 py-3">
                                            <ScoreCell score={job.final_score} />
                                        </div>

                                        {/* Location */}
                                        <div className="px-3 py-3 min-w-0">
                                            <span className="text-xs truncate block" style={{ color: 'var(--text-3)' }}>
                                                {location || '—'}
                                            </span>
                                        </div>

                                        {/* Added */}
                                        <div className="px-3 py-3">
                                            <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-3)' }}>
                                                {formatDate(job.created_at)}
                                            </span>
                                        </div>

                                        {/* Actions */}
                                        <div className="px-3 py-3 flex items-center justify-center">
                                            <button
                                                onClick={e => { e.stopPropagation(); setShowDeleteConfirm(job.id); }}
                                                className="p-1.5 rounded transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                                style={{ color: 'var(--text-3)' }}
                                                onMouseEnter={e => {
                                                    (e.currentTarget as HTMLButtonElement).style.color = '#f87171';
                                                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)';
                                                }}
                                                onMouseLeave={e => {
                                                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
                                                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                                                }}
                                                title="Delete"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </motion.div>
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

            {/* Add Job Modal */}
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
