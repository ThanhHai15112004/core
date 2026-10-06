import React, { useState } from 'react';
import { Play, Search } from 'lucide-react';
import type { TaskHealth, TaskRow, TaskType } from '../../types/scheduler.types';
import type { TaskAction } from '../../hooks/useSchedulerActions';
import { EXECUTION_ICON, EXECUTION_TONE } from '../../constants/scheduler';
import { formatMs } from '../../utils/worker-format';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { ScheduleCell, TaskHealthDot, TaskStatusChip } from './TaskStatus';
import { useLocale } from '../../../../core/i18n/index';

const STATUS_FILTERS = ['all', 'enabled', 'disabled', 'failing'] as const;
const TYPE_FILTERS = ['all', 'cron', 'interval'] as const;
const HEALTH_FILTERS = ['all', 'healthy', 'warning', 'error'] as const;
const SORTS = ['next', 'failures', 'duration', 'name'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
type Sort = (typeof SORTS)[number];

const matchStatus = (x: TaskRow, f: StatusFilter) =>
  f === 'all' || (f === 'enabled' ? x.enabled : f === 'disabled' ? !x.enabled : x.consecutiveFailures > 0);

function compare(a: TaskRow, b: TaskRow, s: Sort): number {
  switch (s) {
    case 'next':
      return (a.nextRunAt ? Date.parse(a.nextRunAt) : Infinity) - (b.nextRunAt ? Date.parse(b.nextRunAt) : Infinity) || a.name.localeCompare(b.name);
    case 'failures':
      return b.consecutiveFailures - a.consecutiveFailures || b.failures24h - a.failures24h;
    case 'duration':
      return (b.avgDurationMs ?? -1) - (a.avgDurationMs ?? -1);
    default:
      return a.name.localeCompare(b.name);
  }
}

interface Props {
  rows: TaskRow[];
  now: number;
  onOpen: (taskId: string) => void;
  onAction?: (action: TaskAction, task: TaskRow) => void;
  canRun?: boolean;
  /** Bộ lọc + sắp xếp (trang Tasks); Overview dùng bản gọn. */
  tools?: boolean;
  emptyText: string;
}

/** Bảng task: lịch (cho người đọc), lần chạy gần nhất + kết quả, lần kế tiếp, tỉ lệ thành công, trạng thái vận hành + sức khoẻ. */
export const TaskTable: React.FC<Props> = ({ rows, now, onOpen, onAction, canRun = false, tools = false, emptyText }) => {
  const { t, formatRelative } = useLocale();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<'all' | TaskType>('all');
  const [health, setHealth] = useState<'all' | TaskHealth>('all');
  const [sort, setSort] = useState<Sort>('next');
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const q = search.trim().toLowerCase();
  const list = tools
    ? rows
        .filter(
          (x) =>
            (!q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q)) &&
            matchStatus(x, status) &&
            (type === 'all' || x.type === type) &&
            (health === 'all' || x.health === health),
        )
        .sort((a, b) => compare(a, b, sort))
    : rows;
  const segmented = <T extends string>(label: string, values: readonly T[], value: T, set: (v: T) => void, key: string) => (
    <div className="sch-filter">
      <span>{label}</span>
      <div className="ov-segmented" role="tablist" aria-label={label}>
        {values.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'is-active' : ''} onClick={() => set(v)}>
            {t(`sch.filter.${key}.${v}`)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      {tools && (
        <div className="sch-tools">
          <label className="wq-search">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('sch.task.search')} aria-label={t('sch.task.search')} />
          </label>
          {segmented(t('sch.filter.status.label'), STATUS_FILTERS, status, setStatus, 'status')}
          {segmented(t('sch.filter.type.label'), TYPE_FILTERS, type, setType, 'type')}
          {segmented(t('sch.filter.health.label'), HEALTH_FILTERS, health, setHealth, 'health')}
          {segmented(t('sch.filter.sort.label'), SORTS, sort, setSort, 'sort')}
        </div>
      )}
      {list.length === 0 ? (
        <p className="ov-empty-line">{t('sch.task.noMatch')}</p>
      ) : (
        <div className="scp-table-wrap">
          <table className="scp-table sch-task-table">
            <thead>
              <tr>
                <th>{t('sch.task.name')}</th>
                <th>{t('sch.task.schedule')}</th>
                <th>{t('sch.task.lastRun')}</th>
                <th>{t('sch.task.nextRun')}</th>
                <th>{t('sch.task.success24h')}</th>
                <th>{t('sch.task.status.label')}</th>
                {onAction && <th aria-label={t('sch.task.actions')} />}
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="is-clickable" onClick={() => onOpen(x.id)}>
                  <td>
                    <span className="cell-strong">{x.name}</span>
                    <small className="pf-row-note">
                      <code>{x.id}</code>
                      {x.type !== 'cron' && ` · ${t(`sch.type.${x.type}`)}`}
                    </small>
                  </td>
                  <td>
                    <ScheduleCell schedule={x.schedule} />
                  </td>
                  <td>
                    {x.lastRunAt ? formatRelative(new Date(x.lastRunAt), now) : t('sch.task.never')}
                    {x.lastStatus && (
                      <small className={`pf-row-note sch-result ov-tone-${EXECUTION_TONE[x.lastStatus]}`}>
                        {EXECUTION_ICON[x.lastStatus]} {t(`sch.exec.status.${x.lastStatus}`)}
                        {x.lastDurationMs !== null && ` · ${formatMs(x.lastDurationMs)}`}
                      </small>
                    )}
                  </td>
                  <td>{x.nextRunAt ? formatIn(secondsUntil(x.nextRunAt, now)) : NO_VALUE}</td>
                  <td className={x.successRatePercent !== null && x.successRatePercent < 95 ? 'is-warn' : ''}>
                    {x.successRatePercent === null ? NO_VALUE : `${x.successRatePercent}%`}
                    {x.executions24h > 0 && <small className="pf-row-note">{t('sch.task.runs', { count: x.executions24h })}</small>}
                  </td>
                  <td>
                    <TaskStatusChip task={x} />
                    <small className="pf-row-note">
                      <TaskHealthDot task={x} />
                    </small>
                  </td>
                  {onAction && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {canRun && (
                        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('run', x)} title={t('sch.action.run')}>
                          <Play size={12} /> {t('sch.action.run')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
