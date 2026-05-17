'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, QueueItem } from '@/utils/store';
import { api, JobListItem, QueueStatusResponse, type JobUpdate } from '@/utils/api';
import Header from '@/components/Header';
import KanbanBoard from '@/components/KanbanBoard';
import AddJobModal from '@/components/AddJobModal';
import ConfirmationModal from '@/components/ConfirmationModal';
import { motion, AnimatePresence } from 'framer-motion';


// ── Stat Card Component ─────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    color,
    delay
}: {
    label: string;
    value: number;
    color: string;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay || 0 }}
            className="bg-[var(--card)] backdrop-blur-sm border border-[var(--border)] rounded-xl !p-4 text-center hover:opacity-80 transition-opacity"
        >
            <p className={`text-2xl font-bold !mb-1 ${color}`}>{value}</p>
            <p className="text-xs text-[var(--text-2)]">{label}</p>
        </motion.div>
    );
}


// ── Queue Item Component ────────────────────────────────────────────────────

function QueueItemRow({
    item,
    onRemove
}: {
    item: QueueItem;
    onRemove: () => void;
}) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (item.status === 'complete' || item.status === 'error') return;

        const tick = () => {
            setElapsed(Math.floor((Date.now() - item.startTime) / 1000));
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [item.startTime, item.status]);

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex items-center justify-between !py-3 !px-4 bg-[var(--card)] border border-[var(--border)] rounded-lg"
        >
            <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-1)] truncate">{item.jobTitle}</p>
                <p className="text-xs text-[var(--text-3)]">
                    {item.status === 'analyzing' && `Analyzing... ${formatTime(elapsed)}`}
                    {item.status === 'pending' && 'Waiting...'}
                    {item.status === 'complete' && 'Complete'}
                    {item.status === 'error' && `Error: ${item.error}`}
                </p>
            </div>
            <button
                onClick={onRemove}
                className="!ml-3 text-[var(--text-3)] hover:text-red-400 transition-colors text-lg cursor-pointer"
                title="Remove"
            >
                ×
            </button>
        </motion.div>
    );
}


// ── Dashboard Page ──────────────────────────────────────────────────────────

