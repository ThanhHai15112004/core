import type { Tone } from '@core/theme';
import type { StatDelta } from '@core/ui/blocks';
import { NO_VALUE, UNIT, formatDelta, formatDuration } from '@core/lib/format';
import { LATENCY_CEILING_MS } from '../constants/traffic';
import type { TrafficSummary } from '../types/traffic.types';

/** Latency: `842 ms`, `1.82 s`, giá trị chạm trần histogram → `≥ 10 s`. (Performance dùng chung.) */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  if (ms >= LATENCY_CEILING_MS) return `≥ ${LATENCY_CEILING_MS / 1000} ${UNIT.s}`;
  if (ms < 1) return `${ms.toFixed(1)} ${UNIT.ms}`;
  if (ms < 1000) return `${Math.round(ms)} ${UNIT.ms}`;
  return `${(ms / 1000).toFixed(2)} ${UNIT.s}`;
}

/** Latency cho trang Traffic: như `formatDuration` nhưng giá trị chạm trần histogram hiện `≥`. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms !== null && ms !== undefined && ms >= LATENCY_CEILING_MS) return `≥ ${formatDuration(LATENCY_CEILING_MS)}`;
  return formatDuration(ms);
}

export function formatRps(rps: number | null | undefined): string {
  if (rps === null || rps === undefined) return NO_VALUE;
  if (rps === 0) return '0';
  if (rps < 0.01) return '< 0.01';
  return rps < 10 ? rps.toFixed(2) : rps.toFixed(1);
}

/** Tông của một HTTP status code. */
export function httpStatusTone(status: number): Tone {
  if (status >= 500 || status === 0) return 'crit';
  if (status >= 400) return 'warn';
  if (status >= 200 && status < 300) return 'ok';
  return 'info';
}

/** Tông tỷ lệ lỗi 5xx theo ngưỡng cấu hình `TRAFFIC_*`; chưa có request → không tô. */
export function errorRateTone(s: TrafficSummary): Tone | undefined {
  if (s.stats.requests === 0) return undefined;
  if (s.stats.errorRatePercent >= s.settings.errorRateCritPercent) return 'crit';
  if (s.stats.errorRatePercent >= s.settings.errorRateWarnPercent) return 'warn';
  return 'ok';
}

/**
 * Thay đổi so với kỳ trước cho StatTile. `higherIsWorse`: true = tăng là xấu (latency, lỗi), null = trung tính
 * (lưu lượng). Không có kỳ trước → null (ẩn).
 */
export function statDelta(v: number | null | undefined, higherIsWorse: boolean | null, suffix: string = UNIT.percent): StatDelta | null {
  const text = formatDelta(v, 1, suffix);
  if (text === null || v === null || v === undefined) return null;
  const direction = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  const good = higherIsWorse === null || v === 0 ? null : higherIsWorse ? v < 0 : v > 0;
  return { text, direction, good };
}

/**
 * Id endpoint dạng `GET /api/v1/x`. Link mã hoá đúng → một segment (có `/` sau khi decode), phần sau là tab con cũ
 * (bỏ qua). Link không mã hoá (`endpoints/GET /api/v1/x`) bị router tách theo `/` → ghép lại.
 */
export function routeIdOf(params: string[]): string | null {
  if (params.length === 0) return null;
  if (params.length === 1 || params[0].includes('/')) return params[0];
  return params.join('/');
}

/** Bỏ API prefix khỏi route cho gọn khi hiển thị trong bảng. */
export function shortRoute(route: string): string {
  return route.replace(/^\/api\/v\d+(?=\/|$)/, '') || '/';
}

/** Xuất CSV (UTF-8 BOM để Excel đọc đúng tiếng Việt). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]): void {
  const escape = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
