import fs from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import {
  computeMigrationChecksum,
  maxRiskLevel,
  riskMeetsThreshold,
  type MigrationDescriptorInput,
  type MigrationPhase,
  type MigrationPreflightItem,
  type MigrationPreflightReport,
  type MigrationRiskLevel,
  type MigrationSafetyMetadata,
  type PreflightFinding,
} from './migration-safety.types.js';

export interface PreflightAnalyzeOptions {
  /** Chạy chế độ offline (quét mã nguồn file `.ts` thay vì đọc từ DataSource đã kết nối). */
  readonly offline?: boolean | undefined;
  /** Thư mục gốc backend để quét file migration khi chạy offline. */
  readonly backendRoot?: string | undefined;
  /** Danh sách migration truyền trực tiếp (ưu tiên dùng trong unit test hoặc kiểm tra tùy chỉnh). */
  readonly descriptors?: readonly MigrationDescriptorInput[] | undefined;
  /** Danh sách tên migration đã applied (dùng khi truyền `descriptors` thủ công). */
  readonly appliedNames?: ReadonlySet<string> | undefined;
  /** Bản đồ checksum đã lưu từ DB/Redis (`migrationName -> checksum`). */
  readonly recordedChecksums?: Readonly<Record<string, string>> | undefined;
  /** Chỉ kiểm tra Expand-and-Contract/Lock trên các migration có timestamp >= mốc này (dùng cho CI offline với legacy migrations). */
  readonly sinceTimestamp?: number | undefined;
}

interface DeclaredRuntimeMigration {
  name?: string;
  up?: unknown;
  down?: unknown;
  transaction?: boolean;
  phase?: MigrationPhase;
  dependsOn?: readonly string[];
  riskLevel?: MigrationRiskLevel;
  requiresBackup?: boolean;
  constructor: { name: string };
}

/**
 * Bộ phân tích an toàn Migration trước khi triển khai (Preflight Gate):
 * - Syntax & Structure (tên/timestamp, hàm up/down, dấu ngoặc, transaction vs CONCURRENTLY)
 * - Dependency (thứ tự `dependsOn`, phát hiện phụ thuộc thiếu hoặc vòng lặp)
 * - Checksum (phát hiện sửa đổi hoặc mất nguồn migration đã áp dụng)
 * - Expand-and-Contract (cảnh báo/chặn DDL phá vỡ tương thích ngược khi chưa khai báo phase `contract`)
 * - Lock Risk (phát hiện `CREATE INDEX` thiếu `CONCURRENTLY`, `ADD CONSTRAINT` thiếu `NOT VALID`, `ALTER TYPE`...)
 * - Backfill Guard (phát hiện DML cập nhật dữ liệu hàng loạt nằm trực tiếp trong migration)
 */
@Injectable()
export class MigrationPreflightService {
  private readonly logger = new Logger(MigrationPreflightService.name);

