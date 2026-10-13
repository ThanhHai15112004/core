import { useMemo } from 'react';
import { useLocale } from '../../i18n/index';
import { useThemeTokens } from '../../theme/useThemeTokens';
import type { Tone } from '../../theme/tone';
import { TONE_CLASS } from '../../theme/tone';
import { PanelState } from '../blocks/PanelState';
import { EChart, type ChartEventHandler } from './EChart';
import { axisStyle, baseOption, escapeHtml } from './chart-theme';

export interface GanttRow {
  id: string;
  label: string;
}

export interface GanttItem {
  id: string;
  rowId: string;
  start: number;
  end: number;
  tone: Tone;
  label: string;
}

export interface GanttMarker {
  t: number;
  label: string;
  tone: Tone;
}

interface GanttProps {
  rows: GanttRow[];
  items: GanttItem[];
  xRange: { from: number; to: number };
  /** Vạch dọc đánh dấu một thời điểm (vd. "bây giờ"). */
  markers?: GanttMarker[];
  /** Chú thích màu dưới biểu đồ. */
  legend?: { tone: Tone; label: string }[];
  formatTooltip?: (item: GanttItem) => string;
  onItemClick?: (item: GanttItem) => void;
  ariaLabel: string;
  className?: string;
}

const ROW_PX = 28;
const MIN_BAR_PX = 3;
const AXIS_PX = 40;
/** Chừa chỗ phía trên cho nhãn vạch đánh dấu. */
const MARKER_TOP_PX = 20;

/** Dòng thời gian dạng Gantt (lịch chạy scheduler, attempts của job). */
export function Gantt({ rows, items, xRange, markers, legend, formatTooltip, onItemClick, ariaLabel, className }: GanttProps) {
  const { t, locale } = useLocale();
  const tokens = useThemeTokens();
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const option = useMemo(() => {
    const axis = axisStyle(tokens);
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    return {
      ...baseOption(tokens),
      grid: { left: 8, right: 16, top: markers?.length ? MARKER_TOP_PX : 8, bottom: 4, containLabel: true },
      tooltip: {
        ...baseOption(tokens).tooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const item = items[p.dataIndex];
          return item ? escapeHtml(formatTooltip ? formatTooltip(item) : item.label) : '';
        },
      },
      xAxis: { type: 'time', min: xRange.from, max: xRange.to, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => timeFmt.format(new Date(v)) } },
      yAxis: { type: 'category', data: rows.map((r) => r.label), inverse: true, ...axis, splitLine: { show: true, lineStyle: { color: tokens.chart.grid } } },
      series: [
        {
          type: 'custom',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderItem: (_params: any, api: any) => {
            const y = api.value(0);
            const start = api.coord([api.value(1), y]);
            const end = api.coord([api.value(2), y]);
            const h = api.size([0, 1])[1] * 0.6;
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - h / 2, width: Math.max(MIN_BAR_PX, end[0] - start[0]), height: h, r: 2 },
              style: { fill: api.visual('color') },
            };
          },
          encode: { x: [1, 2], y: 0 },
          data: items.map((it) => ({ value: [rowIndex.get(it.rowId) ?? 0, it.start, it.end], itemStyle: { color: tokens.tone[it.tone] } })),
          markLine: markers?.length
            ? {
                symbol: 'none',
                silent: true,
                data: markers.map((m) => ({
                  xAxis: m.t,
                  lineStyle: { color: tokens.tone[m.tone], type: 'dashed', width: 1 },
                  label: { formatter: m.label, color: tokens.tone[m.tone], position: 'end', fontSize: 10 },
                })),
              }
            : undefined,
        },
      ],
    };
  }, [tokens, locale, rows, items, xRange, markers, rowIndex, formatTooltip]);

  const onEvents = useMemo<Record<string, ChartEventHandler> | undefined>(
    () => (onItemClick ? { click: (p) => items[p.dataIndex] && onItemClick(items[p.dataIndex]) } : undefined),
    [onItemClick, items],
  );

  if (rows.length === 0) return <PanelState status="empty" message={t('ui.chart.noData')} className={className} />;
  const chart = <EChart option={option} height={rows.length * ROW_PX + AXIS_PX + (markers?.length ? MARKER_TOP_PX : 0)} onEvents={onEvents} ariaLabel={ariaLabel} className={legend?.length ? undefined : className} />;
  if (!legend?.length) return chart;
  return (
    <div className={className}>
      {chart}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {legend.map((l) => (
          <li key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${TONE_CLASS[l.tone].bg}`} aria-hidden="true" />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
