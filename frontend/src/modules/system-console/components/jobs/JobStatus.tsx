import { AlertTriangle, Ban, Check, Circle, Clock, Loader, RotateCw, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Badge } from '@core/ui/primitives';
import { UsageBar } from '@core/ui/blocks';
import type { JobRow, JobStatus } from '../../types/jobs.types';
import { JOB_STATUS_TONE } from '../../constants/jobs';

const STATUS_ICON: Record<JobStatus, LucideIcon> = {
  waiting: Circle,
  active: Loader,
  completed: Check,
  failed: X,
  retrying: RotateCw,
  delayed: Clock,
  stalled: AlertTriangle,
  cancelled: Ban,
};

/** Chip trạng thái job: icon + nhãn, màu theo tông. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { t } = useLocale();
  const Icon = STATUS_ICON[status];
  return (
    <Badge tone={JOB_STATUS_TONE[status]}>
      <Icon />
      {t(`jobs.status.${status}`)}
    </Badge>
  );
}

/** Tiến độ chỉ khi handler báo — không giả %. */
export function JobProgress({ job, withStep, className }: { job: Pick<JobRow, 'progress'>; withStep?: boolean; className?: string }) {
  const p = job.progress;
  if (!p || p.percent === null) return null;
  return <UsageBar percent={p.percent} tone="info" label={withStep ? (p.step ?? undefined) : undefined} className={className} />;
}
