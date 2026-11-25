import { afterEach, describe, expect, it } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ModuleRef } from '@nestjs/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import type { DataSource } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import {
  DB_MAX_RETRIES_CAP,
  DatabaseConnectionService,
  TransactionManager,
  isTransientDbError,
  retryDelayWithJitterMs,
  withDbRetry,
} from '@packages/database/index.js';
import { REQUEST_TIMEOUT_METADATA_KEY, RequestTimeoutInterceptor } from '@packages/http/index.js';
import {
  BaseHttpClientProvider,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
  ConcurrencyLimiterRegistry,
  HttpClientManageableAdapter,
  HttpClientMetricsService,
  HttpConcurrencyLimitError,
  HttpServiceRegistry,
  HttpStatusError,
  HttpTimeoutError,
  RetryStormMonitor,
} from '@packages/http-client/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  BadRequestAppException,
  GatewayTimeoutAppException,
  PackageStatus,
  RESILIENCE_SETTING_KEYS,
  ServiceUnavailableAppException,
  SettingRegistryService,
  TooManyRequestsAppException,
  clampRetryCount,
  classifyTransientError,
  computeResilienceBackoffMs,
} from '@packages/kernel/index.js';
import { QueueRegistry, classifyJobError } from '@packages/messaging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { HttpClientOpsController } from '@modules/http-client-ops/controllers/http-client-ops.controller.js';
import { HttpClientOpsService } from '@modules/http-client-ops/services/http-client-ops.service.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeHttpExecutionContext(method = 'GET', url = '/api/v1/demo'): ExecutionContext {
  const req = {
    method,
    url,
    routeOptions: { url },
  };
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class DummyController {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('Phase 11.4 — Retry, Timeout, Circuit Breaker, Bulkhead & Retry Storm', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('1. Classifies transient vs non-retryable errors across Kernel, Queue and Database', async () => {
    expect(classifyTransientError(new BadRequestAppException())).toBe(false);
    expect(classifyTransientError(new TooManyRequestsAppException())).toBe(true);
    expect(classifyTransientError(new ServiceUnavailableAppException())).toBe(true);
    expect(classifyTransientError(new GatewayTimeoutAppException())).toBe(true);

    // Queue job classifier: business 4xx is non-retryable; circuit open & bulkhead are retryable
    expect(classifyJobError(new BadRequestAppException('INVALID_DATA')).retryable).toBe(false);
    expect(
      classifyJobError(
        new HttpStatusError({
          service: 'billing',
          method: 'POST',
          url: 'https://billing.example.com/pay',
          status: 422,
          retryable: false,
          durationMs: 25,
          attempts: 1,
        }),
      ).retryable,
    ).toBe(false);
    expect(
      classifyJobError(
        new CircuitBreakerOpenError({
          service: 'billing',
          method: 'POST',
          url: 'https://billing.example.com/pay',
          nextAttemptAt: null,
        }),
      ),
    ).toMatchObject({ retryable: true, dependency: 'http' });
    expect(
      classifyJobError(
        new HttpConcurrencyLimitError({
          service: 'billing',
          method: 'GET',
          url: 'https://billing.example.com/pay',
          maxConcurrent: 5,
          inFlight: 5,
          queued: 0,
        }),
      ),
    ).toMatchObject({ retryable: true, dependency: 'http' });

    // Database transient classifier: deadlock & lock_timeout retryable; duplicate & auth NOT retryable
    const deadlockErr = Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
    const lockTimeoutErr = Object.assign(new Error('Lock wait timeout'), {
      code: 'ER_LOCK_WAIT_TIMEOUT',
    });
    const dupErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    const authErr = Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });

    expect(isTransientDbError(deadlockErr)).toBe(true);
    expect(isTransientDbError(lockTimeoutErr)).toBe(true);
    expect(isTransientDbError(dupErr)).toBe(false);
    expect(isTransientDbError(authErr)).toBe(false);

    // withDbRetry retries deadlock and recovers, never retries duplicate key
    let deadlockAttempts = 0;
    const recovered = await withDbRetry(
      async () => {
        deadlockAttempts += 1;
        if (deadlockAttempts < 3) throw deadlockErr;
        return 'ok';
      },
      { maxRetries: 99, baseDelayMs: 10, maxDelayMs: 20, jitter: true, randomFn: () => 0.5 },
    );
    expect(recovered).toBe('ok');
    expect(deadlockAttempts).toBe(3);

    let dupAttempts = 0;
    await expect(
      withDbRetry(
        async () => {
          dupAttempts += 1;
          throw dupErr;
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 20, jitter: false },
      ),
    ).rejects.toBe(dupErr);
    expect(dupAttempts).toBe(1);
    expect(clampRetryCount(100, DB_MAX_RETRIES_CAP)).toBe(DB_MAX_RETRIES_CAP);
  });

  it('2. Computes bounded backoff + jitter and propagates BullMQ jitter + dynamic settings', () => {
    expect(
      computeResilienceBackoffMs(
        2,
        { baseDelayMs: 100, maxDelayMs: 1_000, jitter: true, strategy: 'exponential' },
        () => 0,
      ),
    ).toBe(100);
    expect(
      computeResilienceBackoffMs(
        2,
        { baseDelayMs: 100, maxDelayMs: 1_000, jitter: true, strategy: 'exponential' },
        () => 1,
      ),
    ).toBe(200);
    expect(retryDelayWithJitterMs(3, { jitter: true, randomFn: () => 0 })).toBe(2000);
    expect(retryDelayWithJitterMs(3, { jitter: true, randomFn: () => 1 })).toBe(4000);

    // QueueRegistry injects backoff.jitter for BullMQ
    const config = new CoreConfigService();
    const queueRegistry = new QueueRegistry({} as ModuleRef, config);
    const opts = queueRegistry.retentionOptions('system.events');
    expect(opts.attempts).toBeLessThanOrEqual(config.messaging.maxAttemptsCap);
    expect(opts.backoff).toMatchObject({
      type: config.messaging.backoff,
      delay: config.messaging.backoffDelayMs,
      jitter: config.messaging.backoffJitter,
    });

    // HttpServiceRegistry caps retries by maxRetriesCap and reads dynamic Settings
    const settings = new SettingRegistryService();
    settings.setGlobalValue(RESILIENCE_SETTING_KEYS.HTTP_TIMEOUT_MS, 4_200);
    settings.setGlobalValue(RESILIENCE_SETTING_KEYS.HTTP_RETRY_MAX_CAP, 3);
    settings.setGlobalValue(RESILIENCE_SETTING_KEYS.HTTP_MAX_CONCURRENT, 7);

    const httpRegistry = new HttpServiceRegistry(config, settings);
    const resolvedDefault = httpRegistry.getDefaultPolicy();
    expect(resolvedDefault.timeoutMs).toBe(4_200);
    expect(resolvedDefault.concurrency.maxConcurrent).toBe(7);

    const clampedPolicy = httpRegistry.resolvePolicy('partner', {
      retry: { maxRetries: 50 },
    });
    expect(clampedPolicy.retry.maxRetries).toBe(3);
  });

  it('3. Enforces API RequestTimeoutInterceptor with @RequestTimeout / @NoRequestTimeout and dynamic Settings', async () => {
    const config = new CoreConfigService();
    const settings = new SettingRegistryService();
    settings.setGlobalValue(RESILIENCE_SETTING_KEYS.API_REQUEST_TIMEOUT_MS, 40);

    let metadataOverride: number | undefined;
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === REQUEST_TIMEOUT_METADATA_KEY ? metadataOverride : undefined,
    } as unknown as Reflector;

    const interceptor = new RequestTimeoutInterceptor(reflector, config, settings);
    const slowHandler: CallHandler = {
      handle: () =>
        new Observable((sub) => {
          const t = setTimeout(() => {
            sub.next({ ok: true });
            sub.complete();
          }, 120);
          return () => clearTimeout(t);
        }),
    };

    await expect(
      firstValueFrom(
        interceptor.intercept(makeHttpExecutionContext('GET', '/api/v1/slow'), slowHandler),
      ),
    ).rejects.toBeInstanceOf(GatewayTimeoutAppException);

    const stats = interceptor.getStats();
    expect(stats.effectiveDefaultTimeoutMs).toBe(40);
    expect(stats.totalTimeouts).toBe(1);
    expect(stats.recentTimeouts[0]?.route).toBe('/api/v1/slow');

    // @NoRequestTimeout() (0) allows slow handler to complete
    metadataOverride = 0;
    const ok = await firstValueFrom(
      interceptor.intercept(makeHttpExecutionContext('GET', '/api/v1/stream'), slowHandler),
    );
    expect(ok).toEqual({ ok: true });

    // Fast handler succeeds under @RequestTimeout(200)
    metadataOverride = 200;
    const fast = await firstValueFrom(
      interceptor.intercept(makeHttpExecutionContext('GET', '/api/v1/fast'), {
        handle: () => of({ fast: true }),
      }),
    );
    expect(fast).toEqual({ fast: true });
  });

  it('4. Retries transient DB deadlock inside TransactionManager and records DB resilience metrics', async () => {
    const config = new CoreConfigService();
    const prom = new MetricsRegistryService({ runtime: 'api' });

    const runner = {
      manager: {},
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      release: async () => undefined,
      query: async () => [],
    };
    const fakeDs = {
      isInitialized: true,
      options: { type: 'postgres' },
      createQueryRunner: () => runner,
    } as unknown as DataSource;

    const conn = {
      driver: 'postgres',
      connected: () => fakeDs,
      getStatus: () => ({ state: 'connected' }),
    } as unknown as DatabaseConnectionService;

    const txManager = new TransactionManager(conn, config, prom);

    let runs = 0;
    const res = await txManager.runInTransaction(
      async () => {
        runs += 1;
        if (runs === 1) {
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        }
        return 'committed';
      },
      { retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 30, jitter: false } },
    );

    expect(res).toBe('committed');
    expect(runs).toBe(2);
    expect(txManager.getResilienceStats()).toMatchObject({
      retryCount: 1,
      retryRecoveredCount: 1,
      retryExhaustedCount: 0,
    });

    const exposition = await prom.metrics();
    expect(exposition).toContain('core_db_retries_total');
  });

  it('5. Enforces provider Concurrency Limiter (Bulkhead) without tripping Circuit Breaker', async () => {
    const prom = new MetricsRegistryService({ runtime: 'api' });
    const registry = new HttpServiceRegistry();
    const circuitBreaker = new CircuitBreakerRegistry();
    const metrics = new HttpClientMetricsService(prom);
    const limiter = new ConcurrencyLimiterRegistry();
    const retryStorm = new RetryStormMonitor();
    const client = new BaseHttpClientProvider(
      registry,
      circuitBreaker,
      metrics,
      undefined,
      limiter,
      retryStorm,
    );

    registry.registerService('sms-provider', {
      baseUrl: 'https://sms.example.com',
      timeoutMs: 2_000,
      retry: { maxRetries: 0 },
      concurrency: { enabled: true, maxConcurrent: 2, maxQueue: 0, queueTimeoutMs: 500 },
      circuitBreaker: { enabled: true, failureThreshold: 1, resetTimeoutMs: 10_000 },
    });

    const resolvers: Array<() => void> = [];
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolvers.push(() => resolve(jsonResponse({ sent: true }, 200)));
      })) as typeof fetch;

    const svc = client.forService('sms-provider');
    const p1 = svc.get('/send/1');
    const p2 = svc.get('/send/2');

    // Wait a microtask so p1 & p2 occupy both bulkhead slots
    await Promise.resolve();
    expect(limiter.getInFlight('sms-provider')).toBe(2);

    // 3rd concurrent request is rejected immediately with HttpConcurrencyLimitError
    await expect(svc.get('/send/3')).rejects.toBeInstanceOf(HttpConcurrencyLimitError);
    // Bulkhead rejection must NOT trip the circuit breaker
    expect(circuitBreaker.getSnapshot('sms-provider')?.state).toBe('CLOSED');

    // Finish both in-flight requests -> slots released
    for (const done of resolvers) done();
    await Promise.all([p1, p2]);
    expect(limiter.getInFlight('sms-provider')).toBe(0);

    const snap = limiter.getSnapshot('sms-provider');
    expect(snap).toMatchObject({
      inFlight: 0,
      maxConcurrent: 2,
      peakInFlight: 2,
      totalRejected: 1,
    });

    const exposition = await prom.metrics();
    expect(exposition).toContain('outbound_http_in_flight_requests');
    expect(exposition).toContain('outbound_http_concurrency_rejected_total');
  });

  it('6. Requires halfOpenSuccessThreshold consecutive probes to close Circuit Breaker and emits state events', () => {
    let now = 500_000;
    const cb = new CircuitBreakerRegistry(() => now);
    const transitions: string[] = [];
    cb.onStateChange((e) => transitions.push(`${e.from}->${e.to}`));

    const policy = {
      enabled: true,
      failureThreshold: 2,
      failureWindowMs: 60_000,
      resetTimeoutMs: 5_000,
      halfOpenMaxProbes: 2,
      halfOpenSuccessThreshold: 2,
    };

    cb.onFailure('erp', policy, '503', true);
    cb.onFailure('erp', policy, '503', true);
    expect(cb.getSnapshot('erp')?.state).toBe('OPEN');

    now += 5_001;
    expect(cb.beforeRequest('erp', policy, 'GET', 'https://erp.example.com')).toBe('HALF_OPEN');
    // First probe succeeds -> still HALF_OPEN because threshold is 2
    expect(cb.onSuccess('erp')).toBe('HALF_OPEN');
    expect(cb.getSnapshot('erp')?.halfOpenSuccesses).toBe(1);

    // Second probe succeeds -> CLOSED
    expect(cb.beforeRequest('erp', policy, 'GET', 'https://erp.example.com')).toBe('HALF_OPEN');
    expect(cb.onSuccess('erp')).toBe('CLOSED');
    expect(transitions).toEqual(['CLOSED->OPEN', 'OPEN->HALF_OPEN', 'HALF_OPEN->CLOSED']);
  });

  it('7. Detects Retry Storm, triggers Retry Budget Shedding, and surfaces alerts in Ops & ManageableAdapter', async () => {
    let now = 1_000_000;
    const config = new CoreConfigService();
    const i18n = new CoreI18nService();
    const prom = new MetricsRegistryService({ runtime: 'api' });
    const registry = new HttpServiceRegistry(config);
    const cb = new CircuitBreakerRegistry(() => now);
    const metrics = new HttpClientMetricsService(prom);
    const limiter = new ConcurrencyLimiterRegistry();
    const storm = new RetryStormMonitor(config);
    storm.setClock(() => now);
    storm.setPolicyOverride({
      retriesPerMinThreshold: 5,
      retryRatioPercent: 50,
      minRequests: 10,
      sheddingEnabled: true,
    });

    const events: string[] = [];
    storm.onStormEvent((e) => events.push(`${e.type}:${e.snapshot.service}`));

    registry.registerService('payment-gw', {
      baseUrl: 'https://pay.example.com',
      timeoutMs: 1_000,
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 20, jitter: false },
      circuitBreaker: { enabled: false },
    });

    const client = new BaseHttpClientProvider(registry, cb, metrics, config, limiter, storm);

    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return jsonResponse({ error: 'busy' }, 503);
    }) as typeof fetch;

    // 2 calls × 3 retries = 6 retries -> after 5th retry storm activates & sheds remaining retries!
    await expect(client.forService('payment-gw').get('/tx/1')).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    await expect(client.forService('payment-gw').get('/tx/2')).rejects.toBeInstanceOf(
      HttpStatusError,
    );

    const stormSnap = storm.getServiceSnapshot('payment-gw');
    expect(stormSnap?.active).toBe(true);
    expect(stormSnap?.sheddingActive).toBe(true);
    expect(stormSnap?.sheddedRetriesCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(fetchCount).toBeLessThan(8); // Shedding suppressed retries
    expect(events).toContain('started:payment-gw');

    // Ops controller & ManageableAdapter report storm + 4-layer resilience summary
    const opsService = new HttpClientOpsService(
      registry,
      cb,
      metrics,
      config,
      i18n,
      limiter,
      storm,
    );
    const opsController = new HttpClientOpsController(opsService);
    const overview = opsController.overview();
    expect(overview.totals.activeRetryStorms).toBe(1);
    expect(overview.retryStorm.alerts[0]?.service).toBe('payment-gw');
    expect(overview.resilience.api.defaultTimeoutMs).toBeGreaterThanOrEqual(0);
    expect(overview.resilience.database.queryTimeoutMs).toBe(config.database.queryTimeoutMs);
    expect(overview.resilience.queue.backoffJitter).toBeGreaterThanOrEqual(0);
    expect(overview.resilience.provider.concurrencyEnabled).toBe(true);

    const resilienceEndpoint = opsController.resilience();
    expect(resilienceEndpoint.queue.profiles.length).toBeGreaterThan(0);

    const adapter = new HttpClientManageableAdapter(registry, cb, metrics, config, i18n, storm);
    const pkgStatus = await adapter.getStatus();
    expect([PackageStatus.WARNING, PackageStatus.ERROR]).toContain(pkgStatus.status);
    expect(pkgStatus.metrics['activeRetryStorms']).toBe(1);

    // Timeout metrics also emitted to Prometheus
    const timeoutSvc = client.forService('payment-gw');
    globalThis.fetch = ((_u: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener(
          'abort',
          () => rej(init.signal?.reason ?? new DOMException('Timed out', 'TimeoutError')),
          { once: true },
        );
      })) as typeof fetch;
    await expect(
      timeoutSvc.get('/slow', { timeoutMs: 25, retry: { maxRetries: 0 } }),
    ).rejects.toBeInstanceOf(HttpTimeoutError);

    const exposition = await prom.metrics();
    expect(exposition).toContain('outbound_http_timeouts_total');
    expect(exposition).toContain('outbound_http_retry_storm_active');
    expect(exposition).toContain('outbound_http_retry_storm_shedded_total');

    // Advance clock > 60s -> storm recovers
    now += 61_000;
    const afterRecovery = storm.evaluateService('payment-gw');
    expect(afterRecovery.active).toBe(false);
    expect(events).toContain('recovered:payment-gw');
  });
});
