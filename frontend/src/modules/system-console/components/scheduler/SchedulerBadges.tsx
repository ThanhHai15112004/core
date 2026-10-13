import { useLocale } from '@core/i18n/index';
import { cn } from '@core/lib/cn';
import { Badge } from '@core/ui/primitives';
import { StatusDot } from '@core/ui/blocks';
import type { ExecutionStatus, Schedule, TaskRow } from '../../types/scheduler.types';
import { EXECUTION_TONE, TASK_HEALTH_TONE, TASK_STATUS_TONE } from '../../constants/scheduler';

/** Trạng thái vận hành của task (bật / tắt / đang chạy ×n / đang lỗi). */
export function TaskStatusBadge({ task }: { task: Pick<TaskRow, 'status' | 'running'> }) {
  const { t } = useLocale();
  const tone = TASK_STATUS_TONE[task.status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} size="xs" pulse={task.status === 'running'} />
      {t(`sch.task.status.${task.status}`)}
      {task.status === 'running' && task.running > 1 && <span className="font-mono">×{task.running}</span>}
    </Badge>
  );
}

/** Sức khoẻ — tách khỏi trạng thái vận hành (task có thể vừa bật vừa cảnh báo). */
export function TaskHealthLabel({ health, className }: { health: TaskRow['health']; className?: string }) {
  const { t } = useLocale();
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      <StatusDot tone={TASK_HEALTH_TONE[health]} size="xs" />
      {t(`sch.task.health.${health}`)}
    </span>
  );
}

export function ExecStatusBadge({ status }: { status: ExecutionStatus }) {
  const { t } = useLocale();
  const tone = EXECUTION_TONE[status];
  return (
    <Badge tone={tone}>
      <StatusDot tone={tone} size="xs" pulse={status === 'running'} />
      {t(`sch.exec.status.${status}`)}
    </Badge>
  );
}

/** Lịch cho người đọc là phần chính; biểu thức cron (+ múi giờ) giữ cho developer. */
export function ScheduleText({ schedule, showTz = false }: { schedule: Schedule; showTz?: boolean }) {
  const tz = showTz ? `${schedule.timezone} (${schedule.utcOffset})` : null;
  const meta = [schedule.expression, tz].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <div className="truncate text-fg-2">{schedule.description}</div>
      {meta && <div className="truncate font-mono text-2xs text-faint">{meta}</div>}
    </div>
  );
}
