import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import {
  SettingRegistryService,
  defaultSettingRegistry,
  discoverManifestSettings,
} from '@packages/kernel/index.js';
import { HEALTH_SETTING_KEYS } from '@modules/health/index.js';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

describe('Feature: Health API (GET /health)', () => {
  let context: TestAppContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('should return 200 with redacted public envelope by default when unauthenticated', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload) as {
      success: boolean;
      statusCode: number;
      data: {
        status: string;
        ready: boolean;
        live: boolean;
        redacted?: boolean;
        uptime: number;
        timestamp: string;
        checks?: Record<string, { status: string }>;
      };
      timestamp: string;
    };

    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    // DB test (core_test) không chạy trong môi trường test → health báo degraded thay vì ok giả;
    // Public /health mặc định bật health.public.hide_details nên ẩn chi tiết `checks`.
    expect(body.data.status).toBe('degraded');
    expect(body.data.ready).toBe(false);
    expect(body.data.live).toBe(true);
    expect(body.data.redacted).toBe(true);
    expect('checks' in body.data).toBe(false);
    expect(typeof body.data.uptime).toBe('number');
    expect(typeof body.data.timestamp).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('should expose checks details when health.public.hide_details is disabled', async () => {
    const registry =
      context.moduleFixture.get(SettingRegistryService, { strict: false }) ??
      defaultSettingRegistry;
    const prevDef = registry.getDefinition(HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS);
    if (!prevDef) {
      const manifestDef = discoverManifestSettings().settings.find(
        (s) => s.key === HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS,
      );
      if (manifestDef) {
        registry.registerManifestSetting(manifestDef);
      }
    }
    const baseDef = registry.getDefinition(HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS);
    if (!baseDef) {
      throw new Error(`Setting definition "${HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS}" not found`);
    }

    registry.upsertDefinition({
      ...baseDef,
      globalSerializedValue: 'false',
    });

    try {
      const response = await context.app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as {
        success: boolean;
        statusCode: number;
        data: {
          status: string;
          checks: Record<string, { status: string }>;
        };
      };

      expect(body.success).toBe(true);
      expect(body.data.status).toBe('degraded');
      expect(body.data.checks['database']?.status).toBe('down');
      expect(body.data.checks['redis']?.status).toBe('up');
      expect(body.data.checks['heap']?.status).toBe('up');
    } finally {
      registry.upsertDefinition(baseDef);
    }
  });

  it('should support HEAD probes with Cache-Control: no-store for Load Balancers (13.5)', async () => {
    const checkHead = await context.app.inject({ method: 'HEAD', url: '/health' });
    expect(checkHead.statusCode).toBe(200);
    expect(checkHead.headers['cache-control']).toBe('no-store');

    const liveHead = await context.app.inject({ method: 'HEAD', url: '/health/live' });
    expect(liveHead.statusCode).toBe(200);
    expect(liveHead.headers['cache-control']).toBe('no-store');

    const readyHead = await context.app.inject({ method: 'HEAD', url: '/health/ready' });
    expect([200, 503]).toContain(readyHead.statusCode);
    expect(readyHead.headers['cache-control']).toBe('no-store');
  });
});
