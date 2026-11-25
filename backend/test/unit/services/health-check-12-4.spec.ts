import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import {
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  TerminusModule,
} from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';
import {
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  discoverManifestSettings,
} from '@packages/kernel/index.js';
import {
  DatabaseConnectionService,
  DatabaseOperationsService,
} from '@packages/database/index.js';
import { MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { BaseStorageProvider, StorageConnectionService } from '@packages/storage/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { HealthController } from '@modules/health/controllers/health.controller.js';
import { HEALTH_SETTING_KEYS } from '@modules/health/enum/health.enum.js';
import { sanitizeHealthError } from '@modules/health/helpers/health-probe.helper.js';
import { HealthProbesService } from '@modules/health/services/health-probes.service.js';
import { HealthService } from '@modules/health/services/health.service.js';

interface TestHarnessOptions {
  dbState?: 'connected' | 'reconnecting' | 'unavailable' | 'disabled';
  dbDelayMs?: number;
  redisUp?: boolean;
  redisReady?: boolean;
  redisDelayMs?: number;
  messagingState?: 'connected' | 'reconnecting' | 'unavailable';
  queues?: Array<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: boolean;
    workers: number;
  }>;
  storageState?: 'connected' | 'reconnecting' | 'unavailable';
  runtimeState?: 'starting' | 'running' | 'paused' | 'stopping';
  migrations?: Array<{
    name: string;
    timestamp: number | null;
    status: 'applied' | 'pending';
    appliedAt: string | null;
    integrity?: 'ok' | 'modified' | 'missing_source';
  }>;
}

function registerHealthSettingsInRegistry(registry: SettingRegistryService): void {
  const discovered = discoverManifestSettings();
  for (const grp of discovered.groups) {
    if (grp.code === 'health') {
      registry.registerGroup(grp);
    }
  }
  for (const item of discovered.settings) {
    if (item.module === 'health' || item.groupCode === 'health') {
      registry.registerManifestSetting(item);
    }
  }
}

function setHealthSetting(registry: SettingRegistryService, key: string, value: unknown): void {
  const def = registry.getDefinition(key);
  if (!def) {
    throw new Error(`Setting "${key}" not registered`);
  }
  registry.upsertDefinition({
    ...def,
    globalSerializedValue: String(value),
  });
}

