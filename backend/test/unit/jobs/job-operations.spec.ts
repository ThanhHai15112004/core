import { describe, it, expect, beforeEach } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  jobKeys,
  type ConsumerRegistration,
  type MessagingMonitoringService,
} from '@packages/messaging/index.js';
import {
  JobOperationError,
  JobOperationsService,
  type CancelledJobRecord,
  type JobMonitoringService,
  type JobRecord,
  type JobStatus,
} from '@packages/queue/index.js';

const rec = (id: string, status: JobStatus, over: Partial<JobRecord> = {}): JobRecord =>
  ({
    id,
    queue: 'system.events',
    type: 'report.generate',
    status,
    state: status === 'waiting' ? 'waiting' : status === 'active' ? 'active' : 'failed',
    priority: 0,
    priorityLevel: 'normal',
    createdAt: Date.now() - 1000,
    availableAt: null,
    startedAt: null,
    finishedAt: null,
    worker: null,
    attempts: status === 'failed' ? 3 : 0,
    maxAttempts: 3,
    progress: null,
    source: { kind: 'system', id: null, name: null, detail: null },
    producer: null,
    correlationId: null,
    requestId: null,
    idempotencyKey: null,
    index: {},
    schema: null,
    payloadSize: 1,
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
  }) as JobRecord;

describe('JobOperationsService', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let jobs: Map<string, JobRecord>;
  let tombstones: CancelledJobRecord[];
  let retried: string[];
  let consumers: ConsumerRegistration[];
  let ops: JobOperationsService;

  beforeEach(async () => {
    applyTestEnv();
    config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    jobs = new Map();
    tombstones = [];
    retried = [];
    consumers = [];
    const monitoring = {
      keys: jobKeys(redis),
      usable: () => true,
      get: async (id: string) => jobs.get(id) ?? null,
      detail: async (id: string) =>
        jobs.has(id)
          ? { record: jobs.get(id)!, payload: { password: 'x', ok: 1 }, malformed: false }
          : null,
      saveTombstone: async (t: CancelledJobRecord) => void tombstones.push(t),
      removeTombstone: async () => undefined,
      provider: {
        isKnown: (q: string) => q === 'system.events',
        retry: async (_q: string, id: string) => void retried.push(id),
        removeQueued: async (_q: string, id: string) => jobs.get(id)?.status === 'waiting',
        remove: async () => undefined,
        log: async () => undefined,
      },
    } as unknown as JobMonitoringService;
    const messaging = { consumers: async () => consumers } as unknown as MessagingMonitoringService;
    ops = new JobOperationsService(monitoring, messaging, config, redis);
  });

  const ctx = { ip: '10.0.0.x', actor: null };
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      return err instanceof JobOperationError ? err.code : String(err);
    }
  };

  it('retry: chỉ job lỗi, từ chối lỗi không retry được; ghi audit + sự kiện', async () => {
    jobs.set('f1', rec('f1', 'failed'));
    jobs.set('f2', rec('f2', 'failed', { retryable: false, errorType: 'ValidationError' }));
    jobs.set('w1', rec('w1', 'waiting'));
    const r = await ops.retry('system.events', 'f1', ctx);
    expect(r.record).toMatchObject({
      action: 'retry',
      target: 'system.events|f1',
      result: 'success',
    });
    expect(retried).toEqual(['f1']);
    expect(await code(ops.retry('system.events', 'f2', ctx))).toBe('NON_RETRYABLE');
    expect(await code(ops.retry('system.events', 'w1', ctx))).toBe('INVALID_STATE');
    expect(await code(ops.retry('system.events', 'nope', ctx))).toBe('NOT_FOUND');
    const events = await redis.client.lrange(jobKeys(redis).events(), 0, -1);
    expect(events.map((e) => JSON.parse(e).type)).toEqual(['job_retried']);
  });

  it('bulk retry: giới hạn số job, bỏ qua job không hợp lệ kèm lý do', async () => {
    jobs.set('f1', rec('f1', 'failed'));
    jobs.set('f2', rec('f2', 'failed', { retryable: false }));
    jobs.set('a1', rec('a1', 'active'));
    const r = await ops.bulkRetry(
      ['f1', 'f2', 'a1', 'zz'].map((id) => ({ queue: 'system.events', id })),
      ctx,
    );
    expect(r.items.map((i) => [i.id, i.result, i.reason])).toEqual([
      ['f1', 'retried', null],
      ['f2', 'skipped', 'NON_RETRYABLE'],
      ['a1', 'skipped', 'STATE_ACTIVE'],
      ['zz', 'skipped', 'NOT_FOUND'],
    ]);
    const many = Array.from({ length: config.jobs.bulkRetryMax + 1 }, (_, i) => ({
      queue: 'system.events',
      id: `x${i}`,
    }));
    expect(await code(ops.bulkRetry(many, ctx))).toBe('TOO_MANY');
  });

  it('cancel job đang chờ: xoá khỏi queue + giữ bản ghi Cancelled', async () => {
    jobs.set('w1', rec('w1', 'waiting'));
    const r = await ops.cancel('system.events', 'w1', ' no longer needed ', ctx);
    expect(r).toMatchObject({ mode: 'removed', delivered: true });
    expect(tombstones[0]).toMatchObject({
      reason: 'no longer needed',
      record: { id: 'w1', status: 'cancelled' },
    });
  });

  it('cancel job đang chạy: processor không hỗ trợ huỷ → NOT_CANCELLABLE; có hỗ trợ nhưng không worker nhận → NO_WORKER', async () => {
    jobs.set('a1', rec('a1', 'active'));
    consumers = [
      { consumer: 'P', queue: 'system.events', cancellable: false } as ConsumerRegistration,
    ];
    expect(await code(ops.cancel('system.events', 'a1', null, ctx))).toBe('NOT_CANCELLABLE');
    consumers = [
      { consumer: 'P', queue: 'system.events', cancellable: true } as ConsumerRegistration,
    ];
    // ioredis-mock: không có subscriber → publish trả 0.
    expect(await code(ops.cancel('system.events', 'a1', null, ctx))).toBe('NO_WORKER');
    jobs.set('c1', rec('c1', 'completed'));
    expect(await code(ops.cancel('system.events', 'c1', null, ctx))).toBe('INVALID_STATE');
  });

  it('remove mặc định tắt; payload được redact và ghi audit', async () => {
    jobs.set('c1', rec('c1', 'completed'));
    expect(await code(ops.remove('system.events', 'c1', ctx))).toBe('REMOVE_DISABLED');
    const p = await ops.payload('system.events', 'c1', ctx);
    expect(JSON.stringify(p.payload)).not.toContain('"x"');
    const audit = await redis.client.lrange(jobKeys(redis).operations(), 0, -1);
    expect(JSON.parse(audit[0]!)).toMatchObject({ action: 'payload', target: 'system.events|c1' });
  });
});
