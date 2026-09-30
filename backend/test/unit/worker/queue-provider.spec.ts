import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import type { Job } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { serializeMessage, type QueueRegistry } from '@packages/messaging/index.js';
import {
  BullMqQueueProvider,
  QueueOperationError,
  QueueOperationsService,
  queueKeys,
  type QueueMonitoringService,
} from '@packages/queue/index.js';

type State = 'waiting' | 'prioritized' | 'active' | 'delayed' | 'completed' | 'failed';
interface FakeJob {
  id: string;
  name: string;
  queueName: string;
  data: unknown;
  opts: Record<string, unknown>;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  attemptsMade: number;
  attemptsStarted: number;
  failedReason: string;
  delay: number;
  processedBy?: string;
  stalledCounter: number;
  repeatJobKey?: string;
  state: State;
}

/** Queue BullMQ giả trong bộ nhớ — đủ các hàm queue provider dùng. */
function fakeQueue(name: string, jobs: FakeJob[]) {
  let paused = false;
  const toJob = (j: FakeJob) =>
    ({
      ...j,
      retry: async () => {
        if (j.state !== 'failed') throw new Error('not failed');
        j.state = 'waiting';
      },
    }) as unknown as Job;
  return {
    name,
    keys: { delayed: `${name}:delayed` },
    getJobCounts: async () =>
      Object.fromEntries(
        (['waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'] as const).map(
          (s) => [s, jobs.filter((j) => j.state === s).length],
        ),
      ),
    isPaused: async () => paused,
    pause: async () => {
      paused = true;
    },
    resume: async () => {
      paused = false;
    },
    drain: async (delayed: boolean) => {
      for (const j of [...jobs])
        if (j.state === 'waiting' || (delayed && j.state === 'delayed'))
          jobs.splice(jobs.indexOf(j), 1);
    },
    getWorkers: async () => [
      { rawname: `bull:${name}:w:worker`, addr: '10.0.0.4:5000', age: '60', idle: '1' },
    ],
    getJobs: async (types: State[], start: number, end: number, asc: boolean) =>
      jobs
        .filter((j) => types.includes(j.state))
        .sort((a, b) => (asc ? a.timestamp - b.timestamp : b.timestamp - a.timestamp))
        .slice(start, end + 1)
        .map(toJob),
    getBackend: () => ({
      client: Promise.resolve({
        ping: async () => 'PONG',
        pipeline: (cmds: string[][]) => ({
          exec: async () => cmds.map(() => [null, String(90_000 * 0x1000)]),
        }),
      }),
    }),
  };
}

function job(id: string, state: State, patch: Partial<FakeJob> = {}): FakeJob {
  const env = serializeMessage(
    'report.generate',
    { id },
    { producer: 'api', correlationId: `c-${id}` },
  );
  return {
    id,
    name: 'report.generate',
    queueName: 'reports',
    data: { ...env, id },
    opts: { attempts: 3 },
    timestamp: 1000,
    attemptsMade: 0,
    attemptsStarted: 0,
    failedReason: '',
    delay: 0,
    stalledCounter: 0,
    state,
    ...patch,
  };
}

function registry(queues: ReturnType<typeof fakeQueue>[]) {
  return {
    names: () => queues.map((q) => q.name),
    isKnown: (n: string) => queues.some((q) => q.name === n),
    get: (n: string) => queues.find((q) => q.name === n),
    withTimeout: <T>(p: Promise<T>) => p,
    jobOptions: () => ({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    }),
  } as unknown as QueueRegistry;
}

const ENV = ['OPS_QUEUE_DRAIN_ENABLED', 'OPS_QUEUE_RETRY_FAILED_MAX', 'OPS_QUEUE_PAUSE_ENABLED'];

