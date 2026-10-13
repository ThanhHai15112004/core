import { useMemo } from 'react';
import { useLocale } from '../../i18n/index';
import { useThemeTokens } from '../../theme/useThemeTokens';
import type { Tone } from '../../theme/tone';
import { CHART_HEIGHT_PX } from '../../constants/ui.constants';
import { NO_VALUE } from '../../lib/format';
import { PanelState } from '../blocks/PanelState';
import { EChart, type ChartEventHandler } from './EChart';
import { axisStyle, baseOption, escapeHtml } from './chart-theme';
import { resolveColor, type ChartColor } from './colors';

export interface TimePoint {
  /** epoch ms */
  t: number;
  /** null = không có dữ liệu (vẽ đứt đoạn, không tự thành 0). */
  v: number | null;
}

export interface TimeSeries {
  id: string;
  label: string;
  color?: ChartColor;
  points: TimePoint[];
  axis?: 'left' | 'right';
  dashed?: boolean;
  /** Tô vùng dưới đường. */
  area?: boolean;
}

export interface ChartThreshold {
  value: number;
  label: string;
  tone: Tone;
  axis?: 'left' | 'right';
}

export interface ChartMarker {
  t: number;
  label: string;
  tone: Tone;
}

export interface ChartBand {
  from: number;
  to: number;
  tone: Tone;
  label?: string;
}

export interface TimeSeriesChartProps {
  series: TimeSeries[];
  kind?: 'line' | 'bar';
  /** Xếp chồng (bar theo level, status code…). */
  stacked?: boolean;
  height?: keyof typeof CHART_HEIGHT_PX | number;
  /** Định dạng giá trị trục trái + tooltip. */
  format: (v: number | null) => string;
  formatRight?: (v: number | null) => string;
  yMin?: number;
  yMax?: number;
  thresholds?: ChartThreshold[];
  markers?: ChartMarker[];
  bands?: ChartBand[];
  /** Khung thời gian cố định (để trục X đúng khoảng đã chọn kể cả khi thiếu điểm). */
  xRange?: { from: number; to: number };
  group?: string;
  legend?: boolean;
  /** Bấm vào một điểm / cột → thời điểm (ms). */
  onTimeClick?: (t: number) => void;
  emptyMessage?: string;
  ariaLabel: string;
  className?: string;
}

const DAY_MS = 86_400_000;
const BAR_MAX_WIDTH = 28;
const AREA_OPACITY = 0.14;

