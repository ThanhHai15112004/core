import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { PackageStatus, PackageCategory, CorePackageId } from '@packages/kernel/index.js';
import { SYSTEM_OPS_ROUTES } from '@modules/system-ops/index.js';
import { DATABASE_OPS_ROUTES } from '@modules/database-ops/index.js';
import { LOGS_OPS_ROUTES } from '@modules/logs-ops/index.js';
import { SCHEDULER_OPS_ROUTES } from '@modules/scheduler-ops/index.js';
import { CacheAction } from '@packages/cache/index.js';
import { LoggingAction, LogLevel } from '@packages/logging/index.js';

describe('Feature: System Ops API (/ops/packages)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    // Flush cache mặc định tắt (chưa có RBAC) — bật riêng cho test thao tác của Package Registry.
    process.env['OPS_CACHE_FLUSH_ENABLED'] = 'true';
    context = await createTestApp();
  });

  afterAll(async () => {
    delete process.env['OPS_CACHE_FLUSH_ENABLED'];
    if (context) {
      await context.close();
    }
  });

  it('GET /ops/packages should return registered packages list with status and actions', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildPackagesPath(),
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      data: Array<{
        packageId: string;
        displayName: string;
        category: PackageCategory;
        statusReport: { status: PackageStatus; summary: string };
        actions: Array<{ id: string; label: string }>;
      }>;
    };

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    const cachePkg = body.data.find((p) => p.packageId === CorePackageId.CACHE);
    expect(cachePkg).toBeDefined();
    expect(cachePkg?.category).toBe(PackageCategory.CACHE);
    expect(cachePkg?.statusReport.status).toBe(PackageStatus.HEALTHY);

    const loggingPkg = body.data.find((p) => p.packageId === CorePackageId.LOGGING);
    expect(loggingPkg).toBeDefined();
    expect(loggingPkg?.category).toBe(PackageCategory.LOGGING);

    const dbPkg = body.data.find((p) => p.packageId === CorePackageId.DATABASE);
    expect(dbPkg).toBeDefined();
    expect(dbPkg?.category).toBe(PackageCategory.DATABASE);
  });

  it('POST /ops/packages/:packageId/actions/:actionId should execute action successfully', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: SYSTEM_OPS_ROUTES.buildExecuteActionPath(CorePackageId.CACHE, CacheAction.FLUSH_ALL),
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      data: { success: boolean; message: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.message).toContain('xoá');
  });

  it('POST /ops/packages/:packageId/actions/:actionId should execute logging set_level action', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: SYSTEM_OPS_ROUTES.buildExecuteActionPath(
        CorePackageId.LOGGING,
        LoggingAction.SET_LEVEL_DEBUG,
      ),
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      data: { success: boolean; data: { level: string } };
    };

    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.data.level).toBe(LogLevel.DEBUG);
  });

  describe('i18n (Accept-Language)', () => {
    const runUnknown = (headers?: Record<string, string>) =>
      context.app.inject({
        method: 'POST',
        url: SYSTEM_OPS_ROUTES.buildExecuteActionPath('unknown_pkg_xyz', 'noop'),
        ...(headers ? { headers } : {}),
      });

    it('should translate the unknown-package message into English', async () => {
      const response = await runUnknown({ 'accept-language': 'en-US,en;q=0.9' });

      const body = JSON.parse(response.payload) as {
        data: { success: boolean; message: string };
      };
      expect(body.data.success).toBe(false);
      expect(body.data.message).toBe('Package [unknown_pkg_xyz] does not exist in the system.');
    });

    it('should default the unknown-package message to Vietnamese', async () => {
      const response = await runUnknown();

      const body = JSON.parse(response.payload) as { data: { message: string } };
      expect(body.data.message).toBe('Package [unknown_pkg_xyz] không tồn tại trong hệ thống.');
    });

    it('should translate package display names and actions', async () => {
      const response = await context.app.inject({
        method: 'GET',
        url: SYSTEM_OPS_ROUTES.buildPackagesPath(),
        headers: { 'accept-language': 'en' },
      });

      const body = JSON.parse(response.payload) as {
        data: Array<{ packageId: string; displayName: string; actions: Array<{ label: string }> }>;
      };
      const cache = body.data.find((p) => p.packageId === CorePackageId.CACHE);
      expect(cache?.displayName).toBe('Cache');
      expect(cache?.actions[0]?.label).toBe('Flush core cache');
    });
  });
});

describe('Feature: System Ops overview (/ops/overview)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context?.close();
  });

  it('should return real counts and localized labels', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildOverviewPath(),
      headers: { 'accept-language': 'en' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as {
      data: {
        overallHealth: { totalServices: number; healthyServices: number };
        keyMetrics: Array<{ id: string; label: string; value: string | number }>;
        healthMap: Array<{ id: string; status: string; subtext: string }>;
      };
    };

    // 12 package (gồm metrics & tracing mới) + worker + scheduler; trong test không có telemetry runtime
    // (worker/scheduler unknown), không có database thật, broker không kết nối được (messaging + queue lỗi)
    // → 14 tổng cộng và 9 ổn định.
    expect(body.data.overallHealth.totalServices).toBe(14);
    expect(body.data.overallHealth.healthyServices).toBe(9);
    expect(body.data.keyMetrics.find((m) => m.id === 'req_sec')?.label).toBe('Requests / Sec');
    expect(body.data.healthMap.find((m) => m.id === 'runtime-worker')?.status).toBe('unknown');
    // API theo health check thật: database của test không chạy → không báo "healthy" giả.
    const api = body.data.healthMap.find((m) => m.id === 'runtime-api');
    expect(api?.status).toBe('critical');
    expect(api?.subtext).toContain('database');
    // Không có Prometheus → KPI HTTP không có số liệu ("--"), không phải 0.
    expect(body.data.keyMetrics.find((m) => m.id === 'req_sec')?.value).toBe('--');
    expect(body.data.keyMetrics.find((m) => m.id === 'err_rate')?.value).toBe('--');
  });
});

