import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { RUNTIMES_ROUTES } from '@modules/runtimes/index.js';
import { RedisService } from '@packages/redis/index.js';
import { runtimeKeys, type RuntimeHeartbeat } from '@packages/runtime/index.js';

const workerHeartbeat = (overrides: Partial<RuntimeHeartbeat> = {}): RuntimeHeartbeat => ({
  id: 'worker',
  instance: 'test:1',
  state: 'running',
  at: new Date().toISOString(),
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  uptimeSec: 60,
  supervisor: 'docker',
  environment: 'test',
  process: {
    pid: 4242,
    ppid: 1,
    user: 'node',
    hostname: 'c1',
    platform: 'linux',
    arch: 'x64',
    nodeVersion: 'v22',
    execArgv: [],
  },
  resources: {
    cpuPercent: 12,
    rssMb: 120,
    heapUsedMb: 40,
    heapTotalMb: 60,
    externalMb: 2,
    memoryLimitMb: 512,
    memoryLimitSource: 'cgroup',
    memoryPercent: 23.4,
    eventLoopMeanMs: 1,
    eventLoopP99Ms: 3,
    gcPauseMs: 0,
    gcCount: 0,
    activeHandles: 5,
  },
  metrics: { activeJobs: 2, waitingJobs: 7 },
  details: {},
  issues: [],
  alerts: [],
  descriptor: {
    type: 'queue-consumer',
    framework: 'NestJS',
    entrypoint: 'apps/worker/main.ts',
    sourcePath: 'backend/src/apps/worker/',
  },
  capabilities: { pause: true, restart: true },
  startCount: 3,
  ...overrides,
});

/* Response JSON được kiểm tra động theo từng test. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Envelope {
  data: Json;
  error?: { code: string; message: string };
}

describe('Feature: Runtimes API (/ops/runtimes)', () => {
  let context: TestAppContext;
  let redis: RedisService;
  const en = { 'accept-language': 'en' };

  const get = async (url: string) => {
    const res = await context.app.inject({ method: 'GET', url, headers: en });
    return {
      status: res.statusCode,
      body: JSON.parse(res.payload) as Envelope,
    };
  };
  const post = async (url: string, payload?: object) => {
    const res = await context.app.inject({
      method: 'POST',
      url,
      headers: en,
      ...(payload ? { payload } : {}),
    });
    return {
      status: res.statusCode,
      body: JSON.parse(res.payload) as Envelope,
    };
  };

  beforeAll(async () => {
    context = await createTestApp();
    redis = context.app.get(RedisService);
  });

  afterAll(async () => {
    await context?.close();
  });

  it('lists the 3 long-running runtimes, the API reporting itself', async () => {
    const { status, body } = await get(RUNTIMES_ROUTES.buildListPath());
    expect(status).toBe(200);
    expect(body.data.telemetry.available).toBe(true);
    expect(body.data.runtimes.map((r: { id: string }) => r.id)).toEqual([
      'api',
      'worker',
      'scheduler',
    ]);

    const api = body.data.runtimes[0];
    expect(api.pid).toBe(process.pid);
    expect(api.actions.stop).toEqual({
      allowed: false,
      reason: expect.stringContaining('cannot be stopped'),
    });

    const worker = body.data.runtimes[1];
    expect(worker.status).toBe('unknown');
    expect(worker.reasons[0].message).toBe(
      'No heartbeat has ever been received from this runtime.',
    );
  });

  it('returns detail for a seeded worker heartbeat', async () => {
    await redis.client.set(
      runtimeKeys(redis).heartbeat('worker'),
      JSON.stringify(workerHeartbeat()),
      'EX',
      30,
    );
    const { status, body } = await get(RUNTIMES_ROUTES.buildDetailPath('worker'));
    expect(status).toBe(200);
    expect(body.data.status).toBe('healthy');
    expect(body.data.pid).toBe(4242);
    expect(body.data.restartCount).toBe(0);
    expect(body.data.metrics).toEqual({ activeJobs: 2, waitingJobs: 7 });
    expect(body.data.actions.stop.allowed).toBe(true);
    expect(body.data.actions.start.allowed).toBe(false);
  });

  it('returns 404 for an unknown runtime', async () => {
    const { status, body } = await get(RUNTIMES_ROUTES.buildDetailPath('nope'));
    expect(status).toBe(404);
    expect(body.error?.message).toBe('Runtime [nope] does not exist.');
  });

  it('requires typing STOP to stop a runtime', async () => {
    const { status, body } = await post(RUNTIMES_ROUTES.buildActionPath('worker', 'stop'), {
      confirm: 'stop',
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('refuses to stop the API', async () => {
    const { status, body } = await post(RUNTIMES_ROUTES.buildActionPath('api', 'stop'), {
      confirm: 'STOP',
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('RUNTIME_ACTION_NOT_ALLOWED');
  });

  it('refuses to start a runtime that is running', async () => {
    const { status } = await post(RUNTIMES_ROUTES.buildActionPath('worker', 'start'));
    expect(status).toBe(409);
  });

  it('dispatches a stop command and reports it failed when no process is listening', async () => {
    const { status, body } = await post(RUNTIMES_ROUTES.buildActionPath('worker', 'stop'), {
      confirm: 'STOP',
    });
    expect(status).toBe(202);
    expect(body.data).toMatchObject({ runtime: 'worker', action: 'pause', status: 'failed' });

    const command = await get(RUNTIMES_ROUTES.buildCommandPath(body.data.id));
    expect(command.body.data.message).toBe(
      'The runtime did not receive the command (no process is listening).',
    );
  });

  it('lists runtime events including the API start', async () => {
    const { body } = await get(`${RUNTIMES_ROUTES.buildEventsPath()}?runtime=api`);
    expect(
      body.data.some(
        (e: { type: string; message: string }) =>
          e.type === 'started' && e.message === 'API Gateway started',
      ),
    ).toBe(true);
  });

  it('validates the metrics range', async () => {
    expect((await get(`${RUNTIMES_ROUTES.buildMetricsAllPath()}?range=2h`)).status).toBe(400);
    const { body } = await get(`${RUNTIMES_ROUTES.buildMetricsAllPath()}?range=1h`);
    expect(Object.keys(body.data)).toEqual(['api', 'worker', 'scheduler']);
  });
});
