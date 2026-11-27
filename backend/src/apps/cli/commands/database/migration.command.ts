import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import {
  BackfillOrchestratorService,
  MigrationDeployService,
} from '@modules/database-ops/index.js';
import {
  DatabaseOperationsService,
  MigrationPreflightService,
  type MigrationPhase,
} from '@packages/database/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';
import { ManifestService } from '../../services/manifest.service.js';

function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

@Injectable()
export class MigrationCommand implements ICliCommandProvider {
  constructor(
    @Optional() private readonly databaseOperations?: DatabaseOperationsService,
    @Optional() private readonly manifestService?: ManifestService,
    @Optional() private readonly preflightService?: MigrationPreflightService,
    @Optional() private readonly migrationDeploy?: MigrationDeployService,
    @Optional() private readonly backfillOrchestrator?: BackfillOrchestratorService,
  ) {}

  /** Khai báo danh mục các lệnh liên quan đến di trú Database */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'migration:check',
        domain: 'Database',
        description:
          'Kiểm tra trạng thái và tính toàn vẹn (checksum) các bản di trú (applied / pending)',
        usage: 'npm run cli -- migration:check [--run]',
        execute: (args) => this.checkMigrations(args),
      },
      {
        name: 'migration:preflight',
        domain: 'Database',
        description:
          'Kiểm tra an toàn migration trước triển khai (syntax, dependency, checksum, expand-contract, lock risk)',
        usage: 'npm run cli -- migration:preflight [--offline] [--strict] [--json]',
        execute: (args) => this.preflightMigrations(args),
      },
      {
        name: 'migration:deploy',
        domain: 'Database',
        description:
          'Triển khai migration an toàn có Dual Lock, lock_timeout, Backup Gate, Post-Check và ghi lịch sử rollout',
        usage:
          'npm run cli -- migration:deploy [--release=<ver>] [--commit=<sha>] [--approved-by=<user>] [--ticket=<id>] [--auto-backup] [--allow-breaking] [--skip-backup-check] [--lock-timeout-ms=5000] [--health-url=<url>] [--dry-run] [--json]',
        execute: (args) => this.deployMigrations(args),
      },
      {
        name: 'migration:verify',
        domain: 'Database',
        description: 'Chạy kiểm tra hậu kiểm sau migration (Schema, dữ liệu và Application Health)',
        usage: 'npm run cli -- migration:verify [--health-url=<url>] [--json]',
        execute: (args) => this.verifyMigrations(args),
      },
      {
        name: 'migration:history',
        domain: 'Database',
        description: 'Xem lịch sử các lần triển khai migration Production/Staging',
        usage: 'npm run cli -- migration:history [--limit=20] [--env=<env>] [--json]',
        execute: (args) => this.historyMigrations(args),
      },
      {
        name: 'migration:backfill',
        domain: 'Database',
        description: 'Liệt kê hoặc chạy Backfill dữ liệu lớn tách khỏi Migration (Queue / Inline)',
        usage:
          'npm run cli -- migration:backfill [--list | --name=<name> [--enqueue | --inline] [--batch-size=500] [--throttle-ms=100] [--dry-run] [--json]]',
        execute: (args) => this.runBackfill(args),
      },
      {
        name: 'migration:create',
        domain: 'Database',
        description:
          'Tạo tệp migration mới theo quy chuẩn TypeORM & Expand-and-Contract (hỗ trợ gắn vào từng module)',
        usage:
          'npm run cli -- migration:create <MigrationName> [--module=<module-name>] [--phase=expand|contract|standard]',
        execute: (args) => this.createMigration(args),
      },
      {
        name: 'migration:rollback',
        domain: 'Database',
        description: 'Hoàn tác bản migration gần nhất (có khóa phân tán Dual Lock)',
        usage: 'npm run cli -- migration:rollback [--force]',
        execute: (args) => this.rollbackMigration(args),
      },
    ];
  }

  /** Kiểm tra danh sách các bản di trú (applied và pending) và thực thi nếu có cờ --run */
  public async checkMigrations(args: string[]): Promise<void> {
    if (!this.databaseOperations) {
      throw new Error(
        'DatabaseOperationsService is not available. Please ensure DatabaseModule is loaded.',
      );
    }

    console.log('\n--- CHECKING DATABASE MIGRATIONS STATUS ---');
    const { items, lastRun } = await this.databaseOperations.migrations();

    if (items.length === 0) {
      console.log('No migrations found or declared in system.\n');
      return;
    }

    console.log(
      '┌──────────────────────────────────────────────┬──────────┬───────────────┬────────────────────────┐',
    );
    console.log(
      '│ Migration Name                               │ Status   │ Integrity     │ Timestamp              │',
    );
    console.log(
      '├──────────────────────────────────────────────┼──────────┼───────────────┼────────────────────────┤',
    );

    let pendingCount = 0;
    let tamperedCount = 0;
    for (const item of items) {
      if (item.status === 'pending') pendingCount++;
      if (item.status === 'applied' && item.integrity && item.integrity !== 'ok') tamperedCount++;
      const name = item.name.padEnd(44).slice(0, 44);
      const status = (item.status === 'applied' ? 'APPLIED ' : 'PENDING ').padEnd(8);
      const integrity = (item.integrity ?? 'ok').toUpperCase().padEnd(13).slice(0, 13);
      const ts = (item.timestamp ? new Date(item.timestamp).toISOString() : '-').padEnd(22);

      console.log(`│ ${name} │ ${status} │ ${integrity} │ ${ts} │`);
    }

    console.log(
      '└──────────────────────────────────────────────┴──────────┴───────────────┴────────────────────────┘',
    );
    console.log(
      `Total: ${items.length} migrations (${items.length - pendingCount} applied, ${pendingCount} pending, ${tamperedCount} integrity warning(s))`,
    );

    if (lastRun) {
      console.log(
        `Last migration run: ${lastRun.at} | Status: ${lastRun.status} | Duration: ${lastRun.durationMs}ms`,
      );
    }

    const shouldRun = args.includes('--run');
    if (pendingCount > 0 && shouldRun) {
      console.log('\nExecuting pending migrations via Dual Lock...');
      const runResult = await this.databaseOperations.runMigrations();
      if (runResult.status === 'completed') {
        console.log(`✓ Migrations executed successfully (${runResult.executed.length} applied)\n`);
      } else {
        console.error(`✗ Migration execution failed: ${runResult.error}\n`);
        throw new Error(runResult.error ?? 'Migration run failed');
      }
    } else if (pendingCount > 0) {
      console.log('\nNote: You have pending migrations. To execute them safely, run:');
      console.log('  npm run cli -- migration:deploy\n');
    } else {
      console.log('\nDatabase schema is fully synchronized with migrations ✓\n');
    }
  }

  /** Kiểm tra preflight an toàn migration (online hoặc offline cho CI). */
  public async preflightMigrations(args: string[]): Promise<void> {
    const offline = args.includes('--offline');
    const strict = args.includes('--strict');
    const asJson = args.includes('--json');
    const sinceRaw = readFlag(args, 'since');
    const sinceTimestamp = sinceRaw ? Number(sinceRaw) : undefined;
    const backendRoot = this.manifestService?.getBackendRoot();

    const summary = this.migrationDeploy
      ? await this.migrationDeploy.runPreflight({
          offline,
          backendRoot,
          ...(Number.isFinite(sinceTimestamp) ? { sinceTimestamp } : {}),
        })
      : this.preflightService
        ? {
            report: await this.preflightService.analyze({
              offline,
              backendRoot,
              ...(Number.isFinite(sinceTimestamp) ? { sinceTimestamp } : {}),
            }),
            backupReadiness: null,
            environment: process.env['NODE_ENV'] ?? 'development',
            approvalRequiredInProd: false,
          }
        : null;

    if (!summary) {
      throw new Error('MigrationPreflightService is not available.');
    }

    const { report } = summary;
    if (asJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log('\n--- DATABASE MIGRATION PREFLIGHT CHECK ---');
      console.log(
        `Mode: ${report.mode.toUpperCase()} | Total: ${report.totalMigrations} | Pending: ${report.pendingCount} | Overall Risk: ${report.overallRiskLevel} | Requires Backup: ${report.requiresBackup}`,
      );
      console.log(
        `Errors: ${report.errorCount} | Warnings: ${report.warningCount} | Passed: ${report.passed ? 'YES' : 'NO'}`,
      );
      if (summary.backupReadiness) {
        console.log(`Backup Gate: ${summary.backupReadiness.reason}`);
      }
      if (report.findings.length > 0) {
        console.log('\nFindings:');
        for (const f of report.findings) {
          console.log(
            `  [${f.severity.toUpperCase()}] (${f.category}) ${f.migrationName} [${f.code}]: ${f.message}`,
          );
          if (f.recommendation) {
            console.log(`    -> Recommendation: ${f.recommendation}`);
          }
        }
      }
      console.log('');
    }

    if (!report.passed || (strict && !report.strictPassed)) {
      throw new Error(
        `Migration preflight failed (errors=${report.errorCount}, warnings=${report.warningCount})`,
      );
    }
  }

  /** Triển khai Migration an toàn có Backup gate, Approval gate, Dual Lock & Post-check. */
  public async deployMigrations(args: string[]): Promise<void> {
    if (!this.migrationDeploy) {
      throw new Error('MigrationDeployService is not available.');
    }
    const asJson = args.includes('--json');
    const lockTimeoutRaw = readFlag(args, 'lock-timeout-ms');
    const result = await this.migrationDeploy.deployMigrations({
      releaseVersion: readFlag(args, 'release'),
      gitCommit: readFlag(args, 'commit'),
      approvedBy: readFlag(args, 'approved-by'),
      approvalTicket: readFlag(args, 'ticket'),
      executedBy: readFlag(args, 'actor') ?? 'cli-operator',
      autoBackup: args.includes('--auto-backup'),
      allowBreaking: args.includes('--allow-breaking'),
      skipBackupCheck: args.includes('--skip-backup-check'),
      strictPreflight: args.includes('--strict'),
      ...(lockTimeoutRaw ? { lockTimeoutMs: Number(lockTimeoutRaw) } : {}),
      healthUrl: readFlag(args, 'health-url'),
      dryRun: args.includes('--dry-run'),
      bypassOpsToggle: true,
    });

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n--- SAFE DATABASE MIGRATION DEPLOY ---');
      console.log(
        `Rollout: ${result.rolloutCode} | Status: ${result.status} | Env: ${result.environment} | Release: ${result.releaseVersion}`,
      );
      console.log(
        `Phase: ${result.phase} | Risk: ${result.riskLevel} | ApprovedBy: ${result.approvedBy ?? '-'} | Backup: ${result.backupCode ?? 'N/A'} (verified=${result.backupVerified})`,
      );
      console.log(
        `Executed: ${result.executedMigrations.length} | MaxLockMs: ${result.maxMigrationDurationMs}ms | TotalDuration: ${result.durationMs}ms`,
      );
      if (result.postCheck) {
        console.log(
          `Post-Check: ${result.postCheck.passed ? 'PASSED' : 'FAILED'} (schema=${result.postCheck.schema.passed}, data=${result.postCheck.data.passed}, health=${result.postCheck.health.passed})`,
        );
      }
      if (result.errorMessage) {
        console.error(`Error: ${result.errorMessage}`);
      }
      console.log('');
    }

    if (result.status === 'FAILED' || result.status === 'POST_CHECK_FAILED') {
      throw new Error(result.errorMessage ?? `Migration deploy ended with ${result.status}`);
    }
  }

  /** Hậu kiểm sau migration (Schema, Data, Health). */
  public async verifyMigrations(args: string[]): Promise<void> {
    if (!this.migrationDeploy) {
      throw new Error('MigrationDeployService is not available.');
    }
    const asJson = args.includes('--json');
    const report = await this.migrationDeploy.verifyPostMigration({
      healthUrl: readFlag(args, 'health-url'),
    });
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('\n--- POST-MIGRATION VERIFICATION ---');
      console.log(
        `Status: ${report.passed ? 'PASSED' : 'FAILED'} | Duration: ${report.durationMs}ms`,
      );
      for (const c of report.checks) {
        console.log(`  [${c.passed ? 'OK' : 'FAIL'}] (${c.category}) ${c.name}: ${c.detail}`);
      }
      console.log('');
    }
    if (!report.passed) {
      throw new Error('Post-migration verification failed.');
    }
  }

  /** Lịch sử rollout migration. */
  public async historyMigrations(args: string[]): Promise<void> {
    if (!this.migrationDeploy) {
      throw new Error('MigrationDeployService is not available.');
    }
    const limit = Number(readFlag(args, 'limit') ?? 20);
    const environment = readFlag(args, 'env');
    const rows = await this.migrationDeploy.listRolloutHistory({ limit, environment });
    if (args.includes('--json')) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log('\n--- DATABASE MIGRATION ROLLOUT HISTORY ---');
    if (rows.length === 0) {
      console.log('No rollout history recorded yet.\n');
      return;
    }
    for (const r of rows) {
      console.log(
        `${r.startedAt} | ${r.rolloutCode} | ${r.environment} | v=${r.releaseVersion} | ${r.status} | risk=${r.riskLevel} | approved=${r.approvedBy ?? '-'} | executed=${r.executedMigrations.length} | ${r.durationMs}ms`,
      );
    }
    console.log('');
  }

  /** Liệt kê hoặc chạy Backfill dữ liệu lớn tách khỏi Migration. */
  public async runBackfill(args: string[]): Promise<void> {
    if (!this.backfillOrchestrator) {
      throw new Error('BackfillOrchestratorService is not available.');
    }
    const asJson = args.includes('--json');
    const name = readFlag(args, 'name') ?? args.find((a) => !a.startsWith('--'));
    const isList = args.includes('--list') || !name;

    if (isList) {
      const overview = await this.backfillOrchestrator.getOverview(20);
      if (asJson) {
        console.log(JSON.stringify(overview, null, 2));
        return;
      }
      console.log('\n--- DATABASE BACKFILL DEFINITIONS & RECENT JOBS ---');
      console.log('Definitions:');
      for (const d of overview.definitions) {
        console.log(
          `  - ${d.name} (batch=${d.defaultBatchSize}, throttle=${d.defaultThrottleMs}ms): ${d.description}`,
        );
      }
      console.log('\nRecent Jobs:');
      for (const j of overview.jobs) {
        console.log(
          `  #${j.id} ${j.jobCode} | ${j.jobName} | ${j.status} | ${j.processedRows}/${j.totalRows ?? '?'} (${j.percent}%) | dryRun=${j.dryRun}`,
        );
      }
      console.log('');
      return;
    }

    const batchRaw = readFlag(args, 'batch-size');
    const throttleRaw = readFlag(args, 'throttle-ms');
    const outcome = await this.backfillOrchestrator.enqueueOrRunBackfill({
      jobName: name,
      ...(batchRaw ? { batchSize: Number(batchRaw) } : {}),
      ...(throttleRaw ? { throttleMs: Number(throttleRaw) } : {}),
      dryRun: args.includes('--dry-run'),
      inline: !args.includes('--enqueue'),
      triggeredBy: readFlag(args, 'actor') ?? 'cli-operator',
    });

    console.log(JSON.stringify(outcome, null, 2));
  }

  /** Tạo tệp migration mới theo quy chuẩn đặt tên `<timestamp>-<PascalName>.ts` và Expand-and-Contract. */
  public async createMigration(args: string[]): Promise<void> {
    const rawName = args.find((a) => !a.startsWith('--'));
    if (!rawName) {
      throw new Error(
        'Migration name is required. Usage: npm run cli -- migration:create <MigrationName> [--module=<name>] [--phase=expand|contract|standard]',
      );
    }

    const pascal = rawName
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    if (!pascal) {
      throw new Error(`Invalid migration name "${rawName}".`);
    }

    const rawPhase = readFlag(args, 'phase')?.toLowerCase();
    const phase: MigrationPhase =
      rawPhase === 'expand' || rawPhase === 'contract' ? rawPhase : 'standard';

    const moduleArg = readFlag(args, 'module');
    const backendRoot = this.manifestService?.getBackendRoot() ?? process.cwd();

    let targetDir = path.join(backendRoot, 'src', 'database', 'migrations');
    if (moduleArg && this.manifestService) {
      const modules = await this.manifestService.discoverAllModules();
      const found = modules.find((m) => m.name === moduleArg);
      if (!found) {
        throw new Error(`Module "${moduleArg}" not found.`);
      }
      targetDir = path.join(found.directory, 'migrations');
    }

    const timestamp = Date.now();
    const className = `${pascal}${timestamp}`;
    const fileName = `${timestamp}-${pascal}.ts`;
    const filePath = path.join(targetDir, fileName);

    const phaseHint =
      phase === 'expand'
        ? 'Expand phase: chỉ thêm cột NULLable/có DEFAULT hoặc bảng mới để bản cũ & mới cùng chạy.'
        : phase === 'contract'
          ? 'Contract phase: chỉ xóa cột/bảng cũ sau khi 100% instance cũ đã rút khỏi traffic và backfill hoàn tất.'
          : 'Standard phase: tránh DDL phá vỡ tương thích ngược; tách backfill dữ liệu lớn sang DataBackfillContract.';

    const template = `import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: ${pascal} (${new Date(timestamp).toISOString()})
 * Phase: ${phase} — ${phaseHint}
 * Quy tắc: Tuyệt đối KHÔNG sửa đổi tệp migration này sau khi đã chạy trên môi trường Production.
 */
export class ${className} implements MigrationInterface {
  public readonly name = '${className}';
  public readonly phase = '${phase}' as const;
  public readonly dependsOn: readonly string[] = [];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Viết câu lệnh nâng cấp schema (forward migration) tại đây
    await queryRunner.query('SELECT 1');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Viết câu lệnh hoàn tác (rollback migration) tương ứng tại đây
    await queryRunner.query('SELECT 1');
  }
}
`;

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(filePath, template, 'utf8');
    console.log(`\n✓ Created migration file: ${path.relative(backendRoot, filePath)}`);
    console.log(`  Class: ${className} (phase=${phase})\n`);
  }

  /** Hoàn tác bản migration gần nhất thông qua DatabaseOperationsService. */
  public async rollbackMigration(args: string[]): Promise<void> {
    if (!this.databaseOperations) {
      throw new Error('DatabaseOperationsService is not available.');
    }
    const force = args.includes('--force');
    console.log('\nReverting last applied migration via Dual Lock...');
    const result = await this.databaseOperations.revertLastMigration({ force });
    console.log(`✓ Last migration reverted successfully in ${result.durationMs}ms\n`);
  }
}
