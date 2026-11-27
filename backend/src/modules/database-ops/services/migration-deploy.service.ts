import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  DatabaseConnectionService,
  DatabaseOperationError,
  DatabaseOperationsService,
  MigrationPreflightService,
  PostMigrationVerifierService,
  type MigrationExecutionMetric,
  type MigrationPhase,
  type MigrationPreflightReport,
  type MigrationRiskLevel,
  type MigrationRun,
  type PostMigrationVerificationReport,
} from '@packages/database/index.js';
import { safeJsonParse, safeJsonParseObject } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  BACKUP_OPS_PUBLIC_SERVICE,
  type IBackupOpsPublicService,
} from '@modules/backup-ops/contracts/index.js';
import { BACKUP_TARGET_TYPE, BACKUP_TRIGGER_SOURCE } from '@modules/backup-ops/index.js';
import {
  DbMigrationRolloutEntity,
  type MigrationRolloutStatus,
} from '../entities/db-migration-rollout.entity.js';
import {
  DatabaseActionRejectedException,
  DatabaseNotConnectedException,
} from '../exceptions/database-ops.exceptions.js';
import { DbMigrationRolloutRepository } from '../repositories/db-migration-rollout.repository.js';

export interface MigrationBackupReadinessDto {
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly reason: string;
  readonly latestBackupId: number | null;
  readonly latestBackupCode: string | null;
  readonly latestBackupAt: string | null;
  readonly latestBackupVerified: boolean;
}

export interface MigrationPreflightSummaryDto {
  readonly report: MigrationPreflightReport;
  readonly backupReadiness: MigrationBackupReadinessDto;
  readonly environment: string;
  readonly approvalRequiredInProd: boolean;
}

export interface SafeMigrationDeployInput {
  readonly releaseVersion?: string | undefined;
  readonly gitCommit?: string | undefined;
  readonly approvedBy?: string | undefined;
  readonly approvalTicket?: string | undefined;
  readonly executedBy?: string | undefined;
  readonly autoBackup?: boolean | undefined;
  readonly allowBreaking?: boolean | undefined;
  readonly skipBackupCheck?: boolean | undefined;
  readonly lockTimeoutMs?: number | undefined;
  readonly statementTimeoutMs?: number | undefined;
  readonly healthUrl?: string | undefined;
  readonly dryRun?: boolean | undefined;
  /** CLI `migration:deploy` được phép chạy kể cả khi `OPS_DATABASE_MIGRATIONS_ENABLED=false`. */
  readonly bypassOpsToggle?: boolean | undefined;
  readonly strictPreflight?: boolean | undefined;
}

export interface SafeMigrationDeployResult {
  readonly rolloutCode: string;
  readonly dryRun: boolean;
  readonly status: MigrationRolloutStatus | 'DRY_RUN_READY';
  readonly releaseVersion: string;
  readonly gitCommit: string | null;
  readonly environment: string;
  readonly phase: MigrationPhase;
  readonly riskLevel: MigrationRiskLevel;
  readonly approvedBy: string | null;
  readonly approvalTicket: string | null;
  readonly executedBy: string;
  readonly backupRecordId: number | null;
  readonly backupCode: string | null;
  readonly backupVerified: boolean;
  readonly lockTimeoutMs: number;
  readonly maxMigrationDurationMs: number;
  readonly durationMs: number;
  readonly executedMigrations: readonly MigrationExecutionMetric[];
  readonly preflight: MigrationPreflightReport;
  readonly postCheck: PostMigrationVerificationReport | null;
  readonly errorMessage: string | null;
}

