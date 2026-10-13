import { useMemo } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery, useTimeRange } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Panel, QueryView } from '@core/ui/blocks';
import { Gantt, Heatmap, type GanttItem } from '@core/ui/charts';
import type { SchedulerTimeline, UpcomingList } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import {
  EXECUTION_TONE,
  HEATMAP_AXIS_PX,
  HEATMAP_ROW_PX,
  LIST_MAX_HEIGHT_PX,
  TIMELINE_FUTURE_RATIO,
  TIMELINE_NEXT_WIDTH_RATIO,
  TIMELINE_RANGES,
  UPCOMING_HOURS,
  UPCOMING_ROWS,
} from '../../constants/scheduler';
import { execAt, formatDateTime } from '../../utils/scheduler-format';
import { ConcentrationList, UpcomingTable } from '../../components/scheduler/UpcomingTable';
import { schedulerKeys } from './scheduler-keys';
import type { SchedulerPage } from './useSchedulerPage';

const NEXT_PREFIX = 'next:';
const HOUR_MS = 3_600_000;

/** Timeline: Gantt các lần chạy (thấy chạy chồng / chạy lâu / lỗi) + mật độ lịch 24 giờ tới và cảnh báo dồn lịch. */
export function SchedulerTimelineTab({ page }: { page: SchedulerPage }) {
  const { t } = useLocale();
  const range = useTimeRange(TIMELINE_RANGES);
  const timeline = useLiveQuery(schedulerKeys.timeline(range), () => schedulerApi.timeline(range));
  const upcoming = useLiveQuery(schedulerKeys.upcoming(UPCOMING_HOURS), () => schedulerApi.upcoming(UPCOMING_HOURS), { tier: 'slow' });

  return (
    <>
      <Panel title={t('sch.timeline.title')} hint={t('sch.timeline.hint')} className="mb-4" expandable>
        <QueryView query={timeline} skeleton="chart" isEmpty={(d) => d.lanes.length === 0} emptyMessage={t('sch.timeline.empty')}>
          {(d) => <TimelineGantt data={d} page={page} />}
        </QueryView>
      </Panel>

      <Panel title={t('sch.upcoming.density')} hint={t('sch.concentration.note')} className="mb-4">
        <QueryView query={upcoming} skeleton="chart" isEmpty={(d) => d.items.length === 0} emptyMessage={t('sch.upcoming.empty')}>
          {(d) => <UpcomingHeatmap data={d} onOpenTask={page.openTask} />}
        </QueryView>
      </Panel>
      <Panel title={t('sch.upcoming.next24hTitle')} flush>
        <QueryView query={upcoming}>
          {(d) => (
            <>
              <ConcentrationList items={d.concentration} className="border-b border-border px-3 py-1" />
              <UpcomingTable
                items={d.items.slice(0, UPCOMING_ROWS)}
                onOpenTask={page.openTask}
                showTime
                maxHeight={LIST_MAX_HEIGHT_PX}
                footer={d.truncated || d.items.length > UPCOMING_ROWS ? t('sch.upcoming.truncated', { shown: Math.min(UPCOMING_ROWS, d.items.length) }) : t('sch.upcoming.count', { count: d.items.length })}
              />
            </>
          )}
        </QueryView>
      </Panel>
    </>
  );
}

