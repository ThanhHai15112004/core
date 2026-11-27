import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  BaseCacheProvider,
  CacheInvalidationService,
  DistributedLockService,
} from '@packages/cache/index.js';
import { CoreConfigService, assertProductionStatelessConfig } from '@packages/config/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import {
  FeatureFlagRegistryService,
  ProviderRegistryService,
  SETTING_VALUE_TYPE,
  SettingRegistryService,
  TooManyRequestsAppException,
} from '@packages/kernel/index.js';
import { MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueRegistry } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  RuntimeAgentService,
  evaluateStatelessReadiness,
  installGracefulShutdown,
} from '@packages/runtime/index.js';
import { PlatformSecurityService } from '@packages/security/index.js';
import { StorageConnectionService } from '@packages/storage/index.js';
import { ApiRuntimeContributor } from '@apps/api/runtime/api-runtime.contributor.js';
import { ScheduleSyncService } from '@apps/scheduler/bootstrap/sync-schedules.js';
import { ScheduledTaskRegistry } from '@apps/scheduler/registry/scheduled-task.registry.js';
import { FeatureFlagsService } from '@modules/feature-flags/services/feature-flags.service.js';
import { HealthController } from '@modules/health/controllers/health.controller.js';
import { HealthService } from '@modules/health/services/health.service.js';
import { OutboxRelayService } from '@modules/outbox/services/outbox-relay.service.js';
import { SettingsService } from '@modules/settings/services/settings.service.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

