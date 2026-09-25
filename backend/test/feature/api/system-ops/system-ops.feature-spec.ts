import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { PackageStatus, PackageCategory, CorePackageId } from '@packages/kernel/index.js';
import { SYSTEM_OPS_ROUTES } from '@modules/system-ops/index.js';
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

  it('GET /ops/packages/:packageId should return single package details', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildPackageDetailPath(CorePackageId.CACHE),
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      data: { packageId: string; displayName: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.packageId).toBe(CorePackageId.CACHE);
  });

  it('GET /ops/packages/:packageId should return 404 for unknown package', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: SYSTEM_OPS_ROUTES.buildPackageDetailPath('unknown_pkg_xyz'),
    });

    expect(response.statusCode).toBe(404);
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
    it('should translate 404 error message into English', async () => {
      const response = await context.app.inject({
        method: 'GET',
        url: SYSTEM_OPS_ROUTES.buildPackageDetailPath('unknown_pkg_xyz'),
        headers: { 'accept-language': 'en-US,en;q=0.9' },
      });

      const body = JSON.parse(response.payload) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Package [unknown_pkg_xyz] does not exist in the system.');
    });

    it('should default 404 error message to Vietnamese', async () => {
      const response = await context.app.inject({
        method: 'GET',
        url: SYSTEM_OPS_ROUTES.buildPackageDetailPath('unknown_pkg_xyz'),
      });

      const body = JSON.parse(response.payload) as { error: { message: string } };
      expect(body.error.message).toBe('Package [unknown_pkg_xyz] không tồn tại trong hệ thống.');
    });

    it('should translate package display names and actions', async () => {
      const response = await context.app.inject({
        method: 'GET',
        url: SYSTEM_OPS_ROUTES.buildPackageDetailPath(CorePackageId.CACHE),
        headers: { 'accept-language': 'en' },
      });

      const body = JSON.parse(response.payload) as {
        data: { displayName: string; actions: Array<{ label: string }> };
      };
      expect(body.data.displayName).toBe('Cache');
      expect(body.data.actions[0]?.label).toBe('Flush core cache');
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
        keyMetrics: Array<{ id: string; label: string }>;
        healthMap: Array<{ id: string; status: string }>;
      };
    };

    // 5 package + worker + scheduler; trong test không có telemetry runtime, không có database thật
    // (database đang kết nối/không khả dụng) và broker messaging không kết nối được → không tính là ổn định.
    expect(body.data.overallHealth.totalServices).toBe(8);
    expect(body.data.overallHealth.healthyServices).toBe(3);
    expect(body.data.keyMetrics.find((m) => m.id === 'req_sec')?.label).toBe('Requests / Sec');
    expect(body.data.healthMap.find((m) => m.id === 'runtime-worker')?.status).toBe('unknown');
  });
});
