import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { AUTOSCALING_SETTING_KEYS, RUNTIMES_ROUTES } from '@modules/runtimes/index.js';
import { SettingRegistryService } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  RUNTIME_CPU_PERCENT_METRIC,
  RUNTIME_MEMORY_PERCENT_METRIC,
  runtimeKeys,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Envelope {
  data: Json;
  error?: { code: string; message: string };
}

const makeHeartbeat = (
  id: 'api' | 'worker',
  instance: string,
  overrides: Partial<RuntimeHeartbeat> = {},
): RuntimeHeartbeat => ({
  id,
  instance,
  state: 'running',
  at: new Date().toISOString(),
  startedAt: new Date(Date.now() - 120_000).toISOString(),
  uptimeSec: 120,
  supervisor: 'docker',
  environment: 'test',
  process: {
    pid: 1001,
    ppid: 1,
    user: 'node',
    hostname: instance,
    platform: 'linux',
    arch: 'x64',
    nodeVersion: 'v22',
    execArgv: [],
  },
  resources: {
    cpuPercent: 55,
    rssMb: 180,
    heapUsedMb: 70,
    heapTotalMb: 100,
    externalMb: 4,
    memoryLimitMb: 512,
    memoryLimitSource: 'cgroup',
    memoryPercent: 35.2,
    eventLoopMeanMs: 1.5,
    eventLoopP99Ms: 4.2,
    gcPauseMs: 0,
    gcCount: 0,
    gcMaxPauseMs: 0,
    activeHandles: 12,
  },
  metrics: id === 'api' ? { inFlightRequests: 15 } : { totalBacklog: 120, activeJobs: 4 },
  details: {},
  issues: [],
  alerts: [],
  descriptor: {
    type: id === 'api' ? 'http' : 'queue-consumer',
    framework: 'NestJS',
    entrypoint: id === 'api' ? 'apps/api/main.ts' : 'apps/worker/main.ts',
    sourcePath: `backend/src/apps/${id}/`,
  },
  capabilities: { pause: id === 'worker' },
  startCount: 1,
  ...overrides,
});