const flush = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Phase 13.1 — Stateless Architecture, Graceful Shutdown & Connection Draining', () => {
  beforeEach(() => {
    applyTestEnv();
  });

  afterEach(() => {
    delete process.env['STORAGE_DRIVER'];
    delete process.env['CACHE_DRIVER'];
    delete process.env['STORAGE_ALLOW_LOCAL_IN_PRODUCTION'];
    delete process.env['CACHE_ALLOW_MEMORY_IN_PRODUCTION'];
    delete process.env['RUNTIME_DRAIN_DELAY_MS'];
    delete process.env['RUNTIME_GRACEFUL_TIMEOUT_MS'];
    applyTestEnv();
  });

  describe('1. Production Fail-Fast Stateless Config Guard & Draining Config', () => {
    it('chặn STORAGE_DRIVER=local và CACHE_DRIVER=memory ở production trừ khi bật opt-in cho 1 server nhỏ', () => {
      expect(() =>
        assertProductionStatelessConfig(
          { env: 'production' },
          { driver: 'local', allowLocalInProduction: false },
          { driver: 'redis', allowMemoryInProduction: false },
        ),
      ).toThrow(/STORAGE_DRIVER=local/);

      expect(() =>
        assertProductionStatelessConfig(
          { env: 'production' },
          { driver: 's3', allowLocalInProduction: false },
          { driver: 'memory', allowMemoryInProduction: false },
        ),
      ).toThrow(/CACHE_DRIVER=memory/);

      expect(() =>
        assertProductionStatelessConfig(
          { env: 'production' },
          { driver: 's3', allowLocalInProduction: false },
          { driver: 'redis', allowMemoryInProduction: false },
        ),
      ).not.toThrow();

      expect(() =>
        assertProductionStatelessConfig(
          { env: 'production' },
          { driver: 'local', allowLocalInProduction: true },
          { driver: 'memory', allowMemoryInProduction: true },
        ),
      ).not.toThrow();

      applyTestEnv({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 'local',
        STORAGE_ALLOW_LOCAL_IN_PRODUCTION: 'false',
      });
      expect(() => new CoreConfigService()).toThrow(/STORAGE_DRIVER=local/);

      applyTestEnv({
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        CACHE_DRIVER: 'redis',
        RUNTIME_DRAIN_DELAY_MS: '2500',
        RUNTIME_GRACEFUL_TIMEOUT_MS: '15000',
      });
      const prodCfg = new CoreConfigService();
      expect(prodCfg.runtime.drainDelayMs).toBe(2500);
      expect(prodCfg.runtime.gracefulTimeoutMs).toBe(15000);
    });
  });

  describe('2. Connection Draining, Readiness 503 vs Liveness 200 & Graceful Shutdown', () => {
    it('đưa /health/ready về 503 khi draining trong khi /health/live vẫn 200, gắn Connection: close và chờ in-flight request hoàn tất', async () => {
      const config = new CoreConfigService();
      const redis = new RedisService(config, mockRedisFactory);
      await redis.client.flushall();

      const agent = new RuntimeAgentService({ id: 'api', kind: 'long-running' }, redis, config);
      const contributor = new ApiRuntimeContributor(agent, config);
      contributor.onModuleInit();

      // Giả lập Fastify hooks registry
      const hooks = new Map<string, Array<(...args: unknown[]) => void>>();
      const fakeFastify = {
        addHook: (name: string, fn: (...args: unknown[]) => void) => {
          const list = hooks.get(name) ?? [];
          list.push(fn);
          hooks.set(name, list);
        },
      };
      contributor.attachFastifyDrainingHooks(fakeFastify);

      const healthService = new HealthService(
        { check: jest.fn(async () => ({ details: { heap: { status: 'up' } } })) } as never,
        { check: jest.fn() } as never,
        { checkHeap: jest.fn(async () => ({ heap: { status: 'up' } })) } as never,
        {
          getStatus: () => ({ state: 'connected' }),
          ping: async () => ({ ok: true, latencyMs: 1 }),
        } as unknown as DatabaseConnectionService,
        redis,
        {
          getDriverName: () => 's3',
          check: async () => ({ state: 'connected', lastPingMs: 1, lastError: null }),
        } as unknown as StorageConnectionService,
        undefined,
        new SettingRegistryService(),
        undefined,
        {
          getStatus: () => ({ state: 'connected', lastPingMs: 1 }),
        } as unknown as MessagingConnectionService,
        undefined,
        agent,
        new ProviderRegistryService(),
        config,
        new PlatformSecurityService(config, undefined, redis),
      );
      const controller = new HealthController(healthService);

      // Tạo 1 request đang chạy trước khi SIGTERM
      const req1: Record<string, unknown> = {};
      const headers1: Record<string, string> = {};
      const reply1 = {
        header: (k: string, v: string) => {
          headers1[k.toLowerCase()] = v;
        },
      };
      for (const fn of hooks.get('onRequest') ?? []) fn(req1, reply1, () => undefined);
      expect(contributor.getInFlightCount()).toBe(1);

      const events: string[] = [];
      let appClosed = false;
      let exitCode: number | null = null;
      const app = {
        close: async () => {
          appClosed = true;
          events.push('app.close');
          await agent.beforeApplicationShutdown();
        },
      };

      const uninstall = installGracefulShutdown({
        app,
        agent,
        logger: new Logger('ShutdownTest'),
        drainDelayMs: 30,
        gracefulTimeoutMs: 2000,
        signals: ['SIGTERM'],
        onExit: (code) => {
          exitCode = code;
          events.push(`exit:${code}`);
        },
      });

      try {
        // Bắn SIGTERM
        process.emit('SIGTERM');
        await flush(15);

        // Ngay khi draining: agent.isDraining()=true, /health/live = 200, /health/ready = 503
        expect(agent.isDraining()).toBe(true);
        expect(appClosed).toBe(false);

        const liveStatusCalls: number[] = [];
        const liveRes = await controller.liveness({
          status: (code: number) => {
            liveStatusCalls.push(code);
          },
        } as unknown as FastifyReply);
        expect(liveRes.live).toBe(true);
        expect(liveStatusCalls).toEqual([]);

        const readyStatusCalls: number[] = [];
        const readyRes = await controller.readiness(undefined, {
          status: (code: number) => {
            readyStatusCalls.push(code);
          },
        } as unknown as FastifyReply);
        expect(readyRes.ready).toBe(false);
        expect(readyStatusCalls).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);

        const details = await healthService.getDetailedHealth();
        expect(details.dependencies.process.draining).toBe(true);
        expect(details.dependencies.process.inFlightRequests).toBe(1);
        expect(details.stateless?.draining).toBe(true);

        // Request mới lọt vào lúc draining nhận header Connection: close
        const req2: Record<string, unknown> = {};
        const headers2: Record<string, string> = {};
        for (const fn of hooks.get('onRequest') ?? []) {
          fn(
            req2,
            { header: (k: string, v: string) => (headers2[k.toLowerCase()] = v) },
            () => undefined,
          );
        }
        expect(headers2['connection']).toBe('close');
        expect(contributor.getInFlightCount()).toBe(2);

        // Hoàn tất cả 2 request → app.close() mới được phép chạy
        await flush(40);
        expect(appClosed).toBe(false);

        for (const fn of hooks.get('onResponse') ?? []) fn(req1, reply1, () => undefined);
        for (const fn of hooks.get('onResponse') ?? []) fn(req2, {}, () => undefined);
        await flush(30);

        expect(contributor.getInFlightCount()).toBe(0);
        expect(appClosed).toBe(true);
        expect(exitCode).toBe(0);
        expect(events).toEqual(['app.close', 'exit:0']);
      } finally {
        uninstall();
        await redis.onApplicationShutdown();
      }
    });

    it('OutboxRelayService.stopPollingAndDrain() chờ tick đang chạy hoàn tất trước khi shutdown', async () => {
      let resolveBatch!: () => void;
      let tickCompleted = false;
      const outboxRelay = new OutboxRelayService({
        claimNextBatch: () =>
          new Promise<[]>((resolve) => {
            resolveBatch = () => {
              tickCompleted = true;
              resolve([]);
            };
          }),
      } as never);

      outboxRelay.startPolling('worker-test');
      await flush(300);

      let drained = false;
      const drainPromise = outboxRelay.stopPollingAndDrain(2000).then(() => {
        drained = true;
      });
      await flush(20);
      expect(drained).toBe(false);

      resolveBatch();
      await drainPromise;
      expect(tickCompleted).toBe(true);
      expect(drained).toBe(true);
    });
  });

  describe('3. Atomic Distributed Lock & Scheduler Multi-Replica Sync Lock', () => {
    it('dùng Lua eval cho release/extend khi Redis hỗ trợ và ngăn Scheduler replica khác sync trùng', async () => {
      const config = new CoreConfigService();
      const redis = new RedisService(config, mockRedisFactory);
      await redis.client.flushall();

      const evalCalls: string[] = [];
      const evalClient = {
        status: 'ready',
        set: jest.fn(async () => 'OK'),
        get: jest.fn(async () => 'owner-1'),
        pttl: jest.fn(async () => 5000),
        eval: jest.fn(async (script: string) => {
          evalCalls.push(script);
          return 1;
        }),
      };
      const evalRedis = {
        isReady: () => true,
        key: (...parts: string[]) => `core_test:${parts.join(':')}`,
        client: evalClient,
      } as unknown as RedisService;

      const lockSvc = new DistributedLockService(config, evalRedis);
      const handle = await lockSvc.acquire('scheduler:test-lock', {
        ownerToken: 'owner-1',
        ttlMs: 5000,
      });
      expect(handle).not.toBeNull();
      expect(await handle!.extend(8000)).toBe(true);
      expect(await handle!.release()).toBe(true);
      expect(evalCalls.length).toBe(2);

      // Hai Scheduler instance dùng chung DistributedLockService trên Redis mock
      const sharedLock = new DistributedLockService(config, redis);
      const activeLock = await sharedLock.acquire('scheduler:bootstrap-sync', {
        ownerToken: 'scheduler-replica-1',
        ttlMs: 5000,
      });
      expect(activeLock).not.toBeNull();

      const registry = new ScheduledTaskRegistry();
      const syncService = new ScheduleSyncService(
        {
          withTimeout: async <T>(p: Promise<T>) => p,
          retentionOptions: () => ({}),
          getQueue: () => ({ getJobSchedulers: async () => [] }),
        } as unknown as QueueRegistry,
        { getStatus: () => ({ state: 'connected' }) } as unknown as MessagingConnectionService,
        redis,
        registry,
        config,
        sharedLock,
      );

      // Khi replica-1 đang giữ lock, replica-2 bỏ qua sync để tránh chạy trùng
      const fastSyncLockSpy = jest.spyOn(sharedLock, 'acquire').mockResolvedValueOnce(null);
      const synced = await syncService.sync();
      expect(synced).toBe(false);
      fastSyncLockSpy.mockRestore();

      await activeLock!.release();
      const syncedAfterRelease = await syncService.sync();
      expect(syncedAfterRelease).toBe(true);

      await redis.onApplicationShutdown();
    });
  });

  describe('4. Distributed Rate Limit & Failed-Login Counter trên Redis', () => {
    it('chia sẻ giới hạn Rate Limit và đếm LOGIN_FAILED giữa 2 instance API khác nhau', async () => {
      const config = new CoreConfigService();
      const redis = new RedisService(config, mockRedisFactory);
      await redis.client.flushall();

      const apiNode1 = new PlatformSecurityService(config, undefined, redis);
      const apiNode2 = new PlatformSecurityService(config, undefined, redis);

      expect(apiNode1.isDistributedStoreReady()).toBe(true);
      apiNode1.setRateLimitRule('POST /api/v1/auth/login', {
        ipLimit: 2,
        userLimit: 10,
        apiLimit: 10,
        windowSeconds: 60,
      });
      apiNode2.setRateLimitRule('POST /api/v1/auth/login', {
        ipLimit: 2,
        userLimit: 10,
        apiLimit: 10,
        windowSeconds: 60,
      });

      const r1 = await apiNode1.assertRateLimit({
        method: 'POST',
        url: '/api/v1/auth/login',
        ipAddress: '10.0.0.15',
      });
      expect(r1.allowed).toBe(true);

      const r2 = await apiNode2.assertRateLimit({
        method: 'POST',
        url: '/api/v1/auth/login',
        ipAddress: '10.0.0.15',
      });
      expect(r2.allowed).toBe(true);

      // Request thứ 3 từ cùng IP đi qua node 1 phải bị chặn 429 do tổng 2 node đã đạt limit=2
      await expect(
        apiNode1.assertRateLimit({
          method: 'POST',
          url: '/api/v1/auth/login',
          ipAddress: '10.0.0.15',
        }),
      ).rejects.toThrow(TooManyRequestsAppException);

      // Đếm LOGIN_FAILED liên tiếp chia sẻ qua Redis giữa 2 node
      apiNode1.configureAnomalyThresholds({ failedLoginAlertThreshold: 3 });
      apiNode2.configureAnomalyThresholds({ failedLoginAlertThreshold: 3 });

      const f1 = await apiNode1.recordSecurityEvent({
        eventType: 'LOGIN_FAILED',
        ipAddress: '10.0.0.99',
        identifier: 'alice@core.local',
      });
      expect(f1.alert).toBeNull();

      const f2 = await apiNode2.recordSecurityEvent({
        eventType: 'LOGIN_FAILED',
        ipAddress: '10.0.0.99',
        identifier: 'alice@core.local',
      });
      expect(f2.alert).toBeNull();

      const f3 = await apiNode1.recordSecurityEvent({
        eventType: 'LOGIN_FAILED',
        ipAddress: '10.0.0.99',
        identifier: 'alice@core.local',
      });
      expect(f3.alert?.alertCode).toBe('ANOMALY_BRUTE_FORCE_LOGIN');

      await redis.onApplicationShutdown();
    });
  });

  describe('5. Cross-Instance L1 Cache Invalidation (Pub/Sub) & Stateless Readiness Evaluator', () => {
    it('xóa L1 cache trên instance khác qua Redis Pub/Sub và bỏ qua self-echo', async () => {
      applyTestEnv({ INSTANCE_ID: 'api-node-1' });
      const cfg1 = new CoreConfigService();
      applyTestEnv({ INSTANCE_ID: 'api-node-2' });
      const cfg2 = new CoreConfigService();
      delete process.env['INSTANCE_ID'];

      const redis = new RedisService(cfg1, mockRedisFactory);
      await redis.client.flushall();

      const pubSub1 = new CacheInvalidationService(redis, cfg1, { allowInTest: true });
      const pubSub2 = new CacheInvalidationService(redis, cfg2, { allowInTest: true });

      const reg1 = new SettingRegistryService();
      const reg2 = new SettingRegistryService();
      const ffReg1 = new FeatureFlagRegistryService();
      const ffReg2 = new FeatureFlagRegistryService();

      const cache1 = new BaseCacheProvider(cfg1, redis);
      const cache2 = new BaseCacheProvider(cfg2, redis);

      const settings1 = new SettingsService(
        null,
        null,
        null,
        null,
        reg1,
        null,
        null,
        cache1,
        pubSub1,
      );
      const settings2 = new SettingsService(
        null,
        null,
        null,
        null,
        reg2,
        null,
        null,
        cache2,
        pubSub2,
      );
      const flags1 = new FeatureFlagsService(null, null, ffReg1, null, cache1, pubSub1);
      const flags2 = new FeatureFlagsService(null, null, ffReg2, null, cache2, pubSub2);

      await settings1.onModuleInit();
      await settings2.onModuleInit();
      await flags1.onModuleInit();
      await flags2.onModuleInit();

      // Nạp sẵn L1 cache trên node 2
      await settings2.createGroup({
        code: 'general',
        module: 'settings',
        name: 'General',
        sortOrder: 1,
      });
      await settings2.createSetting({
        key: 'app.site_name',
        groupCode: 'general',
        module: 'settings',
        name: 'Site Name',
        valueType: SETTING_VALUE_TYPE.TEXT,
        defaultValue: 'OldName',
        value: 'OldName',
      });
      await settings2.resolve('app.site_name');
      const resolvedMap2 = (settings2 as unknown as { resolvedCache: Map<string, unknown> })
        .resolvedCache;
      expect(resolvedMap2.size).toBeGreaterThan(0);

      ffReg2.setInstalledModules(['core']);
      await flags2.createFeatureFlag({
        key: 'core.new_dashboard',
        name: 'New Dashboard',
        description: 'New dashboard rollout flag',
        module: 'core',
        isEnabled: false,
      });
      await flags2.evaluate('core.new_dashboard');
      const evalMap2 = (flags2 as unknown as { evaluationCache: Map<string, unknown> })
        .evaluationCache;
      expect(evalMap2.size).toBeGreaterThan(0);

      // Chờ xả các message khởi tạo từ node 2 trước khi đo self-echo trên node 1
      await flush(30);

      // Node 1 cập nhật → node 2 nhận tín hiệu xóa L1 cache ngay (node 1 tự bỏ qua self-echo)
      let selfEchoCount = 0;
      pubSub1.subscribe('settings', () => {
        selfEchoCount += 1;
      });
      await pubSub1.publish('settings', { key: 'app.site_name', action: 'invalidate' });
      await pubSub1.publish('feature-flags', { key: 'core.new_dashboard', action: 'invalidate' });
      await flush(40);

      expect(selfEchoCount).toBe(0);
      expect(resolvedMap2.size).toBe(0);
      expect(evalMap2.size).toBe(0);

      settings1.onModuleDestroy();
      settings2.onModuleDestroy();
      flags1.onModuleDestroy();
      flags2.onModuleDestroy();
      await pubSub1.onApplicationShutdown();
      await pubSub2.onApplicationShutdown();
      await redis.onApplicationShutdown();
    });

    it('evaluateStatelessReadiness trả kết quả ok / degraded / down chính xác theo 7 tiêu chí', () => {
      const okReport = evaluateStatelessReadiness({
        environment: 'production',
        instanceId: 'api-1',
        runtimeState: 'running',
        draining: false,
        inFlightRequests: 0,
        storageDriver: 's3',
        allowLocalStorageInProd: false,
        cacheDriver: 'redis',
        allowMemoryCacheInProd: false,
        redisReady: true,
        databaseEnabled: true,
        distributedRateLimitReady: true,
        drainDelayMs: 5000,
        gracefulTimeoutMs: 30000,
      });
      expect(okReport.compliant).toBe(true);
      expect(okReport.status).toBe('ok');
      expect(okReport.checks).toHaveLength(7);

      const failReport = evaluateStatelessReadiness({
        environment: 'production',
        instanceId: 'api-1',
        runtimeState: 'running',
        draining: false,
        inFlightRequests: 0,
        storageDriver: 'local',
        allowLocalStorageInProd: false,
        cacheDriver: 'memory',
        allowMemoryCacheInProd: false,
        redisReady: false,
        databaseEnabled: true,
        distributedRateLimitReady: false,
        drainDelayMs: 0,
        gracefulTimeoutMs: 30000,
      });
      expect(failReport.compliant).toBe(false);
      expect(failReport.status).toBe('down');
    });
  });
});
