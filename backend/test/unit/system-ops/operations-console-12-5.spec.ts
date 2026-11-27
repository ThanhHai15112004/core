import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Queue } from 'bullmq';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  DatabaseConnectionService,
  DatabaseMonitoringService,
  DatabaseOperationsService,
  TypeOrmConfigService,
  TypeOrmPinoLogger,
  databaseKeys,
} from '@packages/database/index.js';
import { RequestContextService, LogStreamReader, type LogEntry } from '@packages/logging/index.js';
import {
  MessagingConnectionService,
  QUEUES,
  QueueRegistry,
  type QueueName,
} from '@packages/messaging/index.js';
import { schedulerKeys } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { DatabaseOpsService } from '@modules/database-ops/index.js';
import type { DatabaseMetricsService } from '@modules/database-ops/services/database-metrics.service.js';
import { DatabaseStoreService } from '@modules/database-ops/services/database-store.service.js';
import { LogsOpsService, LogsStoreService, type LogAuditService } from '@modules/logs-ops/index.js';
import { parseLogQuery } from '@modules/logs-ops/helpers/log-query.helper.js';
import { SchedulerOperationsService, SchedulerOpsService } from '@modules/scheduler-ops/index.js';
import { SystemInfoService } from '@modules/system-ops/index.js';

