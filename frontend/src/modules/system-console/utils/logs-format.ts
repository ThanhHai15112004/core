import type { LogRow } from '../types/logs.types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `14:21:42.218` theo giờ trình duyệt. */
export function logTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `2026-09-30 14:21:42.218`. */
export function logDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${logTime(iso)}`;
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** ID ngắn để hiện trong cột Context. */
export const shortId = (id: string, n = 10) => (id.length > n ? `${id.slice(0, n)}…` : id);

/** Ngữ cảnh quan trọng nhất của log (job > request > execution > correlation). */
export function contextOf(r: LogRow): { kind: 'job' | 'request' | 'execution' | 'correlation'; id: string } | null {
  if (r.jobId) return { kind: 'job', id: r.jobId };
  if (r.requestId) return { kind: 'request', id: r.requestId };
  if (r.executionId) return { kind: 'execution', id: r.executionId };
  if (r.correlationId) return { kind: 'correlation', id: r.correlationId };
  return null;
}

/** Link tới màn khác cho một ID ngữ cảnh. */
export function contextPath(kind: 'job' | 'request' | 'execution', id: string, queue?: string | null): string {
  const e = encodeURIComponent(id);
  if (kind === 'job') return `jobs/job/${e}${queue ? `?queue=${encodeURIComponent(queue)}` : ''}`;
  if (kind === 'request') return `http-traffic/requests/${e}`;
  return `scheduler?exec=${e}`;
}
