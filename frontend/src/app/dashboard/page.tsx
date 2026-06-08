'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/utils/store';
import { api, type JobListItem, type JobUpdate } from '@/utils/api';
import Header from '@/components/Header';
import KanbanBoard from '@/components/KanbanBoard';
import AddJobModal from '@/components/AddJobModal';
import ConfirmationModal from '@/components/ConfirmationModal';

// ── Helpers ────────────────────────────────────────────────────────────────

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

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

function scoreToBand(score: number): 'strong' | 'good' | 'partial' | 'weak' {
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 55) return 'partial';
  return 'weak';
}

const BAND_COLOR: Record<string, string> = {
  strong: 'var(--strong)',
  good: 'var(--good)',
  partial: 'var(--partial)',
  weak: 'var(--weak)',
};

const BAND_SOFT: Record<string, string> = {
  strong: 'var(--strong-soft)',
  good: 'var(--good-soft)',
  partial: 'var(--partial-soft)',
  weak: 'var(--weak-soft)',
};

// ── CompanyMark ────────────────────────────────────────────────────────────

function CompanyMark({ label, hue, size = 28 }: { label: string; hue: number; size?: number }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: 'var(--radius-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `oklch(0.92 0.05 ${hue} / 0.55)`,
      color: `oklch(0.30 0.08 ${hue})`,
      fontFamily: 'var(--font-mono)',
      fontSize: size * 0.38,
      fontWeight: 600,
      letterSpacing: '0.02em',
      flexShrink: 0,
      border: '1px solid var(--border-soft)',
    }}>
      {label}
    </div>
  );
}

// ── Pipeline steps ─────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'profile', label: 'Profile' },
  { key: 'job_description', label: 'Job description' },
  { key: 'company_intel', label: 'Company intel' },
  { key: 'match_analysis', label: 'Match analysis' },
  { key: 'reachout', label: 'Reachout' },
] as const;

// ── TopBar ─────────────────────────────────────────────────────────────────

function TopBar({ onTrack, onAnalyze }: { onTrack: () => void; onAnalyze: () => void }) {
  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 10,
      padding: '18px 24px 12px',
      borderBottom: '1px solid var(--border-soft)',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'calc(var(--display-scale, 0.92) * 28px)',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--text)',
          lineHeight: 1.1,
        }}>
          Dashboard
        </div>
        <div style={{
          marginTop: 4,
          fontSize: 13,
          color: 'var(--text-3)',
        }}>
          Your active pipeline, jobs in analysis, and items requiring action.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onTrack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 13px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-2)',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'border-color 120ms, color 120ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)'; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 4v16m8-8H4" />
          </svg>
          Track a job
        </button>
        <button
          onClick={onAnalyze}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 13px',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--bg)',
            background: 'var(--text)',
            border: '1px solid var(--text)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'opacity 120ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.82'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          Analyze Job
        </button>
      </div>
    </div>
  );
}

// ── ProcessingStrip ────────────────────────────────────────────────────────

