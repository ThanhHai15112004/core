import type { Tone } from '@core/theme';
import { isNil, NO_VALUE } from '@core/lib/format';
import type { useFormat } from '@core/hooks/useFormat';
import type { AlertItem } from '@core/ui/blocks';
import type { WorkerAlert } from '../../types/worker.types';
import { SEVERITY_TONE } from '../../constants/worker';

type Format = ReturnType<typeof useFormat>;

/** Tốc độ có dấu: `+18/min`, `-40/min`. */
export const signedRate = (f: Format, perMin: number | null | undefined): string =>
  isNil(perMin) ? NO_VALUE : `${perMin > 0 ? '+' : ''}${f.rate(perMin, 'min')}`;

/** Giá trị theo đơn vị series worker (`/min`, `jobs`, `ms`). */
export function formatWorkerUnit(f: Format, unit: string, v: number | null): string {
  if (unit === 'ms') return f.duration(v);
  if (unit === '/min') return f.rate(v, 'min');
  return f.compact(v);
}

/** Chỉ tô viền / màu khi cần chú ý (không tô "ổn"). */
export const attentionTone = (tone: Tone): Tone | undefined => (tone === 'warn' || tone === 'crit' ? tone : undefined);

/** Danh sách cảnh báo của worker / queue cho AlertList. */
export function toAlertItems(alerts: WorkerAlert[], onOpen: (a: WorkerAlert) => void): AlertItem[] {
  return alerts.map((a) => ({
    id: a.id,
    tone: SEVERITY_TONE[a.severity] ?? 'unknown',
    title: a.queue ? `${a.title} · ${a.queue}` : a.title,
    detail: a.message,
    since: a.since,
    onInspect: () => onOpen(a),
  }));
}

/** Lưới số nhỏ giữ nguyên số cột cả trên mobile (KeyValueGrid mặc định xếp 1 cột). */
export const DENSE_GRID = {
  3: 'grid-cols-3 sm:grid-cols-3 lg:grid-cols-3',
  4: 'grid-cols-4 sm:grid-cols-4 lg:grid-cols-4',
} as const;
