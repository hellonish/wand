'use client';

import { useState, useCallback, type DragEvent } from 'react';
import type { JobListItem } from '@/utils/api';
import KanbanCard from './KanbanCard';

interface KanbanBoardProps {
  jobs: JobListItem[];
  onStatusChange: (jobId: string, newStatus: string) => void;
  onJobClick: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onArchive: (jobId: string) => void;
}

const COLUMNS = [
  { status: 'tracked',   label: 'Tracked',   tone: 'neutral' },
  { status: 'applied',   label: 'Applied',   tone: 'accent' },
  { status: 'interview', label: 'Interview', tone: 'good' },
  { status: 'offer',     label: 'Offer',     tone: 'strong' },
  { status: 'rejected',  label: 'Rejected',  tone: 'weak' },
] as const;

type ColumnStatus = (typeof COLUMNS)[number]['status'];

function colDotColor(tone: string): string {
  if (tone === 'neutral') return 'var(--text-3)';
  if (tone === 'accent')  return 'var(--accent)';
  return `var(--${tone})`;
}

export default function KanbanBoard({ jobs, onStatusChange, onJobClick, onDelete, onArchive }: KanbanBoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<ColumnStatus | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Group jobs by status
  const jobsByStatus = new Map<ColumnStatus, JobListItem[]>();
  for (const col of COLUMNS) jobsByStatus.set(col.status, []);
  for (const job of jobs) {
    const key = job.status as ColumnStatus;
    if (jobsByStatus.has(key)) jobsByStatus.get(key)!.push(job);
  }

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, status: ColumnStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      setDragOverColumn(null);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>, columnStatus: ColumnStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggingId(null);
    const jobId = e.dataTransfer.getData('jobId');
    const currentStatus = e.dataTransfer.getData('currentStatus');
    if (jobId && currentStatus !== columnStatus) {
      onStatusChange(jobId, columnStatus);
    }
  }, [onStatusChange]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))`,
      gap: 10,
      alignItems: 'flex-start',
    }}>
      {COLUMNS.map((col) => {
        const columnJobs = jobsByStatus.get(col.status) ?? [];
        const isHover = dragOverColumn === col.status;

        return (
          <div
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
            style={{
              background: isHover ? 'var(--accent-soft)' : 'var(--bg-tint)',
              border: `1px ${isHover ? 'dashed' : 'solid'} ${isHover ? 'var(--accent)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--radius)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 200,
              transition: 'background 140ms, border-color 140ms',
            }}
          >
            {/* Column header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 4px',
            }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: colDotColor(col.tone),
                opacity: 0.75,
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: 'var(--text)',
              }}>
                {col.label}
              </span>
              <span style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-3)',
              }}>
                {columnJobs.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
              {columnJobs.map((job) => (
                <KanbanCard
                  key={job.id}
                  job={job}
                  onClick={onJobClick}
                  onDelete={onDelete}
                  onArchive={onArchive}
                />
              ))}
              {columnJobs.length === 0 && (
                <div style={{
                  padding: '18px 8px',
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--text-4)',
                  border: '1px dashed var(--border-soft)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.02em',
                }}>
                  nothing here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