async function buildHarness(opts: TestHarnessOptions = {}) {
  const settingRegistry = new SettingRegistryService();
  registerHealthSettingsInRegistry(settingRegistry);

  const kernelProviders = new KernelProviderRegistryService();
  const storageCheckSpy = jest.fn(async (_checkOpts?: { writeProbe?: boolean }) => ({
    state: opts.storageState ?? 'connected',
    since: new Date().toISOString(),
    lastSuccessAt: opts.storageState === 'unavailable' ? null : new Date().toISOString(),
    lastPingMs: opts.storageState === 'unavailable' ? null : 1.5,
    lastError: opts.storageState === 'unavailable' ? 'ENOENT: storage root missing' : null,
  }));

  const migrationsSpy = jest.fn(async () => ({
    items: opts.migrations ?? [
      {
        name: '1763400000000-InitCore',
        timestamp: 1763400000000,
        status: 'applied' as const,
        appliedAt: new Date().toISOString(),
        integrity: 'ok' as const,
      },
    ],
    lastRun: {
      at: new Date().toISOString(),
      status: 'completed' as const,
      executed: [],
      error: null,
      durationMs: 12,
    },
  }));

  const dbState = opts.dbState ?? 'connected';
  const msgState = opts.messagingState ?? 'connected';
  const queuesData = opts.queues ?? [
    { name: 'system.events', waiting: 2, active: 1, delayed: 0, failed: 0, paused: false, workers: 2 },
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      HealthProbesService,
      HealthService,
      { provide: SettingRegistryService, useValue: settingRegistry },
      { provide: KernelProviderRegistryService, useValue: kernelProviders },
      {
        provide: DatabaseConnectionService,
        useValue: {
          getStatus: () => ({ state: dbState }),
          connected: () => (dbState === 'connected' || dbState === 'reconnecting' ? {} : null),
          ping: async () => {
            if (opts.dbDelayMs) {
              await new Promise((r) => setTimeout(r, opts.dbDelayMs));
            }
            return dbState === 'connected' || dbState === 'reconnecting'
              ? { ok: true, latencyMs: 2.5, error: null }
              : {
                  ok: false,
                  latencyMs: null,
                  error: { code: 'ECONNREFUSED', message: 'mysql://root:secret@localhost:3306 refused' },
                };
          },
        },
      },
      {
        provide: DatabaseOperationsService,
        useValue: {
          migrations: migrationsSpy,
        },
      },
      {
        provide: RedisService,
        useValue: {
          isReady: () => opts.redisReady ?? opts.redisUp ?? true,
          getLatencySnapshot: () => ({ count: 10, avgMs: 1.2, p50Ms: 1, p95Ms: 2.5, p99Ms: 3.1, lastPingMs: 1 }),
          client: {
            ping: async () => {
              if (opts.redisDelayMs) {
                await new Promise((r) => setTimeout(r, opts.redisDelayMs));
              }
              if (opts.redisUp === false) {
                throw new Error('redis://:secretpass@127.0.0.1:6379 closed');
              }
              return 'PONG';
            },
          },
        },
      },
      {
        provide: MessagingConnectionService,
        useValue: {
          getStatus: () => ({
            state: msgState,
            since: new Date().toISOString(),
            lastSuccessAt: msgState === 'unavailable' ? null : new Date().toISOString(),
            lastPingMs: msgState === 'unavailable' ? null : 1.1,
            lastError: msgState === 'unavailable' ? 'Broker connection lost' : null,
            lastPublishAt: null,
            failures: msgState === 'unavailable' ? 3 : 0,
          }),
        },
      },
      {
        provide: QueueMonitoringService,
        useValue: {
          usable: () => msgState === 'connected',
          status: () => ({ state: msgState }),
          queues: async () =>
            queuesData.map((q) => ({
              name: q.name,
              paused: q.paused,
              counts: {
                waiting: q.waiting,
                active: q.active,
                delayed: q.delayed,
                failed: q.failed,
                completed: 10,
                prioritized: 0,
              },
              workers: Array.from({ length: q.workers }, (_, i) => ({ id: `w-${i}` })),
              oldestWaitingAt: null,
            })),
        },
      },
      {
        provide: StorageConnectionService,
        useValue: {
          getDriverName: () => 'local',
          check: storageCheckSpy,
        },
      },
      {
        provide: RuntimeAgentService,
        useValue: {
          getState: () => opts.runtimeState ?? 'running',
          isShuttingDown: () => (opts.runtimeState ?? 'running') === 'stopping',
        },
      },
    ],
  }).compile();

  expect(moduleRef.get(HealthCheckService)).toBeDefined();
  expect(moduleRef.get(HealthIndicatorService)).toBeDefined();
  expect(moduleRef.get(MemoryHealthIndicator)).toBeDefined();

  return {
    controller: moduleRef.get(HealthController),
    service: moduleRef.get(HealthService),
    settingRegistry,
    kernelProviders,
    storageCheckSpy,
    migrationsSpy,
  };
}

