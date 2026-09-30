import React from 'react';
import type { SchedulerRange, TaskRow } from '../../types/scheduler.types';
import type { TaskAction } from '../../hooks/useSchedulerActions';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { TaskTable } from '../../components/scheduler/TaskTable';
import { useLocale } from '../../../../core/i18n/index';

/** Tasks: quản lý lịch — tìm, lọc theo trạng thái / kiểu lịch / sức khoẻ, sắp xếp; Run Now ngay trên dòng. */
export const SchedulerTasksView: React.FC<{
  range: SchedulerRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  openTask: (taskId: string) => void;
  onAction: (action: TaskAction, task: TaskRow) => void;
  canRun: boolean;
}> = ({ paused, reloadKey, now, openTask, onAction, canRun }) => {
  const { t } = useLocale();
  const { data, error } = usePolling(() => schedulerApi.tasks(), `sch-tasks:${reloadKey}`, 10_000, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.task.title')}</h3>
        {data && <span className="ov-section-hint">{t('sch.task.hint', { count: data.tasks.length })}</span>}
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {data && <TaskTable rows={data.tasks} now={now} onOpen={openTask} onAction={onAction} canRun={canRun} tools emptyText={t('sch.task.empty')} />}
      <p className="pf-chart-note">{t('sch.task.note')}</p>
    </section>
  );
};
