import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import type { Job } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BullMqMonitoringProvider,
  MessageStateError,
  MessagingOperationError,
  MessagingOperationsService,
  messagingKeys,
  parseEnvelope,
  parseLifecycle,
  serializeMessage,
  statusOf,
  type MessagingConnectionService,
  type MessagingMonitoringService,
  type QueueRegistry,
} from '@packages/messaging/index.js';

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
  stacktrace: string[];
  delay: number;
  state: State;
  logs: string[];
}

/** Queue BullMQ giả trong bộ nhớ — đủ các hàm provider dùng. */
function fakeQueue(name: string, jobs: FakeJob[]) {
  const toJob = (j: FakeJob) =>
    ({
      ...j,
      getState: async () => j.state,
      promote: async () => {
        j.state = 'waiting';
      },
      retry: async (_s: string, opts: { resetAttemptsMade?: boolean }) => {
        j.state = 'waiting';
        if (opts.resetAttemptsMade) j.attemptsMade = 0;
      },
      remove: async () => {
        jobs.splice(jobs.indexOf(j), 1);
      },
      log: async (row: string) => j.logs.push(row),
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
    isPaused: async () => false,
    getWorkers: async () => [
      { name, rawname: `bull:x:w:worker`, addr: '1.2.3.4:5', age: '10', idle: '0' },
    ],
    getJobs: async (types: State[], start: number, end: number, asc: boolean) => {
      const list = jobs
        .filter((j) => types.includes(j.state))
        .sort((a, b) => (asc ? a.timestamp - b.timestamp : b.timestamp - a.timestamp));
      return list.slice(start, end + 1).map(toJob);
    },
    getJob: async (id: string) => {
      const j = jobs.find((x) => x.id === id);
      return j ? toJob(j) : undefined;
    },
    getJobLogs: async (id: string) => ({
      logs: jobs.find((x) => x.id === id)?.logs ?? [],
      count: 0,
    }),
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
    patch.name ?? 'user.created',
    { id, password: 'secret' },
    { producer: 'api', correlationId: `c-${id}` },
  );
  return {
    id,
    name: patch.name ?? 'user.created',
    queueName: 'system.events',
    data: { ...env, id },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    timestamp: 1000,
    attemptsMade: 0,
    attemptsStarted: 0,
    failedReason: '',
    stacktrace: [],
    delay: 0,
    state,
    logs: [],
    ...patch,
  };
}

function registry(queues: ReturnType<typeof fakeQueue>[]) {
  return {
    names: () => queues.map((q) => q.name),
    isKnown: (n: string) => queues.some((q) => q.name === n),
    get: (n: string) => queues.find((q) => q.name === n),
    withTimeout: <T>(p: Promise<T>) => p,
  } as unknown as QueueRegistry;
}

const ENV = ['OPS_MESSAGING_REPLAY_ENABLED', 'OPS_MESSAGING_RETRY_ENABLED'];

describe('BullMqMonitoringProvider', () => {
  let redis: RedisService;
  let jobs: FakeJob[];
  let provider: BullMqMonitoringProvider;

  beforeEach(async () => {
    applyTestEnv();
    redis = new RedisService(new CoreConfigService(), mockRedisFactory);
    await redis.client.flushall();
    jobs = [
      job('w1', 'waiting', { timestamp: 500 }),
      job('w2', 'waiting', { timestamp: 800, name: 'order.completed' }),
      job('r1', 'delayed', { attemptsMade: 1, failedReason: 'Timeout' }),
      job('s1', 'delayed', { attemptsMade: 0 }),
      job('d1', 'completed', { processedOn: 1200, finishedOn: 1250, attemptsMade: 0 }),
      job('f1', 'failed', {
        attemptsMade: 3,
        failedReason: 'StorageTimeout',
        finishedOn: 5000,
        logs: [
          JSON.stringify({ at: 2000, type: 'received', attempt: 1 }),
          'dòng log không phải JSON',
          JSON.stringify({ at: 1500, type: 'failed', attempt: 1, error: 'x' }),
        ],
      }),
    ];
    provider = new BullMqMonitoringProvider(
      registry([fakeQueue('system.events', jobs)]),
      redis,
      'localhost:6379/0',
    );
  });

  afterAll(() => {
    for (const k of ENV) delete process.env[k];
  });

  it('trạng thái messaging từ state BullMQ', () => {
    expect(statusOf('delayed', 1)).toBe('retrying');
    expect(statusOf('delayed', 0)).toBe('scheduled');
    expect(statusOf('failed', 3)).toBe('dead_letter');
    expect(statusOf('completed', 0)).toBe('delivered');
    expect(statusOf('prioritized', 0)).toBe('queued');
  });

  it('snapshot queue: số đếm, worker, message chờ lâu nhất', async () => {
    const [q] = await provider.queues();
    expect(q).toMatchObject({
      name: 'system.events',
      counts: { waiting: 2, delayed: 2, failed: 1, completed: 1 },
      oldestWaitingAt: 500,
    });
    expect(q!.workers).toEqual([{ name: 'worker', addr: '1.2.3.4:5', ageSec: 10, idleSec: 0 }]);
  });

  it('backlog theo channel (mẫu waiting)', async () => {
    const b = await provider.backlog(100);
    expect(b.truncated).toBe(false);
    expect(b.channels.sort((a, c) => a.channel.localeCompare(c.channel))).toEqual([
      { channel: 'order.completed', queue: 'system.events', waiting: 1, oldestAt: 800 },
      { channel: 'user.created', queue: 'system.events', waiting: 1, oldestAt: 500 },
    ]);
  });

  it('lọc message theo trạng thái / channel / ID / correlation ID', async () => {
    const all = await provider.listMessages(
      { queue: null, channel: null, status: null, producer: null, search: '' },
      50,
    );
    expect(all.messages).toHaveLength(6);
    const retrying = await provider.listMessages(
      { queue: null, channel: null, status: 'retrying', producer: null, search: '' },
      50,
    );
    expect(retrying.messages.map((m) => m.id)).toEqual(['r1']);
    expect(retrying.messages[0]!.nextAttemptAt).toBe(90_000);
    const byChannel = await provider.listMessages(
      { queue: null, channel: 'order.completed', status: null, producer: null, search: '' },
      50,
    );
    expect(byChannel.messages.map((m) => m.id)).toEqual(['w2']);
    const byId = await provider.listMessages(
      { queue: null, channel: null, status: null, producer: null, search: 'f1' },
      50,
    );
    expect(byId.messages.map((m) => m.id)).toEqual(['f1']);
    const byCorrelation = await provider.listMessages(
      { queue: null, channel: null, status: null, producer: null, search: 'c-d1' },
      50,
    );
    expect(byCorrelation.messages.map((m) => m.id)).toEqual(['d1']);
  });

  it('chi tiết: vòng đời sắp xếp theo thời gian, bỏ dòng log lạ', async () => {
    const d = await provider.message('f1');
    expect(d).toMatchObject({
      status: 'dead_letter',
      attempts: 3,
      maxAttempts: 3,
      error: 'StorageTimeout',
      producer: 'api',
    });
    expect(d!.lifecycle.map((e) => e.type)).toEqual(['failed', 'received']);
    expect(parseLifecycle(['{}', 'x'])).toEqual([]);
    expect(await provider.message('nope')).toBeNull();
  });

  it('retry chỉ cho message đang chờ retry; replay/discard chỉ cho dead letter', async () => {
    await expect(provider.retryNow('system.events', 'f1')).rejects.toBeInstanceOf(
      MessageStateError,
    );
    await provider.retryNow('system.events', 'r1');
    expect(jobs.find((j) => j.id === 'r1')!.state).toBe('waiting');
    await expect(provider.replay('system.events', 'w1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      state: 'waiting',
    });
    await provider.replay('system.events', 'f1');
    const f1 = jobs.find((j) => j.id === 'f1')!;
    expect(f1).toMatchObject({ state: 'waiting', attemptsMade: 0 });
    expect(JSON.parse(f1.logs.at(-1)!)).toMatchObject({ type: 'replayed' });
    await expect(provider.discard('unknown.queue', 'f1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('parseEnvelope kiểm tra cấu trúc', () => {
    expect(
      parseEnvelope({ id: 'a', topic: 't', payload: null, timestamp: new Date().toISOString() }),
    ).not.toBeNull();
    expect(parseEnvelope({ id: 'a', topic: 't', timestamp: 'x', payload: 1 })).toBeNull();
    expect(parseEnvelope('string')).toBeNull();
  });

  describe('MessagingOperationsService', () => {
    const build = (env: Record<string, string> = {}, usable = true) => {
      applyTestEnv(env);
      const config = new CoreConfigService();
      const monitoring = {
        provider,
        supports: () => true,
        usable: () => usable,
        invalidate: () => undefined,
      } as unknown as MessagingMonitoringService;
      const connection = {
        getStatus: () => ({ state: 'connected' }),
      } as unknown as MessagingConnectionService;
      return new MessagingOperationsService(connection, monitoring, config, redis);
    };
    const ctx = { ip: '10.0.0.x', actor: null };

    it('replay: audit + sự kiện; sai trạng thái → INVALID_STATE; không tồn tại → NOT_FOUND', async () => {
      const ops = build();
      const rec = await ops.replayDeadLetter('system.events', 'f1', ctx);
      expect(rec).toMatchObject({
        action: 'replay',
        target: 'system.events/f1',
        result: 'success',
      });
      await expect(ops.replayDeadLetter('system.events', 'w1', ctx)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      await expect(ops.discardDeadLetter('system.events', 'zzz', ctx)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const k = messagingKeys(redis);
      expect(await redis.client.llen(k.operations())).toBe(1);
      expect(JSON.parse((await redis.client.lindex(k.events(), 0))!)).toMatchObject({
        type: 'message_replayed',
      });
    });

    it('thao tác bị tắt bằng env / broker mất kết nối', async () => {
      await expect(
        build({ OPS_MESSAGING_REPLAY_ENABLED: 'false' }).replayDeadLetter(
          'system.events',
          'f1',
          ctx,
        ),
      ).rejects.toMatchObject({
        code: 'REPLAY_DISABLED',
      });
      await expect(
        build({}, false).retryMessage('system.events', 'r1', ctx),
      ).rejects.toBeInstanceOf(MessagingOperationError);
    });

    it('payload được che field nhạy cảm và ghi audit', async () => {
      const ops = build();
      const res = await ops.payload('w1', null, ctx);
      expect(res.payload).toMatchObject({ id: 'w1', password: '[REDACTED]' });
      expect(res.redacted).toBe(true);
      expect(
        JSON.parse((await redis.client.lindex(messagingKeys(redis).operations(), 0))!),
      ).toMatchObject({
        action: 'payload',
        target: 'system.events/w1',
      });
    });
  });
});