function TimelineGantt({ data, page }: { data: SchedulerTimeline; page: SchedulerPage }) {
  const { t, locale } = useLocale();
  const f = useFormat();
  const { rows, items, xRange, now } = useMemo(() => {
    const from = Date.parse(data.from);
    const now = Date.parse(data.to);
    const span = Math.max(1, now - from);
    const to = now + span * TIMELINE_FUTURE_RATIO;
    const nextWidth = (to - from) * TIMELINE_NEXT_WIDTH_RATIO;
    const items: GanttItem[] = [];
    for (const lane of data.lanes) {
      for (const e of lane.executions) {
        const at = execAt(e);
        const start = at ? Date.parse(at) : NaN;
        if (!Number.isFinite(start)) continue;
        const end = e.status === 'running' ? now : Date.parse(e.finishedAt ?? '') || start + (e.durationMs ?? 0);
        const dur = e.status === 'running' ? e.runningMs : e.durationMs;
        items.push({
          id: e.id,
          rowId: lane.taskId,
          start,
          end: Math.max(start, end),
          tone: EXECUTION_TONE[e.status],
          label: `${lane.taskName} · ${t(`sch.exec.status.${e.status}`)} · ${formatDateTime(start, locale)}${dur !== null ? ` · ${f.duration(dur)}` : ''}`,
        });
      }
    }
    for (const u of data.upcoming) {
      const at = Date.parse(u.at);
      if (at > to || at < now) continue;
      items.push({ id: `${NEXT_PREFIX}${u.taskId}:${u.at}`, rowId: u.taskId, start: at, end: at + nextWidth, tone: 'unknown', label: `${u.taskName} · ${t('sch.timeline.next')} ${formatDateTime(at, locale)}` });
    }
    return { rows: data.lanes.map((l) => ({ id: l.taskId, label: l.taskName })), items, xRange: { from, to }, now };
  }, [data, t, f, locale]);

  return (
    <>
      <Gantt
        rows={rows}
        items={items}
        xRange={xRange}
        markers={[{ t: now, label: t('sch.timeline.now'), tone: 'info' }]}
        legend={[
          { tone: EXECUTION_TONE.success, label: t('sch.exec.status.success') },
          { tone: EXECUTION_TONE.failed, label: t('sch.exec.status.failed') },
          { tone: EXECUTION_TONE.running, label: t('sch.exec.status.running') },
          { tone: 'unknown', label: t('sch.timeline.next') },
        ]}
        onItemClick={(it) => (it.id.startsWith(NEXT_PREFIX) ? page.openTask(it.rowId) : page.openExec(it.id))}
        ariaLabel={t('sch.timeline.title')}
      />
      {data.truncated && <p className="mt-2 text-xs text-faint">{t('sch.timeline.truncated')}</p>}
    </>
  );
}

/** Mật độ lịch: mỗi task một hàng, mỗi giờ trong 24 giờ tới một cột, số lần chạy tới hạn. */
function UpcomingHeatmap({ data, onOpenTask }: { data: UpcomingList; onOpenTask: (taskId: string) => void }) {
  const { t, formatTime } = useLocale();
  const { xLabels, tasks, cells } = useMemo(() => {
    const times = data.items.map((u) => Date.parse(u.at));
    const start = Math.floor(Math.min(...times) / HOUR_MS) * HOUR_MS;
    const hours = Array.from({ length: data.hours }, (_, i) => start + i * HOUR_MS);
    const tasks = [...new Map(data.items.map((u) => [u.taskId, u.taskName])).entries()].map(([id, name]) => ({ id, name }));
    const index = new Map(tasks.map((x, i) => [x.id, i]));
    const counts = new Map<string, number>();
    for (const u of data.items) {
      const h = Math.floor((Date.parse(u.at) - start) / HOUR_MS);
      if (h < 0 || h >= hours.length) continue;
      const key = `${h}:${index.get(u.taskId)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const cells: [number, number, number | null][] = [];
    hours.forEach((_, h) => tasks.forEach((_x, y) => cells.push([h, y, counts.get(`${h}:${y}`) ?? 0])));
    return { xLabels: hours.map((h) => formatTime(h, false)), tasks, cells };
  }, [data, formatTime]);
  return (
    <Heatmap
      xLabels={xLabels}
      yLabels={tasks.map((x) => x.name)}
      cells={cells}
      color="series-1"
      format={(v) => t('sch.upcoming.runs', { count: v ?? 0 })}
      height={Math.max(HEATMAP_AXIS_PX * 2, tasks.length * HEATMAP_ROW_PX + HEATMAP_AXIS_PX)}
      onCellClick={(_x, y) => tasks[y] && onOpenTask(tasks[y].id)}
      ariaLabel={t('sch.upcoming.density')}
    />
  );
}
