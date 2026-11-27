import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import type {
  DatabaseConnectionService,
  DatabaseOperationsService,
  MigrationPreflightReport,
  MigrationPreflightService,
  PostMigrationVerifierService,
} from '@packages/database/index.js';
import type { IBackupOpsPublicService } from '@modules/backup-ops/contracts/index.js';
import { MigrationDeployService } from '@modules/database-ops/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

type RolloutRepoParam = ConstructorParameters<typeof MigrationDeployService>[5];

function createPreflightReport(
  overrides: Partial<MigrationPreflightReport> = {},
): MigrationPreflightReport {
  return {
    checkedAt: new Date().toISOString(),
    mode: 'online',
    passed: true,
    strictPassed: true,
    overallRiskLevel: 'LOW',
    requiresBackup: false,
    totalMigrations: 1,
    appliedCount: 0,
    pendingCount: 1,
    errorCount: 0,
    warningCount: 0,
    items: [
      {
        name: 'AddCol1764400000000',
        timestamp: 1764400000000,
        status: 'pending',
        phase: 'expand',
        riskLevel: overrides.overallRiskLevel ?? 'LOW',
        requiresBackup: overrides.requiresBackup ?? false,
        checksum: 'abc123',
        dependsOn: [],
        findings: [],
      },
    ],
    findings: [],
    ...overrides,
  };
}

describe('MigrationDeployService', () => {
  let config: CoreConfigService;

  beforeEach(() => {
    applyTestEnv({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      OPS_DATABASE_MIGRATIONS_ENABLED: 'true',
      DB_MIGRATION_REQUIRE_APPROVAL_IN_PROD: 'true',
    });
    config = new CoreConfigService();
  });

  function buildService(opts: {
    report: MigrationPreflightReport;
    backupOverview?: Awaited<ReturnType<IBackupOpsPublicService['getOverview']>>;
    autoBackupSuccess?: boolean;
  }) {
    const savedRollouts: Record<string, unknown>[] = [];
    const connection = {
      connected: () => ({ options: { type: 'postgres' } }),
      getStatus: () => ({ state: 'connected' }),
    } as unknown as DatabaseConnectionService;

    const operations = {
      runMigrations: jest.fn(async () => ({
        at: new Date().toISOString(),
        status: 'completed' as const,
        executed: ['AddCol1764400000000'],
        error: null,
        durationMs: 42,
        metrics: [
          {
            name: 'AddCol1764400000000',
            checksum: 'abc123',
            durationMs: 42,
            lockTimeoutMs: 5000,
            statementTimeoutMs: 60000,
            exceededLockWarn: false,
          },
        ],
        maxMigrationDurationMs: 42,
        checksums: { AddCol1764400000000: 'abc123' },
      })),
    } as unknown as DatabaseOperationsService;

    const preflight = {
      analyze: jest.fn(async () => opts.report),
    } as unknown as MigrationPreflightService;

    const verifier = {
      verify: jest.fn(async () => ({
        checkedAt: new Date().toISOString(),
        passed: true,
        durationMs: 12,
        schema: {
          passed: true,
          pendingCount: 0,
          tamperedCount: 0,
          invalidIndexes: [],
          missingTables: [],
        },
        data: { passed: true, totalChecks: 1, failedChecks: 0 },
        health: {
          passed: true,
          dbOk: true,
          dbLatencyMs: 3,
          appHealthChecked: false,
          appHealthOk: null,
          appHealthUrl: null,
        },
        checks: [],
      })),
    } as unknown as PostMigrationVerifierService;

    const rolloutRepo = {
      findLatestChecksumMap: async () => ({}),
      saveSafe: jest.fn(async (data: Record<string, unknown>) => {
        savedRollouts.push(data);
        return { id: 1, ...data };
      }),
      listRecent: async () => [],
    } as unknown as RolloutRepoParam;

    const backupOps = {
      getOverview: jest.fn(
        async () =>
          opts.backupOverview ?? {
            latestDatabaseBackup: null,
          },
      ),
      runBackup: jest.fn(async () => ({
        id: 99,
        backupCode: 'BKP-DB-99',
        status: 'SUCCESS',
        verifyStatus: 'PENDING',
        startedAt: new Date().toISOString(),
      })),
      verifyBackupRecord: jest.fn(async () => ({
        passed: opts.autoBackupSuccess ?? true,
        summary: 'Restore drill ok',
      })),
    } as unknown as IBackupOpsPublicService;

    const service = new MigrationDeployService(
      config,
      connection,
      operations,
      preflight,
      verifier,
      rolloutRepo,
      backupOps,
    );

    return { service, operations, backupOps, savedRollouts };
  }

  it('requires approvedBy on production before deploying pending migrations', async () => {
    const { service } = buildService({ report: createPreflightReport() });
    await expect(service.deployMigrations({ releaseVersion: '2.0.0' })).rejects.toThrow();
  });

  it('blocks high-risk migrations when no verified recent backup exists, and succeeds when autoBackup=true', async () => {
    const riskyReport = createPreflightReport({
      overallRiskLevel: 'HIGH',
      requiresBackup: true,
    });

    const blocked = buildService({ report: riskyReport });
    await expect(
      blocked.service.deployMigrations({
        releaseVersion: '2.0.0',
        approvedBy: 'release-manager',
      }),
    ).rejects.toThrow();

    const withAutoBackup = buildService({ report: riskyReport, autoBackupSuccess: true });
    const res = await withAutoBackup.service.deployMigrations({
      releaseVersion: '2.0.0',
      approvedBy: 'release-manager',
      approvalTicket: 'CHG-404',
      autoBackup: true,
    });

    expect(res.status).toBe('SUCCESS');
    expect(res.backupRecordId).toBe(99);
    expect(res.backupCode).toBe('BKP-DB-99');
    expect(res.backupVerified).toBe(true);
    expect(res.approvedBy).toBe('release-manager');
    expect(res.postCheck?.passed).toBe(true);
    expect(withAutoBackup.savedRollouts.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks breaking DDL when allowBreaking is false', async () => {
    const breakingReport = createPreflightReport({
      passed: false,
      overallRiskLevel: 'CRITICAL',
      requiresBackup: false,
      findings: [
        {
          code: 'EXPAND_CONTRACT_VIOLATION',
          severity: 'error',
          category: 'expand_contract',
          migrationName: 'DropCol1764400000000',
          message: 'DROP COLUMN without phase=contract',
        },
      ],
    });
    const { service } = buildService({ report: breakingReport });
    await expect(
      service.deployMigrations({
        releaseVersion: '2.0.0',
        approvedBy: 'release-manager',
      }),
    ).rejects.toThrow();
  });
});
