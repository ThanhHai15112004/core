import type { MetricValue } from '../types/runtime.types';

export const NO_VALUE = '--';

/** 582920 → "6d 17h", 7500 → "2h 5m", 45 → "45s". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return NO_VALUE;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds)}s`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return formatUptime(ms / 1000);
}

export function formatMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return NO_VALUE;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

export function formatMetric(value: MetricValue | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  if (typeof value === 'boolean') return String(value);
  return unit ? `${value} ${unit}` : String(value);
}

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? NO_VALUE : `${Number(value.toFixed(1))}%`;
