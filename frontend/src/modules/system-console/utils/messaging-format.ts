import type { ChartSeries } from '../components/common/LineChart';
import type { MessagingSeries } from '../types/messaging.types';
import { MESSAGING_SERIES_COLORS } from '../constants/messaging';
import { FALLBACK_COLORS } from '../constants/performance';
import { formatUnit } from './performance-format';
import { NO_VALUE } from './runtime-format';

const KB = 1024;

/** Tốc độ message: `842/s`, nhỏ thì theo phút cho dễ đọc (`12/min`). */
export function formatMsgRate(perSec: number | null | undefined): string {
  if (perSec === null || perSec === undefined) return NO_VALUE;
  if (perSec > 0 && perSec < 1) return formatUnit(Number((perSec * 60).toFixed(1)), '/min');
  return formatUnit(Number(perSec.toFixed(perSec >= 100 ? 0 : 2)), '/s');
}

/** Giây → `2d 8h`, `18m`, `42s`. */
export function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return NO_VALUE;
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Message ID dài (UUID) → rút gọn để hiển thị trong bảng. */
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

/** Series theo byte → KB để trục dễ đọc. */
export function toMessagingChart(list: MessagingSeries[]): { series: ChartSeries[]; unit: string } {
  const conv = (u: string) => (u === 'B' ? 'KB' : u);
  const first = list[0]?.unit ?? '';
  return {
    unit: conv(first),
    series: list.map((s, i) => ({
      id: s.id,
      label: s.label,
      unit: conv(s.unit),
      ...(s.unit !== first ? { axis: 'right' as const } : {}),
      color: MESSAGING_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      points: s.unit === 'B' ? s.points.map((p) => ({ t: p.t, value: Number((p.value / KB).toFixed(2)) })) : s.points,
    })),
  };
}
