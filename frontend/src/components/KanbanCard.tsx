'use client';

import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react';
import type { JobListItem } from '@/utils/api';

interface KanbanCardProps {
  job: JobListItem;
  onClick: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onArchive: (jobId: string) => void;
}

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

const BAND_COLOR = {
  strong: 'var(--strong)',
  good: 'var(--good)',
  partial: 'var(--partial)',
  weak: 'var(--weak)',
};

const BAND_SOFT = {
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

// ── ScorePill ─────────────────────────────────────────────────────────────

function ScorePill({ score }: { score: number }) {
  const band = scoreToBand(score);
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
      lineHeight: 1.6,
      flexShrink: 0,
    }}>
      {score}
    </span>
  );
}

// ── KanbanCard ─────────────────────────────────────────────────────────────

export default function KanbanCard({ job, onClick, onDelete, onArchive }: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const title = job.job_posting?.job_title || 'Untitled Position';
  const company = job.job_posting?.company_name || 'Unknown';
  const location = job.job_posting?.location;

  const initials = company
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const hue = hashHue(company);

  // Click-away to close menu
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData('jobId', job.id);
      e.dataTransfer.setData('currentStatus', job.status);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => setIsDragging(true));
    },
    [job.id, job.status],
  );

  const handleDragEnd = useCallback(() => setIsDragging(false), []);

  const handleClick = useCallback(() => {
    if (!menuOpen) onClick(job.id);
  }, [job.id, onClick, menuOpen]);

  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  }, []);

  const handleArchive = useCallback(() => {
    onArchive(job.id);
    setMenuOpen(false);
  }, [job.id, onArchive]);

  const handleDelete = useCallback(() => {
    onDelete(job.id);
    setMenuOpen(false);
  }, [job.id, onDelete]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className="group"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--pad-card)',
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        transition: 'border-color 140ms',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        userSelect: 'none',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!isDragging) e.currentTarget.style.borderColor = 'var(--text-4)';
      }}
      onMouseLeave={(e) => {
        if (!isDragging) e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {/* Top row: company mark + title + menu */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <CompanyMark label={initials} hue={hue} size={24} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--text)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{company}</div>
        </div>

        {/* Three-dot context menu */}
        <div style={{ flexShrink: 0, position: 'relative' }} ref={menuRef}>
          <button
            onClick={handleMenuToggle}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-xs)',
              color: 'var(--text-3)',
              opacity: 0,
              transition: 'opacity 120ms, background 120ms',
            }}
            className="group-hover:!opacity-100"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.color = 'var(--text-2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-3)';
            }}
            title="More actions"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              zIndex: 20,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-2)',
              minWidth: 140,
              overflow: 'hidden',
              padding: '3px 0',
            }}>
              <button
                onClick={handleArchive}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: 12,
                  color: 'var(--text-2)',
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tint)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1" />
                  <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
                  <path d="M10 12h4" />
                </svg>
                Archive
              </button>
              <button
                onClick={handleDelete}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  width: '100%',
                  textAlign: 'left',
                  fontSize: 12,
                  color: 'var(--text-2)',
                  transition: 'background 100ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--weak-soft)'; e.currentTarget.style.color = 'var(--weak)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: score pill + location + time-ago */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
          {job.final_score != null ? (
            <ScorePill score={job.final_score} />
          ) : (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--surface-3)',
              color: 'var(--text-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.6,
            }}>—</span>
          )}
          {location && (
            <span style={{
              fontSize: 11,
              color: 'var(--text-3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{location}</span>
            </span>
          )}
        </div>
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-4)',
          flexShrink: 0,
        }}>
          {timeAgo(job.updated_at ?? job.created_at)}
        </span>
      </div>
    </div>
  );
}
