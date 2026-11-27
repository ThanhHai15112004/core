import { describe, it, expect, beforeEach } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import { MigrationPreflightService, computeMigrationChecksum } from '@packages/database/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('MigrationPreflightService', () => {
  let service: MigrationPreflightService;

  beforeEach(() => {
    applyTestEnv();
    const config = new CoreConfigService();
    service = new MigrationPreflightService(config);
  });

  it('passes clean expand migration without findings', async () => {
    const report = await service.analyze({
      descriptors: [
        {
          name: 'AddProfileBio1764400000000',
          timestamp: 1764400000000,
          upSource: "await queryRunner.query('ALTER TABLE users ADD COLUMN bio TEXT NULL');",
          downSource: "await queryRunner.query('ALTER TABLE users DROP COLUMN bio');",
          metadata: { phase: 'expand' },
        },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.strictPassed).toBe(true);
    expect(report.overallRiskLevel).toBe('LOW');
    expect(report.requiresBackup).toBe(false);
    expect(report.findings).toHaveLength(0);
  });

  it('detects syntax issues: unbalanced SQL parentheses and CONCURRENTLY without transaction=false', async () => {
    const report = await service.analyze({
      descriptors: [
        {
          name: 'BrokenIndex1764400000001',
          timestamp: 1764400000001,
          upSource:
            "await queryRunner.query('CREATE INDEX CONCURRENTLY idx_users_email ON users (email');",
          downSource: "await queryRunner.query('DROP INDEX idx_users_email');",
        },
      ],
    });

    expect(report.passed).toBe(false);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('SQL_SYNTAX_UNBALANCED_PARENS');
    expect(codes).toContain('CONCURRENTLY_REQUIRES_NO_TRANSACTION');
  });

  it('detects dependency errors: missing dependency, out-of-order timestamp, and cycles', async () => {
    const report = await service.analyze({
      descriptors: [
        {
          name: 'First1764400000010',
          timestamp: 1764400000010,
          upSource: "await queryRunner.query('SELECT 1');",
          downSource: "await queryRunner.query('SELECT 1');",
          metadata: { dependsOn: ['Second1764400000020', 'NonExistent1764400000000'] },
        },
        {
          name: 'Second1764400000020',
          timestamp: 1764400000020,
          upSource: "await queryRunner.query('SELECT 1');",
          downSource: "await queryRunner.query('SELECT 1');",
          metadata: { dependsOn: ['First1764400000010'] },
        },
      ],
    });

    expect(report.passed).toBe(false);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('MISSING_MIGRATION_DEPENDENCY');
    expect(codes).toContain('INVALID_MIGRATION_DEPENDENCY_ORDER');
    expect(codes).toContain('CYCLIC_MIGRATION_DEPENDENCY');
  });

  it('detects checksum tampering and missing source for applied migrations', async () => {
    const original = {
      name: 'InitUsers1764400000000',
      timestamp: 1764400000000,
      upSource: "await queryRunner.query('CREATE TABLE t (id INT)');",
      downSource: "await queryRunner.query('DROP TABLE t');",
    };
    const oldChecksum = computeMigrationChecksum(original);

    const report = await service.analyze({
      descriptors: [
        {
          ...original,
          upSource: "await queryRunner.query('CREATE TABLE t (id BIGINT)');",
        },
      ],
      appliedNames: new Set(['InitUsers1764400000000', 'DeletedOld1764300000000']),
      recordedChecksums: { InitUsers1764400000000: oldChecksum },
    });

    expect(report.passed).toBe(false);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('MODIFIED_APPLIED_MIGRATION');
    expect(codes).toContain('MISSING_APPLIED_SOURCE');
  });

  it('blocks breaking DDL unless phase=contract and flags lock risks & inline backfills', async () => {
    const breakingReport = await service.analyze({
      descriptors: [
        {
          name: 'DropLegacyCol1764400000030',
          timestamp: 1764400000030,
          upSource: "await queryRunner.query('ALTER TABLE users DROP COLUMN legacy_code');",
          downSource: "await queryRunner.query('SELECT 1');",
          metadata: { phase: 'standard' },
        },
        {
          name: 'RiskyIndexAndBackfill1764400000040',
          timestamp: 1764400000040,
          upSource: `
            await queryRunner.query('CREATE INDEX idx_u_status ON users (status)');
            await queryRunner.query('ALTER TABLE users ADD CONSTRAINT fk_u_org FOREIGN KEY (org_id) REFERENCES orgs(id)');
            await queryRunner.query('UPDATE users SET status = 1 WHERE status IS NULL');
          `,
          downSource: "await queryRunner.query('SELECT 1');",
        },
      ],
    });

    expect(breakingReport.passed).toBe(false);
    expect(breakingReport.requiresBackup).toBe(true);
    expect(['HIGH', 'CRITICAL']).toContain(breakingReport.overallRiskLevel);
    const codes = breakingReport.findings.map((f) => f.code);
    expect(codes).toContain('EXPAND_CONTRACT_VIOLATION');
    expect(codes).toContain('LOCK_RISK_INDEX_WITHOUT_CONCURRENTLY');
    expect(codes).toContain('LOCK_RISK_CONSTRAINT_VALIDATION');
    expect(codes).toContain('BACKFILL_IN_MIGRATION');

    // When explicitly marked phase='contract', DROP COLUMN becomes a controlled contract warning
    const contractReport = await service.analyze({
      descriptors: [
        {
          name: 'DropLegacyCol1764400000030',
          timestamp: 1764400000030,
          upSource: "await queryRunner.query('ALTER TABLE users DROP COLUMN legacy_code');",
          downSource: "await queryRunner.query('SELECT 1');",
          metadata: { phase: 'contract' },
        },
      ],
    });
    expect(contractReport.passed).toBe(true);
    expect(contractReport.requiresBackup).toBe(true);
    expect(contractReport.findings.map((f) => f.code)).toContain('CONTRACT_PHASE_MIGRATION');
  });
});