  constructor(
    private readonly config: CoreConfigService,
    @Optional() private readonly connection?: DatabaseConnectionService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public async analyze(options: PreflightAnalyzeOptions = {}): Promise<MigrationPreflightReport> {
    const ds = options.offline ? null : (this.connection?.connected() ?? null);
    const mode: 'online' | 'offline' = ds ? 'online' : 'offline';

    const descriptors = options.descriptors
      ? [...options.descriptors]
      : ds
        ? this.descriptorsFromDataSource(ds.migrations as DeclaredRuntimeMigration[])
        : await this.scanMigrationFiles(options.backendRoot ?? this.resolveDefaultBackendRoot());

    const appliedSet = options.appliedNames
      ? new Set(options.appliedNames)
      : ds
        ? await this.loadAppliedNames(ds)
        : new Set<string>();

    const recordedChecksums: Record<string, string> = {
      ...(await this.loadRedisChecksums()),
      ...(options.recordedChecksums ?? {}),
    };

    const findings: PreflightFinding[] = [];
    const seenNames = new Set<string>();
    const seenTimestamps = new Map<number, string>();
    const descriptorByName = new Map<string, MigrationDescriptorInput>();

    for (const d of descriptors) {
      if (seenNames.has(d.name)) {
        findings.push({
          code: 'DUPLICATE_MIGRATION_NAME',
          severity: 'error',
          category: 'syntax',
          migrationName: d.name,
          message: `Duplicate migration name detected: "${d.name}".`,
          recommendation: 'Rename one migration class so every migration name is unique.',
        });
      }
      seenNames.add(d.name);
      descriptorByName.set(d.name, d);

      if (d.timestamp !== null) {
        const existingOwner = seenTimestamps.get(d.timestamp);
        if (existingOwner && existingOwner !== d.name) {
          findings.push({
            code: 'DUPLICATE_MIGRATION_TIMESTAMP',
            severity: 'error',
            category: 'dependency',
            migrationName: d.name,
            message: `Migration "${d.name}" shares timestamp ${d.timestamp} with "${existingOwner}".`,
            recommendation:
              'Use a unique 13-digit timestamp prefix so execution order is deterministic.',
          });
        } else {
          seenTimestamps.set(d.timestamp, d.name);
        }
      }
    }

    // Kiểm tra migration đã applied nhưng mất file nguồn trong code
    for (const appliedName of appliedSet) {
      if (!descriptorByName.has(appliedName)) {
        findings.push({
          code: 'MISSING_APPLIED_SOURCE',
          severity: 'error',
          category: 'checksum',
          migrationName: appliedName,
          message: `Applied migration "${appliedName}" is missing from source code.`,
          recommendation: 'Restore the applied migration file; never delete historical migrations.',
        });
      }
    }

    // Kiểm tra dependency graph (missing target / ordering / cycles)
    this.validateDependencies(descriptors, appliedSet, findings);

    // Phân tích từng migration
    const items: MigrationPreflightItem[] = [];
    let overallRiskLevel: MigrationRiskLevel = 'LOW';
    let anyRequiresBackup = false;
    const backupThreshold = this.config.database.migrationRequireBackupRisk;

    const sorted = [...descriptors].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    for (const d of sorted) {
      const isApplied = appliedSet.has(d.name);
      const checksum = d.checksum ?? computeMigrationChecksum(d);
      const phase: MigrationPhase = d.metadata?.phase ?? 'standard';
      const itemFindings: PreflightFinding[] = [];
      let itemRisk: MigrationRiskLevel = d.metadata?.riskLevel ?? 'LOW';

      // 1. Checksum check đối với migration đã chạy
      if (isApplied) {
        const recorded = recordedChecksums[d.name];
        if (recorded && recorded !== checksum) {
          itemFindings.push({
            code: 'MODIFIED_APPLIED_MIGRATION',
            severity: 'error',
            category: 'checksum',
            migrationName: d.name,
            message: `Applied migration "${d.name}" checksum mismatch (recorded=${recorded}, current=${checksum}).`,
            recommendation:
              'Revert edits to applied migrations and create a new forward migration instead.',
          });
        }
      } else {
        // 2. Syntax & structure checks cho migration pending (hoặc toàn bộ trong offline mode)
        this.checkSyntaxAndStructure(d, itemFindings);

        // 3. Expand-and-Contract + Lock Risk + Backfill heuristics
        const withinSinceScope =
          options.sinceTimestamp === undefined ||
          d.timestamp === null ||
          d.timestamp >= options.sinceTimestamp;
        if (withinSinceScope) {
          const analysis = this.analyzeSqlSafety(d, phase, itemFindings);
          itemRisk = maxRiskLevel(itemRisk, analysis.riskLevel);
        }
      }

      // Thu thập finding toàn cục (duplicate/dependency) thuộc về migration này
      for (const f of findings) {
        if (f.migrationName === d.name && !itemFindings.includes(f)) {
          itemFindings.push(f);
        }
      }

      const itemRequiresBackup =
        d.metadata?.requiresBackup ?? riskMeetsThreshold(itemRisk, backupThreshold);

      if (!isApplied) {
        overallRiskLevel = maxRiskLevel(overallRiskLevel, itemRisk);
        if (itemRequiresBackup) {
          anyRequiresBackup = true;
        }
      }

      for (const f of itemFindings) {
        if (!findings.includes(f)) {
          findings.push(f);
        }
      }

      items.push({
        name: d.name,
        timestamp: d.timestamp,
        status: isApplied ? 'applied' : 'pending',
        phase,
        riskLevel: itemRisk,
        requiresBackup: itemRequiresBackup,
        checksum,
        dependsOn: d.metadata?.dependsOn ?? [],
        findings: itemFindings,
      });
    }

    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;

    return {
      checkedAt: new Date().toISOString(),
      mode,
      passed: errorCount === 0,
      strictPassed: errorCount === 0 && warningCount === 0,
      overallRiskLevel,
      requiresBackup: anyRequiresBackup,
      totalMigrations: items.length,
      appliedCount: items.filter((i) => i.status === 'applied').length,
      pendingCount: items.filter((i) => i.status === 'pending').length,
      errorCount,
      warningCount,
      items,
      findings,
    };
  }

  private descriptorsFromDataSource(
    migrations: readonly DeclaredRuntimeMigration[],
  ): MigrationDescriptorInput[] {
    return migrations.map((m) => {
      const name = m.name ?? m.constructor.name;
      const tsMatch = /(\d{13})$/.exec(name) ?? /^(\d{13})/.exec(name);
      const timestamp = tsMatch ? Number(tsMatch[1]) : null;
      const upSource = typeof m.up === 'function' ? m.up.toString() : '';
      const downSource = typeof m.down === 'function' ? m.down.toString() : '';
      const metadata: MigrationSafetyMetadata = {
        ...(m.phase ? { phase: m.phase } : {}),
        ...(Array.isArray(m.dependsOn) ? { dependsOn: m.dependsOn } : {}),
        ...(m.riskLevel ? { riskLevel: m.riskLevel } : {}),
        ...(typeof m.requiresBackup === 'boolean' ? { requiresBackup: m.requiresBackup } : {}),
        ...(typeof m.transaction === 'boolean' ? { transaction: m.transaction } : {}),
      };
      return {
        name,
        timestamp: timestamp !== null && Number.isFinite(timestamp) ? timestamp : null,
        upSource,
        downSource,
        checksum: computeMigrationChecksum({ name, upSource, downSource }),
        metadata,
      };
    });
  }

  private async scanMigrationFiles(backendRoot: string): Promise<MigrationDescriptorInput[]> {
    const candidateDirs = [path.join(backendRoot, 'src', 'database', 'migrations')];

    for (const group of ['modules', 'project-modules']) {
      const groupDir = path.join(backendRoot, 'src', group);
      const entries = await fs.readdir(groupDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidateDirs.push(path.join(groupDir, entry.name, 'migrations'));
        }
      }
    }

    const descriptors: MigrationDescriptorInput[] = [];
    for (const dir of candidateDirs) {
      const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.ts') || file.name.endsWith('.d.ts')) {
          continue;
        }
        const filePath = path.join(dir, file.name);
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        if (!content) continue;
        const parsed = this.parseMigrationSourceFile(content, filePath);
        if (parsed) {
          descriptors.push(parsed);
        }
      }
    }
    return descriptors;
  }

  public parseMigrationSourceFile(
    content: string,
    filePath: string,
  ): MigrationDescriptorInput | null {
    const classMatch = /export\s+class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface/.exec(
      content,
    );
    if (!classMatch?.[1]) return null;

    const className = classMatch[1];
    const namePropMatch = /\bname\s*=\s*['"`]([^'"`]+)['"`]/.exec(content);
    const name = namePropMatch?.[1] ?? className;
    const tsMatch = /(\d{13})$/.exec(name) ?? /^(\d{13})/.exec(path.basename(filePath));
    const timestamp = tsMatch ? Number(tsMatch[1]) : null;

    const upSource = this.extractMethodBody(content, 'up');
    const downSource = this.extractMethodBody(content, 'down');

    const phaseMatch = /\bphase\s*(?::[^=]+)?=\s*['"`](expand|contract|standard)['"`]/.exec(
      content,
    );
    const riskMatch = /\briskLevel\s*(?::[^=]+)?=\s*['"`](LOW|MEDIUM|HIGH|CRITICAL)['"`]/.exec(
      content,
    );
    const txMatch = /\btransaction\s*(?::[^=]+)?=\s*(true|false)/.exec(content);
    const backupMatch = /\brequiresBackup\s*(?::[^=]+)?=\s*(true|false)/.exec(content);
    const depsMatch = /\bdependsOn\s*(?::[^=]+)?=\s*\[([^\]]*)\]/.exec(content);
    const dependsOn = depsMatch?.[1]
      ? [...depsMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!).filter(Boolean)
      : undefined;

    const metadata: MigrationSafetyMetadata = {
      ...(phaseMatch?.[1] ? { phase: phaseMatch[1] as MigrationPhase } : {}),
      ...(riskMatch?.[1] ? { riskLevel: riskMatch[1] as MigrationRiskLevel } : {}),
      ...(txMatch?.[1] ? { transaction: txMatch[1] === 'true' } : {}),
      ...(backupMatch?.[1] ? { requiresBackup: backupMatch[1] === 'true' } : {}),
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    };

    return {
      name,
      timestamp: timestamp !== null && Number.isFinite(timestamp) ? timestamp : null,
      upSource,
      downSource,
      filePath,
      checksum: computeMigrationChecksum({ name, upSource, downSource }),
      metadata,
    };
  }

  private extractMethodBody(content: string, methodName: 'up' | 'down'): string {
    const methodRegex = new RegExp(
      `(?:^|\\n)[ \\t]*(?:public\\s+|private\\s+|protected\\s+)?(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{`,
    );
    const match = methodRegex.exec(content);
    if (!match) return '';

    const openBraceIdx = match.index + match[0].length - 1;
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (!inDouble && !inTemplate && ch === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && !inTemplate && ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (!inSingle && !inDouble && ch === '`') {
        inTemplate = !inTemplate;
        continue;
      }
      if (inSingle || inDouble || inTemplate) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return content.slice(openBraceIdx, i + 1);
        }
      }
    }
    return content.slice(openBraceIdx);
  }

  private validateDependencies(
    descriptors: readonly MigrationDescriptorInput[],
    appliedSet: ReadonlySet<string>,
    findings: PreflightFinding[],
  ): void {
    const byName = new Map(descriptors.map((d) => [d.name, d]));
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (name: string): void => {
      if (stack.has(name)) {
        findings.push({
          code: 'CYCLIC_MIGRATION_DEPENDENCY',
          severity: 'error',
          category: 'dependency',
          migrationName: name,
          message: `Circular migration dependency detected involving "${name}".`,
          recommendation: 'Break the cycle in `dependsOn` metadata.',
        });
        return;
      }
      if (visited.has(name)) return;
      visited.add(name);
      stack.add(name);

      const node = byName.get(name);
      for (const dep of node?.metadata?.dependsOn ?? []) {
        const depNode = byName.get(dep);
        if (!depNode && !appliedSet.has(dep)) {
          findings.push({
            code: 'MISSING_MIGRATION_DEPENDENCY',
            severity: 'error',
            category: 'dependency',
            migrationName: name,
            message: `Migration "${name}" declares dependsOn "${dep}", which does not exist.`,
            recommendation: 'Ensure the target dependency migration exists or fix the name.',
          });
          continue;
        }
        if (
          depNode &&
          node &&
          node.timestamp !== null &&
          depNode.timestamp !== null &&
          depNode.timestamp > node.timestamp
        ) {
          findings.push({
            code: 'INVALID_MIGRATION_DEPENDENCY_ORDER',
            severity: 'error',
            category: 'dependency',
            migrationName: name,
            message: `Migration "${name}" (${node.timestamp}) depends on "${dep}" (${depNode.timestamp}) which has a later timestamp.`,
            recommendation:
              'Ensure dependency timestamps are strictly earlier than dependent migrations.',
          });
        }
        if (depNode) visit(dep);
      }

      stack.delete(name);
    };

    for (const d of descriptors) {
      visit(d.name);
    }
  }

  private checkSyntaxAndStructure(d: MigrationDescriptorInput, findings: PreflightFinding[]): void {
    if (!d.name || d.timestamp === null) {
      findings.push({
        code: 'INVALID_MIGRATION_NAMING',
        severity: 'error',
        category: 'syntax',
        migrationName: d.name || '(unknown)',
        message: `Migration "${d.name}" does not follow <13-digit-timestamp>-<PascalName> naming convention.`,
        recommendation: 'Generate migrations via `npm run cli -- migration:create <Name>`.',
      });
    }

    if (!d.upSource.trim()) {
      findings.push({
        code: 'EMPTY_MIGRATION_UP',
        severity: 'error',
        category: 'syntax',
        migrationName: d.name,
        message: `Migration "${d.name}" has an empty or missing up() implementation.`,
      });
    }

    if (!d.downSource.trim()) {
      findings.push({
        code: 'MISSING_MIGRATION_DOWN',
        severity: 'warning',
        category: 'syntax',
        migrationName: d.name,
        message: `Migration "${d.name}" has no down() rollback method.`,
        recommendation: 'Provide a reversible down() or explicit no-op comment for audit clarity.',
      });
    }

    // Kiểm tra cân bằng dấu ngoặc trong các chuỗi SQL literal
    const sqlStrings = this.extractSqlLiterals(d.upSource);
    for (const sql of sqlStrings) {
      if (!this.hasBalancedParens(sql)) {
        findings.push({
          code: 'SQL_SYNTAX_UNBALANCED_PARENS',
          severity: 'error',
          category: 'syntax',
          migrationName: d.name,
          message: `Migration "${d.name}" contains SQL with unbalanced parentheses.`,
          recommendation: 'Verify the DDL/DML syntax in queryRunner.query(...).',
        });
        break;
      }
    }

    if (/\bCONCURRENTLY\b/i.test(d.upSource) && d.metadata?.transaction !== false) {
      findings.push({
        code: 'CONCURRENTLY_REQUIRES_NO_TRANSACTION',
        severity: 'error',
        category: 'syntax',
        migrationName: d.name,
        message: `Migration "${d.name}" uses CONCURRENTLY but does not set \`public readonly transaction = false\`.`,
        recommendation:
          'PostgreSQL rejects CREATE/DROP INDEX CONCURRENTLY inside a transaction block. Set `public readonly transaction = false;`.',
      });
    }
  }

  private analyzeSqlSafety(
    d: MigrationDescriptorInput,
    phase: MigrationPhase,
    findings: PreflightFinding[],
  ): { riskLevel: MigrationRiskLevel } {
    const sqlText = this.extractSqlLiterals(d.upSource).join('\n') || d.upSource;
    let riskLevel: MigrationRiskLevel = 'LOW';

    // 1. Expand-and-Contract checks
    const hasDropTable = /\bDROP\s+TABLE\b/i.test(sqlText);
    const hasDropColumn = /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i.test(sqlText);
    const hasRename = /\bRENAME\s+(?:COLUMN|TABLE|TO)\b/i.test(sqlText);
    const hasAlterType =
      /\bALTER\s+TABLE\b[\s\S]*?\b(?:ALTER\s+COLUMN|MODIFY\s+COLUMN)[\s\S]*?\bTYPE\b/i.test(
        sqlText,
      );

    if (hasDropTable || hasDropColumn || hasRename || hasAlterType) {
      riskLevel = maxRiskLevel(riskLevel, hasDropTable || hasAlterType ? 'CRITICAL' : 'HIGH');
      if (phase !== 'contract') {
        findings.push({
          code: 'EXPAND_CONTRACT_VIOLATION',
          severity: 'error',
          category: 'expand_contract',
          migrationName: d.name,
          message: `Migration "${d.name}" performs breaking DDL (DROP/RENAME/ALTER TYPE) without \`phase = 'contract'\`.`,
          recommendation:
            'Split into Expand (add nullable column/dual-write) -> Backfill -> Deploy new code -> Contract (mark `phase = "contract"` in a follow-up release).',
        });
      } else {
        findings.push({
          code: 'CONTRACT_PHASE_MIGRATION',
          severity: 'warning',
          category: 'expand_contract',
          migrationName: d.name,
          message: `Migration "${d.name}" is a Contract-phase cleanup DDL. Ensure previous app version is fully drained before running.`,
        });
      }
    }

    // ADD COLUMN ... NOT NULL without DEFAULT
    const addNotNullMatches = sqlText.matchAll(
      /\bADD\s+(?:COLUMN\s+)?[\w"]+\s+[^,;)]*\bNOT\s+NULL\b[^,;]*/gi,
    );
    for (const m of addNotNullMatches) {
      if (!/\bDEFAULT\b/i.test(m[0])) {
        riskLevel = maxRiskLevel(riskLevel, 'HIGH');
        if (phase !== 'contract') {
          findings.push({
            code: 'EXPAND_CONTRACT_NOT_NULL_NO_DEFAULT',
            severity: 'warning',
            category: 'expand_contract',
            migrationName: d.name,
            message: `Migration "${d.name}" adds a NOT NULL column without DEFAULT, breaking older app instances during rolling deploy.`,
            recommendation:
              'Expand as NULLable first, backfill in queue, then add NOT NULL / CHECK NOT VALID constraint.',
          });
        }
        break;
      }
    }

    // 2. Lock Duration / Table Lock Risks
    const isCreatingNewTable = /\bCREATE\s+TABLE\b/i.test(sqlText);
    if (
      /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(sqlText) &&
      !/\bCONCURRENTLY\b/i.test(sqlText) &&
      !isCreatingNewTable
    ) {
      riskLevel = maxRiskLevel(riskLevel, 'HIGH');
      findings.push({
        code: 'LOCK_RISK_INDEX_WITHOUT_CONCURRENTLY',
        severity: 'warning',
        category: 'lock_risk',
        migrationName: d.name,
        message: `Migration "${d.name}" creates an index on an existing table without CONCURRENTLY, blocking writes while building.`,
        recommendation:
          'Use `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` with `public readonly transaction = false` (PostgreSQL).',
      });
    }

    if (
      /\bADD\s+CONSTRAINT\b[\s\S]*?\b(?:FOREIGN\s+KEY|CHECK)\b/i.test(sqlText) &&
      !/\bNOT\s+VALID\b/i.test(sqlText) &&
      !isCreatingNewTable
    ) {
      riskLevel = maxRiskLevel(riskLevel, 'HIGH');
      findings.push({
        code: 'LOCK_RISK_CONSTRAINT_VALIDATION',
        severity: 'warning',
        category: 'lock_risk',
        migrationName: d.name,
        message: `Migration "${d.name}" adds a FOREIGN KEY or CHECK constraint without NOT VALID, acquiring ACCESS EXCLUSIVE lock during full table scan.`,
        recommendation:
          'Add constraint with `NOT VALID`, then run `VALIDATE CONSTRAINT` separately.',
      });
    }

    if (/\b(?:VACUUM\s+FULL|CLUSTER|LOCK\s+TABLE)\b/i.test(sqlText)) {
      riskLevel = maxRiskLevel(riskLevel, 'CRITICAL');
      findings.push({
        code: 'LOCK_RISK_EXCLUSIVE_TABLE_LOCK',
        severity: 'error',
        category: 'lock_risk',
        migrationName: d.name,
        message: `Migration "${d.name}" executes an exclusive table-locking statement (VACUUM FULL / CLUSTER / LOCK TABLE).`,
        recommendation: 'Remove exclusive table-lock statements from automated migrations.',
      });
    }

    // 3. Large Backfill inside migration check
    const hasBulkDml =
      /\bUPDATE\s+[\w."`]+\s+SET\b/i.test(sqlText) ||
      /\bINSERT\s+INTO\s+[\w."`]+[\s\S]*?\bSELECT\b/i.test(sqlText) ||
      /\bDELETE\s+FROM\s+[\w."`]+/i.test(sqlText);
    const isBoundedOrMetadata =
      /\bLIMIT\s+\d+\b/i.test(sqlText) || /\bcore_migrations\b/i.test(sqlText);
    if (hasBulkDml && !isBoundedOrMetadata) {
      riskLevel = maxRiskLevel(riskLevel, 'HIGH');
      findings.push({
        code: 'BACKFILL_IN_MIGRATION',
        severity: 'warning',
        category: 'backfill',
        migrationName: d.name,
        message: `Migration "${d.name}" contains an unbounded UPDATE/DELETE/INSERT..SELECT statement.`,
        recommendation:
          'Move large data backfills out of schema migrations into a DataBackfillContract job executed via Queue (`migration:backfill`).',
      });
    }

    return { riskLevel };
  }

  private extractSqlLiterals(source: string): string[] {
    const results: string[] = [];
    const regex = /`([^`]*)`|'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    for (const match of source.matchAll(regex)) {
      const literal = match[1] ?? match[2] ?? match[3] ?? '';
      if (
        /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|SELECT|TRUNCATE|LOCK|CLUSTER|VACUUM)\b/i.test(
          literal,
        )
      ) {
        results.push(literal);
      }
    }
    return results;
  }

  private hasBalancedParens(sql: string): boolean {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i]!;
      const prev = i > 0 ? sql[i - 1] : '';
      if (ch === "'" && !inDouble && prev !== '\\') {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle && prev !== '\\') {
        inDouble = !inDouble;
        continue;
      }
      if (inSingle || inDouble) continue;
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth < 0) return false;
      }
    }
    return depth === 0;
  }

  private async loadAppliedNames(ds: {
    query: <T = unknown>(sql: string) => Promise<T>;
  }): Promise<Set<string>> {
    const table = this.config.database.migrationsTableName;
    try {
      const rows = (await ds.query(`SELECT name FROM ${table}`)) as Array<{ name?: unknown }>;
      return new Set(rows.map((r) => String(r.name ?? '')).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  private async loadRedisChecksums(): Promise<Record<string, string>> {
    if (!this.redis?.isReady()) return {};
    try {
      return await this.redis.client.hgetall(databaseKeys(this.redis).migrationChecksums());
    } catch (err) {
      this.logger.debug(`Could not read migration checksums from Redis: ${String(err)}`);
      return {};
    }
  }

  private resolveDefaultBackendRoot(): string {
    const cwd = process.cwd();
    return cwd.endsWith(`${path.sep}backend`) ? cwd : path.join(cwd, 'backend');
  }
}
