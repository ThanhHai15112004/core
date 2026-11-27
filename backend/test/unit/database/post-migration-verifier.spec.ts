import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  PostMigrationVerifierService,
  type DatabaseConnectionService,
  type DatabaseOperationsService,
} from '@packages/database/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('PostMigrationVerifierService', () => {
  let config: CoreConfigService;

  beforeEach(() => {
    applyTestEnv();
    config = new CoreConfigService();
  });

  it('passes schema, data, and health checks when DB and app readiness are healthy', async () => {
    const qr = {
      connect: async () => undefined,
      release: async () => undefined,
      hasTable: async (name: string) => name === 'db_migration_rollouts',
    };
    const fakeDs = {
      options: { type: 'postgres' },
      createQueryRunner: () => qr,
      query: async (sql: string) => {
        if (sql.includes('pg_index')) return [];
        if (sql.includes('core_migrations')) return [{ cnt: 14 }];
        if (sql.includes('orphan_check')) return [{ cnt: 0 }];
        return [];
      },
    };
    const fakeConn = {
      connected: () => fakeDs,
      ping: async () => ({ ok: true, latencyMs: 4, error: null }),
    } as unknown as DatabaseConnectionService;

    const fakeOps = {
      migrations: async () => ({
        items: [
          {
            name: 'Init1764000000000',
            timestamp: 1764000000000,
            status: 'applied' as const,
            appliedAt: null,
            integrity: 'ok' as const,
          },
        ],
        lastRun: null,
      }),
    } as unknown as DatabaseOperationsService;

    const fakeFetch = (async () =>
      ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;

    const verifier = new PostMigrationVerifierService(config, fakeConn, fakeOps, fakeFetch);
    const report = await verifier.verify({
      expectedTables: ['db_migration_rollouts'],
      postChecks: [{ name: 'orphan_check', sql: 'SELECT 0 AS cnt FROM orphan_check' }],
      healthUrl: 'http://127.0.0.1:3005/api/v1/health/ready',
    });

    expect(report.passed).toBe(true);
    expect(report.schema.passed).toBe(true);
    expect(report.schema.invalidIndexes).toEqual([]);
    expect(report.data.passed).toBe(true);
    expect(report.health.passed).toBe(true);
    expect(report.health.appHealthOk).toBe(true);
  });

  it('fails verification when invalid index, missing table, or pending migration is found', async () => {
    const qr = {
      connect: async () => undefined,
      release: async () => undefined,
      hasTable: async () => false,
    };
    const fakeDs = {
      options: { type: 'postgres' },
      createQueryRunner: () => qr,
      query: async (sql: string) => {
        if (sql.includes('pg_index')) return [{ index_name: 'public.idx_broken' }];
        return [{ cnt: 1 }];
      },
    };
    const fakeConn = {
      connected: () => fakeDs,
      ping: async () => ({ ok: true, latencyMs: 5, error: null }),
    } as unknown as DatabaseConnectionService;
    const fakeOps = {
      migrations: async () => ({
        items: [
          {
            name: 'Pending1764500000000',
            timestamp: 1764500000000,
            status: 'pending' as const,
            appliedAt: null,
            integrity: 'ok' as const,
          },
        ],
        lastRun: null,
      }),
    } as unknown as DatabaseOperationsService;

    const verifier = new PostMigrationVerifierService(config, fakeConn, fakeOps);
    const report = await verifier.verify({
      expectedTables: ['missing_tbl'],
    });

    expect(report.passed).toBe(false);
    expect(report.schema.passed).toBe(false);
    expect(report.schema.pendingCount).toBe(1);
    expect(report.schema.invalidIndexes).toEqual(['public.idx_broken']);
    expect(report.schema.missingTables).toEqual(['missing_tbl']);
  });
});
