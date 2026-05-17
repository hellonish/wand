'use client';

import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react';
import { motion } from 'framer-motion';
import type { JobListItem } from '@/utils/api';

interface KanbanCardProps {
  job: JobListItem;
  onStatusChange: (jobId: string, newStatus: string) => void;
  onClick: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onArchive: (jobId: string) => void;
}

/** Format ISO date string to short display like "Apr 9" */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Colored score badge — mirrors Jobs page ScoreCell logic */
function ScoreBadge({ score }: { score: number | undefined }) {
  if (score === undefined || score === null) return null;

  const color =
    score >= 80 ? '#22c55e' :
    score >= 60 ? '#f59e0b' :
    'var(--text-3)';

  return (
    <span
      className="text-[11px] font-mono tabular-nums leading-none"
      style={{ color }}
    >
      {score}
    </span>
  );
}

/** Two-letter company initials avatar — matches Jobs page CompanyInitials */
function CompanyInitials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div
      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-[9px] font-semibold"
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

export default function KanbanCard({ job, onStatusChange, onClick, onDelete, onArchive }: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const title = job.job_posting?.job_title || 'Untitled Position';
  const company = job.job_posting?.company_name || 'Unknown';

  // Click-away listener to close context menu
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData('jobId', job.id);
      e.dataTransfer.setData('currentStatus', job.status);
      e.dataTransfer.effectAllowed = 'move';
      // Small delay so the browser captures the card image before we dim it
      requestAnimationFrame(() => setIsDragging(true));
    },
    [job.id, job.status],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!menuOpen) {
      onClick(job.id);
    }
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
    <motion.div
      layout
      layoutId={`kanban-card-${job.id}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        className="group rounded-lg p-2.5 cursor-grab active:cursor-grabbing select-none transition-colors duration-150 relative"
        style={{
          background: 'var(--card)',
          border: `1px solid ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-strong)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
          }
        }}
      >
        {/* Company row */}
        <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
          <CompanyInitials name={company} />
          <span
            className="text-xs truncate"
            style={{ color: 'var(--text-2)' }}
          >
            {company}
          </span>
          {/* Spacer pushes score + menu to the right */}
          <span className="flex-1" />

          {/* Score badge */}
          {job.final_score !== undefined && job.final_score !== null && (
            <span className="flex-shrink-0">
              <ScoreBadge score={job.final_score} />
            </span>
          )}

          {/* Three-dot context menu button */}
          <div className="flex-shrink-0 relative" ref={menuRef}>
            <button
              onClick={handleMenuToggle}
              className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--text-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-2)';
                e.currentTarget.style.background = 'var(--hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-3)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 py-1 rounded-lg z-10 min-w-[140px]"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                }}
              >
                {/* Archive */}
                <button
                  onClick={handleArchive}
                  className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left rounded transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--hover)';
                    e.currentTarget.style.color = 'var(--text-1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-2)';
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="5" rx="1" />
                    <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
                    <path d="M10 12h4" />
                  </svg>
                  Archive
                </button>

                {/* Delete */}
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left rounded transition-colors"
                  style={{ color: 'var(--text-2)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                    e.currentTarget.style.color = '#f87171';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-2)';
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Job title */}
        <p
          className="text-sm font-medium leading-snug truncate mb-1.5"
          style={{ color: 'var(--text-1)' }}
        >
          {title}
        </p>

        {/* Date added */}
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: 'var(--text-3)' }}
        >
          {formatDate(job.created_at)}
        </span>
      </div>
    </motion.div>
  );
}
