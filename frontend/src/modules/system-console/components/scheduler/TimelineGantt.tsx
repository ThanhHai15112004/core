import React, { useMemo } from 'react';
import type { Execution, SchedulerTimeline } from '../../types/scheduler.types';
import { EXECUTION_TONE } from '../../constants/scheduler';
import { formatMs } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

const TICKS = 6;
/** Phần tương lai hiển thị lịch sắp chạy (tỉ lệ so với khoảng đã chọn). */
const FUTURE_RATIO = 1 / 6;

/**
 * Execution Timeline dạng gantt mini: mỗi task một làn, mỗi lần chạy là một vạch từ lúc bắt đầu tới lúc xong (đang chạy
 * → tới hiện tại) — nhìn thấy ngay chạy chồng, chạy lâu, lỡ lịch (◆) và bị bỏ qua (↷); bên phải "bây giờ" là lịch sắp tới.
 */
export const TimelineGantt: React.FC<{ data: SchedulerTimeline; now: number; onOpen: (e: Execution) => void; onOpenTask: (taskId: string) => void }> = ({
  data,
  now,
  onOpen,
  onOpenTask,
}) => {
  const { t, formatTime } = useLocale();
  const from = Date.parse(data.from);
  const span = Math.max(1, now - from);
  const to = now + span * FUTURE_RATIO;
  const total = to - from;
  const pos = (ms: number) => `${Math.min(100, Math.max(0, ((ms - from) / total) * 100))}%`;
  const upcoming = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const u of data.upcoming) {
      const at = Date.parse(u.at);
      if (at <= to) map.set(u.taskId, [...(map.get(u.taskId) ?? []), at]);
    }
    return map;
  }, [data.upcoming, to]);
  // Bỏ nhãn trục sát mốc "bây giờ" / mép phải để không đè chữ.
  const ticks = Array.from({ length: TICKS }, (_, i) => from + (total * i) / TICKS).filter((tk) => Math.abs(tk - now) > total * 0.07);
  const withSeconds = span <= 3600_000;
  if (data.lanes.length === 0) return <p className="ov-empty-line">{t('sch.timeline.empty')}</p>;
  return (
    <div className="sch-gantt" role="img" aria-label={t('sch.timeline.title')}>
      <div className="sch-gantt-axis">
        <span />
        <div className="sch-gantt-track">
          {ticks.map((tk) => (
            <span key={tk} className="sch-gantt-tick" style={{ left: pos(tk) }}>
              {formatTime(tk, withSeconds)}
            </span>
          ))}
          <span className="sch-gantt-now" style={{ left: pos(now) }}>
            {t('sch.timeline.now')}
          </span>
        </div>
      </div>
      {data.lanes.map((lane) => (
        <div key={lane.taskId} className="sch-gantt-lane">
          <button type="button" className="ov-link sch-gantt-label" onClick={() => onOpenTask(lane.taskId)} title={lane.taskId}>
            {lane.taskName}
          </button>
          <div className="sch-gantt-track">
            <span className="sch-gantt-nowline" style={{ left: pos(now) }} />
            {lane.executions.map((e) => {
              const start = Date.parse(e.startedAt ?? e.scheduledAt ?? e.finishedAt ?? '');
              if (!Number.isFinite(start)) return null;
              const label = `${e.taskName} · ${t(`sch.exec.status.${e.status}`)} · ${formatTime(start, true)}${e.durationMs !== null ? ` · ${formatMs(e.durationMs)}` : ''}`;
              if (e.status === 'missed' || e.status === 'skipped')
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={`sch-gantt-mark is-${e.status} ov-tone-${EXECUTION_TONE[e.status]}`}
                    style={{ left: pos(start) }}
                    title={label}
                    aria-label={label}
                    onClick={() => onOpen(e)}
                  >
                    {e.status === 'missed' ? '◆' : '↷'}
                  </button>
                );
              const end = e.status === 'running' ? now : Date.parse(e.finishedAt ?? '') || start + (e.durationMs ?? 0);
              const width = Math.max(0.35, ((end - start) / total) * 100);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`sch-gantt-bar ov-tone-${e.longRunning ? 'warn' : EXECUTION_TONE[e.status]} ${e.status === 'running' ? 'is-running' : ''}`}
                  style={{ left: pos(start), width: `${width}%` }}
                  title={label}
                  aria-label={label}
                  onClick={() => onOpen(e)}
                />
              );
            })}
            {(upcoming.get(lane.taskId) ?? []).map((at) => (
              <span key={at} className="sch-gantt-next" style={{ left: pos(at) }} title={`${t('sch.timeline.next')} ${formatTime(at, true)}`} />
            ))}
          </div>
        </div>
      ))}
      <p className="pf-chart-note sch-gantt-legend">
        <span className="sch-legend is-ok">■ {t('sch.exec.status.success')}</span>
        <span className="sch-legend is-crit">■ {t('sch.exec.status.failed')}</span>
        <span className="sch-legend is-warn">◆ {t('sch.exec.status.missed')}</span>
        <span className="sch-legend">↷ {t('sch.exec.status.skipped')}</span>
        <span className="sch-legend">┊ {t('sch.timeline.next')}</span>
      </p>
    </div>
  );
};