export interface MigrationRolloutHistoryDto {
  readonly id: number;
  readonly rolloutCode: string;
  readonly releaseVersion: string;
  readonly gitCommit: string | null;
  readonly environment: string;
  readonly phase: MigrationPhase;
  readonly riskLevel: MigrationRiskLevel;
  readonly status: MigrationRolloutStatus;
  readonly executedMigrations: readonly MigrationExecutionMetric[];
  readonly approvedBy: string | null;
  readonly approvalTicket: string | null;
  readonly executedBy: string;
  readonly backupRecordId: number | null;
  readonly backupCode: string | null;
  readonly backupVerified: boolean;
  readonly lockTimeoutMs: number | null;
  readonly maxMigrationDurationMs: number | null;
  readonly durationMs: number;
  readonly preflightSummary: {
    readonly passed: boolean;
    readonly errorCount: number;
    readonly warningCount: number;
    readonly pendingCount: number;
  } | null;
  readonly postCheckSummary: {
    readonly passed: boolean;
    readonly schemaPassed: boolean;
    readonly dataPassed: boolean;
    readonly healthPassed: boolean;
  } | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/**
 * Bộ điều phối triển khai Migration an toàn (Section 15.4):
 * Preflight (syntax/dependency/checksum/expand-contract/lock risk)
 * -> Production Approval Gate
 * -> Conditional Backup Gate (tích hợp `backup-ops` + Restore Drill Verify)
 * -> Dual Lock + `lock_timeout` Execution
 * -> Post-Migration Verification (Schema + Data + Health)
 * -> Lưu lịch sử Rollout (`db_migration_rollouts`) & Audit Log.
 */
@Injectable()
export class MigrationDeployService {
  private readonly logger = new Logger(MigrationDeployService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly connection: DatabaseConnectionService,
    private readonly operations: DatabaseOperationsService,
    private readonly preflightService: MigrationPreflightService,
    private readonly verifierService: PostMigrationVerifierService,
    private readonly rolloutRepo: DbMigrationRolloutRepository,
    @Optional()
    @Inject(BACKUP_OPS_PUBLIC_SERVICE)
    private readonly backupOps?: IBackupOpsPublicService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  public async runPreflight(
    options: {
      offline?: boolean | undefined;
      backendRoot?: string | undefined;
      sinceTimestamp?: number | undefined;
    } = {},
  ): Promise<MigrationPreflightSummaryDto> {
    const recordedChecksums = options.offline ? {} : await this.rolloutRepo.findLatestChecksumMap();

    const report = await this.preflightService.analyze({
      offline: options.offline,
      backendRoot: options.backendRoot,
      sinceTimestamp: options.sinceTimestamp,
      recordedChecksums,
    });

    const backupReadiness = await this.evaluateBackupReadiness(report.requiresBackup);

    return {
      report,
      backupReadiness,
      environment: this.config.app.env,
      approvalRequiredInProd:
        this.config.isProduction && this.config.database.migrationRequireApprovalInProd,
    };
  }

  public async deployMigrations(
    input: SafeMigrationDeployInput = {},
  ): Promise<SafeMigrationDeployResult> {
    const startedAt = new Date();
    const startMs = Date.now();
    const env = this.config.app.env;
    const rolloutCode = `mig-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const releaseVersion = input.releaseVersion?.trim() || this.config.app.version || '1.0.0';
    const gitCommit = input.gitCommit?.trim() || null;
    const approvedBy = input.approvedBy?.trim() || null;
    const approvalTicket = input.approvalTicket?.trim() || null;
    const executedBy = input.executedBy?.trim() || 'system';
    const lockTimeoutMs = input.lockTimeoutMs ?? this.config.database.migrationLockTimeoutMs;
    const statementTimeoutMs =
      input.statementTimeoutMs ?? this.config.database.migrationStatementTimeoutMs;

    if (!input.bypassOpsToggle && !this.config.database.migrationsEnabled) {
      throw new DatabaseActionRejectedException(
        'MIGRATIONS_DISABLED',
        'database.error.MIGRATIONS_DISABLED',
      );
    }

    if (!this.connection.connected()) {
      throw new DatabaseNotConnectedException(this.connection.getStatus().state);
    }

    const recordedChecksums = await this.rolloutRepo.findLatestChecksumMap();
    const preflight = await this.preflightService.analyze({ recordedChecksums });

    // 1. Chặn lỗi Syntax / Dependency / Checksum hoặc Lock tuyệt đối
    const hardErrors = preflight.findings.filter(
      (f) => f.severity === 'error' && f.code !== 'EXPAND_CONTRACT_VIOLATION',
    );
    if (hardErrors.length > 0 || (input.strictPreflight && preflight.warningCount > 0)) {
      const firstMsg =
        hardErrors[0]?.message ?? preflight.findings[0]?.message ?? 'Preflight failed';
      throw new DatabaseActionRejectedException(
        'PREFLIGHT_FAILED',
        'database.error.PREFLIGHT_FAILED',
        { reason: firstMsg },
        422,
      );
    }

    // 2. Chặn Expand-and-Contract violation trừ khi cho phép tường minh
    const breakingFindings = preflight.findings.filter(
      (f) => f.code === 'EXPAND_CONTRACT_VIOLATION',
    );
    if (breakingFindings.length > 0 && !input.allowBreaking) {
      throw new DatabaseActionRejectedException(
        'BREAKING_DDL_BLOCKED',
        'database.error.BREAKING_DDL_BLOCKED',
        { migration: breakingFindings[0]?.migrationName ?? '' },
        422,
      );
    }

    const pendingItems = preflight.items.filter((i) => i.status === 'pending');
    const aggregatePhase: MigrationPhase = pendingItems.some((i) => i.phase === 'contract')
      ? 'contract'
      : pendingItems.some((i) => i.phase === 'expand')
        ? 'expand'
        : 'standard';

    // 3. Production Approval Gate (khi có pending migrations)
    if (
      pendingItems.length > 0 &&
      this.config.isProduction &&
      this.config.database.migrationRequireApprovalInProd &&
      !approvedBy
    ) {
      throw new DatabaseActionRejectedException(
        'APPROVAL_REQUIRED',
        'database.error.APPROVAL_REQUIRED',
        undefined,
        422,
      );
    }

    // 4. Conditional Backup Gate (khi có pending migrations và risk đạt ngưỡng)
    let backupRecordId: number | null = null;
    let backupCode: string | null = null;
    let backupVerified = false;

    if (pendingItems.length > 0 && preflight.requiresBackup && !input.skipBackupCheck) {
      const readiness = await this.evaluateBackupReadiness(true);
      if (readiness.satisfied) {
        backupRecordId = readiness.latestBackupId;
        backupCode = readiness.latestBackupCode;
        backupVerified = readiness.latestBackupVerified;
      } else if (input.autoBackup && this.backupOps && !input.dryRun) {
        this.logger.log(
          `Risk=${preflight.overallRiskLevel}: creating and verifying pre-migration database backup...`,
        );
        const record = await this.backupOps.runBackup({
          targetType: BACKUP_TARGET_TYPE.DATABASE,
          triggerSource: input.bypassOpsToggle
            ? BACKUP_TRIGGER_SOURCE.CLI
            : BACKUP_TRIGGER_SOURCE.MANUAL,
          actorName: executedBy,
          note: `Pre-migration backup for release ${releaseVersion} (${rolloutCode})`,
        });
        const drill = await this.backupOps.verifyBackupRecord(record.id, {
          actorName: executedBy,
          reason: `Pre-migration verification for ${rolloutCode}`,
        });
        if (!drill.passed) {
          throw new DatabaseActionRejectedException(
            'BACKUP_REQUIRED',
            'database.error.BACKUP_REQUIRED',
            { reason: `Pre-migration backup verification drill failed: ${drill.summary}` },
            422,
          );
        }
        backupRecordId = record.id;
        backupCode = record.backupCode;
        backupVerified = true;
      } else {
        throw new DatabaseActionRejectedException(
          'BACKUP_REQUIRED',
          'database.error.BACKUP_REQUIRED',
          { reason: readiness.reason },
          422,
        );
      }
    }

    // Dry-run preview
    if (input.dryRun) {
      return {
        rolloutCode,
        dryRun: true,
        status: 'DRY_RUN_READY',
        releaseVersion,
        gitCommit,
        environment: env,
        phase: aggregatePhase,
        riskLevel: preflight.overallRiskLevel,
        approvedBy,
        approvalTicket,
        executedBy,
        backupRecordId,
        backupCode,
        backupVerified,
        lockTimeoutMs,
        maxMigrationDurationMs: 0,
        durationMs: Date.now() - startMs,
        executedMigrations: [],
        preflight,
        postCheck: null,
        errorMessage: null,
      };
    }

    const preflightSummaryJson = JSON.stringify({
      passed: preflight.passed,
      overallRiskLevel: preflight.overallRiskLevel,
      errorCount: preflight.errorCount,
      warningCount: preflight.warningCount,
      pendingCount: preflight.pendingCount,
    });

    const savedRollout = await this.rolloutRepo.saveSafe({
      rolloutCode,
      releaseVersion,
      gitCommit,
      environment: env,
      phase: aggregatePhase,
      riskLevel: preflight.overallRiskLevel,
      status: 'RUNNING',
      approvedBy,
      approvalTicket,
      executedBy,
      backupRecordId,
      backupCode,
      backupVerified,
      lockTimeoutMs,
      preflightReportJson: preflightSummaryJson,
      startedAt,
    });

    // 5. Thực thi migration (có Dual Lock + lock_timeout)
    let runResult: MigrationRun;
    try {
      const ds = this.connection.connected();
      // Khi gọi qua CLI `migration:deploy`, bypass toggle UI console nếu migrationsEnabled=false
      runResult = await this.runWithOpsBypassIfNeeded(Boolean(input.bypassOpsToggle), () =>
        this.operations.runMigrations({
          lockTimeoutMs,
          statementTimeoutMs,
          extraRecordedChecksums: recordedChecksums,
          lockOwner: `${executedBy}:${rolloutCode}`,
        }),
      );
      void ds;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.finalizeRolloutRecord(savedRollout, {
        status: 'FAILED',
        executedMigrations: [],
        checksumSnapshot: recordedChecksums,
        maxMigrationDurationMs: 0,
        durationMs: Date.now() - startMs,
        postCheck: null,
        errorMessage: msg,
      });
      if (err instanceof DatabaseOperationError && err.code === 'BUSY') {
        throw new DatabaseActionRejectedException('BUSY', 'database.error.BUSY', undefined, 409);
      }
      throw err;
    }

    const executedMetrics = runResult.metrics ?? [];
    const maxMigrationDurationMs =
      runResult.maxMigrationDurationMs ??
      (executedMetrics.length > 0 ? Math.max(...executedMetrics.map((m) => m.durationMs)) : 0);

    if (runResult.status === 'failed') {
      const totalDuration = Date.now() - startMs;
      await this.finalizeRolloutRecord(savedRollout, {
        status: 'FAILED',
        executedMigrations: executedMetrics,
        checksumSnapshot: runResult.checksums ?? recordedChecksums,
        maxMigrationDurationMs,
        durationMs: totalDuration,
        postCheck: null,
        errorMessage: runResult.error,
      });
      await this.recordAudit(rolloutCode, releaseVersion, 'MIGRATION_DEPLOY_FAILED', false, {
        error: runResult.error,
        executed: runResult.executed,
        approvedBy,
      });
      return {
        rolloutCode,
        dryRun: false,
        status: 'FAILED',
        releaseVersion,
        gitCommit,
        environment: env,
        phase: aggregatePhase,
        riskLevel: preflight.overallRiskLevel,
        approvedBy,
        approvalTicket,
        executedBy,
        backupRecordId,
        backupCode,
        backupVerified,
        lockTimeoutMs,
        maxMigrationDurationMs,
        durationMs: totalDuration,
        executedMigrations: executedMetrics,
        preflight,
        postCheck: null,
        errorMessage: runResult.error,
      };
    }

    // 6. Hậu kiểm sau Migration (Schema + Data + Health)
    const postCheck = await this.verifierService.verify({
      healthUrl: input.healthUrl ?? null,
    });

    const finalStatus: MigrationRolloutStatus = !postCheck.passed
      ? 'POST_CHECK_FAILED'
      : executedMetrics.length === 0
        ? 'NO_OP'
        : 'SUCCESS';

    const totalDuration = Date.now() - startMs;
    await this.finalizeRolloutRecord(savedRollout, {
      status: finalStatus,
      executedMigrations: executedMetrics,
      checksumSnapshot: runResult.checksums ?? recordedChecksums,
      maxMigrationDurationMs,
      durationMs: totalDuration,
      postCheck,
      errorMessage: postCheck.passed ? null : 'Post-migration verification failed',
    });

    await this.recordAudit(
      rolloutCode,
      releaseVersion,
      finalStatus === 'POST_CHECK_FAILED' ? 'MIGRATION_POST_CHECK_FAILED' : 'MIGRATION_DEPLOYED',
      postCheck.passed,
      {
        status: finalStatus,
        executed: runResult.executed,
        approvedBy,
        approvalTicket,
        backupCode,
        maxMigrationDurationMs,
      },
    );

    return {
      rolloutCode,
      dryRun: false,
      status: finalStatus,
      releaseVersion,
      gitCommit,
      environment: env,
      phase: aggregatePhase,
      riskLevel: preflight.overallRiskLevel,
      approvedBy,
      approvalTicket,
      executedBy,
      backupRecordId,
      backupCode,
      backupVerified,
      lockTimeoutMs,
      maxMigrationDurationMs,
      durationMs: totalDuration,
      executedMigrations: executedMetrics,
      preflight,
      postCheck,
      errorMessage: postCheck.passed ? null : 'Post-migration verification checks failed',
    };
  }

  public async verifyPostMigration(
    options: {
      healthUrl?: string | null | undefined;
    } = {},
  ): Promise<PostMigrationVerificationReport> {
    if (!this.connection.connected()) {
      throw new DatabaseNotConnectedException(this.connection.getStatus().state);
    }
    return this.verifierService.verify({ healthUrl: options.healthUrl ?? null });
  }

  public async listRolloutHistory(
    query: {
      limit?: number | undefined;
      environment?: string | undefined;
      status?: MigrationRolloutStatus | undefined;
    } = {},
  ): Promise<MigrationRolloutHistoryDto[]> {
    const rows = await this.rolloutRepo.listRecent(query);
    return rows.map((r) => this.toHistoryDto(r));
  }

  public async evaluateBackupReadiness(required: boolean): Promise<MigrationBackupReadinessDto> {
    if (!this.backupOps) {
      return {
        required,
        satisfied: !required,
        reason: required
          ? 'BackupOpsService is unavailable'
          : 'Backup not required for low-risk migration',
        latestBackupId: null,
        latestBackupCode: null,
        latestBackupAt: null,
        latestBackupVerified: false,
      };
    }

    try {
      const overview = await this.backupOps.getOverview();
      const latest = overview.latestDatabaseBackup;
      if (!latest || latest.status !== 'SUCCESS') {
        return {
          required,
          satisfied: !required,
          reason: 'No successful database backup found.',
          latestBackupId: latest?.id ?? null,
          latestBackupCode: latest?.backupCode ?? null,
          latestBackupAt: latest?.startedAt ?? null,
          latestBackupVerified: false,
        };
      }

      const ageHours = (Date.now() - Date.parse(latest.startedAt)) / 3_600_000;
      const maxAge = this.config.database.migrationBackupMaxAgeHours;
      const verified = latest.verifyStatus === 'PASSED';
      const fresh = Number.isFinite(ageHours) && ageHours <= maxAge;

      if (!fresh) {
        return {
          required,
          satisfied: !required,
          reason: `Latest database backup (${latest.backupCode}) is ${ageHours.toFixed(1)}h old (max ${maxAge}h).`,
          latestBackupId: latest.id,
          latestBackupCode: latest.backupCode,
          latestBackupAt: latest.startedAt,
          latestBackupVerified: verified,
        };
      }

      if (!verified) {
        return {
          required,
          satisfied: !required,
          reason: `Latest database backup (${latest.backupCode}) has not passed restore verification drill (verifyStatus=${latest.verifyStatus}).`,
          latestBackupId: latest.id,
          latestBackupCode: latest.backupCode,
          latestBackupAt: latest.startedAt,
          latestBackupVerified: false,
        };
      }

      return {
        required,
        satisfied: true,
        reason: `Verified database backup ${latest.backupCode} is ready (${ageHours.toFixed(1)}h old).`,
        latestBackupId: latest.id,
        latestBackupCode: latest.backupCode,
        latestBackupAt: latest.startedAt,
        latestBackupVerified: true,
      };
    } catch (err) {
      return {
        required,
        satisfied: !required,
        reason: `Unable to evaluate backup status: ${err instanceof Error ? err.message : String(err)}`,
        latestBackupId: null,
        latestBackupCode: null,
        latestBackupAt: null,
        latestBackupVerified: false,
      };
    }
  }

  private async runWithOpsBypassIfNeeded<T>(bypass: boolean, fn: () => Promise<T>): Promise<T> {
    if (!bypass || this.config.database.migrationsEnabled) {
      return fn();
    }
    const dbCfg = this.config.database as { migrationsEnabled: boolean };
    dbCfg.migrationsEnabled = true;
    try {
      return await fn();
    } finally {
      dbCfg.migrationsEnabled = false;
    }
  }

  private async finalizeRolloutRecord(
    existing: DbMigrationRolloutEntity | null,
    payload: {
      status: MigrationRolloutStatus;
      executedMigrations: readonly MigrationExecutionMetric[];
      checksumSnapshot: Readonly<Record<string, string>>;
      maxMigrationDurationMs: number;
      durationMs: number;
      postCheck: PostMigrationVerificationReport | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    if (!existing) return;
    await this.rolloutRepo.saveSafe({
      ...existing,
      status: payload.status,
      executedMigrationsJson: JSON.stringify(payload.executedMigrations),
      checksumSnapshotJson: JSON.stringify(payload.checksumSnapshot),
      maxMigrationDurationMs: payload.maxMigrationDurationMs,
      durationMs: payload.durationMs,
      postCheckReportJson: payload.postCheck
        ? JSON.stringify({
            passed: payload.postCheck.passed,
            schemaPassed: payload.postCheck.schema.passed,
            dataPassed: payload.postCheck.data.passed,
            healthPassed: payload.postCheck.health.passed,
            durationMs: payload.postCheck.durationMs,
          })
        : null,
      errorMessage: payload.errorMessage,
      finishedAt: new Date(),
    });
  }

  private async recordAudit(
    rolloutCode: string,
    releaseVersion: string,
    action: string,
    succeeded: boolean,
    afterData: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog
      ?.record({
        module: 'database-ops',
        feature: 'migrations',
        action,
        resourceType: 'DB_MIGRATION_ROLLOUT',
        resourceId: rolloutCode,
        afterData: {
          succeeded,
          releaseVersion,
          environment: this.config.app.env,
          ...afterData,
        },
      })
      .catch(() => undefined);
  }

  private toHistoryDto(row: DbMigrationRolloutEntity): MigrationRolloutHistoryDto {
    const executedMigrations =
      safeJsonParse<MigrationExecutionMetric[]>(row.executedMigrationsJson, []) ?? [];
    const preflightSummary = row.preflightReportJson
      ? safeJsonParseObject<MigrationRolloutHistoryDto['preflightSummary']>(
          row.preflightReportJson,
          null,
        )
      : null;
    const postCheckSummary = row.postCheckReportJson
      ? safeJsonParseObject<MigrationRolloutHistoryDto['postCheckSummary']>(
          row.postCheckReportJson,
          null,
        )
      : null;

    return {
      id: row.id,
      rolloutCode: row.rolloutCode,
      releaseVersion: row.releaseVersion,
      gitCommit: row.gitCommit,
      environment: row.environment,
      phase: row.phase,
      riskLevel: row.riskLevel,
      status: row.status,
      executedMigrations,
      approvedBy: row.approvedBy,
      approvalTicket: row.approvalTicket,
      executedBy: row.executedBy,
      backupRecordId: row.backupRecordId,
      backupCode: row.backupCode,
      backupVerified: row.backupVerified,
      lockTimeoutMs: row.lockTimeoutMs,
      maxMigrationDurationMs: row.maxMigrationDurationMs,
      durationMs: row.durationMs,
      preflightSummary,
      postCheckSummary,
      errorMessage: row.errorMessage,
      startedAt:
        row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
      finishedAt:
        row.finishedAt instanceof Date
          ? row.finishedAt.toISOString()
          : row.finishedAt
            ? String(row.finishedAt)
            : null,
    };
  }
}