describe('Feature: Autoscaling Metrics & Runtimes API (Phase 13.2)', () => {
  let context: TestAppContext;
  let redis: RedisService;
  const en = { 'accept-language': 'en' };

  const get = async (url: string) => {
    const res = await context.app.inject({ method: 'GET', url, headers: en });
    return { status: res.statusCode, body: JSON.parse(res.payload) as Envelope };
  };

  const post = async (url: string, payload: object) => {
    const res = await context.app.inject({ method: 'POST', url, headers: en, payload });
    return { status: res.statusCode, body: JSON.parse(res.payload) as Envelope };
  };

  beforeAll(async () => {
    context = await createTestApp();
    redis = context.app.get(RedisService);
  });

  afterAll(async () => {
    await context?.close();
  });

  it('exposes CPU, RAM, http_requests_in_flight and queue backlog gauges on /metrics', async () => {
    await context.app.inject({ method: 'GET', url: '/health/live' });
    const res = await context.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.body;

    expect(body).toContain(RUNTIME_CPU_PERCENT_METRIC);
    expect(body).toContain(RUNTIME_MEMORY_PERCENT_METRIC);
    expect(body).toContain('http_requests_in_flight');
    expect(body).toContain('core_queue_backlog_total');
    // Sau khi request xong, http_requests_in_flight trở về 0 (không tự đếm /metrics).
    expect(body).toMatch(/http_requests_in_flight\{[^}]*\}\s+0(\n|$)/);
  });

  it('GET /ops/runtimes/autoscaling aggregates multi-instance heartbeats, backlog and DB impact', async () => {
    const keys = runtimeKeys(redis);
    const api1 = makeHeartbeat('api', 'api-pod-1', { metrics: { inFlightRequests: 40 } });
    const api2 = makeHeartbeat('api', 'api-pod-2', { metrics: { inFlightRequests: 30 } });
    const worker1 = makeHeartbeat('worker', 'worker-pod-1', { metrics: { totalBacklog: 160 } });

    await redis.client.del(keys.instanceIndex('api'), keys.instanceIndex('worker'));
    await redis.client.sadd(keys.instanceIndex('api'), 'api-pod-1', 'api-pod-2');
    await redis.client.set(
      keys.instanceHeartbeat('api', 'api-pod-1'),
      JSON.stringify(api1),
      'EX',
      60,
    );
    await redis.client.set(
      keys.instanceHeartbeat('api', 'api-pod-2'),
      JSON.stringify(api2),
      'EX',
      60,
    );
    await redis.client.sadd(keys.instanceIndex('worker'), 'worker-pod-1');
    await redis.client.set(
      keys.instanceHeartbeat('worker', 'worker-pod-1'),
      JSON.stringify(worker1),
      'EX',
      60,
    );

    const { status, body } = await get(RUNTIMES_ROUTES.buildAutoscalingPath());
    expect(status).toBe(200);
    expect(body.data.enabled).toBe(true);
    expect(body.data.workloads.api.activeInstances).toBe(2);
    expect(body.data.workloads.api.metrics.inFlightRequests).toBe(70);
    expect(body.data.workloads.worker.activeInstances).toBe(1);
    expect(body.data.databaseImpact.perInstancePoolLimit).toBeGreaterThan(0);
    expect(body.data.databaseImpact.maxConnectionsBudget).toBeGreaterThan(0);
    expect(Array.isArray(body.data.publishedMetrics)).toBe(true);
    expect(
      body.data.publishedMetrics.some(
        (m: { name: string }) => m.name === 'http_requests_in_flight',
      ),
    ).toBe(true);
  });

  it('POST /ops/runtimes/autoscaling/simulate validates payload and enforces min/max & cooldown', async () => {
    const invalid = await post(RUNTIMES_ROUTES.buildAutoscalingSimulatePath(), {
      target: 'unknown',
      currentReplicas: 1,
      signals: {},
    });
    expect(invalid.status).toBe(400);

    const nowMs = 5_000_000;
    const spike = await post(RUNTIMES_ROUTES.buildAutoscalingSimulatePath(), {
      target: 'api',
      currentReplicas: 1,
      signals: { cpuPercent: 85, memoryPercent: 60, inFlightRequests: 400 },
      policyOverrides: {
        minReplicas: 1,
        maxReplicas: 4,
        targetInFlightPerInstance: 50,
        scaleUpMaxStep: 2,
      },
      nowMs,
    });
    expect(spike.status).toBe(200);
    expect(spike.body.data.decision.action).toBe('scale_up');
    expect(spike.body.data.decision.clampedBy).toBe('max');
    expect(spike.body.data.decision.recommendedReplicas).toBe(3);

    const cooldownHold = await post(RUNTIMES_ROUTES.buildAutoscalingSimulatePath(), {
      target: 'api',
      currentReplicas: 3,
      signals: { cpuPercent: 10, memoryPercent: 20, inFlightRequests: 2 },
      cooldown: { lastScaleUpAtMs: nowMs - 30_000 },
      policyOverrides: { minReplicas: 1, maxReplicas: 4, scaleDownCooldownSec: 300 },
      nowMs,
    });
    expect(cooldownHold.status).toBe(200);
    expect(cooldownHold.body.data.decision.action).toBe('hold');
    expect(cooldownHold.body.data.decision.cooldownActive).toBe(true);
    expect(cooldownHold.body.data.decision.blockedReason).toBe('scale_down_cooldown');
  });

  it('GET /ops/runtimes/autoscaling/hpa renders YAML synchronized with dynamic settings', async () => {
    const registry = context.app.get(SettingRegistryService);
    registry.setGlobalValue(AUTOSCALING_SETTING_KEYS.API_MIN_REPLICAS, 3);
    registry.setGlobalValue(AUTOSCALING_SETTING_KEYS.API_MAX_REPLICAS, 12);

    const apiRes = await get(`${RUNTIMES_ROUTES.buildAutoscalingHpaPath('api')}&namespace=staging`);
    expect(apiRes.status).toBe(200);
    expect(apiRes.body.data.filename).toBe('hpa-api.yaml');
    expect(apiRes.body.data.yaml).toContain('namespace: staging');
    expect(apiRes.body.data.yaml).toContain('minReplicas: 3');
    expect(apiRes.body.data.yaml).toContain('maxReplicas: 12');
    expect(apiRes.body.data.yaml).toContain('name: http_requests_in_flight');

    const workerRes = await get(RUNTIMES_ROUTES.buildAutoscalingHpaPath('worker'));
    expect(workerRes.status).toBe(200);
    expect(workerRes.body.data.filename).toBe('hpa-worker.yaml');
    expect(workerRes.body.data.yaml).toContain('name: core_queue_backlog_total');
  });
});
