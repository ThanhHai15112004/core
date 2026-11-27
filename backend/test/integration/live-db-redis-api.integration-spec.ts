import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { DataSource } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
  discoverManifestSettings,
} from '@packages/kernel/index.js';
import { HEALTH_SETTING_KEYS } from '@modules/health/index.js';
import { createTestApp, type TestAppContext } from '../concerns/test-app.concern.js';
import {
  assertSafeTestDatabase,
  withRollbackTransaction,
} from '../concerns/test-database.concern.js';

async function waitForDatabaseReady(
  connection: DatabaseConnectionService,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (connection.isConnected()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const status = connection.getStatus();
  throw new Error(
    `DatabaseConnectionService did not connect within ${timeoutMs}ms (state=${status.state}, error=${status.lastError?.message ?? 'none'}).`,
  );
}

describe('Live Integration & API Tests (Real PostgreSQL + Real Redis — Phase 15.1)', () => {
  let context: TestAppContext;
  let config: CoreConfigService;
  let dbConnection: DatabaseConnectionService;
  let dataSource: DataSource;
  let redis: RedisService;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['DB_ENABLED'] = 'true';

    context = await createTestApp({ useRealRedis: true });
    config = context.moduleFixture.get(CoreConfigService);
    dbConnection = context.moduleFixture.get(DatabaseConnectionService);
    dataSource = context.moduleFixture.get(DataSource);
    redis = context.moduleFixture.get(RedisService);

    assertSafeTestDatabase(config.database.database, config.app.env);
    await waitForDatabaseReady(dbConnection);
  }, 30_000);

  afterAll(async () => {
    if (context) {
      await context.close();
    }
  });

  it('connects to real PostgreSQL, verifies migrated schema and rolls back transaction cleanly', async () => {
    expect(dbConnection.isConnected()).toBe(true);
    expect(dataSource.isInitialized).toBe(true);

    const pingRows = (await dataSource.query('SELECT 1 AS ok')) as Array<{ ok: number }>;
    expect(Number(pingRows[0]?.ok)).toBe(1);

    const tableRows = (await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('roles', 'permissions', 'users') ORDER BY table_name`,
    )) as Array<{ table_name: string }>;
    expect(tableRows.map((r) => r.table_name)).toEqual(['permissions', 'roles', 'users']);

    const probeCode = `ci_live_probe_${Date.now()}`;
    const rollbackRun = await withRollbackTransaction(dataSource, async (em) => {
      await em.query(
        `INSERT INTO roles (code, name, description, is_system) VALUES ($1, $2, $3, false)`,
        [probeCode, 'CI Live Probe Role', 'Temporary role inside rollback transaction'],
      );
      const insideRows = (await em.query(`SELECT code FROM roles WHERE code = $1`, [
        probeCode,
      ])) as Array<{ code: string }>;
      expect(insideRows).toHaveLength(1);
      return insideRows[0]?.code;
    });

    expect(rollbackRun.result).toBe(probeCode);
    expect(rollbackRun.rolledBack).toBe(true);

    const afterRows = (await dataSource.query(`SELECT code FROM roles WHERE code = $1`, [
      probeCode,
    ])) as Array<{ code: string }>;
    expect(afterRows).toHaveLength(0);
  });

  it('connects to real Redis and supports prefixed read/write/TTL lifecycle', async () => {
    const pong = await redis.client.ping();
    expect(pong).toBe('PONG');

    const key = redis.key(`ci-live-integration:${Date.now()}`);
    await redis.client.set(key, 'ok-from-ci', 'EX', 60);
    const val = await redis.client.get(key);
    const ttl = await redis.client.ttl(key);
    await redis.client.del(key);

    expect(val).toBe('ok-from-ci');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('serves live API health readiness and auth envelope against real DB and Redis', async () => {
    const liveRes = await context.injectJson<{ live: boolean }>({
      method: 'GET',
      url: '/health/live',
    });
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.success).toBe(true);
    expect(liveRes.body.data.live).toBe(true);

    const readyRes = await context.injectJson<{ ready: boolean }>({
      method: 'GET',
      url: '/health/ready',
    });
    expect(readyRes.status).toBe(200);
    expect(readyRes.body.success).toBe(true);
    expect(readyRes.body.data.ready).toBe(true);

    const registry =
      context.moduleFixture.get(SettingRegistryService, { strict: false }) ??
      defaultSettingRegistry;
    const existingDef = registry.getDefinition(HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS);
    if (!existingDef) {
      const manifestDef = discoverManifestSettings().settings.find(
        (s) => s.key === HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS,
      );
      if (manifestDef) {
        registry.registerManifestSetting(manifestDef);
      }
    }
    const baseDef = registry.getDefinition(HEALTH_SETTING_KEYS.PUBLIC_HIDE_DETAILS);
    if (baseDef) {
      registry.upsertDefinition({ ...baseDef, globalSerializedValue: 'false' });
    }

    try {
      const healthRes = await context.injectJson<{
        status: string;
        ready: boolean;
        checks: Record<string, { status: string }>;
      }>({
        method: 'GET',
        url: '/health',
      });
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.data.ready).toBe(true);
      expect(healthRes.body.data.checks['database']?.status).toBe('up');
      expect(healthRes.body.data.checks['redis']?.status).toBe('up');
    } finally {
      if (baseDef) {
        registry.upsertDefinition(baseDef);
      }
    }

    const badLogin = await context.injectJson({
      method: 'POST',
      url: '/auth/login',
      payload: {
        identifier: 'nonexistent.ci.user@example.com',
        password: 'InvalidPassword!123',
      },
    });
    expect([400, 401]).toContain(badLogin.status);
    expect(badLogin.body.success).toBe(false);
  });
});
