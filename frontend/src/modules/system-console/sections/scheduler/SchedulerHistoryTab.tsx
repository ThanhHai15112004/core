import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { FilterBar, Panel, PanelGrid, QueryView, StatusDot } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { ExecutionStatus, ExecutionTrigger, TaskRow } from '../../types/scheduler.types';
import { schedulerApi, type ExecutionFilter } from '../../services/scheduler.api';
import { BREAKDOWN_TASKS, EXECUTION_STATUSES, EXECUTION_TONE, EXECUTION_TRIGGERS, HISTORY_LIMIT, HISTORY_TABLE_HEIGHT_PX, TASK_HISTORY_LIMIT } from '../../constants/scheduler';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { schedulerKeys } from './scheduler-keys';
import type { SchedulerPage } from './useSchedulerPage';

const ALL = '__all__';

/** Lịch sử: mọi lần chạy (lọc trạng thái / trigger / task); lọc "Lỗi" thêm phân tích theo loại lỗi và theo task. */
export function SchedulerHistoryTab({ page, tasks }: { page: SchedulerPage; tasks: TaskRow[] }) {
  const onlyFailed = page.filters.status.length === 1 && page.filters.status[0] === 'failed' && !page.filters.task;
  return (
    <>
      {onlyFailed && <FailureBreakdown page={page} />}
      <ExecutionHistory page={page} tasks={tasks} />
    </>
  );
}

/** Bảng lịch sử thực thi — dùng ở tab Lịch sử (mọi task) và trang task (`taskId` cố định). */
export function ExecutionHistory({ page, tasks = [], taskId }: { page: SchedulerPage; tasks?: TaskRow[]; taskId?: string }) {
  const { t } = useLocale();
  const { filters, setFilters, range } = page;
  const task = taskId ?? filters.task;
  const filter = useMemo<ExecutionFilter>(
    () => ({ range, status: filters.status, trigger: filters.trigger, limit: taskId ? TASK_HISTORY_LIMIT : HISTORY_LIMIT, ...(task ? { task } : {}) }),
    [range, filters.status, filters.trigger, task, taskId],
  );
  const query = useLiveQuery(schedulerKeys.executions(filter), () => schedulerApi.executions(filter));
  const active = filters.status.length > 0 || filters.trigger.length > 0 || (!taskId && filters.task !== '');

  return (
    <Panel
      title={t('sch.history.title')}
      hint={t('sch.history.note')}
      flush
      actions={
        <Button size="xs" variant="ghost" onClick={() => page.navigate('logs/explorer?runtime=scheduler')}>
          <FileText />
          {t('sch.logs.runtime')}
        </Button>
      }
    >
      <div className="border-b border-border px-3 pt-3">
        <FilterBar active={active} onClear={() => setFilters({ status: [], trigger: [], ...(taskId ? {} : { task: '' }) })}>
          {!taskId && tasks.length > 1 && (
            <Select value={filters.task || ALL} onValueChange={(v) => setFilters({ task: v === ALL ? '' : v })}>
              <SelectTrigger size="sm" className="w-52" aria-label={t('sch.exec.col.task')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('sch.history.allTasks')}</SelectItem>
                {tasks.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ToggleGroup type="multiple" value={filters.status} onValueChange={(v) => setFilters({ status: v as ExecutionStatus[] })} aria-label={t('sch.history.filterStatus')}>
            {EXECUTION_STATUSES.map((s) => (
              <ToggleGroupItem key={s} value={s}>
                <StatusDot tone={EXECUTION_TONE[s]} size="xs" />
                {t(`sch.exec.status.${s}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="multiple" value={filters.trigger} onValueChange={(v) => setFilters({ trigger: v as ExecutionTrigger[] })} aria-label={t('sch.history.filterTrigger')}>
            {EXECUTION_TRIGGERS.map((s) => (
              <ToggleGroupItem key={s} value={s}>
                {t(`sch.exec.trigger.${s}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FilterBar>
      </div>
      <QueryView query={query}>
        {(d) => (
          <ExecutionTable
            rows={d.items}
            columns={taskId ? ['time', 'result', 'duration', 'trigger', 'error', 'id', 'logs'] : ['time', 'task', 'result', 'duration', 'trigger', 'error', 'logs']}
            onOpen={page.openExec}
            activeId={page.execId}
            navigate={page.navigate}
            emptyMessage={t('sch.history.empty')}
            maxHeight={HISTORY_TABLE_HEIGHT_PX}
            footer={d.truncated ? t('sch.history.truncated', { count: d.items.length }) : t('sch.history.count', { count: d.items.length })}
          />
        )}
      </QueryView>
    </Panel>
  );
}

/** Lỗi theo loại (bấm → lần chạy mẫu) và theo task (lỗi liên tiếp trước — bấm → trang task). */
function FailureBreakdown({ page }: { page: SchedulerPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(schedulerKeys.failures(page.range), () => schedulerApi.failures(page.range), { tier: 'slow' });
  const consecutive = query.data?.byTask.filter((x) => x.consecutive > 0).length ?? 0;
  return (
    <PanelGrid>
      <Panel title={t('sch.failures.byType')} actions={query.data && <Badge tone={query.data.failed > 0 ? 'crit' : 'ok'}>{t('sch.failures.total', { count: f.compact(query.data.failed) })}</Badge>}>
        <QueryView query={query} compact isEmpty={(d) => d.byType.length === 0} emptyMessage={t('sch.failures.none')}>
          {(d) => (
            <BarList
              items={d.byType.map((x) => ({
                id: x.type,
                label: <span className="font-mono text-xs">{x.type}</span>,
                value: x.count,
                display: f.compact(x.count),
                sub: `${x.tasks.slice(0, BREAKDOWN_TASKS).join(', ')}${x.tasks.length > BREAKDOWN_TASKS ? ` +${x.tasks.length - BREAKDOWN_TASKS}` : ''}`,
                tone: 'crit',
                onClick: () => page.openExec(x.sampleExecutionId),
              }))}
            />
          )}
        </QueryView>
      </Panel>
      <Panel
        title={t('sch.failures.byTask')}
        hint={t('sch.failures.consecutiveNote')}
        actions={consecutive > 0 ? <Badge tone="warn">{t('sch.failures.consecutiveTasks', { count: consecutive })}</Badge> : undefined}
      >
        <QueryView query={query} compact isEmpty={(d) => d.byTask.length === 0} emptyMessage={t('sch.failures.none')}>
          {(d) => (
            <BarList
              items={d.byTask.map((x) => ({
                id: x.taskId,
                label: x.taskName,
                value: x.failed,
                display: f.compact(x.failed),
                sub: x.consecutive > 0 ? <span className="text-warn-fg">{t('sch.failures.consecutive', { count: x.consecutive })}</span> : undefined,
                tone: x.consecutive > 0 ? 'warn' : 'crit',
                onClick: () => page.openTask(x.taskId),
              }))}
            />
          )}
        </QueryView>
      </Panel>
    </PanelGrid>
  );
}