describe('Feature: Operations Console Section 12.5 (/ops/...)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context?.close();
  });

  it('GET /ops/system-info & GET /ops/modules should return versions, deployment info and installed modules', async () => {
    const infoRes = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildSystemInfoPath(),
    });
    expect(infoRes.statusCode).toBe(200);
    const infoBody = JSON.parse(infoRes.payload) as {
      success: boolean;
      data: {
        coreVersion: string;
        projectVersion: string;
        deployment: { nodeVersion: string };
        modules: { total: number; enabled: number };
      };
    };
    expect(infoBody.success).toBe(true);
    expect(infoBody.data.coreVersion).toBeTruthy();
    expect(infoBody.data.projectVersion).toBeTruthy();
    expect(infoBody.data.deployment.nodeVersion).toBeTruthy();
    expect(infoBody.data.modules.total).toBeGreaterThan(0);

    const modRes = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildModulesPath(),
    });
    expect(modRes.statusCode).toBe(200);
    const modBody = JSON.parse(modRes.payload) as {
      success: boolean;
      data: {
        summary: { total: number };
        items: Array<{ name: string; version: string; status: string }>;
      };
    };
    expect(modBody.success).toBe(true);
    expect(modBody.data.items.length).toBe(modBody.data.summary.total);
    const healthMod = modBody.data.items.find((m) => m.name === 'health');
    expect(healthMod).toBeDefined();
    expect(healthMod?.status).toBe('enabled');
  });

  it('POST /ops/database/backup/report, GET /ops/database/backup, GET /ops/database/queries/slow and GET /ops/overview should reflect 12.5 fields', async () => {
    const reportRes = await context.app.inject({
      method: 'POST',
      url: `/${DATABASE_OPS_ROUTES.PREFIX}/${DATABASE_OPS_ROUTES.BACKUP_REPORT}`,
      payload: {
        status: 'success',
        sizeBytes: 2048,
        durationMs: 1200,
        provider: 'pg_dump',
        location: 's3://backups/test.dump',
      },
    });
    expect(reportRes.statusCode).toBe(200);
    const reportBody = JSON.parse(reportRes.payload) as {
      data: { status: string; latest: { provider: string | null } | null };
    };
    expect(reportBody.data.status).toBe('healthy');
    expect(reportBody.data.latest?.provider).toBe('pg_dump');

    const backupRes = await context.app.inject({
      method: 'GET',
      url: `/${DATABASE_OPS_ROUTES.PREFIX}/${DATABASE_OPS_ROUTES.BACKUP}`,
    });
    expect(backupRes.statusCode).toBe(200);
    const backupBody = JSON.parse(backupRes.payload) as { data: { status: string } };
    expect(backupBody.data.status).toBe('healthy');

    const slowSqlRes = await context.app.inject({
      method: 'GET',
      url: `/${DATABASE_OPS_ROUTES.PREFIX}/${DATABASE_OPS_ROUTES.SLOW_QUERIES}?range=1h&limit=20`,
    });
    expect(slowSqlRes.statusCode).toBe(200);
    const slowSqlBody = JSON.parse(slowSqlRes.payload) as {
      data: { available: boolean; thresholdMs: number; items: unknown[] };
    };
    expect(slowSqlBody.data.available).toBe(true);
    expect(Array.isArray(slowSqlBody.data.items)).toBe(true);

    const overviewRes = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildOverviewPath(),
    });
    expect(overviewRes.statusCode).toBe(200);
    const overviewBody = JSON.parse(overviewRes.payload) as {
      data: {
        systemInfo?: { coreVersion: string };
        backupStatus?: { status: string };
      };
    };
    expect(overviewBody.data.systemInfo?.coreVersion).toBeTruthy();
    expect(overviewBody.data.backupStatus?.status).toBe('healthy');
  });

  it('GET /ops/logs/slow-requests and GET /ops/scheduler/executions?slowOnly=true should work', async () => {
    const slowLogsRes = await context.app.inject({
      method: 'GET',
      url: `/${LOGS_OPS_ROUTES.PREFIX}/${LOGS_OPS_ROUTES.SLOW_REQUESTS}?range=1h&limit=20`,
    });
    expect(slowLogsRes.statusCode).toBe(200);
    const slowLogsBody = JSON.parse(slowLogsRes.payload) as {
      data: { thresholdMs: number; items: unknown[] };
    };
    expect(typeof slowLogsBody.data.thresholdMs).toBe('number');
    expect(Array.isArray(slowLogsBody.data.items)).toBe(true);

    const slowExecRes = await context.app.inject({
      method: 'GET',
      url: `/${SCHEDULER_OPS_ROUTES.PREFIX}/${SCHEDULER_OPS_ROUTES.EXECUTIONS}?range=1h&slowOnly=true&limit=20`,
    });
    expect(slowExecRes.statusCode).toBe(200);
    const slowExecBody = JSON.parse(slowExecRes.payload) as {
      data: { items: unknown[] };
    };
    expect(Array.isArray(slowExecBody.data.items)).toBe(true);
  });
});