export default function DashboardPage() {
    const router = useRouter();
    const {
        isAuthenticated, token, _hasHydrated, fetchUser, user,
        queue, removeFromQueue, clearQueue, setQueue,
    } = useStore();

    const [jobs, setJobs] = useState<JobListItem[]>([]);
    const [isQueueOpen, setIsQueueOpen] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [showArchiveConfirm, setShowArchiveConfirm] = useState<string | null>(null);

    // ── Load jobs from API ──────────────────────────────────────────────────

    const loadJobs = useCallback(async () => {
        try {
            const data = await api.getJobs();
            setJobs(data);
        } catch (err) {
            console.error('Failed to load jobs:', err);
        }
    }, []);

    // ── Optimistic status change handler ────────────────────────────────────

    const handleStatusChange = useCallback(async (jobId: string, newStatus: string) => {
        // Find the job's current status for per-item rollback
        const targetJob = jobs.find(j => j.id === jobId);
        if (!targetJob) return;
        const previousStatus = targetJob.status;

        // Optimistically update local state
        setJobs(prev =>
            prev.map(j => (j.id === jobId ? { ...j, status: newStatus as JobListItem['status'] } : j))
        );

        try {
            await api.updateJob(jobId, { status: newStatus as JobUpdate['status'] });
        } catch (err) {
            console.error('Failed to update job status:', err);
            // Roll back only the affected job
            setJobs(prev =>
                prev.map(j => (j.id === jobId ? { ...j, status: previousStatus } : j))
            );
        }
    }, [jobs]);

    // ── Navigate to job detail ──────────────────────────────────────────────

    const handleJobClick = useCallback((jobId: string) => {
        router.push(`/jobs/${jobId}`);
    }, [router]);

    // ── Delete handler ─────────────────────────────────────────────────────

    const handleConfirmDelete = useCallback(async () => {
        if (!showDeleteConfirm) return;
        try {
            await api.deleteJob(showDeleteConfirm);
            setJobs(prev => prev.filter(j => j.id !== showDeleteConfirm));
        } catch (err) {
            console.error('Failed to delete job:', err);
            throw err;
        }
    }, [showDeleteConfirm]);

    // ── Archive handler ────────────────────────────────────────────────────

    const handleArchive = useCallback(async (jobId: string) => {
        const targetJob = jobs.find(j => j.id === jobId);
        if (!targetJob) return;
        const previousStatus = targetJob.status;

        setJobs(prev =>
            prev.map(j => (j.id === jobId ? { ...j, status: 'archived' as JobListItem['status'] } : j))
        );

        try {
            await api.updateJob(jobId, { status: 'archived' as JobUpdate['status'] });
        } catch (err) {
            console.error('Failed to archive job:', err);
            setJobs(prev =>
                prev.map(j => (j.id === jobId ? { ...j, status: previousStatus } : j))
            );
        }
    }, [jobs]);

    // ── Initial data fetch ──────────────────────────────────────────────────

    useEffect(() => {
        if (!_hasHydrated) return;

        if (token && !user) {
            fetchUser();
            return;
        }

        if (!token) {
            router.push('/');
            return;
        }

        if (isAuthenticated) {
            loadJobs();

            api.getQueueStatus()
                .then((status: QueueStatusResponse) => {
                    const mappedQueue: QueueItem[] = status.jobs.map(j => ({
                        id: j.id,
                        jobTitle: j.job_title,
                        status: j.status === 'processing' ? 'analyzing' : 'pending',
                        startTime: Date.now(),
                    }));
                    setQueue(mappedQueue);
                })
                .catch(console.error);
        }
    }, [_hasHydrated, isAuthenticated, token, user, fetchUser, router, setQueue, loadJobs]);

    // ── Auth guard ──────────────────────────────────────────────────────────

    if (!_hasHydrated || !isAuthenticated) {
        return null;
    }

    // ── Derived data ────────────────────────────────────────────────────────

    const stats = {
        total: jobs.length,
        applied: jobs.filter(j => j.status === 'applied').length,
        interview: jobs.filter(j => j.status === 'interview').length,
        offer: jobs.filter(j => j.status === 'offer').length,
        rejected: jobs.filter(j => j.status === 'rejected').length,
    };

    const displayQueue = queue;

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <main className="min-h-screen">
            <Header />

            <div className="max-w-6xl mx-auto !px-6 !py-8">

                {/* Page Header */}
                <div className="flex items-center justify-between !mb-8">
                    <div>
                    <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-1)' }}>
                        Dashboard
                    </h1>
                    <p className="text-sm !mt-0.5" style={{ color: 'var(--text-2)' }}>
                            {stats.total} tracked
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
                            e.currentTarget.style.color = 'var(--text-1)';
                            e.currentTarget.style.borderColor = 'var(--accent-border)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.color = 'var(--text-2)';
                            e.currentTarget.style.borderColor = 'var(--border-strong)';
                        }}
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Job
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 !gap-4 !mb-8">
                    <StatCard label="Total Applications" value={stats.total} color="text-[var(--text-1)]" delay={0} />
                    <StatCard label="Applied" value={stats.applied} color="text-blue-500" delay={0.1} />
                    <StatCard label="Interview" value={stats.interview} color="text-yellow-500" delay={0.2} />
                    <StatCard label="Offer" value={stats.offer} color="text-green-500" delay={0.3} />
                    <StatCard label="Rejected" value={stats.rejected} color="text-red-500" delay={0.4} />
                </div>

                {/* Kanban Board */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="!mb-6"
                >
                    <KanbanBoard
                        jobs={jobs}
                        onStatusChange={handleStatusChange}
                        onJobClick={handleJobClick}
                        onDelete={(jobId) => setShowDeleteConfirm(jobId)}
                        onArchive={(jobId) => setShowArchiveConfirm(jobId)}
                    />
                </motion.div>

                {/* Analysis Queue */}
                <AnimatePresence>
                    {displayQueue.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-[var(--card)] backdrop-blur-sm border border-[var(--border)] rounded-2xl overflow-hidden"
                        >
                            <div
                                onClick={() => setIsQueueOpen(!isQueueOpen)}
                                className="w-full flex items-center justify-between !px-6 !py-4 hover:opacity-90 transition-opacity cursor-pointer"
                            >
                                <div className="flex items-center !gap-3">
                                    <span className="text-[var(--text-1)] font-medium">Analysis Queue</span>
                                    <span className="!px-2 !py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded-full">
                                        {displayQueue.length}
                                    </span>
                                </div>
                                <div className="flex items-center !gap-3">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            clearQueue();
                                        }}
                                        className="text-xs text-[var(--text-3)] hover:text-red-400 transition-colors cursor-pointer"
                                    >
                                        Clear all
                                    </button>
                                    <div className="flex-shrink-0 ml-2">
                                        <svg
                                            className={`w-5 h-5 text-[var(--text-2)] transition-transform ${isQueueOpen ? 'rotate-180' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                            {isQueueOpen && (
                                <motion.div className="!px-6 !pb-4 space-y-2">
                                    <AnimatePresence mode='popLayout'>
                                        {displayQueue.map((item) => (
                                            <QueueItemRow
                                                key={item.id}
                                                item={item}
                                                onRemove={() => {
                                                    api.cancelJob(item.id).catch(console.error);
                                                    removeFromQueue(item.id);
                                                }}
                                            />
                                        ))}
                                    </AnimatePresence>
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Add Job Modal */}
            <AddJobModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onJobCreated={(jobId) => router.push(`/jobs/${jobId}`)}
                onJobTracked={() => loadJobs()}
            />

            {/* Delete Confirmation */}
            <ConfirmationModal
                isOpen={!!showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(null)}
                onConfirm={handleConfirmDelete}
                title="Delete Job"
                message="Are you sure you want to delete this job? This action cannot be undone."
                confirmLabel="Delete"
                isDestructive={true}
            />

            {/* Archive Confirmation */}
            <ConfirmationModal
                isOpen={!!showArchiveConfirm}
                onClose={() => setShowArchiveConfirm(null)}
                onConfirm={async () => {
                    if (showArchiveConfirm) {
                        await handleArchive(showArchiveConfirm);
                        setShowArchiveConfirm(null);
                    }
                }}
                title="Archive Job"
                message="This job will be moved to archive and hidden from the board. You can still find it in the Jobs page under the 'Archived' filter."
                confirmLabel="Archive"
                isDestructive={false}
            />
        </main>
    );
}