/** Biểu đồ theo thời gian (đường / cột / cột chồng) — màu, chữ, lưới lấy từ theme. */
export function TimeSeriesChart({
  series,
  kind = 'line',
  stacked,
  height = 'md',
  format,
  formatRight,
  yMin,
  yMax,
  thresholds = [],
  markers = [],
  bands = [],
  xRange,
  group,
  legend,
  onTimeClick,
  emptyMessage,
  ariaLabel,
  className,
}: TimeSeriesChartProps) {
  const { t, locale } = useLocale();
  const tokens = useThemeTokens();
  const px = typeof height === 'number' ? height : CHART_HEIGHT_PX[height];
  const hasData = series.some((s) => s.points.some((p) => p.v !== null));

  const option = useMemo(() => {
    const allT = series.flatMap((s) => s.points.map((p) => p.t));
    const from = xRange?.from ?? Math.min(...allT);
    const to = xRange?.to ?? Math.max(...allT);
    const longSpan = to - from > DAY_MS;
    const timeFmt = new Intl.DateTimeFormat(locale, longSpan ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false });
    const tipFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const hasRight = series.some((s) => s.axis === 'right');
    const colors = series.map((s, i) => resolveColor(tokens, s.color, i));
    const axis = axisStyle(tokens);

    const markLine = (axisSide: 'left' | 'right') => {
      const lines = [
        ...thresholds
          .filter((th) => (th.axis ?? 'left') === axisSide)
          .map((th) => ({
            yAxis: th.value,
            name: th.label,
            lineStyle: { color: tokens.tone[th.tone], type: 'dashed', width: 1 },
            label: { formatter: th.label, color: tokens.tone[th.tone], position: 'insideEndTop', fontSize: 10 },
          })),
        ...(axisSide === 'left'
          ? markers.map((m) => ({
              xAxis: m.t,
              name: m.label,
              lineStyle: { color: tokens.tone[m.tone], type: 'solid', width: 1 },
              label: { formatter: m.label, color: tokens.tone[m.tone], position: 'insideEndTop', fontSize: 10 },
            }))
          : []),
      ];
      return lines.length ? { symbol: 'none', silent: true, data: lines } : undefined;
    };
    const markArea = bands.length
      ? {
          silent: true,
          data: bands.map((b) => [
            { xAxis: b.from, name: b.label ?? '', itemStyle: { color: tokens.toneBg[b.tone] }, label: { color: tokens.tone[b.tone], fontSize: 10 } },
            { xAxis: b.to },
          ]),
        }
      : undefined;
    const firstOn = (side: 'left' | 'right') => series.findIndex((s) => (s.axis ?? 'left') === side);

    return {
      ...baseOption(tokens),
      color: colors,
      grid: { left: 8, right: hasRight ? 8 : 16, top: legend ? 32 : 16, bottom: 4, containLabel: true },
      legend: legend ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4, textStyle: { color: tokens.text2, fontSize: 11 } } : undefined,
      tooltip: {
        ...baseOption(tokens).tooltip,
        trigger: 'axis',
        axisPointer: { type: kind === 'bar' ? 'shadow' : 'line', lineStyle: { color: tokens.borderStrong }, shadowStyle: { color: tokens.chart.grid } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          if (!params.length) return '';
          const time = tipFmt.format(new Date(params[0].value[0]));
          const rows = params
            .map((p) => {
              const s = series[p.seriesIndex];
              const v = p.value[1] as number | null;
              const fmt = s?.axis === 'right' && formatRight ? formatRight : format;
              return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${p.color}"></span>${escapeHtml(s?.label ?? '')}</span><b style="font-family:${tokens.fontMono};font-weight:500">${escapeHtml(v === null || v === undefined ? NO_VALUE : fmt(v))}</b></div>`;
            })
            .join('');
          return `<div style="margin-bottom:4px;color:${tokens.muted}">${time}</div>${rows}`;
        },
      },
      xAxis: { type: 'time', min: xRange?.from, max: xRange?.to, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: (v: number) => timeFmt.format(new Date(v)) } },
      yAxis: [
        { type: 'value', min: yMin, max: yMax, ...axis, axisLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: (v: number) => format(v) } },
        ...(hasRight
          ? [{ type: 'value', ...axis, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: (v: number) => (formatRight ?? format)(v) } }]
          : []),
      ],
      series: series.map((s, i) => {
        const side = s.axis ?? 'left';
        return {
          id: s.id,
          name: s.label,
          type: kind,
          yAxisIndex: side === 'right' ? 1 : 0,
          data: s.points.map((p) => [p.t, p.v]),
          stack: stacked ? 'total' : undefined,
          showSymbol: false,
          symbolSize: 5,
          connectNulls: false,
          barMaxWidth: BAR_MAX_WIDTH,
          lineStyle: { width: 1.5, type: s.dashed ? 'dashed' : 'solid' },
          areaStyle: s.area || (stacked && kind === 'line') ? { opacity: AREA_OPACITY } : undefined,
          emphasis: { focus: 'series' },
          markLine: firstOn(side) === i ? markLine(side) : undefined,
          markArea: i === 0 ? markArea : undefined,
        };
      }),
    };
  }, [series, kind, stacked, format, formatRight, yMin, yMax, thresholds, markers, bands, xRange, legend, tokens, locale]);

  const onEvents = useMemo<Record<string, ChartEventHandler> | undefined>(
    () => (onTimeClick ? { click: (p) => Array.isArray(p.value) && onTimeClick(Number(p.value[0])) } : undefined),
    [onTimeClick],
  );

  if (!hasData) return <PanelState status="empty" message={emptyMessage ?? t('ui.chart.noData')} className={className} />;
  return <EChart option={option} height={px} group={group} onEvents={onEvents} ariaLabel={ariaLabel} className={className} />;
}

/** Cột chồng theo thời gian (vd. log theo level, request theo status). */
export function StackedBarChart(props: Omit<TimeSeriesChartProps, 'kind' | 'stacked'>) {
  return <TimeSeriesChart {...props} kind="bar" stacked legend={props.legend ?? true} />;
}
