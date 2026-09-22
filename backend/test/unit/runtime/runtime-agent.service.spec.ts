import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import {
  ResourceSampler,
  RuntimeAgentService,
  runtimeKeys,
  type RuntimeCommand,
  type RuntimeContributor,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('RuntimeAgentService', () => {
  let redis: RedisService;
  let agent: RuntimeAgentService;
  let contributor: jest.Mocked<RuntimeContributor>;
  let keys: ReturnType<typeof runtimeKeys>;

  const send = async (command: Omit<RuntimeCommand, 'requestedAt' | 'runtime'>) => {
    await redis.client.publish(
      keys.commandChannel('worker'),
      JSON.stringify({ ...command, runtime: 'worker', requestedAt: new Date().toISOString() }),
    );
    await flush();
  };

  beforeEach(async () => {
    applyTestEnv({ RUNTIME_SUPERVISOR: 'docker' });
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    keys = runtimeKeys(redis);
    contributor = {
      describe: jest.fn(() => ({
        type: 'queue-consumer',
        framework: 'NestJS',
        entrypoint: 'x',
        sourcePath: 'y',
      })),
      collectMetrics: jest.fn(async () => ({ activeJobs: 2 })),
      pause: jest.fn(async () => undefined),
      resume: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<RuntimeContributor>;
    agent = new RuntimeAgentService(
      { id: 'worker', kind: 'long-running' },
      redis,
      config,
      new ResourceSampler(),
      new MetricRecorder(config, redis, 'worker@test:1'),
    );
    agent.registerContributor(contributor);
    await agent.onApplicationBootstrap();
  });

  afterEach(async () => {
    await agent.beforeApplicationShutdown();
    await redis.onApplicationShutdown();
  });

  it('publishes a heartbeat with a TTL, real resources and contributor metrics', async () => {
    const raw = await redis.client.get(keys.heartbeat('worker'));
    const hb = JSON.parse(raw!) as RuntimeHeartbeat;
    expect(hb.state).toBe('running');
    expect(hb.metrics).toEqual({ activeJobs: 2 });
    expect(hb.resources.rssMb).toBeGreaterThan(0);
    expect(hb.capabilities).toEqual({ pause: true, restart: true });
    expect(await redis.client.ttl(keys.heartbeat('worker'))).toBeGreaterThan(0);
  });

  it('records a started event and increments the start counter', async () => {
    const events = await redis.client.xrevrange(keys.events(), '+', '-');
    expect(events.some(([, fields]) => fields.includes('started'))).toBe(true);
    expect(await redis.client.get(keys.starts('worker'))).toBe('1');
  });

  it('pauses and resumes on command, persisting the paused flag', async () => {
    await send({ id: 'c1', action: 'pause' });
    expect(contributor.pause).toHaveBeenCalled();
    expect(await redis.client.exists(keys.paused('worker'))).toBe(1);
    expect(JSON.parse((await redis.client.get(keys.commandResult('c1')))!)).toMatchObject({
      status: 'completed',
    });
    expect(
      (JSON.parse((await redis.client.get(keys.heartbeat('worker')))!) as RuntimeHeartbeat).state,
    ).toBe('paused');

    await send({ id: 'c2', action: 'resume' });
    expect(contributor.resume).toHaveBeenCalled();
    expect(await redis.client.exists(keys.paused('worker'))).toBe(0);
  });

  it('force restart records the stop and exits with code 1', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await send({ id: 'c3', action: 'restart', mode: 'force' });
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse((await redis.client.get(keys.commandResult('c3')))!)).toMatchObject({
      status: 'accepted',
    });
    const events = await redis.client.xrevrange(keys.events(), '+', '-');
    const types = events.map(([, fields]) => fields[fields.indexOf('type') + 1]);
    expect(types.slice(0, 2)).toEqual(['stopped', 'restart_requested']);
    expect(await redis.client.exists(keys.heartbeat('worker'))).toBe(0);
    exit.mockRestore();
  });
});
