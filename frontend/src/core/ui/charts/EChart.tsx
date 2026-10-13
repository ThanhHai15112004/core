import { useEffect, useRef } from 'react';
import { echarts, type EChartsCoreOption } from './echarts';
import { cn } from '../../lib/cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartEventHandler = (params: any) => void;

interface EChartProps {
  option: EChartsCoreOption;
  height: number;
  /** Đồng bộ crosshair/tooltip giữa các biểu đồ cùng nhóm. */
  group?: string;
  onEvents?: Record<string, ChartEventHandler>;
  ariaLabel: string;
  className?: string;
}

/** Vỏ ECharts: khởi tạo một lần, tự co giãn theo khung, huỷ khi unmount. */
export function EChart({ option, height, group, onEvents, ariaLabel, className }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !group) return;
    chart.group = group;
    echarts.connect(group);
  }, [group]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    for (const [name, handler] of Object.entries(onEvents)) chart.on(name, handler);
    return () => {
      for (const [name, handler] of Object.entries(onEvents)) chart.off(name, handler);
    };
  }, [onEvents]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={cn('w-full', className)} style={{ height }} />;
}