describe('Section 12.5 — Operations Console extensions', () => {
  let redis: RedisService;
  let config: CoreConfigService;
  let i18n: CoreI18nService;

  beforeEach(async () => {
    applyTestEnv();
    process.env['APP_GIT_COMMIT'] = 'abcdef1234567890abcdef1234567890abcdef12';
    process.env['APP_IMAGE'] = 'ghcr.io/core/backend:1.2.3';
    process.env['APP_IMAGE_DIGEST'] =
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['APP_BUILD_TIME'] = '2026-11-25T08:30:00.000Z';
    process.env['APP_DEPLOY_STRATEGY'] = 'blue-green';
    process.env['APP_DEPLOY_SLOT'] = 'green';
    process.env['DB_SLOW_QUERY_MS'] = '250';
    process.env['DB_BACKUP_MAX_AGE_HOURS'] = '24';
    process.env['SCHEDULER_SLOW_TASK_MS'] = '5000';

    config = new CoreConfigService();
    i18n = new CoreI18nService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
  });

  it('SystemInfoService returns Core/Project versions, deployment metadata and installed modules', () => {
    const sysInfo = new SystemInfoService(config);
    const info = sysInfo.getSystemInfo();

    expect(info.coreVersion).toBeTruthy();
    expect(info.projectVersion).toBeTruthy();
    expect(info.deployment.commit).toBe('abcdef1234567890abcdef1234567890abcdef12');
    expect(info.deployment.shortCommit).toBe('abcdef1');
    expect(info.deployment.image).toBe('ghcr.io/core/backend:1.2.3');
    expect(info.deployment.imageDigest).toBe(
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
    expect(info.deployment.buildTime).toBe('2026-11-25T08:30:00.000Z');
    expect(info.deployment.strategy).toBe('blue-green');
    expect(info.deployment.slot).toBe('green');
    expect(info.modules.total).toBeGreaterThan(0);
    expect(info.modules.enabled).toBeGreaterThan(0);

    const modules = sysInfo.getInstalledModules();
    const healthMod = modules.items.find((m) => m.name === 'health');
    expect(healthMod).toBeDefined();
    expect(healthMod?.status).toBe('enabled');
    expect(healthMod?.version).toBeTruthy();
  });

  it('TypeOrmPinoLogger & TypeOrmConfigService capture slow queries with requestId/traceId and DatabaseOpsService reads them', async () => {
    const typeOrmCfg = new TypeOrmConfigService(
      config,
      { id: 'api', instance: 'api-1', startedAt: Date.now() } as never,
      redis,
    );
    const options = typeOrmCfg.createTypeOrmOptions() as { logger?: TypeOrmPinoLogger };
    expect(options.logger).toBeInstanceOf(TypeOrmPinoLogger);

    RequestContextService.runWith(
      {
        correlationId: 'corr-slow-1',
        requestId: 'req-slow-1',
        traceId: '0123456789abcdef0123456789abcdef',
      },
      () => {
        options.logger?.logQuerySlow(
          640,
          "SELECT * FROM users WHERE email = 'secret@example.com' AND id = 42",
        );
      },
    );

    // Chờ pipeline Redis bất đồng bộ hoàn tất
    await new Promise((r) => setTimeout(r, 25));

    const store = new DatabaseStoreService(redis);
    const dbOps = new DatabaseOpsService(
      {
        getStatus: () => ({ state: 'connected' }),
        driver: 'mysql',
      } as unknown as DatabaseConnectionService,
      {} as unknown as DatabaseMonitoringService,
      {} as unknown as DatabaseOperationsService,
      {} as unknown as DatabaseMetricsService,
      store,
      config,
      i18n,
    );

    const slowRes = await dbOps.getSlowQueries('1h', 20);
    expect(slowRes.available).toBe(true);
    expect(slowRes.thresholdMs).toBe(250);
    expect(slowRes.items).toHaveLength(1);
    expect(slowRes.items[0]?.durationMs).toBe(640);
    expect(slowRes.items[0]?.requestId).toBe('req-slow-1');
    expect(slowRes.items[0]?.traceId).toBe('0123456789abcdef0123456789abcdef');
    expect(slowRes.items[0]?.correlationId).toBe('corr-slow-1');
    expect(slowRes.items[0]?.sql).not.toContain('secret@example.com');

    // Xác minh key Redis cũng khớp
    const rawList = await redis.client.lrange(databaseKeys(redis).slowQueries(), 0, -1);
    expect(rawList).toHaveLength(1);
  });

  it('DatabaseOpsService tracks backup status (unconfigured -> healthy -> warning/stale -> critical/failed)', async () => {
    const store = new DatabaseStoreService(redis);
    const dbOps = new DatabaseOpsService(
      {
        getStatus: () => ({ state: 'connected' }),
        driver: 'mysql',
      } as unknown as DatabaseConnectionService,
      {} as unknown as DatabaseMonitoringService,
      {} as unknown as DatabaseOperationsService,
      {} as unknown as DatabaseMetricsService,
      store,
      config,
      i18n,
    );

    const empty = await dbOps.getBackupStatus();
    expect(empty.status).toBe('unknown');
    expect(empty.source).toBe('unconfigured');

    const ok = await dbOps.reportBackup({
      status: 'success',
      sizeBytes: 1024 * 1024 * 50,
      durationMs: 4200,
      provider: 's3',
      location: 's3://backups/core/2026-11-25.sql.gz',
      retentionDays: 30,
      reportedBy: 'cron-backup',
    });
    expect(ok.status).toBe('healthy');
    expect(ok.stale).toBe(false);
    expect(ok.latest?.provider).toBe('s3');

    const stale = await dbOps.reportBackup({
      status: 'success',
      at: new Date(Date.now() - 30 * 3600_000).toISOString(),
    });
    expect(stale.status).toBe('warning');
    expect(stale.stale).toBe(true);

    const failed = await dbOps.reportBackup({
      status: 'failed',
      error: 'pg_dump: connection timed out',
    });
    expect(failed.status).toBe('critical');
    expect(failed.latest?.error).toContain('connection timed out');
    expect(failed.history.length).toBe(3);
  });

  it('LogsOpsService filters slow requests with requestId & traceId and supports slow:true query syntax', async () => {
    const nowIso = new Date().toISOString();
    const entries: LogEntry[] = [
      {
        id: '1700000001000-0',
        t: nowIso,
        level: 'warn',
        message: 'GET /api/v1/reports 200 1420ms',
        runtime: 'api',
        requestId: 'req-api-slow',
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        correlationId: 'corr-api-slow',
        route: '/api/v1/reports',
        durationMs: 1420,
        slowRequest: true,
        metadata: { method: 'GET', path: '/api/v1/reports', status: 200 },
      },
      {
        id: '1700000002000-0',
        t: nowIso,
        level: 'info',
        message: 'GET /api/v1/health 200 3ms',
        runtime: 'api',
        requestId: 'req-api-fast',
        traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        durationMs: 3,
        slowRequest: false,
        metadata: { method: 'GET', path: '/api/v1/health', status: 200 },
      },
    ];

    const stream = {
      isAvailable: () => true,
      recent: jest.fn(async () => entries),
      recentAfter: jest.fn(async () => ({ entries: [], contiguous: true })),
    } as unknown as LogStreamReader;
    const store = new LogsStoreService(redis, stream);
    const logsOps = new LogsOpsService(config, store, {} as unknown as LogAuditService);

    const parsed = parseLogQuery('slow:true');
    expect(parsed.slowOnly).toBe(true);

    const searchSlow = await logsOps.search(parsed, null, 50);
    expect(searchSlow.items).toHaveLength(1);
    expect(searchSlow.items[0]?.requestId).toBe('req-api-slow');

    const slowRequests = await logsOps.getSlowRequests('1h', 20);
    expect(slowRequests.available).toBe(true);
    expect(slowRequests.items).toHaveLength(1);
    expect(slowRequests.items[0]?.method).toBe('GET');
    expect(slowRequests.items[0]?.route).toBe('/api/v1/reports');
    expect(slowRequests.items[0]?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('SchedulerOpsService marks slow task executions and filters slowOnly', async () => {
    const keys = schedulerKeys(redis);
    await redis.client.hset(
      keys.definitions(),
      'sync.reports',
      JSON.stringify({
        id: 'sync.reports',
        queue: QUEUES.SYSTEM_EVENTS,
        name: 'Sync Reports',
        every: 60000,
      }),
    );

    const now = Date.now();
    const fakeQueue = {
      name: QUEUES.SYSTEM_EVENTS,
      getJobSchedulers: async () => [],
      getJobs: async (states: string[]) =>
        states.includes('completed')
          ? [
              {
                id: 'exec-slow-1',
                name: 'Sync Reports',
                repeatJobKey: 'sync.reports',
                timestamp: now - 10_000,
                processedOn: now - 9_000,
                finishedOn: now - 1_000, // 8000ms >= 5000ms
                attemptsMade: 1,
                failedReason: null,
              },
              {
                id: 'exec-fast-1',
                name: 'Sync Reports',
                repeatJobKey: 'sync.reports',
                timestamp: now - 20_000,
                processedOn: now - 19_500,
                finishedOn: now - 19_000, // 500ms < 5000ms
                attemptsMade: 1,
                failedReason: null,
              },
            ]
          : [],
    } as unknown as Queue;

    const queueMap = new Map<QueueName, Queue>([[QUEUES.SYSTEM_EVENTS, fakeQueue]]);
    const queueRegistry = {
      isKnown: (name: string) => queueMap.has(name as QueueName),
      get: (name: string) => queueMap.get(name as QueueName)!,
      getQueues: () => queueMap,
      withTimeout: <T>(p: Promise<T>) => p,
    } as unknown as QueueRegistry;
    const connection = {
      getStatus: () => ({ state: 'connected', lastPingMs: 1 }),
    } as unknown as MessagingConnectionService;

    const ops = new SchedulerOperationsService(
      config,
      redis,
      queueRegistry,
      connection,
      { publish: async () => undefined, recordPublished: () => undefined } as never,
      new AuditLogService(),
    );
    const schedulerOps = new SchedulerOpsService(
      config,
      i18n,
      redis,
      queueRegistry,
      ops,
      connection,
    );

    const all = await schedulerOps.getExecutions({ range: '1h', limit: 20 });
    expect(all.items).toHaveLength(2);
    expect(all.items.find((x) => x.id === 'exec-slow-1')?.slow).toBe(true);
    expect(all.items.find((x) => x.id === 'exec-fast-1')?.slow).toBe(false);

    const slowOnly = await schedulerOps.getExecutions({ range: '1h', slowOnly: true, limit: 20 });
    expect(slowOnly.items).toHaveLength(1);
    expect(slowOnly.items[0]?.id).toBe('exec-slow-1');
  });
});
