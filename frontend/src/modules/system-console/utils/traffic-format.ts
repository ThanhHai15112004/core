import type { EndpointStatus } from '../types/traffic.types';
import type { StatusTone } from './status-tone';
import { LATENCY_CEILING_MS } from '../constants/traffic';
import { NO_VALUE } from './runtime-format';

/** Latency: `842 ms`, `1.82 s`, giá trị chạm trần histogram → `≥ 10 s`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  if (ms >= LATENCY_CEILING_MS) return `≥ ${LATENCY_CEILING_MS / 1000} s`;
  if (ms < 1) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatRps(rps: number | null | undefined): string {
  if (rps === null || rps === undefined) return NO_VALUE;
  if (rps === 0) return '0';
  if (rps < 0.01) return '< 0.01';
  return rps < 10 ? rps.toFixed(2) : rps.toFixed(1);
}

/** 8420000 → "8,4 Tr" / "8.4M" theo locale. */
export function formatCount(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return NO_VALUE;
  if (n < 10_000) return n.toLocaleString(locale);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export const formatPct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? NO_VALUE : `${Number(n.toFixed(digits))}%`;

/** `+12%` / `-8%`; `null` → không có kỳ trước. */
export function formatDelta(n: number | null | undefined, suffix = '%'): string | null {
  if (n === null || n === undefined) return null;
  const rounded = Number(n.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded}${suffix}`;
}

export function httpStatusTone(status: number): StatusTone {
  if (status >= 500 || status === 0) return 'crit';
  if (status >= 400) return 'warn';
  if (status >= 200 && status < 300) return 'ok';
  return 'unknown';
}

export const ENDPOINT_TONE: Record<EndpointStatus, StatusTone> = {
  healthy: 'ok',
  slow: 'warn',
  high_error: 'warn',
  failing: 'crit',
  idle: 'unknown',
  low_traffic: 'unknown',
};

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
