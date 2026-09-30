import { describe, it, expect } from '@jest/globals';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import {
  JobError,
  classifyJobError,
  dependencyOf,
  serializeMessage,
  toUnrecoverable,
} from '@packages/messaging/index.js';
import { priorityLevel, progressOf, sourceOf, toJobRecord } from '@packages/queue/index.js';

const NOW = 1_800_000_000_000;

function job(over: Partial<Record<string, unknown>> = {}): Job {
  return {
    id: 'job-1',
    name: 'report.generate',
    queueName: 'system.events',
    data: serializeMessage(
      'report.generate',
      { reportId: 'r1' },
      { producer: 'api', correlationId: 'corr-1' },
    ),
    opts: { attempts: 3 },
    timestamp: NOW - 60_000,
    attemptsMade: 0,
    attemptsStarted: 0,
    failedReason: '',
    delay: 0,
    stalledCounter: 0,
    progress: 0,
    ...over,
  } as unknown as Job;
}

describe('toJobRecord — trạng thái chuẩn hoá', () => {
  it('waiting / prioritized → waiting; delayed có lượt thử → retrying, chưa → delayed', () => {
    expect(toJobRecord(job(), 'waiting', { now: NOW }).status).toBe('waiting');
    expect(toJobRecord(job({ opts: { priority: 1 } }), 'prioritized', { now: NOW })).toMatchObject({
      status: 'waiting',
      priorityLevel: 'critical',
    });
    expect(
      toJobRecord(job({ attemptsMade: 1 }), 'delayed', { runAt: NOW + 5000, now: NOW }),
    ).toMatchObject({
      status: 'retrying',
      availableAt: NOW + 5000,
      delayReason: 'retry',
      retryable: true,
    });
    expect(toJobRecord(job({ delay: 10_000 }), 'delayed', { now: NOW })).toMatchObject({
      status: 'delayed',
      delayReason: 'delay',
    });
  });

  it('active: còn khoá → active (heartbeat), mất khoá quá grace → stalled, chưa kiểm tra → active', () => {
    const running = job({ processedOn: NOW - 120_000, attemptsStarted: 1 });
    const alive = toJobRecord(running, 'active', { lockTtlMs: 25_000, now: NOW });
    expect(alive.status).toBe('active');
    expect(alive.heartbeat).toEqual({ alive: true, lastAt: NOW - 5000 });
    expect(toJobRecord(running, 'active', { lockTtlMs: null, now: NOW }).status).toBe('stalled');
    expect(toJobRecord(running, 'active', { now: NOW })).toMatchObject({
      status: 'active',
      heartbeat: null,
    });
    // Vừa được nhận, chưa kịp có khoá → chưa coi là stalled.
    expect(
      toJobRecord(job({ processedOn: NOW - 1000 }), 'active', { lockTtlMs: null, now: NOW }).status,
    ).toBe('active');
  });

  it('failed: JobCancelled → cancelled; lỗi sớm hơn maxAttempts → không retry được; hết lượt → chưa rõ', () => {
    const cancelled = toJobRecord(
      job({ failedReason: 'JobCancelled: stop please', finishedOn: NOW, attemptsMade: 1 }),
      'failed',
      { now: NOW },
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelReason: 'stop please',
      cancelledAt: NOW,
    });
    expect(
      toJobRecord(
        job({ failedReason: 'ValidationError: bad input', finishedOn: NOW, attemptsMade: 3 }),
        'failed',
      ),
    ).toMatchObject({ status: 'failed', errorType: 'ValidationError', retryable: false });
    expect(
      toJobRecord(
        job({ failedReason: 'Something broke', finishedOn: NOW, attemptsMade: 1 }),
        'failed',
      ),
    ).toMatchObject({ errorType: 'UnhandledException', retryable: false });
    expect(
      toJobRecord(
        job({ failedReason: 'StorageTimeout: upload', finishedOn: NOW, attemptsMade: 3 }),
        'failed',
      ),
    ).toMatchObject({ errorType: 'StorageTimeout', retryable: null });
  });

  it('thời gian chờ / xử lý, correlation, kích thước payload', () => {
    const r = toJobRecord(
      job({ processedOn: NOW - 50_000, finishedOn: NOW - 45_000 }),
      'completed',
      { now: NOW },
    );
    expect(r).toMatchObject({
      status: 'completed',
      waitMs: 10_000,
      durationMs: 5000,
      correlationId: 'corr-1',
      error: null,
    });
    expect(r.payloadSize).toBeGreaterThan(0);
  });
});

