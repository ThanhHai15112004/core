import React from 'react';
import type { Execution, Schedule, TaskRow } from '../../types/scheduler.types';
import { EXECUTION_ICON, EXECUTION_TONE, TASK_HEALTH_TONE, TASK_STATUS_ICON, TASK_STATUS_TONE } from '../../constants/scheduler';
import { useLocale } from '../../../../core/i18n/index';

/** Trạng thái hiển thị của task (● Enabled / ○ Disabled / ▶ Running / ⚠ Failing / ⚠ Overdue / ✕ Misconfigured). */
export const TaskStatusChip: React.FC<{ task: Pick<TaskRow, 'status' | 'running'> }> = ({ task }) => {
  const { t } = useLocale();
  return (
    <span className={`pf-chip ov-tone-${TASK_STATUS_TONE[task.status]}`}>
      {TASK_STATUS_ICON[task.status]} {t(`sch.task.status.${task.status}`)}
      {task.status === 'running' && task.running > 1 && ` ×${task.running}`}
    </span>
  );
};

/** Sức khoẻ tách riêng với trạng thái vận hành (một task có thể vừa Enabled vừa Warning). */
export const TaskHealthDot: React.FC<{ task: Pick<TaskRow, 'health'> }> = ({ task }) => {
  const { t } = useLocale();
  return (
    <span className={`sch-health ov-tone-${TASK_HEALTH_TONE[task.health]}`} title={t(`sch.task.health.${task.health}`)}>
      <span className="ov-dot" aria-hidden="true" /> {t(`sch.task.health.${task.health}`)}
    </span>
  );
};

export const ExecutionStatusChip: React.FC<{ exec: Pick<Execution, 'status'> }> = ({ exec }) => {
  const { t } = useLocale();
  const tone = EXECUTION_TONE[exec.status];
  return (
    <span className={`pf-chip ov-tone-${tone}`}>
      {EXECUTION_ICON[exec.status]} {t(`sch.exec.status.${exec.status}`)}
    </span>
  );
};

/** Lịch cho người đọc là phần chính; biểu thức cron + múi giờ giữ cho developer. */
export const ScheduleCell: React.FC<{ schedule: Schedule; showTz?: boolean }> = ({ schedule, showTz = false }) => (
  <span className="sch-schedule">
    <span>{schedule.description}</span>
    <small className="pf-row-note">
      {schedule.expression && <code>{schedule.expression}</code>}
      {showTz && (
        <>
          {schedule.expression && ' · '}
          {schedule.timezone} ({schedule.utcOffset})
        </>
      )}
    </small>
  </span>
);