describe('BullMqQueueProvider', () => {
  let redis: RedisService;
  let jobs: FakeJob[];
  let provider: BullMqQueueProvider;

  beforeEach(async () => {
    applyTestEnv();
    redis = new RedisService(new CoreConfigService(), mockRedisFactory);
    await redis.client.flushall();
    jobs = [
      job('w1', 'waiting', { timestamp: 500 }),
      job('w2', 'waiting', { timestamp: 800 }),
      job('a1', 'active', {
        processedOn: 2000,
        attemptsStarted: 1,
        processedBy: 'worker',
        stalledCounter: 1,
      }),
      job('r1', 'delayed', { attemptsMade: 1, failedReason: 'StorageTimeout: x' }),
      job('d1', 'delayed', { delay: 5000 }),
      job('s1', 'delayed', { repeatJobKey: 'cleanup::0 * * * *' }),
      job('f1', 'failed', { attemptsMade: 3, failedReason: 'SMTPError: 550', finishedOn: 3000 }),
      job('f2', 'failed', { attemptsMade: 3, failedReason: 'SMTPError: 421', finishedOn: 3500 }),
    ];
    provider = new BullMqQueueProvider(
      registry([fakeQueue('reports', jobs)]),
      redis,
      'redis:6379/0',
    );
  });

  afterAll(() => {
    for (const k of ENV) delete process.env[k];
  });

  it('snapshot queue: số job theo trạng thái, worker kết nối, job chờ lâu nhất', async () => {
    const [q] = await provider.queues();
    expect(q).toMatchObject({
      name: 'reports',
      counts: { waiting: 2, active: 1, delayed: 3, failed: 2 },
      paused: false,
      workers: [{ name: 'worker', addr: '10.0.0.4:5000', ageSec: 60, idleSec: 1 }],
      oldestWaitingAt: 500,
      oldestWaitingId: 'w1',
    });
    expect(provider.info()).toMatchObject({
      driver: 'bullmq',
      backend: 'Redis',
      endpoint: 'redis:6379/0',
    });
  });

  it('job: tách retrying khỏi delayed, lý do hẹn giờ, worker xử lý, stalled, thời điểm chạy', async () => {
    const list = await provider.jobs(null, ['retrying', 'delayed', 'active'], 50);
    const by = Object.fromEntries(list.map((j) => [j.id, j]));
    expect(by['r1']).toMatchObject({
      state: 'retrying',
      delayReason: 'retry',
      runAt: 90_000,
      error: 'StorageTimeout: x',
    });
    expect(by['d1']).toMatchObject({ state: 'delayed', delayReason: 'delay' });
    expect(by['s1']).toMatchObject({ state: 'delayed', delayReason: 'repeat' });
    expect(by['a1']).toMatchObject({
      state: 'active',
      processedBy: 'worker',
      stalledCount: 1,
      delayReason: null,
    });
    expect(by['a1']!.correlationId).toBe('c-a1');
    await expect(provider.jobs('nope', ['failed'], 10)).rejects.toBeInstanceOf(QueueOperationError);
  });

  it('pause/resume, retry job lỗi (cũ nhất trước), drain chỉ xoá job chờ', async () => {
    await provider.pause('reports');
    expect((await provider.queues())[0]!.paused).toBe(true);
    await provider.resume('reports');
    expect(await provider.retryFailed('reports', 1)).toBe(1);
    expect(jobs.find((j) => j.id === 'f1')!.state).toBe('waiting');
    expect(jobs.find((j) => j.id === 'f2')!.state).toBe('failed');
    await provider.drain('reports', false);
    expect(jobs.filter((j) => j.state === 'waiting')).toEqual([]);
    expect(jobs.filter((j) => j.state === 'delayed')).toHaveLength(3);
    expect(provider.defaults()).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delayMs: 1000 },
      removeOnComplete: 'count:1000',
      removeOnFail: 'count:1000',
    });
  });

  describe('QueueOperationsService', () => {
    const ctx = { ip: '10.0.0.x', actor: null };
    const ops = (connected = true) => {
      const monitoring = {
        provider,
        supports: () => true,
        usable: () => connected,
        invalidate: () => undefined,
      } as unknown as QueueMonitoringService;
      return new QueueOperationsService(monitoring, new CoreConfigService(), redis);
    };
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: unknown) => (e instanceof QueueOperationError ? e.code : String(e)),
      );

    it('pause/resume ghi audit + sự kiện; sai trạng thái bị từ chối', async () => {
      const s = ops();
      const rec = await s.pause('reports', ctx);
      expect(rec).toMatchObject({
        action: 'pause',
        target: 'reports',
        result: 'success',
        ip: '10.0.0.x',
      });
      expect(await code(s.pause('reports', ctx))).toBe('INVALID_STATE');
      await s.resume('reports', ctx);
      expect(await code(s.resume('reports', ctx))).toBe('INVALID_STATE');
      const keys = queueKeys(redis);
      const events = (await redis.client.lrange(keys.events(), 0, -1)).map(
        (r) => JSON.parse(r).type,
      );
      expect(events).toEqual(['queue_resumed', 'queue_paused']);
      expect(await redis.client.llen(keys.operations())).toBe(2);
    });

    it('retry job lỗi có giới hạn mỗi lần; queue lạ → NOT_FOUND; mất kết nối → UNAVAILABLE', async () => {
      process.env['OPS_QUEUE_RETRY_FAILED_MAX'] = '1';
      expect(await code(ops().retryFailed('reports', 2, ctx))).toBe('TOO_MANY');
      const r = await ops().retryFailed('reports', 1, ctx);
      expect(r).toMatchObject({ requested: 1, retried: 1 });
      expect(await code(ops().pause('nope', ctx))).toBe('NOT_FOUND');
      expect(await code(ops(false).pause('reports', ctx))).toBe('UNAVAILABLE');
      delete process.env['OPS_QUEUE_RETRY_FAILED_MAX'];
    });

    it('drain mặc định tắt; bật thì xoá job chờ và ghi audit', async () => {
      expect(await code(ops().drain('reports', false, ctx))).toBe('DRAIN_DISABLED');
      process.env['OPS_QUEUE_DRAIN_ENABLED'] = 'true';
      const rec = await ops().drain('reports', true, ctx);
      expect(rec).toMatchObject({ action: 'drain', detail: 'waiting=2, delayed=3' });
      expect(jobs.map((j) => j.state).sort()).toEqual(['active', 'failed', 'failed']);
      delete process.env['OPS_QUEUE_DRAIN_ENABLED'];
    });
  });
});
