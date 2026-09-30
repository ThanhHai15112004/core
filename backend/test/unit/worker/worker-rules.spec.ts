import { describe, it, expect } from '@jest/globals';
import {
  diffWorkerAlerts,
  evaluateWorkerRules,
  primaryReason,
  reasonOf,
  ruleOf,
  stalledJobs,
  type QueueRuleInput,
  type WorkerRuleConfig,
  type WorkerRuleInput,
} from '@modules/worker-ops/index.js';
import type { MessagingErrorRecord } from '@packages/messaging/index.js';
import type { JobSummary } from '@packages/queue/index.js';

const cfg: WorkerRuleConfig = {
  backlogWarn: 1000,
  backlogCrit: 5000,
  oldestWaitingMin: 10,
  failureRatePercent: 5,
  minOps: 20,
  processingP95Ms: 5000,
  stalledMin: 10,
  retryStormPerMin: 100,
  concurrencyPercent: 90,
};

const base = (patch: Partial<WorkerRuleInput> = {}): WorkerRuleInput => ({
  connection: 'connected',
  queues: [],
  stalled: null,
  retries: { perMin: 0, queue: null, error: null },
  pressure: [],
  ...patch,
});

const queue = (patch: Partial<QueueRuleInput> = {}): QueueRuleInput => ({
  name: 'reports',
  waiting: 0,
  active: 0,
  paused: false,
  workers: 1,
  concurrency: 5,
  oldestWaitingMin: null,
  ops: 0,
  failureRatePercent: null,
  p95Ms: null,
  ...patch,
});

describe('evaluateWorkerRules', () => {
  it('backend queue mất kết nối → chỉ một cảnh báo critical', () => {
    const v = evaluateWorkerRules(
      base({ connection: 'unavailable', queues: [queue({ waiting: 9000, workers: 0 })] }),
      cfg,
    );
    expect(v.map((x) => x.id)).toEqual(['BROKER_UNAVAILABLE']);
    expect(v[0]!.severity).toBe('critical');
  });

  it('không đủ dữ liệu → không kết luận', () => {
    expect(evaluateWorkerRules(base({ queues: null }), cfg)).toEqual([]);
    // Tỷ lệ lỗi 50% nhưng mới 4 job — chưa đủ minOps.
    expect(
      evaluateWorkerRules(base({ queues: [queue({ ops: 4, failureRatePercent: 50 })] }), cfg),
    ).toEqual([]);
  });

  it('job chờ mà không có worker → NO_WORKER theo queue; chờ lâu → critical', () => {
    const v = evaluateWorkerRules(
      base({
        queues: [
          queue({ name: 'emails', waiting: 5, workers: 0, oldestWaitingMin: 2 }),
          queue({ name: 'reports', waiting: 1842, workers: 0, oldestWaitingMin: 42 }),
        ],
      }),
      cfg,
    );
    expect(v.find((x) => x.id === 'NO_WORKER:reports')).toMatchObject({
      severity: 'critical',
      extra: { target: 'reports', oldestMin: 42 },
    });
    expect(v.find((x) => x.id === 'NO_WORKER:emails')?.severity).toBe('warning');
    // Có NO_WORKER thì không kêu thêm "chờ lâu".
    expect(v.some((x) => x.rule === 'OLDEST_WAITING')).toBe(false);
  });

  it('queue tạm dừng còn job → QUEUE_PAUSED; có worker mà job chờ quá lâu → OLDEST_WAITING', () => {
    const v = evaluateWorkerRules(
      base({
        queues: [
          queue({ name: 'notifications', waiting: 842, paused: true }),
          queue({ name: 'reports', waiting: 20, oldestWaitingMin: 18.6 }),
        ],
      }),
      cfg,
    );
    expect(v.map((x) => x.id).sort()).toEqual([
      'OLDEST_WAITING:reports',
      'QUEUE_PAUSED:notifications',
    ]);
    expect(v.find((x) => x.rule === 'OLDEST_WAITING')).toMatchObject({ value: 19, unit: 'min' });
  });

  it('backlog warn/crit theo ngưỡng', () => {
    const v = evaluateWorkerRules(
      base({ queues: [queue({ name: 'a', waiting: 1200 }), queue({ name: 'b', waiting: 6000 })] }),
      cfg,
    );
    expect(v.find((x) => x.id === 'BACKLOG:a')).toMatchObject({
      severity: 'warning',
      threshold: 1000,
    });
    expect(v.find((x) => x.id === 'BACKLOG:b')).toMatchObject({
      severity: 'critical',
      threshold: 5000,
    });
    expect(v[0]!.severity).toBe('critical');
  });

  it('tỷ lệ lỗi, xử lý chậm, gần hết concurrency (chỉ khi còn job chờ)', () => {
    const v = evaluateWorkerRules(
      base({
        queues: [
          queue({ name: 'reports', ops: 100, failureRatePercent: 25, p95Ms: 8000 }),
          queue({ name: 'emails', waiting: 30, active: 5, concurrency: 5 }),
          queue({ name: 'audit', waiting: 0, active: 5, concurrency: 5 }),
        ],
      }),
      cfg,
    );
    expect(v.find((x) => x.id === 'FAILURE_RATE:reports')?.severity).toBe('critical');
    expect(v.find((x) => x.id === 'SLOW_PROCESSING:reports')).toMatchObject({ value: 8000 });
    expect(v.find((x) => x.id === 'CAPACITY:emails')).toMatchObject({
      value: 100,
      extra: { active: 5, concurrency: 5 },
    });
    expect(v.some((x) => x.id === 'CAPACITY:audit')).toBe(false);
  });

  it('job treo, retry storm (kèm queue & lỗi chính), áp lực tài nguyên worker', () => {
    const v = evaluateWorkerRules(
      base({
        stalled: { count: 3, oldestMin: 42.2, queue: 'exports' },
        retries: { perMin: 482, queue: 'reports', error: 'StorageTimeout' },
        pressure: [{ key: 'memory', value: 91, threshold: 85 }],
      }),
      cfg,
    );
    expect(v.find((x) => x.rule === 'STALLED_JOBS')).toMatchObject({
      value: 3,
      extra: { oldestMin: 42, queue: 'exports' },
    });
    expect(v.find((x) => x.rule === 'RETRY_STORM')).toMatchObject({
      severity: 'critical',
      extra: { queue: 'reports', error: 'StorageTimeout' },
    });
    expect(v.find((x) => x.id === 'WORKER_PRESSURE:memory')).toMatchObject({ unit: '%' });
  });
});

