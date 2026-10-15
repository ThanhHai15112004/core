import { describe, it, expect, beforeEach } from '@jest/globals';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import {
  createPaginationQueryFixture,
  defineFactory,
  tokenPayloadFactory,
  userIdentityFactory,
} from '../../fixtures/data-factory.fixture.js';
import {
  TestDatabaseSafetyError,
  assertSafeTestDatabase,
  truncateTestTables,
  withRollbackTransaction,
} from '../../concerns/test-database.concern.js';
import {
  buildModuleCoverageReport,
  classifySourceFileToModule,
  formatModuleCoverageMarkdown,
  type IstanbulCoverageSummaryJson,
} from '../../concerns/coverage-reporter.concern.js';

interface SampleEntity {
  id: string;
  name: string;
  active: boolean;
  role: string;
}

describe('Testing Foundation Unit Tests (Task 2.7)', () => {
  beforeEach(() => {
    applyTestEnv();
    userIdentityFactory.resetSequence();
    tokenPayloadFactory.resetSequence();
  });

  describe('2.7.5 DataFactory & Fixtures', () => {
    it('build, buildMany, state và create/createMany hoạt động đúng với sequence tự tăng', async () => {
      const sampleFactory = defineFactory<SampleEntity>((seq) => ({
        id: `entity-${seq}`,
        name: `Sample ${seq}`,
        active: true,
        role: 'member',
      }));

      const first = sampleFactory.build();
      const second = sampleFactory.build({ name: 'Custom Name' });
      expect(first).toEqual({
        id: 'entity-1',
        name: 'Sample 1',
        active: true,
        role: 'member',
      });
      expect(second.id).toBe('entity-2');
      expect(second.name).toBe('Custom Name');

      // Immutable state/trait
      const inactiveAdminFactory = sampleFactory
        .state({ active: false })
        .state((seq) => ({ role: `admin-${seq}` }));

      const adminItem = inactiveAdminFactory.build();
      expect(adminItem).toEqual({
        id: 'entity-1',
        name: 'Sample 1',
        active: false,
        role: 'admin-1',
      });

      const batch = sampleFactory.buildMany(3);
      expect(batch).toHaveLength(3);

      // Persist qua Repository
      const savedStore: SampleEntity[] = [];
      const mockRepo = {
        save: async (item: SampleEntity) => {
          savedStore.push(item);
          return item;
        },
      };

      const createdOne = await sampleFactory.create(mockRepo, { role: 'owner' });
      expect(createdOne.role).toBe('owner');
      const createdMany = await sampleFactory.createMany(mockRepo, 2);
      expect(createdMany).toHaveLength(2);
      expect(savedStore).toHaveLength(3);
    });

    it('userIdentityFactory, tokenPayloadFactory và createPaginationQueryFixture sinh dữ liệu chuẩn', () => {
      const user = userIdentityFactory.build({ permissions: ['users.read'] });
      expect(user).toEqual({
        id: 'user-test-1',
        email: 'user1@test.local',
        roles: ['user'],
        permissions: ['users.read'],
      });

      const payload = tokenPayloadFactory.build();
      expect(payload).toEqual({
        sub: 'user-test-1',
        roles: ['user'],
      });

      const query = createPaginationQueryFixture({ limit: 50, search: 'core' });
      expect(query).toEqual({ page: 1, limit: 50, search: 'core' });
    });
  });

  describe('2.7.4 Test Database Safety Guard & Rollback Harness', () => {
    it('chấp nhận tên DB test hợp lệ (:memory:, *_test, test_*) và chặn DB production/dev', () => {
      expect(() => assertSafeTestDatabase('core_test', 'test')).not.toThrow();
      expect(() => assertSafeTestDatabase('test_core', 'test')).not.toThrow();
      expect(() => assertSafeTestDatabase(':memory:', 'test')).not.toThrow();

      expect(() => assertSafeTestDatabase('core_production', 'test')).toThrow(
        TestDatabaseSafetyError,
      );
      expect(() => assertSafeTestDatabase('core', 'test')).toThrow(TestDatabaseSafetyError);
      expect(() => assertSafeTestDatabase('core_test', 'production')).toThrow(
        TestDatabaseSafetyError,
      );
      expect(() => assertSafeTestDatabase('', 'test')).toThrow(TestDatabaseSafetyError);
    });

    it('withRollbackTransaction luôn luôn rollback và giải phóng QueryRunner sau khi chạy test', async () => {
      const lifecycle = {
        connected: false,
        started: false,
        rolledBack: false,
        released: false,
      };
      const queries: string[] = [];

      const manager = {
        query: async (sql: string) => {
          queries.push(sql);
          return [];
        },
      } as unknown as EntityManager;

      const runner = {
        manager,
        connect: async () => {
          lifecycle.connected = true;
        },
        startTransaction: async () => {
          lifecycle.started = true;
        },
        rollbackTransaction: async () => {
          lifecycle.rolledBack = true;
        },
        release: async () => {
          lifecycle.released = true;
        },
      } as unknown as QueryRunner;

      const ds = {
        options: { type: 'postgres', database: 'core_test' },
        createQueryRunner: () => runner,
      } as unknown as DataSource;

      const outcome = await withRollbackTransaction(ds, async (em) => {
        await em.query('INSERT INTO sample_items VALUES (1)');
        return 'ok-in-tx';
      });

      expect(outcome).toEqual({ result: 'ok-in-tx', rolledBack: true });
      expect(lifecycle).toEqual({
        connected: true,
        started: true,
        rolledBack: true,
        released: true,
      });
      expect(queries).toEqual(['INSERT INTO sample_items VALUES (1)']);
    });

    it('truncateTestTables thực thi TRUNCATE an toàn theo driver và chặn tên bảng không hợp lệ', async () => {
      const executedSql: string[] = [];
      const pgDs = {
        options: { type: 'postgres', database: 'core_test' },
        query: async (sql: string) => {
          executedSql.push(sql);
          return [];
        },
      } as unknown as DataSource;

      await truncateTestTables(pgDs, ['users', 'audit_logs']);
      expect(executedSql).toEqual(['TRUNCATE TABLE "users", "audit_logs" RESTART IDENTITY CASCADE']);

      await expect(truncateTestTables(pgDs, ['users; DROP TABLE x'])).rejects.toThrow(
        TestDatabaseSafetyError,
      );
    });
  });

  describe('2.7.7 Module Coverage Reporter', () => {
    it('gom nhóm chính xác độ phủ theo từng package, module, app và định dạng bảng Markdown', () => {
      expect(
        classifySourceFileToModule('/repo/backend/src/packages/security/guards/auth.guard.ts'),
      ).toEqual({
        key: 'packages/security',
        category: 'packages',
        name: 'security',
      });
      expect(
        classifySourceFileToModule('/repo/backend/src/modules/health/services/health.service.ts'),
      ).toEqual({
        key: 'modules/health',
        category: 'modules',
        name: 'health',
      });

      const mockSummary: IstanbulCoverageSummaryJson = {
        '/repo/backend/src/packages/kernel/errors/app.exception.ts': {
          statements: { total: 20, covered: 18, skipped: 0, pct: 90 },
          branches: { total: 10, covered: 8, skipped: 0, pct: 80 },
          functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
          lines: { total: 20, covered: 18, skipped: 0, pct: 90 },
        },
        '/repo/backend/src/packages/kernel/utils/id.util.ts': {
          statements: { total: 10, covered: 6, skipped: 0, pct: 60 },
          branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
          functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
          lines: { total: 10, covered: 6, skipped: 0, pct: 60 },
        },
        '/repo/backend/src/modules/health/services/health.service.ts': {
          statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
          branches: { total: 4, covered: 4, skipped: 0, pct: 100 },
          functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
          lines: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
      };

      const report = buildModuleCoverageReport(mockSummary);
      expect(report.totalFiles).toBe(3);
      expect(report.overall.statements.pct).toBe(85);
      expect(report.items).toHaveLength(2);

      const kernelCov = report.items.find((i) => i.key === 'packages/kernel')!;
      expect(kernelCov.fileCount).toBe(2);
      expect(kernelCov.statements).toEqual({ total: 30, covered: 24, skipped: 0, pct: 80 });

      const healthCov = report.items.find((i) => i.key === 'modules/health')!;
      expect(healthCov.statements.pct).toBe(100);

      const markdown = formatModuleCoverageMarkdown(report);
      expect(markdown).toContain('`packages/kernel`');
      expect(markdown).toContain('`modules/health`');
      expect(markdown).toContain('80.00% (24/30)');
    });
  });
});
