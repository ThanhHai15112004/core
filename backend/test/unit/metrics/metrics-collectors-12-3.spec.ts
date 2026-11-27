import { describe, expect, it, jest } from '@jest/globals';
import type { HttpAdapterHost } from '@nestjs/core';
import type { CoreConfigService } from '@packages/config/index.js';
import {
  HttpMetricsHook,
  MetricsRegistryService,
  resolveHttpMetricModule,
  statusClassOf,
} from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import type { QueueInfo } from '@packages/queue/index.js';
import { DatabaseMonitorService } from '@modules/database-ops/services/database-monitor.service.js';
import { WorkerMetricsService } from '@modules/worker-ops/services/worker-metrics.service.js';
import { buildLocalHttpSnapshot } from '@modules/metrics-ops/helpers/metrics-local-reader.helper.js';

describe('12.3 Metrics Collectors Unit Tests', () => {
  it('normalizes HTTP module names and status classes safely', () => {
    expect(resolveHttpMetricModule('/api/v1/users/:id', 'api/v1')).toBe('users');
    expect(resolveHttpMetricModule('/api/v1/ops/database/overview', 'api/v1')).toBe('ops/database');
    expect(resolveHttpMetricModule('unmatched', 'api/v1')).toBe('unmatched');
    expect(resolveHttpMetricModule('/', 'api/v1')).toBe('root');

    expect(statusClassOf(200)).toBe('2xx');
    expect(statusClassOf(302)).toBe('3xx');
    expect(statusClassOf(404)).toBe('4xx');
    expect(statusClassOf(503)).toBe('5xx');
  });

  it('records default labels (runtime, instance, version), http_requests_total, and local p50/p95/p99 by module/version', async () => {
    const registry = new MetricsRegistryService({
      runtime: 'api',
      instance: 'api-pod-01:1234',
      version: '2.3.4',
    });

    let onResponseCb:
      | ((
          req: { method: string; routeOptions?: { url?: string } },
          reply: { statusCode: number; elapsedTime: number },
          done: () => void,
        ) => void)
      | null = null;

    const adapterHost = {
      httpAdapter: {
        getInstance: () => ({
          addHook: (event: string, cb: typeof onResponseCb) => {
            if (event === 'onResponse') {
              onResponseCb = cb;
            }
          },
        }),
      },
    } as unknown as HttpAdapterHost;

    const hook = new HttpMetricsHook(adapterHost, registry);
    hook.onModuleInit();
    expect(onResponseCb).not.toBeNull();

    const done = jest.fn();
    onResponseCb!(
      { method: 'GET', routeOptions: { url: '/api/v1/users/:id' } },
      { statusCode: 200, elapsedTime: 25 },
      done,
    );
    onResponseCb!(
      { method: 'POST', routeOptions: { url: '/api/v1/users' } },
      { statusCode: 500, elapsedTime: 300 },
      done,
    );
    onResponseCb!(
      { method: 'GET', routeOptions: { url: '/api/v1/orders' } },
      { statusCode: 404, elapsedTime: 10 },
      done,
    );
    expect(done).toHaveBeenCalledTimes(3);

    const text = await registry.metrics();
    expect(text).toContain('runtime="api"');
    expect(text).toContain('instance="api-pod-01:1234"');
    expect(text).toContain('version="2.3.4"');
    expect(text).toContain('http_requests_total');

    const json = await registry.getMetricsJson();
    const snap = buildLocalHttpSnapshot(json, '2.3.4', 60);
    expect(snap.totalRequests).toBe(3);
    expect(snap.errors4xx).toBe(1);
    expect(snap.errors5xx).toBe(1);
    expect(snap.p50Ms).not.toBeNull();
    expect(snap.p95Ms).not.toBeNull();
    expect(snap.p99Ms).not.toBeNull();

    const usersMod = snap.errorsByModule.find((m) => m.module === 'users' && m.version === '2.3.4');
    expect(usersMod).toBeDefined();
    expect(usersMod?.requests).toBe(2);
    expect(usersMod?.errors5xx).toBe(1);
    expect(usersMod?.errorRatePercent).toBe(50);
  });

  it('tracks Redis command latency via sendCommand wrapper and measurePingMs', async () => {
    const fakeClient = {
      status: 'ready',
      on: jest.fn(),
      connect: jest.fn(async () => undefined),
      quit: jest.fn(async () => 'OK'),
      ping: jest.fn(async () => 'PONG'),
      sendCommand(cmd: { promise: Promise<unknown> }) {
        return cmd.promise;
      },
    };
    const config = {
      cache: { redis: { host: '127.0.0.1', port: 6379, db: 0, prefix: 'test:' } },
    } as unknown as CoreConfigService;

    const redis = new RedisService(config, () => fakeClient as never, { id: 'api' });
    const observed: Array<{ op: string; ms: number }> = [];
    const unsubscribe = redis.registerLatencyObserver((op, ms) => observed.push({ op, ms }));

    (redis.client as unknown as { sendCommand: (cmd: unknown) => Promise<unknown> }).sendCommand({
      name: 'GET',
      promise: Promise.resolve('ok'),
    });
    await new Promise((r) => setTimeout(r, 15));

    const pingMs = await redis.measurePingMs();
    expect(pingMs).not.toBeNull();
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed[0]?.op).toBe('get');

    const snap = redis.getLatencySnapshot();
    expect(snap.count).toBeGreaterThanOrEqual(1);
    expect(snap.p95Ms).not.toBeNull();
    expect(snap.lastPingMs).toBe(pingMs);

    unsubscribe();
    await redis.onApplicationShutdown();
  });

  it('exports core_queue_oldest_job_age_seconds gauge in WorkerMetricsService', async () => {
    const registry = new MetricsRegistryService({
      runtime: 'worker',
      instance: 'worker-1',
      version: '1.0.0',
    });
    const workerMetrics = new WorkerMetricsService({} as never, registry);
    const now = 1_700_000_000_000;
    const queues: QueueInfo[] = [
      {
        name: 'system.events',
        paused: false,
        counts: { waiting: 12, active: 2, delayed: 3, failed: 1, completed: 50, prioritized: 0 },
        oldestWaitingAt: now - 45_000,
        workers: [],
      } as unknown as QueueInfo,
      {
        name: 'empty.queue',
        paused: false,
        counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 10, prioritized: 0 },
        oldestWaitingAt: null,
        workers: [],
      } as unknown as QueueInfo,
    ];

    workerMetrics.recordQueues(queues, now);
    const text = await registry.metrics();
    expect(text).toContain('core_queue_oldest_job_age_seconds');
    expect(text).toContain('queue="system.events"');
    expect(text).toContain(' 45');
  });

  it('records DB pool stats per instance in DatabaseMonitorService even when distributed lock is held elsewhere', async () => {
    const fakeDriver = {
      master: { totalCount: 12, idleCount: 5, waitingCount: 2 },
    };
    const connection = {
      connected: () => ({ driver: fakeDriver }),
    };
    const monitoring = {};
    const metrics = {
      recordPool: jest.fn(),
    };
    const store = {
      isAvailable: () => true,
      keys: { collectLock: () => 'db:collect:lock' },
      client: { set: jest.fn(async () => null) }, // lock held by another instance
    };
    const config = {
      database: { enabled: true, maxConnections: 20 },
      isTest: true,
    } as unknown as CoreConfigService;

    const monitor = new DatabaseMonitorService(
      connection as never,
      monitoring as never,
      metrics as never,
      store as never,
      config,
    );

    await monitor.tick(Date.now());
    expect(metrics.recordPool).toHaveBeenCalledWith(
      { used: 7, idle: 5, waiting: 2, total: 12 },
      20,
    );
  });
});