describe('diffWorkerAlerts / ruleOf', () => {
  it('giữ `since` cho cảnh báo đang diễn ra, báo hồi phục cảnh báo đã hết', () => {
    const active = new Map([
      [
        'BACKLOG:reports',
        {
          since: 1000,
          severity: 'warning' as const,
          value: 1200,
          threshold: 1000,
          unit: '',
          extra: {},
        },
      ],
      [
        'STALLED_JOBS',
        {
          since: 2000,
          severity: 'warning' as const,
          value: 1,
          threshold: 10,
          unit: 'min',
          extra: {},
        },
      ],
    ]);
    const v = evaluateWorkerRules(base({ queues: [queue({ waiting: 1500 })] }), cfg);
    const { started, set, recovered } = diffWorkerAlerts(v, active, 62_000);
    expect(started).toEqual([]);
    expect(set.get('BACKLOG:reports')).toMatchObject({ since: 1000, value: 1500 });
    expect(recovered).toEqual([
      expect.objectContaining({ id: 'STALLED_JOBS', durationMs: 60_000 }),
    ]);
    expect(ruleOf('BACKLOG:system.events')).toBe('BACKLOG');
  });
});

describe('reasonOf / primaryReason / stalledJobs', () => {
  it('gộp lý do lỗi theo tên lỗi hoặc message đã bỏ số/id', () => {
    expect(reasonOf('StorageTimeout: bucket reports timed out')).toBe('StorageTimeout');
    expect(reasonOf('ValidationError: email is required')).toBe('ValidationError');
    expect(reasonOf('ECONNREFUSED 127.0.0.1:6379')).toBe('ECONNREFUSED');
    expect(reasonOf('timeout after 5000ms')).toBe(reasonOf('timeout after 3000ms'));
    expect(reasonOf('')).toBe('Unknown');
    expect(reasonOf('x'.repeat(200)).length).toBeLessThanOrEqual(81);
  });

  it('lỗi chính = lý do xuất hiện nhiều nhất (ưu tiên error code)', () => {
    const e = (message: string, code: string | null = null) =>
      ({ message, code }) as unknown as MessagingErrorRecord;
    expect(
      primaryReason([e('StorageTimeout: a'), e('boom', 'ETIMEDOUT'), e('StorageTimeout: b')]),
    ).toBe('StorageTimeout');
    expect(primaryReason([])).toBeNull();
  });

  it('job active chạy quá ngưỡng là treo, cũ nhất trước', () => {
    const now = 100 * 60_000;
    const j = (id: string, processedAt: number | null) => ({ id, processedAt }) as JobSummary;
    const out = stalledJobs(
      [
        j('a', now - 5 * 60_000),
        j('b', now - 42 * 60_000),
        j('c', now - 18 * 60_000),
        j('d', null),
      ],
      10,
      now,
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'c']);
  });
});