function createReplyMock(): { reply: FastifyReply; statusCalls: number[] } {
  const statusCalls: number[] = [];
  const reply = {
    status: (code: number) => {
      statusCalls.push(code);
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, statusCalls };
}

const ADMIN_ACTOR: UserIdentity = {
  id: 1,
  username: 'superadmin',
  email: 'admin@example.com',
  roles: ['super_admin'],
  permissions: ['health.read', 'settings.read'],
};

const REGULAR_USER: UserIdentity = {
  id: 99,
  username: 'member',
  email: 'member@example.com',
  roles: ['user'],
  permissions: ['users.read'],
};

describe('Health Check 12.4 (Liveness, Readiness, Degraded vs Critical, Providers, Migration & Redaction)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Liveness Check: running process trả ok/200; shutting down trả down/503', async () => {
    const healthy = await buildHarness({ runtimeState: 'running' });
    const liveReply = createReplyMock();
    const resOk = await healthy.controller.liveness(liveReply.reply);
    expect(resOk.live).toBe(true);
    expect(resOk.status).toBe('ok');
    expect(liveReply.statusCalls).toEqual([]);

    const stopping = await buildHarness({ runtimeState: 'stopping' });
    const downReply = createReplyMock();
    const resDown = await stopping.controller.liveness(downReply.reply);
    expect(resDown.live).toBe(false);
    expect(resDown.status).toBe('down');
    expect(downReply.statusCalls).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);
  });

  it('Database Check có timeout rõ: vượt quá health.db.timeout_ms → ready=false và HTTP 503', async () => {
    const h = await buildHarness({ dbDelayMs: 600 });
    setHealthSetting(h.settingRegistry, HEALTH_SETTING_KEYS.DB_TIMEOUT_MS, 200);

    const { reply, statusCalls } = createReplyMock();
    const readyRes = await h.controller.readiness(ADMIN_ACTOR, reply);

    expect(readyRes.ready).toBe(false);
    expect(readyRes.status).toBe('down');
    expect(statusCalls).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);
    expect(readyRes.checks?.['database']).toMatchObject({
      status: 'down',
      severity: 'critical',
      timeoutMs: 200,
    });
    expect(String(readyRes.checks?.['database']?.error)).toContain('timed out after 200ms');
  });

  it('Redis & Queue: phân biệt suy giảm (degraded → HTTP 200) và lỗi nghiêm trọng (unavailable → HTTP 503)', async () => {
    // Suy giảm: Redis ping chậm & Queue có backlog cao
    const degraded = await buildHarness({
      redisDelayMs: 60,
      messagingState: 'connected',
      queues: [{ name: 'system.events', waiting: 1500, active: 1, delayed: 0, failed: 2, paused: false, workers: 1 }],
    });
    setHealthSetting(degraded.settingRegistry, HEALTH_SETTING_KEYS.REDIS_DEGRADED_LATENCY_MS, 20);
    setHealthSetting(degraded.settingRegistry, HEALTH_SETTING_KEYS.QUEUE_BACKLOG_WARN_THRESHOLD, 1000);

    const degradedReply = createReplyMock();
    const readyDegraded = await degraded.controller.readiness(ADMIN_ACTOR, degradedReply.reply);
    expect(readyDegraded.ready).toBe(true);
    expect(readyDegraded.status).toBe('degraded');
    expect(degradedReply.statusCalls).toEqual([]);
    expect(readyDegraded.checks?.['redis']).toMatchObject({ status: 'degraded', severity: 'degraded' });
    expect(readyDegraded.checks?.['queue']).toMatchObject({ status: 'degraded', severity: 'degraded' });

    // Nghiêm trọng: Redis chết + Broker unavailable
    const critical = await buildHarness({ redisUp: false, messagingState: 'unavailable' });
    const critReply = createReplyMock();
    const readyCrit = await critical.controller.readiness(ADMIN_ACTOR, critReply.reply);
    expect(readyCrit.ready).toBe(false);
    expect(readyCrit.status).toBe('down');
    expect(critReply.statusCalls).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);
    expect(readyCrit.checks?.['redis']).toMatchObject({ status: 'down', severity: 'critical' });
    expect(readyCrit.checks?.['queue']).toMatchObject({ status: 'down', severity: 'critical' });
  });

  it('Storage Check: truyền setting health.storage.write_probe_enabled xuống StorageConnectionService và verify write/read/delete', async () => {
    const h = await buildHarness({ storageState: 'connected' });
    setHealthSetting(h.settingRegistry, HEALTH_SETTING_KEYS.STORAGE_WRITE_PROBE_ENABLED, true);

    await h.service.getDetailedHealth();
    expect(h.storageCheckSpy).toHaveBeenCalledWith({ writeProbe: true });

    // Kiểm tra StorageConnectionService.check({ writeProbe: true }) thực tế trên driver mock
    const store = new Map<string, Buffer>();
    const fakeProvider = {
      driver: {
        name: 'local',
        ping: async () => undefined,
        put: async (key: string, body: Buffer) => {
          store.set(key, body);
          return { multipart: false };
        },
        get: async (key: string) => {
          const buf = store.get(key);
          if (!buf) throw new Error('ENOENT');
          return buf;
        },
        delete: async (key: string) => {
          store.delete(key);
        },
      },
    } as unknown as BaseStorageProvider;
    const fakeConfig = {
      isTest: true,
      storage: { driver: 'local' },
    } as unknown as CoreConfigService;

    const conn = new StorageConnectionService(fakeProvider, fakeConfig);
    const result = await conn.check({ writeProbe: true });
    expect(result.state).toBe('connected');
    expect(store.size).toBe(0); // probe file đã được xóa sạch
  });

  it('Email, SMS và Provider: hiển thị trạng thái phụ thuộc và fallback khi primary DOWN', async () => {
    const h = await buildHarness();
    h.kernelProviders.replaceSnapshot(
      [
        {
          id: 1,
          providerCode: 'smtp-main',
          providerType: PROVIDER_TYPE.EMAIL,
          driverCode: 'smtp',
          displayName: 'Primary SMTP',
          domainRefCode: null,
          httpServiceName: null,
          role: PROVIDER_ROLE.PRIMARY,
          priority: 1,
          isPrimary: true,
          fallbackAllowed: false,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.DOWN,
          healthStatusName: 'DOWN',
          lastHealthCheckAt: new Date().toISOString(),
          lastHealthLatencyMs: 500,
          lastHealthErrorCode: 'SMTP_TIMEOUT',
        },
        {
          id: 2,
          providerCode: 'sendgrid-backup',
          providerType: PROVIDER_TYPE.EMAIL,
          driverCode: 'sendgrid',
          displayName: 'Backup SendGrid',
          domainRefCode: null,
          httpServiceName: null,
          role: PROVIDER_ROLE.FALLBACK,
          priority: 2,
          isPrimary: false,
          fallbackAllowed: true,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.HEALTHY,
          healthStatusName: 'HEALTHY',
          lastHealthCheckAt: new Date().toISOString(),
          lastHealthLatencyMs: 90,
          lastHealthErrorCode: null,
        },
        {
          id: 3,
          providerCode: 'twilio-main',
          providerType: PROVIDER_TYPE.SMS,
          driverCode: 'twilio',
          displayName: 'Twilio Primary',
          domainRefCode: null,
          httpServiceName: null,
          role: PROVIDER_ROLE.PRIMARY,
          priority: 1,
          isPrimary: true,
          fallbackAllowed: false,
          status: PROVIDER_STATUS.ACTIVE,
          statusName: 'ACTIVE',
          pausedAt: null,
          pausedReason: null,
          secretRef: null,
          hasEncryptedSecrets: false,
          config: {},
          healthStatus: PROVIDER_HEALTH_STATUS.DOWN,
          healthStatusName: 'DOWN',
          lastHealthCheckAt: new Date().toISOString(),
          lastHealthLatencyMs: 800,
          lastHealthErrorCode: 'SMS_DOWN',
        },
      ],
      [],
    );
    h.kernelProviders.setPolicyProvider(() => ({
      fallbackEnabled: true,
      fallbackAllowedTypes: [PROVIDER_TYPE.EMAIL, PROVIDER_TYPE.SMS],
      fallbackOnPaused: true,
      fallbackOnDown: true,
      fallbackOnDegraded: false,
      unitRoutingEnabled: true,
    }));

    const detailed = await h.controller.details();
    expect(detailed.ready).toBe(true); // Outbound provider lỗi không đánh sập API Readiness
    expect(detailed.status).toBe('degraded');
    expect(detailed.dependencies.providers.email).toMatchObject({
      status: 'degraded',
      resolvedProviderCode: 'sendgrid-backup',
      fallbackAvailable: true,
      downCount: 1,
      healthyCount: 1,
    });
    expect(detailed.dependencies.providers.sms).toMatchObject({
      status: 'down',
      resolvedProviderCode: null,
      downCount: 1,
    });
  });

  it('Migration Check: cảnh báo DB chưa đúng phiên bản và hỗ trợ setting chặn Readiness', async () => {
    const h = await buildHarness({
      migrations: [
        {
          name: '1763400000000-Init',
          timestamp: 1763400000000,
          status: 'applied',
          appliedAt: new Date().toISOString(),
          integrity: 'ok',
        },
        {
          name: '1763500000000-AddAuditIndex',
          timestamp: 1763500000000,
          status: 'pending',
          appliedAt: null,
        },
      ],
    });

    // Mặc định fail_on_pending_migration = false → degraded (200) + cảnh báo
    const detailed = await h.controller.details();
    expect(detailed.dependencies.migration.upToDate).toBe(false);
    expect(detailed.dependencies.migration.pending).toBe(1);
    expect(detailed.dependencies.migration.pendingNames).toEqual(['1763500000000-AddAuditIndex']);
    expect(detailed.warnings.some((w) => w.includes('pending migration'))).toBe(true);
    expect(detailed.ready).toBe(true);

    // Cache hoạt động (lần gọi thứ 2 không query lại)
    await h.service.getDetailedHealth();
    expect(h.migrationsSpy).toHaveBeenCalledTimes(1);

    // Bật setting chặn Readiness khi còn pending migration → HTTP 503
    setHealthSetting(h.settingRegistry, HEALTH_SETTING_KEYS.READINESS_FAIL_ON_PENDING_MIGRATION, true);
    h.service.invalidateMigrationCache();
    const replyMock = createReplyMock();
    const readyBlocked = await h.controller.readiness(ADMIN_ACTOR, replyMock.reply);
    expect(readyBlocked.ready).toBe(false);
    expect(readyBlocked.status).toBe('down');
    expect(replyMock.statusCalls).toEqual([HttpStatus.SERVICE_UNAVAILABLE]);
  });

  it('Ẩn chi tiết nhạy cảm khỏi Health API công khai; chỉ quản trị viên xem được đầy đủ', async () => {
    const h = await buildHarness({ dbState: 'unavailable' });

    // 1. Anonymous caller → bị ẩn toàn bộ chi tiết nhạy cảm
    const anonRes = await h.controller.check(undefined, createReplyMock().reply);
    expect(anonRes).toMatchObject({ redacted: true, ready: false, live: true });
    expect('checks' in anonRes).toBe(false);

    const anonReady = await h.controller.readiness(undefined, createReplyMock().reply);
    expect(anonReady).toMatchObject({ redacted: true, ready: false });
    expect(anonReady.checks).toBeUndefined();

    // 2. User thường không có quyền admin → vẫn bị ẩn
    const userRes = await h.controller.check(REGULAR_USER, createReplyMock().reply);
    expect(userRes).toMatchObject({ redacted: true });
    expect('checks' in userRes).toBe(false);

    // 3. Admin → thấy đầy đủ checks và lỗi đã được sanitize (ẩn URI/mật khẩu)
    const adminRes = await h.controller.check(ADMIN_ACTOR, createReplyMock().reply);
    expect('checks' in adminRes).toBe(true);
    if ('checks' in adminRes) {
      expect(adminRes.checks['database']?.error).toContain('[REDACTED_URI]');
      expect(adminRes.checks['database']?.error).not.toContain('secret');
    }

    // 4. Tắt cờ ẩn chi tiết → công khai cũng thấy checks
    setHealthSetting(h.settingRegistry, HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS, false);
    const unredacted = await h.controller.check(undefined, createReplyMock().reply);
    expect('checks' in unredacted).toBe(true);

    // 5. sanitizeHealthError loại bỏ URI và password/token
    expect(
      sanitizeHealthError('postgres://admin:SuperSecret@10.0.0.1:5432/core?password=abc'),
    ).toBe('[REDACTED_URI]');
  });
});
