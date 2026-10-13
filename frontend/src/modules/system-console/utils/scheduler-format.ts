import { NO_VALUE, UNIT } from '@core/lib/format';
import type { Execution } from '../types/scheduler.types';

/** Khoảng thời gian tới lần chạy kế tiếp: `42s`, `4m`, `2h 18m`, `6d 3h`. */
export function formatIn(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return NO_VALUE;
  if (sec < 60) return `${Math.max(0, Math.round(sec))}${UNIT.s}`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}${UNIT.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}${UNIT.h} ${m % 60}${UNIT.m}` : `${h}${UNIT.h}`;
  return `${Math.floor(h / 24)}${UNIT.d}${h % 24 ? ` ${h % 24}${UNIT.h}` : ''}`;
}

/** Giây tới một thời điểm ISO (âm → 0). */
export const secondsUntil = (at: string | null | undefined, now: number) => (at ? Math.max(0, (Date.parse(at) - now) / 1000) : null);

/** `13/10 14:21:42` theo locale (giờ trình duyệt). */
export function formatDateTime(v: string | number, locale: string, withSeconds = true): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false }).format(new Date(v));
}

/** Thời điểm đại diện của một lần chạy (bắt đầu → theo lịch → kết thúc). */
export const execAt = (e: Pick<Execution, 'startedAt' | 'scheduledAt' | 'finishedAt'>): string | null => e.startedAt ?? e.scheduledAt ?? e.finishedAt;

/** Thời lượng hiển thị: đang chạy → đã chạy bao lâu. */
export const execDurationMs = (e: Pick<Execution, 'status' | 'runningMs' | 'durationMs'>): number | null => (e.status === 'running' ? e.runningMs : e.durationMs);
