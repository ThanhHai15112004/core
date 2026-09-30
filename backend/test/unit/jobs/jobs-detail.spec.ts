import { describe, it, expect, beforeAll } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { CoreConfigService } from '@packages/config/index.js';
import type { LifecycleEntry } from '@packages/messaging/index.js';
import type { JobDetailRaw, JobRecord } from '@packages/queue/index.js';
import { JobsOpsService } from '@modules/jobs-ops/index.js';

const T = 1_800_000_000_000;
const entry = (
  at: number,
  type: LifecycleEntry['type'],
  over: Partial<LifecycleEntry> = {},
): LifecycleEntry => ({
  at,
  type,
  runtime: 'worker',
  consumer: 'P',
  attempt: null,
  ms: null,
  error: null,
  delayMs: null,
  ...over,
});

function raw(
  record: Partial<JobRecord>,
  lifecycle: LifecycleEntry[],
  stacktrace: string[] = [],
): JobDetailRaw {
  return {
    record: {
      id: 'j1',
      queue: 'reports',
      type: 'GenerateReport',
      status: 'failed',
      state: 'failed',
      createdAt: T,
      startedAt: T + 2100,
      finishedAt: T + 14_000,
      attempts: 3,
      maxAttempts: 3,
      availableAt: null,
      error: 'StorageTimeout: upload',
      errorType: 'StorageTimeout',
      ...record,
    } as JobRecord,
    lifecycle,
    logs: [],
    stacktrace,
    payload: {},
    returnValue: null,
    backoff: { type: 'exponential', delayMs: 1000 },
    removeOnComplete: null,
    removeOnFail: null,
    malformed: false,
  };
}

describe('JobsOpsService — lần thử & vòng đời', () => {
  let service: JobsOpsService;
  beforeAll(() => {
    applyTestEnv();
    const n = null as never;
    service = new JobsOpsService(n, n, n, n, n, n, n, new CoreConfigService(), n);
  });

  const failedJob = raw(
    {},
    [
      entry(T + 2100, 'received', { attempt: 1, instance: 'worker@h:1' }),
      entry(T + 4200, 'failed', {
        attempt: 1,
        ms: 2100,
        error: 'Timeout: x',
        errorType: 'Timeout',
        retryable: true,
      }),
      entry(T + 4200, 'retry_scheduled', { attempt: 1, delayMs: 1000 }),
      entry(T + 5200, 'received', { attempt: 2, instance: 'worker@h:2' }),
      entry(T + 9000, 'failed', {
        attempt: 2,
        ms: 3800,
        error: 'Timeout: y',
        errorType: 'Timeout',
        retryable: true,
      }),
      entry(T + 9000, 'retry_scheduled', { attempt: 2, delayMs: 2000 }),
      entry(T + 11_000, 'retried_manually', { actor: 'ops' }),
      entry(T + 11_000, 'received', { attempt: 3 }),
      entry(T + 14_000, 'failed', {
        attempt: 3,
        ms: 3000,
        error: 'StorageTimeout: upload',
        errorType: 'StorageTimeout',
        dependency: 'storage',
      }),
      entry(T + 14_000, 'dead_lettered', { attempt: 3 }),
    ],
    ['stack-1', 'stack-2', 'stack-3'],
  );

  it('attempts: mỗi lần thử có kết quả, instance, backoff, lần thủ công, stack đúng lần', () => {
    const a = service.attempts(failedJob);
    expect(
      a.map((x) => [x.attempt, x.result, x.errorType, x.backoffMs, x.manual, x.stack]),
    ).toEqual([
      [1, 'failed', 'Timeout', 1000, false, 'stack-1'],
      [2, 'failed', 'Timeout', 2000, false, 'stack-2'],
      [3, 'failed', 'StorageTimeout', null, true, 'stack-3'],
    ]);
    expect(a[0]!.instance).toBe('worker@h:1');
    expect(a[2]!.dependency).toBe('storage');
  });

  it('không có job log (job cũ) → dựng lần thử gần nhất từ timestamp', () => {
    const a = service.attempts(
      raw({ status: 'completed', error: null, errorType: null, attempts: 1, durationMs: 500 }, []),
    );
    expect(a).toEqual([
      expect.objectContaining({ attempt: 1, result: 'completed', durationMs: 500 }),
    ]);
  });

  it('lifecycle: created → enqueued → picked → failed → retry → … → exhausted, sắp theo thời gian', () => {
    const steps = service.lifecycle(failedJob, T + 20_000).map((s) => s.kind);
    expect(steps).toEqual([
      'created',
      'enqueued',
      'picked',
      'failed',
      'retry_scheduled',
      'picked',
      'failed',
      'retry_scheduled',
      'retried_manually',
      'picked',
      'failed',
      'exhausted',
    ]);
  });

  it('lifecycle job đang chờ / đang hẹn giờ có bước hiện tại', () => {
    const waiting = service.lifecycle(
      raw({ status: 'waiting', startedAt: null, finishedAt: null, attempts: 0 }, []),
      T + 5000,
    );
    expect(waiting.at(-1)).toMatchObject({ kind: 'waiting', current: true });
    const delayed = service.lifecycle(
      raw(
        {
          status: 'delayed',
          startedAt: null,
          finishedAt: null,
          attempts: 0,
          availableAt: T + 60_000,
        },
        [],
      ),
      T,
    );
    expect(delayed.map((s) => s.kind)).toEqual(['created', 'enqueued', 'scheduled', 'scheduled']);
  });

  it('ngưỡng chạy lâu / chờ lâu theo baseline', () => {
    expect(service.longRunningThreshold(120_000)).toBe(360_000);
    expect(service.longRunningThreshold(1000)).toBe(60_000);
    expect(service.longRunningThreshold(null)).toBe(180_000);
    expect(service.longWaitThreshold(8000)).toBe(80_000);
  });
});
