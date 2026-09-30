import type { JobSourceKind } from '@packages/messaging/index.js';
import {
  JOB_LIST_STATES,
  LIST_STATES_OF,
  type JobListState,
  type JobPriorityLevel,
  type JobRecord,
  type JobStatus,
} from '@packages/queue/index.js';

export interface JobFilter {
  /** null = mọi trạng thái. */
  status: JobStatus | null;
  queue: string | null;
  type: string | null;
  /** Tìm theo tên loại job (không phân biệt hoa thường). */
  typeContains: string | null;
  /** Áp dụng cho job đã kết thúc (completed / failed / cancelled) theo thời điểm kết thúc. */
  from: number | null;
  to: number | null;
  worker: string | null;
  source: JobSourceKind | null;
  minAttempts: number | null;
  minDurationMs: number | null;
  errorType: string | null;
  priority: JobPriorityLevel | null;
}

export const EMPTY_FILTER: JobFilter = {
  status: null,
  queue: null,
  type: null,
  typeContains: null,
  from: null,
  to: null,
  worker: null,
  source: null,
  minAttempts: null,
  minDurationMs: null,
  errorType: null,
  priority: null,
};

type SourceState = JobListState | 'tombstone';

/** Nguồn đọc job cho trang: một danh sách BullMQ của một queue, hoặc bản ghi huỷ của Console. */
export interface JobSourceReader {
  list(
    queue: string,
    state: JobListState,
    start: number,
    count: number,
    asc: boolean,
  ): Promise<JobRecord[]>;
  cancelled(offset: number, count: number, from: number): Promise<JobRecord[]>;
}

const CHUNK = 50;
const FINISHED = new Set<SourceState>(['completed', 'failed', 'tombstone']);

export const activityAt = (j: JobRecord) =>
  j.finishedAt ?? j.cancelledAt ?? j.startedAt ?? j.createdAt;

/** Thứ tự hiển thị theo trạng thái: chờ → cũ nhất trước; đang chạy → chạy lâu nhất trước; hẹn giờ → sắp chạy trước. */
function ordering(status: JobStatus | null): { asc: boolean; key: (j: JobRecord) => number } {
  switch (status) {
    case 'waiting':
      return { asc: true, key: (j) => j.createdAt };
    case 'active':
    case 'stalled':
      return { asc: true, key: (j) => j.startedAt ?? j.createdAt };
    case 'delayed':
    case 'retrying':
      return { asc: true, key: (j) => j.availableAt ?? j.createdAt };
    default:
      return { asc: false, key: activityAt };
  }
}

export function matchesFilter(j: JobRecord, f: JobFilter): boolean {
  if (f.status) {
    // Tab Active gồm cả job mất heartbeat (được đánh dấu stalled).
    const ok =
      f.status === 'active'
        ? j.status === 'active' || j.status === 'stalled'
        : j.status === f.status;
    if (!ok) return false;
  }
  if (f.queue && j.queue !== f.queue) return false;
  if (f.type && j.type !== f.type) return false;
  if (f.typeContains && !j.type.toLowerCase().includes(f.typeContains.toLowerCase())) return false;
  const finished = j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled';
  if (finished && f.from !== null && activityAt(j) < f.from) return false;
  if (finished && f.to !== null && activityAt(j) > f.to) return false;
  if (f.worker && j.worker !== f.worker) return false;
  if (f.source && j.source.kind !== f.source) return false;
  if (f.minAttempts !== null && j.attempts < f.minAttempts) return false;
  if (f.minDurationMs !== null) {
    const d =
      j.durationMs ?? (j.startedAt !== null && !j.finishedAt ? Date.now() - j.startedAt : null);
    if (d === null || d < f.minDurationMs) return false;
  }
  if (f.errorType && j.errorType !== f.errorType) return false;
  if (f.priority && j.priorityLevel !== f.priority) return false;
  return true;
}

/** Cursor = vị trí đã đọc của từng nguồn (`-1` = nguồn đã hết). */
export type Cursor = Record<string, number>;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): Cursor {
  if (!raw) return {};
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(
        ([, n]) => typeof n === 'number' && Number.isInteger(n) && n >= -1,
      ),
    ) as Cursor;
  } catch {
    return {};
  }
}

interface Source {
  key: string;
  queue: string;
  state: SourceState;
  offset: number;
  buffer: JobRecord[];
  ended: boolean;
}

export interface ScanResult {
  jobs: JobRecord[];
  nextCursor: string | null;
  scanned: number;
  truncated: boolean;
}

/**
 * Một trang job theo bộ lọc: gộp k danh sách (mỗi queue × mỗi danh sách BullMQ + bản ghi huỷ) theo thứ tự hiển thị,
 * đọc từng đoạn nhỏ, dừng khi đủ `limit` hoặc chạm `scanMax`. Nguồn job đã kết thúc sắp theo thời gian giảm dần nên
 * gặp job cũ hơn `from` là dừng nguồn đó. Cursor giữ vị trí từng nguồn → "Load more" không quét lại từ đầu.
 */
export async function scanJobs(
  reader: JobSourceReader,
  queues: string[],
  filter: JobFilter,
  limit: number,
  scanMax: number,
  cursor: Cursor,
): Promise<ScanResult> {
  const { asc, key } = ordering(filter.status);
  const lists: SourceState[] = filter.status
    ? [...LIST_STATES_OF[filter.status]]
    : [...JOB_LIST_STATES];
  if (!filter.status || filter.status === 'cancelled') lists.push('tombstone');
  const sources: Source[] = [];
  for (const state of lists) {
    const qs =
      state === 'tombstone' ? ['*'] : queues.filter((q) => !filter.queue || q === filter.queue);
    for (const queue of qs) {
      const k = `${queue}|${state}`;
      const offset = cursor[k] ?? 0;
      sources.push({
        key: k,
        queue,
        state,
        offset: Math.max(0, offset),
        buffer: [],
        ended: offset === -1,
      });
    }
  }
  const fill = async (s: Source) => {
    if (s.ended || s.buffer.length) return;
    const items =
      s.state === 'tombstone'
        ? await reader.cancelled(s.offset, CHUNK, filter.from ?? 0)
        : await reader.list(s.queue, s.state, s.offset, CHUNK, asc);
    s.buffer = items;
    if (items.length < CHUNK) s.ended = true;
  };
  const page: JobRecord[] = [];
  let scanned = 0;
  while (page.length < limit && scanned < scanMax) {
    await Promise.all(sources.map(fill));
    const live = sources.filter((s) => s.buffer.length > 0);
    if (!live.length) break;
    let best = live[0]!;
    for (const s of live) {
      const a = key(s.buffer[0]!);
      const b = key(best.buffer[0]!);
      if (asc ? a < b : a > b) best = s;
    }
    const job = best.buffer.shift()!;
    best.offset++;
    scanned++;
    // Nguồn job đã kết thúc sắp theo thời gian giảm dần: cũ hơn `from` → phần còn lại cũng cũ hơn.
    if (FINISHED.has(best.state) && filter.from !== null && activityAt(job) < filter.from) {
      best.ended = true;
      best.buffer = [];
      continue;
    }
    if (matchesFilter(job, filter)) page.push(job);
  }
  const more = sources.some((s) => s.buffer.length > 0 || !s.ended);
  const next: Cursor = {};
  for (const s of sources) next[s.key] = s.ended && s.buffer.length === 0 ? -1 : s.offset;
  return {
    jobs: page,
    nextCursor: more ? encodeCursor(next) : null,
    scanned,
    truncated: more && scanned >= scanMax,
  };
}
