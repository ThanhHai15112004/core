import { useMemo, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { FilterBar, Panel, QueryView, SearchInput } from '@core/ui/blocks';
import type { TaskRow } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { TASK_HEALTH_FILTERS, TASK_STATUS_FILTERS, TASK_TYPE_FILTERS } from '../../constants/scheduler';
import { TaskTable } from '../../components/scheduler/TaskTable';
import { schedulerKeys } from './scheduler-keys';
import type { SchedulerPage } from './useSchedulerPage';
import type { TaskActions } from './useTaskActions';

type StatusFilter = (typeof TASK_STATUS_FILTERS)[number];
type TypeFilter = (typeof TASK_TYPE_FILTERS)[number];
type HealthFilter = (typeof TASK_HEALTH_FILTERS)[number];

const matchStatus = (x: TaskRow, f: StatusFilter) => f === 'all' || (f === 'enabled' ? x.enabled : f === 'disabled' ? !x.enabled : x.consecutiveFailures > 0);

/** Tasks: tìm, lọc theo trạng thái / kiểu lịch / sức khoẻ, sắp xếp theo cột; Run Now / Bật / Tắt ngay trên dòng. */
export function SchedulerTasksTab({ page, actions }: { page: SchedulerPage; actions: TaskActions }) {
  const { t } = useLocale();
  const query = useLiveQuery(schedulerKeys.tasks(), () => schedulerApi.tasks());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [health, setHealth] = useState<HealthFilter>('all');
  const active = q !== '' || status !== 'all' || type !== 'all' || health !== 'all';
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (query.data?.tasks ?? []).filter(
      (x) => (!s || x.name.toLowerCase().includes(s) || x.id.toLowerCase().includes(s)) && matchStatus(x, status) && (type === 'all' || x.type === type) && (health === 'all' || x.health === health),
    );
  }, [query.data, q, status, type, health]);
  const settings = query.data?.settings;

  return (
    <Panel title={t('sch.task.title')} hint={t('sch.task.note')} flush actions={query.data && <span className="font-mono text-xs text-muted">{t('sch.task.count', { count: query.data.tasks.length })}</span>}>
      <div className="border-b border-border px-3 pt-3">
        <FilterBar
          active={active}
          onClear={() => {
            setQ('');
            setStatus('all');
            setType('all');
            setHealth('all');
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder={t('sch.task.search')} className="w-full sm:w-64" />
          <ToggleGroup type="single" value={status} onValueChange={(v) => v && setStatus(v as StatusFilter)} aria-label={t('sch.filter.status.label')}>
            {TASK_STATUS_FILTERS.map((v) => (
              <ToggleGroupItem key={v} value={v}>
                {t(`sch.filter.status.${v}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
            <SelectTrigger size="sm" className="w-36" aria-label={t('sch.filter.type.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_TYPE_FILTERS.map((v) => (
                <SelectItem key={v} value={v}>
                  {t('sch.filter.type.label')}: {t(`sch.filter.type.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={health} onValueChange={(v) => setHealth(v as HealthFilter)}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('sch.filter.health.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_HEALTH_FILTERS.map((v) => (
                <SelectItem key={v} value={v}>
                  {t('sch.filter.health.label')}: {t(`sch.filter.health.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
      </div>
      <QueryView query={query}>
        {() => (
          <TaskTable
            rows={rows}
            onOpen={(id) => page.openTask(id)}
            onAction={actions.request}
            canRun={settings?.run ?? false}
            canToggle={settings?.toggle ?? false}
            emptyMessage={t(active && (query.data?.tasks.length ?? 0) > 0 ? 'sch.task.noMatch' : 'sch.task.empty')}
          />
        )}
      </QueryView>
    </Panel>
  );
}
