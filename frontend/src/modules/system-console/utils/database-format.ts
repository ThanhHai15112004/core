import { NO_VALUE } from './runtime-format';

/** 3506176 → "3.34 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return NO_VALUE;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${bytes < 0 ? '-' : ''}${v < 10 && i > 0 ? v.toFixed(2) : v < 100 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const formatSignedBytes = (bytes: number | null | undefined) =>
  bytes === null || bytes === undefined ? NO_VALUE : `${bytes > 0 ? '+' : ''}${formatBytes(bytes)}`;

/** Thời lượng: `840 ms`, `8.4 s`, `2 phút 14 s`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatCompact(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return NO_VALUE;
  return n < 10_000 ? n.toLocaleString(locale) : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
