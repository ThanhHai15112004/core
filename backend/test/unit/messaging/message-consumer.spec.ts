import { describe, it, expect, beforeEach } from '@jest/globals';
import { UnrecoverableError, type Job } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { MetricRecorder } from '@packages/telemetry/index.js';
import {
  MessageConsumerRunner,
  messagingKeys,
  nextRetryDelay,
  serializeMessage,
  type LifecycleEntry,
  type MessagingErrorRecord,
  type MessagingEventRecord,
} from '@packages/messaging/index.js';

/** MetricRecorder giả: đếm lại các lần ghi để kiểm tra. */
function fakeRecorder() {
  const counts = new Map<string, number>();
  const timings: string[] = [];
  const recorder = {
    instance: 'worker@test',
    count: (m: string, by = 1) => counts.set(m, (counts.get(m) ?? 0) + by),
    timing: (m: string) => timings.push(m),
    gauge: () => undefined,
  };
  return { recorder: recorder as unknown as MetricRecorder, counts, timings };
}

function fakeJob(data: unknown, patch: Partial<Record<string, unknown>> = {}) {
  const logs: string[] = [];
  const job = {
    id: 'msg-1',
    name: 'user.created',
    queueName: 'system.events',
    data,
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    attemptsStarted: 1,
    attemptsMade: 0,
    log: async (row: string) => logs.push(row),
    ...patch,
  };
  return { job: job as unknown as Job, logs };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
const types = (logs: string[]) => logs.map((l) => (JSON.parse(l) as LifecycleEntry).type);

describe('MessageConsumerRunner', () => {
  let redis: RedisService;
  let runner: MessageConsumerRunner;
  let m: ReturnType<typeof fakeRecorder>;

  beforeEach(async () => {
    applyTestEnv();
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory, { id: 'worker' });
    await redis.client.flushall();
    m = fakeRecorder();
    runner = new MessageConsumerRunner(new RequestContextService(), config, m.recorder, redis, {
      id: 'worker',
    } as never);
    runner.register({
      consumer: 'UserConsumer',
      queue: 'system.events',
      concurrency: 2,
      idempotent: true,
    });
  });

  it('xử lý thành công: đếm theo channel, ghi vòng đời, chạy trong correlation ID của producer', async () => {
    const env = serializeMessage(
      'user.created',
      { id: 1 },
      { producer: 'api', correlationId: 'corr-1' },
    );
    const { job, logs } = fakeJob(env);
    let seen: string | undefined;
    await runner.process('UserConsumer', job, async () => {
      seen = RequestContextService.currentCorrelationId();
    });
    await flush();
    expect(seen).toBe('corr-1');
    expect(m.counts.get('msg.consumed')).toBe(1);
    expect(m.counts.get('msg.ch.user.created.con')).toBe(1);
    expect(m.timings).toEqual(['msg.process', 'msg.ch.user.created.proc']);
    expect(types(logs)).toEqual(['received', 'completed']);
  });

  it('lỗi còn lượt thử → retry_scheduled với độ trễ backoff; không vào dead letter', async () => {
    const { job, logs } = fakeJob(serializeMessage('user.created', {}), {
      attemptsStarted: 2,
      attemptsMade: 1,
    });
    await expect(
      runner.process('UserConsumer', job, async () => {
        throw new Error('Database timeout');
      }),
    ).rejects.toThrow('Database timeout');
    await flush();
    expect(m.counts.get('msg.retry')).toBe(1);
    expect(m.counts.get('msg.dlq')).toBeUndefined();
    expect(m.counts.get('msg.err.timeout')).toBe(1);
    const rows = logs.map((l) => JSON.parse(l) as LifecycleEntry);
    expect(rows.map((r) => r.type)).toEqual(['received', 'failed', 'retry_scheduled']);
    expect(rows[2]!.delayMs).toBe(2000);
    const [err] = (await redis.client.lrange(messagingKeys(redis).errors(), 0, -1)).map(
      (r) => JSON.parse(r) as MessagingErrorRecord,
    );
    expect(err).toMatchObject({
      stage: 'consume',
      attempt: 2,
      maxAttempts: 3,
      final: false,
      consumer: 'UserConsumer',
    });
  });

  it('hết lượt thử → dead letter + sự kiện', async () => {
    const { job, logs } = fakeJob(serializeMessage('user.created', {}), {
      attemptsStarted: 3,
      attemptsMade: 2,
    });
    await expect(
      runner.process('UserConsumer', job, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await flush();
    expect(m.counts.get('msg.dlq')).toBe(1);
    expect(types(logs)).toEqual(['received', 'failed', 'dead_lettered']);
    const events = (await redis.client.lrange(messagingKeys(redis).events(), 0, -1)).map(
      (r) => JSON.parse(r) as MessagingEventRecord,
    );
    expect(events.map((e) => e.type)).toEqual(['dead_lettered', 'consumer_started']);
  });

  it('envelope hỏng → lỗi deserialize, không retry (UnrecoverableError), handler không chạy', async () => {
    const { job } = fakeJob({ hello: 'world' });
    let called = false;
    await expect(
      runner.process('UserConsumer', job, async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(called).toBe(false);
    expect(m.counts.get('msg.err.deserialize')).toBe(1);
    expect(m.counts.get('msg.dlq')).toBe(1);
  });

  it('báo consumer đang chạy lên Redis; pause được phản ánh; unregister xoá', async () => {
    runner.setPaused('UserConsumer', true);
    await flush();
    const key = messagingKeys(redis).consumers('worker@test');
    expect(JSON.parse((await redis.client.get(key))!)).toEqual([
      expect.objectContaining({
        consumer: 'UserConsumer',
        paused: true,
        idempotent: true,
        concurrency: 2,
      }),
    ]);
    await runner.unregister('UserConsumer');
    expect(await redis.client.get(key)).toBeNull();
  });

  it('nextRetryDelay theo backoff', () => {
    const j = (backoff: unknown) => ({ opts: { backoff } }) as unknown as Job;
    expect(nextRetryDelay(j({ type: 'exponential', delay: 500 }), 3)).toBe(2000);
    expect(nextRetryDelay(j({ type: 'fixed', delay: 700 }), 3)).toBe(700);
    expect(nextRetryDelay(j(undefined), 1)).toBe(0);
    expect(nextRetryDelay(j(250), 2)).toBe(250);
  });
});
