import { useMemo } from 'react';
import { useLocale } from '../../i18n/index';
import { useThemeTokens } from '../../theme/useThemeTokens';
import { CHART_HEIGHT_PX } from '../../constants/ui.constants';
import { NO_VALUE } from '../../lib/format';
import { PanelState } from '../blocks/PanelState';
import { EChart, type ChartEventHandler } from './EChart';
import { axisStyle, baseOption, escapeHtml } from './chart-theme';
import { resolveColor, type ChartColor } from './colors';

interface HeatmapProps {
  xLabels: string[];
  yLabels: string[];
  /** [xIndex, yIndex, value]; value null = không có dữ liệu. */
  cells: [number, number, number | null][];
  format: (v: number | null) => string;
  color?: ChartColor;
  height?: keyof typeof CHART_HEIGHT_PX | number;
  onCellClick?: (x: number, y: number) => void;
  ariaLabel: string;
  className?: string;
}

/** Bản đồ nhiệt (vd. lỗi theo ngày × giờ). */
export function Heatmap({ xLabels, yLabels, cells, format, color = 'crit', height = 'md', onCellClick, ariaLabel, className }: HeatmapProps) {
  const { t } = useLocale();
  const tokens = useThemeTokens();
  const px = typeof height === 'number' ? height : CHART_HEIGHT_PX[height];
  const values = cells.map((c) => c[2]).filter((v): v is number => v !== null);
  const max = values.length ? Math.max(...values) : 0;

  const option = useMemo(() => {
    const axis = axisStyle(tokens);
    return {
      ...baseOption(tokens),
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        ...baseOption(tokens).tooltip,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => `${escapeHtml(yLabels[p.value[1]] ?? '')} · ${escapeHtml(xLabels[p.value[0]] ?? '')}<br/><b>${escapeHtml(p.value[2] === null ? NO_VALUE : format(p.value[2]))}</b>`,
      },
      xAxis: { type: 'category', data: xLabels, ...axis, splitLine: { show: false }, splitArea: { show: false } },
      yAxis: { type: 'category', data: yLabels, ...axis, splitLine: { show: false } },
      visualMap: { show: false, min: 0, max: max || 1, inRange: { color: [tokens.panel2, resolveColor(tokens, color, 0)] } },
      series: [
        {
          type: 'heatmap',
          data: cells,
          itemStyle: { borderColor: tokens.panel, borderWidth: 2, borderRadius: 2 },
          emphasis: { itemStyle: { borderColor: tokens.text } },
        },
      ],
    };
  }, [tokens, xLabels, yLabels, cells, format, color, max]);

  const onEvents = useMemo<Record<string, ChartEventHandler> | undefined>(
    () => (onCellClick ? { click: (p) => onCellClick(p.value[0], p.value[1]) } : undefined),
    [onCellClick],
  );

  if (values.length === 0) return <PanelState status="empty" message={t('ui.chart.noData')} className={className} />;
  return <EChart option={option} height={px} onEvents={onEvents} ariaLabel={ariaLabel} className={className} />;
}
