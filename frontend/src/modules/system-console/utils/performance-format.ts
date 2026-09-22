import { formatMs, formatRps } from './traffic-format';
import { NO_VALUE } from './runtime-format';

/** Định dạng giá trị theo đơn vị backend trả về (`ms`, `%`, `MB`, `/s`, `/min`, `ms/min`, `jobs`). */
export function formatUnit(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return NO_VALUE;
  switch (unit) {
    case 'ms':
      return formatMs(value);
    case '%':
      return `${Number(value.toFixed(value < 10 ? 2 : 1))}%`;
    case 'MB':
      return value >= 1024 ? `${(value / 1024).toFixed(2)} GB` : `${Math.round(value)} MB`;
    case '/s':
      return `${formatRps(value)}/s`;
    case '/min':
      return `${Number(value.toFixed(value < 10 ? 2 : 1))}/min`;
    case 'ms/min':
      return `${Math.round(value)} ms/min`;
    case 'jobs':
      return String(Math.round(value));
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
}

/** `+12%` với chiều tốt/xấu: tăng latency/CPU là xấu, tăng throughput là trung tính. */
export function trendOf(change: number | null, higherIsWorse: boolean | null): { text: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (change === null) return null;
  const rounded = Number(change.toFixed(1));
  const text = `${rounded > 0 ? '↑' : rounded < 0 ? '↓' : '→'} ${Math.abs(rounded)}%`;
  if (higherIsWorse === null || rounded === 0) return { text, tone: 'neutral' };
  return { text, tone: (rounded > 0) === higherIsWorse ? 'bad' : 'good' };
}