describe('nguồn / tiến độ / priority', () => {
  it('sourceOf: metadata envelope; envelope cũ → suy từ producer (scheduler dùng correlation = execution)', () => {
    const withMeta = serializeMessage(
      'x',
      {},
      {
        producer: 'api',
        job: {
          source: { kind: 'http', id: 'req-1', name: 'POST /api/v1/reports', detail: null },
          requestId: 'req-1',
          idempotencyKey: null,
          index: {},
          schema: null,
        },
      },
    );
    expect(sourceOf(withMeta)).toEqual({
      kind: 'http',
      id: 'req-1',
      name: 'POST /api/v1/reports',
      detail: null,
    });
    expect(
      sourceOf(serializeMessage('x', {}, { producer: 'scheduler', correlationId: 'sch_1' })),
    ).toMatchObject({
      kind: 'scheduler',
      id: 'sch_1',
    });
    expect(sourceOf(serializeMessage('x', {}, { producer: 'cli' })).kind).toBe('manual');
    expect(sourceOf(null).kind).toBe('system');
  });

  it('progressOf: mặc định 0 = chưa báo; object có phase được giữ', () => {
    expect(progressOf(0)).toBeNull();
    expect(progressOf({})).toBeNull();
    expect(progressOf(42)).toMatchObject({ percent: 42 });
    expect(
      progressOf({
        percent: 68,
        processed: 6821,
        total: 10000,
        step: 'Generating PDF',
        phases: [
          { name: 'Fetch', state: 'done' },
          { name: 'x', state: 'bogus' },
        ],
      }),
    ).toEqual({
      percent: 68,
      processed: 6821,
      total: 10000,
      step: 'Generating PDF',
      phases: [{ name: 'Fetch', state: 'done' }],
    });
  });

  it('priorityLevel theo quy ước BullMQ (số nhỏ = ưu tiên cao, 0 = không đặt)', () => {
    expect([0, 1, 5, 100, 5000].map(priorityLevel)).toEqual([
      'normal',
      'critical',
      'high',
      'normal',
      'low',
    ]);
  });
});

describe('phân loại lỗi job', () => {
  it('JobError giữ type / retryable / dependency; message dạng Type: …', () => {
    const e = new JobError('StorageTimeout', 'upload failed', {
      retryable: true,
      dependency: 'storage',
    });
    expect(e.message).toBe('StorageTimeout: upload failed');
    expect(classifyJobError(e)).toMatchObject({
      type: 'StorageTimeout',
      retryable: true,
      dependency: 'storage',
    });
  });

  it('lỗi kết nối → DependencyUnavailable (retryable), timeout → retryable, validation → không retry', () => {
    const conn = Object.assign(new Error('connect ECONNREFUSED mysql:3306'), {
      code: 'ECONNREFUSED',
    });
    expect(classifyJobError(conn)).toMatchObject({
      type: 'DependencyUnavailable',
      retryable: true,
      dependency: 'database',
    });
    expect(classifyJobError(new Error('operation timed out'))).toMatchObject({
      type: 'Timeout',
      retryable: true,
    });
    const v = Object.assign(new Error('bad'), { name: 'ValidationError' });
    expect(classifyJobError(v)).toMatchObject({ type: 'ValidationError', retryable: false });
    expect(classifyJobError(new Error('weird'))).toMatchObject({
      type: 'UnhandledException',
      retryable: null,
    });
  });

  it('dependencyOf chỉ khi có từ khoá rõ ràng', () => {
    expect(dependencyOf('S3 bucket not reachable')).toBe('storage');
    expect(dependencyOf('RedisTimeout')).toBe('cache');
    expect(dependencyOf('something else')).toBeNull();
  });

  it('toUnrecoverable giữ message Type: … và stack gốc', () => {
    const err = new JobError('InvalidReport', 'missing id', { retryable: false });
    const u = toUnrecoverable(err, classifyJobError(err));
    expect(u).toBeInstanceOf(UnrecoverableError);
    expect(u.message).toBe('InvalidReport: missing id');
    expect(u.stack).toBe(err.stack);
  });
});
