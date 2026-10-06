import React from 'react';
import type { JobRow, JobStatus } from '../../types/jobs.types';
import { JOB_STATUS_ICON, JOB_STATUS_TONE } from '../../constants/jobs';
import { useLocale } from '../../../../core/i18n/index';

/** ○ Waiting · ● Active · ✓ Completed · ✕ Failed · ↻ Retrying · ◷ Delayed · ⚠ Stalled · ⊘ Cancelled. */
export const JobStatusChip: React.FC<{
  status: JobStatus;
  large?: boolean;
}> = ({ status, large }) => {
  const { t } = useLocale();
  return (
    <span className={`pf-chip ov-tone-${JOB_STATUS_TONE[status]} ${large ? 'job-chip-lg' : ''}`}>
      {JOB_STATUS_ICON[status]} {t(`jobs.status.${status}`)}
    </span>
  );
};

/** Tiến độ chỉ khi handler báo — không giả %. */
export const JobProgressBar: React.FC<{
  job: Pick<JobRow, 'progress'>;
  compact?: boolean;
}> = ({ job, compact }) => {
  const p = job.progress;
  if (!p || p.percent === null) return compact ? <span className="ov-muted">—</span> : null;
  return (
    <span className={`job-progress ${compact ? 'is-compact' : ''}`} title={p.step ?? undefined}>
      <span className="job-progress-track">
        <span className="job-progress-fill" style={{ width: `${Math.min(100, Math.max(0, p.percent))}%` }} />
      </span>
      <span className="job-progress-value">{Math.round(p.percent)}%</span>
    </span>
  );
};
