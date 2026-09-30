import { describe, it, expect } from '@jest/globals';
import { EMPTY_FILTER, scanJobs, type JobSourceReader } from '@modules/jobs-ops/index.js';
import type { JobListState, JobRecord, JobStatus } from '@packages/queue/index.js';

const T = 1_800_000_000_000;

function rec(
  id: string,
  queue: string,
  status: JobStatus,
  at: number,
  over: Partial<JobRecord> = {},
): JobRecord {
  const finished = status === 'completed' || status === 'failed';
  return {
    id,
    queue,
    type: 'report.generate',
    status,
    state: finished ? (status as JobListState) : status === 'waiting' ? 'waiting' : 'active',
    priority: 0,
    priorityLevel: 'normal',
    createdAt: at - 1000,
    availableAt: null,
    startedAt: finished || status === 'active' ? at - 500 : null,
    finishedAt: finished ? at : null,
    worker: 'worker',
    attempts: 1,
    maxAttempts: 3,
    progress: null,
    source: { kind: 'system', id: null, name: null, detail: null },
    producer: null,
    correlationId: null,
    requestId: null,
    idempotencyKey: null,
    index: {},
    schema: null,
    payloadSize: 10,
    error: status === 'failed' ? 'StorageTimeout: x' : null,
    errorType: status === 'failed' ? 'StorageTimeout' : null,
    retryable: null,
    stalledCount: 0,
    delayReason: null,
    waitMs: null,
    durationMs: null,
    heartbeat: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    ...over,
  };
}

/** Reader giả: mỗi (queue, state) là một danh sách đã sắp như BullMQ; đếm số lần đọc. */
function reader(lists: Record<string, JobRecord[]>, tombstones: JobRecord[] = []) {
  const calls = { list: 0 };
  const r: JobSourceReader = {
    list: async (queue, state, start, count, asc) => {
      calls.list++;
      const all = [...(lists[`${queue}|${state}`] ?? [])];
      const sorted = asc ? all.reverse() : all;
      return sorted.slice(start, start + count);
    },
    cancelled: async (offset, count, from) =>
      tombstones.filter((t) => (t.cancelledAt ?? 0) >= from).slice(offset, offset + count),
  };
  return { r, calls };
}

describe('scanJobs — gộp nhiều danh sách, cursor, bộ lọc', () => {
  const qs = ['a', 'b'];
  // Danh sách finished: mới nhất trước (như BullMQ desc).
  const completedA = Array.from({ length: 60 }, (_, i) =>
    rec(`a${i}`, 'a', 'completed', T - i * 2000),
  );
  const failedB = Array.from({ length: 30 }, (_, i) =>
    rec(`b${i}`, 'b', 'failed', T - i * 3000 - 500),
  );

  it('"All": trộn theo thời gian giảm dần, phân trang bằng cursor không trùng / không sót', async () => {
    const { r } = reader({ 'a|completed': completedA, 'b|failed': failedB });
    const seen: string[] = [];
    let cursor: Record<string, number> = {};
    let pages = 0;
    for (;;) {
      const res = await scanJobs(r, qs, EMPTY_FILTER, 25, 2000, cursor);
      pages++;
      const times = res.jobs.map((j) => j.finishedAt!);
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      seen.push(...res.jobs.map((j) => j.id));
      if (!res.nextCursor) break;
      cursor = JSON.parse(Buffer.from(res.nextCursor, 'base64url').toString());
    }
    expect(pages).toBe(4);
    expect(new Set(seen).size).toBe(90);
    expect(seen.length).toBe(90);
  });

  it('bộ lọc trạng thái + queue + loại lỗi; cửa sổ thời gian dừng sớm nguồn đã kết thúc', async () => {
    const { r, calls } = reader({ 'a|completed': completedA, 'b|failed': failedB });
    const failed = await scanJobs(
      r,
      qs,
      { ...EMPTY_FILTER, status: 'failed', errorType: 'StorageTimeout' },
      50,
      2000,
      {},
    );
    expect(failed.jobs).toHaveLength(30);
    expect(failed.nextCursor).toBeNull();
    const recent = await scanJobs(
      r,
      qs,
      { ...EMPTY_FILTER, status: 'completed', from: T - 20_000 },
      50,
      2000,
      {},
    );
    // a0..a10 nằm trong 20s gần nhất; gặp job cũ hơn thì dừng, không đọc hết 60 job.
    expect(recent.jobs.map((j) => j.id)).toEqual(Array.from({ length: 11 }, (_, i) => `a${i}`));
    expect(recent.nextCursor).toBeNull();
    expect(calls.list).toBeLessThanOrEqual(4);
  });

  it('waiting: cũ nhất trước; chạm scanMax → truncated + cursor', async () => {
    const waiting = Array.from({ length: 40 }, (_, i) =>
      rec(`w${i}`, 'a', 'waiting', T - i * 1000),
    );
    const { r } = reader({ 'a|waiting': waiting });
    const res = await scanJobs(
      r,
      qs,
      { ...EMPTY_FILTER, status: 'waiting', type: 'nope' },
      10,
      20,
      {},
    );
    expect(res.jobs).toHaveLength(0);
    expect(res.scanned).toBe(20);
    expect(res.truncated).toBe(true);
    expect(res.nextCursor).not.toBeNull();
    const ordered = await scanJobs(r, qs, { ...EMPTY_FILTER, status: 'waiting' }, 3, 2000, {});
    expect(ordered.jobs.map((j) => j.id)).toEqual(['w39', 'w38', 'w37']);
  });

  it('Cancelled gồm job huỷ khi chạy (failed JobCancelled) và bản ghi huỷ khi còn chờ', async () => {
    const running = rec('c1', 'a', 'cancelled', T - 1000, {
      state: 'failed',
      cancelledAt: T - 1000,
    });
    const queued = rec('c2', 'b', 'cancelled', T - 2000, {
      state: 'removed',
      finishedAt: null,
      cancelledAt: T - 2000,
    });
    const { r } = reader({ 'a|failed': [running, ...failedB.map((j) => ({ ...j, queue: 'a' }))] }, [
      queued,
    ]);
    const res = await scanJobs(r, qs, { ...EMPTY_FILTER, status: 'cancelled' }, 10, 2000, {});
    expect(res.jobs.map((j) => j.id)).toEqual(['c1', 'c2']);
  });

  it('Active gồm cả job stalled', async () => {
    const { r } = reader({
      'a|active': [rec('x1', 'a', 'active', T), rec('x2', 'a', 'stalled', T - 5000)],
    });
    const res = await scanJobs(r, qs, { ...EMPTY_FILTER, status: 'active' }, 10, 2000, {});
    expect(res.jobs.map((j) => j.status).sort()).toEqual(['active', 'stalled']);
    const stalled = await scanJobs(r, qs, { ...EMPTY_FILTER, status: 'stalled' }, 10, 2000, {});
    expect(stalled.jobs.map((j) => j.id)).toEqual(['x2']);
  });
});
