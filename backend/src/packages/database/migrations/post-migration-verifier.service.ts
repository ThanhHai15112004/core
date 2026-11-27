import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { DatabaseOperationsService } from '../operations/database-operations.service.js';
import type {
  PostMigrationCheckItem,
  PostMigrationSqlCheck,
  PostMigrationVerificationReport,
} from './migration-safety.types.js';

export interface PostMigrationVerifyOptions {
  readonly expectedTables?: readonly string[] | undefined;
  readonly postChecks?: readonly PostMigrationSqlCheck[] | undefined;
  readonly healthUrl?: string | null | undefined;
  readonly healthTimeoutMs?: number | undefined;
}

/**
 * Kiểm tra hậu kiểm sau khi chạy Migration (Post-Migration Verification):
 * 1. Schema: 0 migration đang chờ, 0 checksum bị sửa đổi, không có index lỗi (`pg_index.indisvalid = false`), đủ bảng kỳ vọng.
 * 2. Dữ liệu: kiểm tra đọc bảng lịch sử + chạy các SQL sanity check khai báo kèm theo.
 * 3. Application Health: ping Database và gọi readiness endpoint (nếu cấu hình `healthUrl`).
 */
@Injectable()
export class PostMigrationVerifierService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly connection: DatabaseConnectionService,
    private readonly operations: DatabaseOperationsService,
    @Optional() private readonly httpFetch: typeof fetch = fetch,
  ) {}

  public async verify(
    options: PostMigrationVerifyOptions = {},
  ): Promise<PostMigrationVerificationReport> {
    const startedAt = Date.now();
    const checks: PostMigrationCheckItem[] = [];

    const ds = this.connection.connected();
    const driver = String(ds?.options.type ?? this.config.database.connection);

    // 1. Schema checks
    let pendingCount = 0;
    let tamperedCount = 0;
    const invalidIndexes: string[] = [];
    const missingTables: string[] = [];

    const migStart = Date.now();
    try {
      const migStatus = await this.operations.migrations();
      pendingCount = migStatus.items.filter((m) => m.status === 'pending').length;
      tamperedCount = migStatus.items.filter(
        (m) => m.status === 'applied' && m.integrity && m.integrity !== 'ok',
      ).length;
      checks.push({
        name: 'schema.migrations_synchronized',
        category: 'schema',
        passed: pendingCount === 0 && tamperedCount === 0,
        detail: `pending=${pendingCount}, tampered=${tamperedCount}`,
        durationMs: Date.now() - migStart,
      });
    } catch (err) {
      pendingCount = -1;
      checks.push({
        name: 'schema.migrations_synchronized',
        category: 'schema',
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - migStart,
      });
    }

    if (ds && driver === 'postgres') {
      const idxStart = Date.now();
      try {
        const rows = (await ds.query(
          `SELECT n.nspname || '.' || c.relname AS index_name
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE NOT i.indisvalid AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
        )) as Array<{ index_name?: unknown }>;
        for (const r of rows) {
          if (r.index_name) invalidIndexes.push(String(r.index_name));
        }
        checks.push({
          name: 'schema.no_invalid_indexes',
          category: 'schema',
          passed: invalidIndexes.length === 0,
          detail:
            invalidIndexes.length === 0
              ? 'All PostgreSQL indexes are valid'
              : `Invalid indexes: ${invalidIndexes.join(', ')}`,
          durationMs: Date.now() - idxStart,
        });
      } catch (err) {
        checks.push({
          name: 'schema.no_invalid_indexes',
          category: 'schema',
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - idxStart,
        });
      }
    }

    if (ds && options.expectedTables && options.expectedTables.length > 0) {
      const tblStart = Date.now();
      const qr = ds.createQueryRunner();
      try {
        await qr.connect();
        for (const tableName of options.expectedTables) {
          const exists = await qr.hasTable(tableName);
          if (!exists) missingTables.push(tableName);
        }
        checks.push({
          name: 'schema.expected_tables_exist',
          category: 'schema',
          passed: missingTables.length === 0,
          detail:
            missingTables.length === 0
              ? `Verified ${options.expectedTables.length} expected table(s)`
              : `Missing tables: ${missingTables.join(', ')}`,
          durationMs: Date.now() - tblStart,
        });
      } finally {
        await qr.release().catch(() => undefined);
      }
    }

    const schemaPassed =
      pendingCount === 0 &&
      tamperedCount === 0 &&
      invalidIndexes.length === 0 &&
      missingTables.length === 0 &&
      checks.filter((c) => c.category === 'schema').every((c) => c.passed);

    // 2. Data integrity checks
    const dataChecks: PostMigrationCheckItem[] = [];
    if (ds) {
      const tableCheckStart = Date.now();
      try {
        const rows = (await ds.query(
          `SELECT COUNT(*) AS cnt FROM ${this.config.database.migrationsTableName}`,
        )) as Array<{ cnt?: unknown; count?: unknown }>;
        const totalRows = Number(rows[0]?.cnt ?? rows[0]?.count ?? 0);
        dataChecks.push({
          name: 'data.migrations_table_readable',
          category: 'data',
          passed: Number.isFinite(totalRows) && totalRows >= 0,
          detail: `migrations_table_rows=${totalRows}`,
          durationMs: Date.now() - tableCheckStart,
        });
      } catch (err) {
        dataChecks.push({
          name: 'data.migrations_table_readable',
          category: 'data',
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - tableCheckStart,
        });
      }

      for (const sqlCheck of options.postChecks ?? []) {
        const cStart = Date.now();
        try {
          const rows = (await ds.query(sqlCheck.sql)) as Array<Record<string, unknown>>;
          const first = rows[0] ?? {};
          const rawVal = first['cnt'] ?? first['count'] ?? first['ok'] ?? Object.values(first)[0];
          const numVal = typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : Number(rawVal ?? 0);
          const passed = sqlCheck.expectation === 'positive' ? numVal > 0 : numVal === 0;
          dataChecks.push({
            name: `data.${sqlCheck.name}`,
            category: 'data',
            passed,
            detail: `value=${String(rawVal ?? 0)} (expected=${sqlCheck.expectation ?? 'zero'})`,
            durationMs: Date.now() - cStart,
          });
        } catch (err) {
          dataChecks.push({
            name: `data.${sqlCheck.name}`,
            category: 'data',
            passed: false,
            detail: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - cStart,
          });
        }
      }
    } else {
      dataChecks.push({
        name: 'data.database_connection',
        category: 'data',
        passed: false,
        detail: 'Database is not connected',
        durationMs: 0,
      });
    }
    checks.push(...dataChecks);
    const failedDataChecks = dataChecks.filter((c) => !c.passed).length;
    const dataPassed = failedDataChecks === 0;

    // 3. Application Health Check
    const pingStart = Date.now();
    const pingResult = await this.connection.ping();
    checks.push({
      name: 'health.database_ping',
      category: 'health',
      passed: pingResult.ok,
      detail: pingResult.ok
        ? `DB ping ok (${pingResult.latencyMs ?? 0}ms)`
        : `DB ping failed: ${pingResult.error?.message ?? 'unknown'}`,
      durationMs: Date.now() - pingStart,
    });

    let appHealthChecked = false;
    let appHealthOk: boolean | null = null;
    const appHealthUrl = options.healthUrl?.trim() ? options.healthUrl.trim() : null;
    if (appHealthUrl) {
      appHealthChecked = true;
      const hStart = Date.now();
      try {
        const res = await this.httpFetch(appHealthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(options.healthTimeoutMs ?? 5_000),
        });
        appHealthOk = res.ok;
        checks.push({
          name: 'health.application_readiness',
          category: 'health',
          passed: res.ok,
          detail: `GET ${appHealthUrl} -> HTTP ${res.status}`,
          durationMs: Date.now() - hStart,
        });
      } catch (err) {
        appHealthOk = false;
        checks.push({
          name: 'health.application_readiness',
          category: 'health',
          passed: false,
          detail: `GET ${appHealthUrl} failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - hStart,
        });
      }
    }

    const healthPassed = pingResult.ok && appHealthOk !== false;

    return {
      checkedAt: new Date().toISOString(),
      passed: schemaPassed && dataPassed && healthPassed,
      durationMs: Date.now() - startedAt,
      schema: {
        passed: schemaPassed,
        pendingCount,
        tamperedCount,
        invalidIndexes,
        missingTables,
      },
      data: {
        passed: dataPassed,
        totalChecks: dataChecks.length,
        failedChecks: failedDataChecks,
      },
      health: {
        passed: healthPassed,
        dbOk: pingResult.ok,
        dbLatencyMs: pingResult.latencyMs,
        appHealthChecked,
        appHealthOk,
        appHealthUrl,
      },
      checks,
    };
  }
}
