'use client';

import { useState, useCallback, type DragEvent } from 'react';
import type { JobListItem } from '@/utils/api';
import KanbanCard from './KanbanCard';
import { motion, AnimatePresence } from 'framer-motion';

interface KanbanBoardProps {
  jobs: JobListItem[];
  onStatusChange: (jobId: string, newStatus: string) => void;
  onJobClick: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onArchive: (jobId: string) => void;
}

/** Column definitions — left to right */
const COLUMNS = [
  { status: 'tracked', label: 'Tracked', dotColor: '#52525b' },
  { status: 'applied', label: 'Applied', dotColor: '#0ea5e9' },
  { status: 'interview', label: 'Interview', dotColor: '#f59e0b' },
  { status: 'offer', label: 'Offer', dotColor: '#22c55e' },
  { status: 'rejected', label: 'Rejected', dotColor: '#52525b' },
] as const;

type ColumnStatus = (typeof COLUMNS)[number]['status'];

export default function KanbanBoard({ jobs, onStatusChange, onJobClick, onDelete, onArchive }: KanbanBoardProps) {
  // Track which column is currently being dragged over for visual feedback
  const [dragOverColumn, setDragOverColumn] = useState<ColumnStatus | null>(null);

  // Group jobs by status
  const jobsByStatus = new Map<ColumnStatus, JobListItem[]>();
  for (const col of COLUMNS) {
    jobsByStatus.set(col.status, []);
  }
  for (const job of jobs) {
    const colStatus = job.status as ColumnStatus;
    if (jobsByStatus.has(colStatus)) {
      jobsByStatus.get(colStatus)!.push(job);
    }
    // Jobs with statuses like 'queued' or 'analyzing' are not shown in columns
  }

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, status: ColumnStatus) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverColumn(status);
    },
    [],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Only clear if leaving the column element itself (not entering a child)
      const rect = e.currentTarget.getBoundingClientRect();
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setDragOverColumn(null);
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, columnStatus: ColumnStatus) => {
      e.preventDefault();
      setDragOverColumn(null);

      const jobId = e.dataTransfer.getData('jobId');
      const currentStatus = e.dataTransfer.getData('currentStatus');

      if (jobId && currentStatus !== columnStatus) {
        onStatusChange(jobId, columnStatus);
      }
    },
    [onStatusChange],
  );

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-4"
      style={{ minHeight: 'calc(100vh - 200px)' }}
    >
      {COLUMNS.map((col) => {
        const columnJobs = jobsByStatus.get(col.status) ?? [];
        const isDragOver = dragOverColumn === col.status;

        return (
          <div
            key={col.status}
            className="flex flex-col rounded-xl flex-shrink-0 transition-colors duration-200"
            style={{
              width: 268,
              minHeight: '100%',
              background: isDragOver ? 'var(--hover)' : 'var(--surface)',
              border: `1px solid ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
            }}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              {/* Colored dot */}
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: col.dotColor }}
              />
              {/* Label */}
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--text-2)' }}
              >
                {col.label}
              </span>
              {/* Count badge */}
              <span
                className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ml-auto"
                style={{
                  background: 'var(--card)',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border)',
                }}
              >
                {columnJobs.length}
              </span>
            </div>

            {/* Cards area */}
            <div className="flex flex-col gap-2 p-2 flex-1">
              {columnJobs.length === 0 ? (
                // Empty state
                <div className="flex items-center justify-center py-10">
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-3)', opacity: 0.6 }}
                  >
                    No jobs
                  </span>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {columnJobs.map((job) => (
                    <KanbanCard
                      key={job.id}
                      job={job}
                      onStatusChange={onStatusChange}
                      onClick={onJobClick}
                      onDelete={onDelete}
                      onArchive={onArchive}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
