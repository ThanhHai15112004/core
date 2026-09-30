import React, { useState } from 'react';
import type { Execution, SchedulerRange } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { TIMELINE_RANGES } from '../../constants/scheduler';
import { TimelineGantt } from '../../components/scheduler/TimelineGantt';
import { ConcentrationNotes, UpcomingList } from '../../components/scheduler/UpcomingList';
import { useLocale } from '../../../../core/i18n/index';

/** Số dòng lịch 24 giờ tới hiển thị (task chạy dày sinh hàng trăm mốc). */
const UPCOMING_ROWS = 48;

/** Timeline: gantt các lần chạy (thấy chạy chồng / chạy lâu / lỡ lịch) + lịch 24 giờ tới và cảnh báo dồn lịch. */
export const SchedulerTimelineView: React.FC<{
  range: SchedulerRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  openExecution: (e: Execution) => void;
  openTask: (taskId: string) => void;
}> = ({ paused, reloadKey, now, openExecution, openTask }) => {
  const { t } = useLocale();
  const [range, setRange] = useState<SchedulerRange>('6h');
  const timeline = usePolling(() => schedulerApi.timeline(range), `sch-timeline:${range}:${reloadKey}`, 15_000, paused);
  const upcoming = usePolling(() => schedulerApi.upcoming(24), `sch-upcoming:${reloadKey}`, 30_000, paused);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.timeline.title')}</h3>
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
            {TIMELINE_RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </header>
        {timeline.error && !timeline.data && <p className="scp-alert scp-alert-danger">{timeline.error.message}</p>}
        {!timeline.data && !timeline.error && <p className="ov-empty-line">{t('common.loading')}</p>}
        {timeline.data && <TimelineGantt data={timeline.data} now={now} onOpen={openExecution} onOpenTask={openTask} />}
        {timeline.data?.truncated && <p className="pf-chart-note">{t('sch.timeline.truncated')}</p>}
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.upcoming.next24hTitle')}</h3>
          {upcoming.data && <span className="ov-section-hint">{t('sch.upcoming.count', { count: upcoming.data.items.length })}</span>}
        </header>
        {upcoming.data && (
          <>
            <ConcentrationNotes items={upcoming.data.concentration} />
            <UpcomingList items={upcoming.data.items.slice(0, UPCOMING_ROWS)} now={now} onOpenTask={openTask} emptyText={t('sch.upcoming.empty')} showTime />
            {(upcoming.data.truncated || upcoming.data.items.length > UPCOMING_ROWS) && <p className="pf-chart-note">{t('sch.upcoming.truncated')}</p>}
          </>
        )}
        <p className="pf-chart-note">{t('sch.concentration.note')}</p>
      </section>
    </>
  );
};