function ProcessingStrip({ jobs, onOpen }: { jobs: JobListItem[]; onOpen: (id: string) => void }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-soft)',
        background: 'var(--bg-tint)',
      }}>
        <span
          className="wand-pulse"
          style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)', flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.01em' }}>
          JobLens · Processing
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          JobLens is running — jobs appear on your board when analysis completes.
        </span>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
          {jobs.length} active
        </div>
      </div>

      {/* Job cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 0,
      }}>
        {jobs.map((job, i) => (
          <ProcessingCard key={job.id} job={job} onOpen={onOpen} hasBorder={i < jobs.length - 1} />
        ))}
      </div>
    </div>
  );
}

function ProcessingCard({ job, onOpen, hasBorder }: { job: JobListItem; onOpen: (id: string) => void; hasBorder: boolean }) {
  const company = job.job_posting?.company_name || 'Unknown';
  const title = job.job_posting?.job_title || 'Analyzing…';
  const location = job.job_posting?.location;
  const initials = company.split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase().slice(0, 2);
  const hue = hashHue(company);
  const stepIdx = job.current_step ?? 0;

  return (
    <div
      onClick={() => onOpen(job.id)}
      style={{
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRight: hasBorder ? '1px solid var(--border-soft)' : 'none',
        cursor: 'pointer',
        transition: 'background 140ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tint)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Job info row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <CompanyMark label={initials} hue={hue} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{company}</span>
            {location && (
              <>
                <span style={{ color: 'var(--text-4)' }}>·</span>
                <span>{location}</span>
              </>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--accent)',
          background: 'var(--accent-soft)',
          padding: '2px 7px',
          borderRadius: 'var(--radius-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          {job.status}
        </span>
      </div>

      {/* Pipeline step bars */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {PIPELINE_STEPS.map((s, idx) => {
          const state = idx < stepIdx ? 'done' : idx === stepIdx ? 'running' : 'queued';
          return (
            <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                className={state === 'running' ? 'wand-shimmer' : undefined}
                style={{
                  height: 3,
                  width: '100%',
                  borderRadius: 999,
                  background: state === 'done'
                    ? 'var(--strong)'
                    : state === 'running'
                      ? 'var(--accent)'
                      : 'var(--surface-3)',
                }}
              />
              <span style={{
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: state === 'queued' ? 'var(--text-4)' : 'var(--text-3)',
                letterSpacing: '0.03em',
              }}>
                {s.label.split(' ')[0].toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color: 'var(--text-2)' }}>
          Step{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{Math.min(stepIdx + 1, 5)}/5</span>
          {' · '}
          <span style={{ color: 'var(--text-3)' }}>{PIPELINE_STEPS[Math.min(stepIdx, PIPELINE_STEPS.length - 1)]?.label}</span>
        </span>
        <span style={{ color: 'var(--accent)', fontSize: 11 }}>Open →</span>
      </div>
    </div>
  );
}

// ── StatsRow ───────────────────────────────────────────────────────────────

const STAT_ITEMS = [
  { key: 'active', label: 'Active', tone: 'neutral' },
  { key: 'applied', label: 'Applied', tone: 'accent' },
  { key: 'interview', label: 'Interview', tone: 'good' },
  { key: 'offer', label: 'Offer', tone: 'strong' },
  { key: 'rejected', label: 'Rejected', tone: 'weak' },
] as const;

function StatDotColor(tone: string): string {
  if (tone === 'neutral') return 'var(--text-3)';
  if (tone === 'accent') return 'var(--accent)';
  return `var(--${tone})`;
}

function StatsRow({ counts }: { counts: Record<string, number> }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 0,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      {STAT_ITEMS.map((it, i) => (
        <div
          key={it.key}
          style={{
            padding: '14px 18px',
            borderRight: i < STAT_ITEMS.length - 1 ? '1px solid var(--border-soft)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: StatDotColor(it.tone),
              opacity: 0.7,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {it.label}
            </span>
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'calc(var(--display-scale, 0.92) * 32px)',
            fontWeight: 500,
            color: 'var(--text)',
            letterSpacing: '-0.025em',
            lineHeight: 1,
          }}>
            {counts[it.key] ?? 0}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── ArchivedSection ────────────────────────────────────────────────────────

function ArchivedSection({
  jobs,
  open,
  setOpen,
  onOpen,
  onRestore,
  onDelete,
}: {
  jobs: JobListItem[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onOpen: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          border: '1px solid var(--border)',
          borderRadius: open ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
          background: open ? 'var(--bg-tint)' : 'var(--surface)',
          width: '100%',
          cursor: 'pointer',
          transition: 'background 140ms',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'var(--bg-tint)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'var(--surface)'; }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: 'var(--text-3)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 180ms',
            flexShrink: 0,
          }}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.01em' }}>Archived</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Removed from board — still accessible via Jobs</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
          {jobs.length}
        </span>
      </button>

      {open && (
        <div
          className="wand-fadeup"
          style={{
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 var(--radius) var(--radius)',
            background: 'var(--surface)',
            overflow: 'hidden',
          }}
        >
          {jobs.map((job, i) => {
            const company = job.job_posting?.company_name || 'Unknown';
            const title = job.job_posting?.job_title || 'Untitled Position';
            const location = job.job_posting?.location;
            const initials = company.split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase().slice(0, 2);
            const hue = hashHue(company);
            return (
              <div
                key={job.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 14px',
                  borderTop: i > 0 ? '1px solid var(--border-soft)' : 'none',
                }}
              >
                <CompanyMark label={initials} hue={hue} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                    {company}{location ? ` · ${location}` : ''}
                  </div>
                </div>
                {job.final_score != null && (() => {
                  const band = scoreToBand(job.final_score);
                  return (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-xs)',
                      background: BAND_SOFT[band],
                      color: BAND_COLOR[band],
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}>
                      {job.final_score}
                    </span>
                  );
                })()}
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>
                  {timeAgo(job.updated_at ?? job.created_at)}
                </span>
                <button
                  onClick={() => onRestore(job.id)}
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-2)',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'border-color 120ms, color 120ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  Restore
                </button>
                <button
                  onClick={() => onOpen(job.id)}
                  title="View job details"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-3)',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)'; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
                <button
                  onClick={() => onDelete(job.id)}
                  title="Permanently delete job"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-3)',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--weak)'; e.currentTarget.style.borderColor = 'var(--weak)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, token, _hasHydrated, fetchUser, user } = useStore();

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalMode, setAddModalMode] = useState<'analyze' | 'track'>('analyze');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJobs(data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }, []);

  const handleStatusChange = useCallback(async (jobId: string, newStatus: string) => {
    const targetJob = jobs.find((j) => j.id === jobId);
    if (!targetJob) return;
    const previousStatus = targetJob.status;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: newStatus as JobListItem['status'] } : j)));
    try {
      await api.updateJob(jobId, { status: newStatus as JobUpdate['status'] });
    } catch (err) {
      console.error('Failed to update job status:', err);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: previousStatus } : j)));
    }
  }, [jobs]);

  const handleJobClick = useCallback((jobId: string) => {
    router.push(`/jobs/${jobId}`);
  }, [router]);

  const handleConfirmDelete = useCallback(async () => {
    if (!showDeleteConfirm) return;
    try {
      await api.deleteJob(showDeleteConfirm);
      setJobs((prev) => prev.filter((j) => j.id !== showDeleteConfirm));
    } catch (err) {
      console.error('Failed to delete job:', err);
      throw err;
    }
  }, [showDeleteConfirm]);

  const handleArchive = useCallback(async (jobId: string) => {
    const targetJob = jobs.find((j) => j.id === jobId);
    if (!targetJob) return;
    const previousStatus = targetJob.status;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'archived' as JobListItem['status'] } : j)));
    try {
      await api.updateJob(jobId, { status: 'archived' as JobUpdate['status'] });
    } catch (err) {
      console.error('Failed to archive job:', err);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: previousStatus } : j)));
    }
  }, [jobs]);

  const handleRestore = useCallback(async (jobId: string) => {
    await handleStatusChange(jobId, 'tracked');
  }, [handleStatusChange]);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (token && !user) { fetchUser(); return; }
    if (!token) { router.push('/'); return; }
    if (isAuthenticated) loadJobs();
  }, [_hasHydrated, isAuthenticated, token, user, fetchUser, router, loadJobs]);

  // Poll while any job is still processing so step bars and status stay live.
  const processingJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'analyzing');
  useEffect(() => {
    if (processingJobs.length === 0) return;
    const interval = setInterval(loadJobs, 4000);
    return () => clearInterval(interval);
  }, [processingJobs.length, loadJobs]);

  if (!_hasHydrated || !isAuthenticated) return null;

  // ── Derived data ────────────────────────────────────────────────────────
  const activeBoardJobs = jobs.filter((j) =>
    j.status === 'tracked' || j.status === 'applied' || j.status === 'interview' || j.status === 'offer' || j.status === 'rejected'
  );
  const archivedJobs = jobs.filter((j) => j.status === 'archived');

  const counts = {
    active: activeBoardJobs.length,
    applied: activeBoardJobs.filter((j) => j.status === 'applied').length,
    interview: activeBoardJobs.filter((j) => j.status === 'interview').length,
    offer: activeBoardJobs.filter((j) => j.status === 'offer').length,
    rejected: activeBoardJobs.filter((j) => j.status === 'rejected').length,
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <main style={{ minHeight: '100vh' }}>
      <Header />

      <TopBar
        onTrack={() => { setAddModalMode('track'); setShowAddModal(true); }}
        onAnalyze={() => { setAddModalMode('analyze'); setShowAddModal(true); }}
      />

      <div style={{ padding: '20px 24px 100px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Processing strip */}
        {processingJobs.length > 0 && (
          <ProcessingStrip jobs={processingJobs} onOpen={handleJobClick} />
        )}

        {/* Stats row */}
        <StatsRow counts={counts} />

        {/* Kanban board */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                Active workflow
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'calc(var(--display-scale, 0.92) * 20px)',
                fontWeight: 500,
                letterSpacing: '-0.015em',
                color: 'var(--text)',
              }}>
                Application board
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Drag to move · {activeBoardJobs.length} active
            </div>
          </div>
          <KanbanBoard
            jobs={activeBoardJobs}
            onStatusChange={handleStatusChange}
            onJobClick={handleJobClick}
            onDelete={(jobId) => setShowDeleteConfirm(jobId)}
            onArchive={(jobId) => setShowArchiveConfirm(jobId)}
          />
        </div>

        {/* Archived section */}
        {archivedJobs.length > 0 && (
          <ArchivedSection
            jobs={archivedJobs}
            open={archivedOpen}
            setOpen={setArchivedOpen}
            onOpen={handleJobClick}
            onRestore={handleRestore}
            onDelete={(jobId) => setShowDeleteConfirm(jobId)}
          />
        )}
      </div>

      {/* Add Job Modal */}
      <AddJobModal
        isOpen={showAddModal}
        initialMode={addModalMode}
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
