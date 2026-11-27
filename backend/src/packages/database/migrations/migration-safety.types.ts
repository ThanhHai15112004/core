import { createHash } from 'node:crypto';

export type MigrationPhase = 'expand' | 'contract' | 'standard';

export type MigrationRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PreflightSeverity = 'info' | 'warning' | 'error';

export type PreflightCategory =
  'syntax' | 'dependency' | 'checksum' | 'expand_contract' | 'lock_risk' | 'backfill';

export interface PostMigrationSqlCheck {
  readonly name: string;
  readonly sql: string;
  /** Mặc định kỳ vọng count === 0 (ví dụ đếm bản ghi lỗi/null). Nếu 'positive' thì kỳ vọng > 0. */
  readonly expectation?: 'zero' | 'positive';
}

export interface MigrationSafetyMetadata {
  readonly phase?: MigrationPhase;
  readonly dependsOn?: readonly string[];
  readonly riskLevel?: MigrationRiskLevel;
  readonly requiresBackup?: boolean;
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly expectedTables?: readonly string[];
  readonly postChecks?: readonly PostMigrationSqlCheck[];
  readonly transaction?: boolean;
}

export interface MigrationDescriptorInput {
  readonly name: string;
  readonly timestamp: number | null;
  readonly upSource: string;
  readonly downSource: string;
  readonly filePath?: string | null;
  readonly checksum?: string;
  readonly metadata?: MigrationSafetyMetadata;
}

export interface PreflightFinding {
  readonly code: string;
  readonly severity: PreflightSeverity;
  readonly category: PreflightCategory;
  readonly migrationName: string;
  readonly message: string;
  readonly recommendation?: string;
}

export interface MigrationPreflightItem {
  readonly name: string;
  readonly timestamp: number | null;
  readonly status: 'applied' | 'pending';
  readonly phase: MigrationPhase;
  readonly riskLevel: MigrationRiskLevel;
  readonly requiresBackup: boolean;
  readonly checksum: string;
  readonly dependsOn: readonly string[];
  readonly findings: readonly PreflightFinding[];
}

export interface MigrationPreflightReport {
  readonly checkedAt: string;
  readonly mode: 'online' | 'offline';
  readonly passed: boolean;
  readonly strictPassed: boolean;
  readonly overallRiskLevel: MigrationRiskLevel;
  readonly requiresBackup: boolean;
  readonly totalMigrations: number;
  readonly appliedCount: number;
  readonly pendingCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly items: readonly MigrationPreflightItem[];
  readonly findings: readonly PreflightFinding[];
}

export interface MigrationLockHandle {
  readonly token: string;
  readonly owner: string;
  readonly acquiredAt: string;
  readonly dbLockAcquired: boolean;
  readonly redisLockAcquired: boolean;
  readonly driver: string;
  readonly advisoryLockKey: number | string | null;
  release(): Promise<void>;
}

export interface MigrationExecutionMetric {
  readonly name: string;
  readonly checksum: string;
  readonly durationMs: number;
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly exceededLockWarn: boolean;
}

export interface PostMigrationCheckItem {
  readonly name: string;
  readonly category: 'schema' | 'data' | 'health';
  readonly passed: boolean;
  readonly detail: string;
  readonly durationMs: number;
}

export interface PostMigrationVerificationReport {
  readonly checkedAt: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly schema: {
    readonly passed: boolean;
    readonly pendingCount: number;
    readonly tamperedCount: number;
    readonly invalidIndexes: readonly string[];
    readonly missingTables: readonly string[];
  };
  readonly data: {
    readonly passed: boolean;
    readonly totalChecks: number;
    readonly failedChecks: number;
  };
  readonly health: {
    readonly passed: boolean;
    readonly dbOk: boolean;
    readonly dbLatencyMs: number | null;
    readonly appHealthChecked: boolean;
    readonly appHealthOk: boolean | null;
    readonly appHealthUrl: string | null;
  };
  readonly checks: readonly PostMigrationCheckItem[];
}

const RISK_ORDER: Record<MigrationRiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function maxRiskLevel(a: MigrationRiskLevel, b: MigrationRiskLevel): MigrationRiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export function riskMeetsThreshold(
  risk: MigrationRiskLevel,
  threshold: MigrationRiskLevel | 'NEVER',
): boolean {
  if (threshold === 'NEVER') return false;
  return RISK_ORDER[risk] >= RISK_ORDER[threshold];
}

/**
 * Tính mã băm SHA-256 rút gọn (16 hex) chuẩn duy nhất cho nội dung logic (`up`/`down`) của một Migration.
 */
export function computeMigrationChecksum(migration: {
  name?: string;
  up?: unknown;
  down?: unknown;
  upSource?: string;
  downSource?: string;
  constructor?: { name?: string };
}): string {
  const name = migration.name ?? migration.constructor?.name ?? '';
  const upSource =
    typeof migration.upSource === 'string'
      ? migration.upSource
      : typeof migration.up === 'function'
        ? migration.up.toString()
        : '';
  const downSource =
    typeof migration.downSource === 'string'
      ? migration.downSource
      : typeof migration.down === 'function'
        ? migration.down.toString()
        : '';
  const normalized = `${name}|${upSource}|${downSource}`.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
