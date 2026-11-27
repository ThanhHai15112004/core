import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { safeJsonParse } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import {
  computeMigrationChecksum,
  type MigrationExecutionMetric,
} from '../migrations/migration-safety.types.js';
import {
  MigrationLockBusyError,
  MigrationLockService,
} from '../migrations/migration-lock.service.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { sanitizeDbMessage } from '../utils/error-classify.js';
import {
  DatabaseMonitoringService,
  DatabaseUnavailableError,
} from '../monitoring/database-monitoring.service.js';
import { recordDbEvent } from '../monitoring/db-events.js';

export type SessionAction = 'cancel' | 'terminate';

export type MigrationIntegrityStatus = 'ok' | 'modified' | 'missing_source';

export { computeMigrationChecksum };

export class DatabaseOperationError extends Error {
  constructor(
    public readonly code:
      | 'ACTIONS_DISABLED'
      | 'MIGRATIONS_DISABLED'
      | 'MIGRATION_TAMPERED'
      | 'ROLLBACK_FORBIDDEN'
      | 'SEED_ENV_FORBIDDEN'
      | 'UNSUPPORTED'
      | 'SESSION_NOT_FOUND'
      | 'SELF_SESSION'
      | 'NOT_RUNNING'
      | 'UNAVAILABLE'
      | 'BUSY'
      | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

export interface MigrationInfo {
  name: string;
  timestamp: number | null;
  status: 'applied' | 'pending';
  appliedAt: string | null;
  checksum?: string | null;
  integrity?: MigrationIntegrityStatus;
}

export interface MigrationRun {
  /** ISO */
  at: string;
  status: 'completed' | 'failed';
  executed: string[];
  error: string | null;
  durationMs: number;
  metrics?: MigrationExecutionMetric[];
  maxMigrationDurationMs?: number;
  checksums?: Record<string, string>;
  lockType?: 'db_and_redis' | 'db_only' | 'redis_only' | 'in_process';
}

export interface RunMigrationsOptions {
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
  readonly extraRecordedChecksums?: Readonly<Record<string, string>>;
  readonly lockOwner?: string;
}

/** Thao tác vận hành database: test connection, cancel query, terminate session, migration. */
@Injectable()
export class DatabaseOperationsService {
  private readonly logger = new Logger('DatabaseOperations');
  private readonly fallbackLockService: MigrationLockService;

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly monitoring: DatabaseMonitoringService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly lockService?: MigrationLockService,
  ) {
    this.fallbackLockService = new MigrationLockService(this.config, this.connection, this.redis);
  }

  private get effectiveLockService(): MigrationLockService {
    return this.lockService ?? this.fallbackLockService;
  }

  /** Kiểm tra kết nối tới dịch vụ database */
  public async testConnection() {
    const result = await this.connection.ping();
    return {
      ...result,
      checkedAt: new Date().toISOString(),
      state: this.connection.getStatus().state,
    };
  }

  /**
   * Cancel/terminate chỉ cho session của chính app (provider đã lọc theo user + database) và không phải
   * connection đang dùng để thao tác.
   */
  public async sessionAction(action: SessionAction, sessionId: string): Promise<void> {
    if (!this.config.database.actionsEnabled)
      throw new DatabaseOperationError('ACTIONS_DISABLED', 'Database actions are disabled');
    if (!this.monitoring.supports(action))
      throw new DatabaseOperationError('UNSUPPORTED', 'Not supported by this driver');
    try {
      await this.monitoring.withContext(async (ctx) => {
        const session = (await this.monitoring.provider.sessions(ctx)).find(
          (s) => s.id === sessionId,
        );
        if (!session) throw new DatabaseOperationError('SESSION_NOT_FOUND', sessionId);
        if (session.isSelf) throw new DatabaseOperationError('SELF_SESSION', sessionId);
        if (action === 'cancel' && !session.query)
          throw new DatabaseOperationError('NOT_RUNNING', sessionId);
        if (action === 'cancel') await this.monitoring.provider.cancel(ctx, sessionId);
        else await this.monitoring.provider.terminate(ctx, sessionId);
        this.logger.warn(
          `${action} session #${sessionId} (${session.runtime ?? session.program ?? 'unknown'})`,
        );
        await recordDbEvent(this.redis, {
          type: action === 'cancel' ? 'query_cancelled' : 'session_terminated',
          severity: 'warning',
          params: {
            session: sessionId,
            runtime: session.runtime ?? '',
            query: (session.query ?? '').slice(0, 120),
          },
          runtime: session.runtime,
        });
      });
    } catch (err) {
      if (err instanceof DatabaseOperationError) throw err;
      if (err instanceof DatabaseUnavailableError)
        throw new DatabaseOperationError('UNAVAILABLE', err.state);
      throw new DatabaseOperationError('FAILED', sanitizeDbMessage(err));
    }
  }

  /** Migration khai báo (DataSource.migrations) so với bảng lịch sử → applied / pending kèm kiểm tra tính toàn vẹn. */
  public async migrations(
    extraRecordedChecksums: Readonly<Record<string, string>> = {},
  ): Promise<{ items: MigrationInfo[]; lastRun: MigrationRun | null }> {
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);
    const table = this.config.database.migrationsTableName;
    const applied = await this.monitoring
      .withContext((ctx) =>
        ctx.run<{ name: string; timestamp: number }>(`SELECT name, timestamp FROM ${table}`),
      )
      .catch(() => [] as { name: string; timestamp: number }[]);
    const appliedNames = new Map(applied.map((a) => [String(a.name), Number(a.timestamp)]));

    const redisChecksums = this.redis?.isReady()
      ? await this.redis.client
          .hgetall(databaseKeys(this.redis).migrationChecksums())
          .catch(() => ({}) as Record<string, string>)
      : ({} as Record<string, string>);
    const storedChecksums: Record<string, string> = {
      ...redisChecksums,
      ...extraRecordedChecksums,
    };

    const declaredMap = new Map<
      string,
      { name: string; timestamp: number | null; checksum: string }
    >();
    for (const m of ds.migrations) {
      const name = m.name ?? m.constructor.name;
      const timestamp = Number(/(\d{13})$/.exec(name)?.[1] ?? /^(\d{13})/.exec(name)?.[1] ?? NaN);
      declaredMap.set(name, {
        name,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        checksum: computeMigrationChecksum(m),
      });
    }

    const names = new Set([...declaredMap.keys(), ...appliedNames.keys()]);
    const items: MigrationInfo[] = [...names].map((name) => {
      const declared = declaredMap.get(name);
      const isApplied = appliedNames.has(name);
      const ts = appliedNames.get(name) ?? declared?.timestamp ?? null;
      const recordedHash = storedChecksums[name];

      let integrity: MigrationIntegrityStatus = 'ok';
      if (isApplied && !declared) {
        integrity = 'missing_source';
      } else if (isApplied && declared && recordedHash && recordedHash !== declared.checksum) {
        integrity = 'modified';
      }

      return {
        name,
        timestamp: ts,
        status: isApplied ? 'applied' : 'pending',
        appliedAt: null,
        checksum: declared?.checksum ?? recordedHash ?? null,
        integrity,
      };
    });
    items.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { items, lastRun: await this.lastRun() };
  }

  /**
   * Thực thi các tệp migration cơ sở dữ liệu chưa được áp dụng:
   * - Kiểm tra tính bất biến (checksum)
   * - Khóa phân tán 2 lớp (DB Advisory Lock + Redis owner-token lock)
   * - Áp dụng `lock_timeout` & `statement_timeout` trên QueryRunner và đo thời lượng từng migration
   */
  public async runMigrations(options: RunMigrationsOptions = {}): Promise<MigrationRun> {
    if (!this.config.database.migrationsEnabled)
      throw new DatabaseOperationError('MIGRATIONS_DISABLED', 'Running migrations is disabled');
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);

    if (this.config.database.migrationStrict) {
      const { items } = await this.migrations(options.extraRecordedChecksums);
      const tampered = items.filter((m) => m.status === 'applied' && m.integrity !== 'ok');
      if (tampered.length > 0) {
        const detail = tampered.map((m) => `${m.name} (${m.integrity})`).join(', ');
        throw new DatabaseOperationError(
          'MIGRATION_TAMPERED',
          `Immutable migration policy violated: applied migration(s) modified or missing in source: ${detail}`,
        );
      }
    }

    let lockHandle;
    try {
      lockHandle = await this.effectiveLockService.acquire({
        dataSource: ds,
        owner: options.lockOwner ?? 'runMigrations',
      });
    } catch (err) {
      if (err instanceof MigrationLockBusyError) {
        throw new DatabaseOperationError('BUSY', err.message);
      }
      throw err;
    }

    const lockTimeoutMs = options.lockTimeoutMs ?? this.config.database.migrationLockTimeoutMs;
    const statementTimeoutMs =
      options.statementTimeoutMs ?? this.config.database.migrationStatementTimeoutMs;
    const maxLockWarnMs = this.config.database.migrationMaxLockWarnMs;
    const driver = String(ds.options.type ?? this.config.database.connection);
    const lockType: MigrationRun['lockType'] =
      lockHandle.dbLockAcquired && lockHandle.redisLockAcquired
        ? 'db_and_redis'
        : lockHandle.dbLockAcquired
          ? 'db_only'
          : lockHandle.redisLockAcquired
            ? 'redis_only'
            : 'in_process';

    const startedAt = Date.now();
    const metrics: MigrationExecutionMetric[] = [];
    const executedNames: string[] = [];
    const checksumSnapshot: Record<string, string> = {};
    let run: MigrationRun;

    try {
      const { items: currentItems } = await this.migrations(options.extraRecordedChecksums);
      const pendingNames = new Set(
        currentItems.filter((i) => i.status === 'pending').map((i) => i.name),
      );

      if (pendingNames.size > 0) {
        const declaredSorted = [...ds.migrations]
          .map((m) => {
            const name = m.name ?? m.constructor.name;
            const ts = Number(/(\d{13})$/.exec(name)?.[1] ?? /^(\d{13})/.exec(name)?.[1] ?? 0);
            return { migration: m, name, ts };
          })
          .filter((entry) => pendingNames.has(entry.name))
          .sort((a, b) => a.ts - b.ts);

        const table = this.config.database.migrationsTableName;
        for (const entry of declaredSorted) {
          const checksum = computeMigrationChecksum(entry.migration);
          const migMeta = entry.migration as {
            transaction?: boolean;
            lockTimeoutMs?: number;
            statementTimeoutMs?: number;
          };
          const useTx = migMeta.transaction !== false;
          const effLockTimeout = migMeta.lockTimeoutMs ?? lockTimeoutMs;
          const effStmtTimeout = migMeta.statementTimeoutMs ?? statementTimeoutMs;

          const migStart = Date.now();
          const qr = ds.createQueryRunner();
          await qr.connect();
          try {
            if (useTx) {
              await qr.startTransaction();
            }
            try {
              await this.effectiveLockService.withLockTimeout(
                qr,
                {
                  lockTimeoutMs: effLockTimeout,
                  statementTimeoutMs: effStmtTimeout,
                  driver,
                },
                async () => {
                  await entry.migration.up(qr);
                  const tsVal = entry.ts || Date.now();
                  await qr.query(
                    driver === 'postgres'
                      ? `INSERT INTO ${table}(timestamp, name) VALUES ($1, $2)`
                      : `INSERT INTO ${table}(timestamp, name) VALUES (?, ?)`,
                    [tsVal, entry.name],
                  );
                },
              );
              if (useTx) {
                await qr.commitTransaction();
              }
            } catch (migErr) {
              if (useTx && qr.isTransactionActive) {
                await qr.rollbackTransaction().catch(() => undefined);
              }
              throw migErr;
            }
          } finally {
            await qr.release().catch(() => undefined);
          }

          const migDuration = Date.now() - migStart;
          const exceededLockWarn = migDuration > maxLockWarnMs;
          if (exceededLockWarn) {
            this.logger.warn(
              `Migration "${entry.name}" took ${migDuration}ms (exceeds lock warning threshold ${maxLockWarnMs}ms)`,
            );
          }
          executedNames.push(entry.name);
          checksumSnapshot[entry.name] = checksum;
          metrics.push({
            name: entry.name,
            checksum,
            durationMs: migDuration,
            lockTimeoutMs: effLockTimeout,
            statementTimeoutMs: effStmtTimeout,
            exceededLockWarn,
          });
        }
      }

      for (const m of ds.migrations) {
        const name = m.name ?? m.constructor.name;
        checksumSnapshot[name] = computeMigrationChecksum(m);
      }

      run = {
        at: new Date().toISOString(),
        status: 'completed',
        executed: executedNames,
        error: null,
        durationMs: Date.now() - startedAt,
        metrics,
        maxMigrationDurationMs:
          metrics.length > 0 ? Math.max(...metrics.map((m) => m.durationMs)) : 0,
        checksums: checksumSnapshot,
        lockType,
      };
      await this.saveMigrationChecksums(ds);
      this.logger.log(`Migrations completed: ${run.executed.join(', ') || 'none pending'}`);
    } catch (err) {
      run = {
        at: new Date().toISOString(),
        status: 'failed',
        executed: executedNames,
        error: sanitizeDbMessage(err),
        durationMs: Date.now() - startedAt,
        metrics,
        maxMigrationDurationMs:
          metrics.length > 0 ? Math.max(...metrics.map((m) => m.durationMs)) : 0,
        checksums: checksumSnapshot,
        lockType,
      };
      this.logger.error(`Migrations failed: ${run.error}`);
    } finally {
      await lockHandle.release();
    }

    const keys = this.redis ? databaseKeys(this.redis) : null;
    if (keys && this.redis?.isReady())
      await this.redis.client
        .set(keys.lastMigrationRun(), JSON.stringify(run))
        .catch(() => undefined);
    await recordDbEvent(this.redis, {
      type: run.status === 'completed' ? 'migration_completed' : 'migration_failed',
      severity: run.status === 'completed' ? 'success' : 'critical',
      params: { count: run.executed.length, error: run.error ?? '' },
      runtime: null,
    });
    return run;
  }

  /** Hoàn tác (rollback) bản migration gần nhất (yêu cầu Dual Lock và chặn trên Production nếu không có `force`). */
  public async revertLastMigration(options?: { force?: boolean }): Promise<MigrationRun> {
    if (!this.config.database.migrationsEnabled)
      throw new DatabaseOperationError('MIGRATIONS_DISABLED', 'Running migrations is disabled');
    if (this.config.isProduction && !options?.force) {
      throw new DatabaseOperationError(
        'ROLLBACK_FORBIDDEN',
        'Rolling back migrations in production requires explicit --force confirmation',
      );
    }
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);

    let lockHandle;
    try {
      lockHandle = await this.effectiveLockService.acquire({
        dataSource: ds,
        owner: 'revertLastMigration',
      });
    } catch (err) {
      if (err instanceof MigrationLockBusyError) {
        throw new DatabaseOperationError('BUSY', err.message);
      }
      throw err;
    }

    const startedAt = Date.now();
    try {
      await ds.undoLastMigration({ transaction: 'each' });
      const run: MigrationRun = {
        at: new Date().toISOString(),
        status: 'completed',
        executed: ['reverted_last'],
        error: null,
        durationMs: Date.now() - startedAt,
      };
      this.logger.warn(`Last database migration reverted in ${run.durationMs}ms`);
      return run;
    } catch (err) {
      const message = sanitizeDbMessage(err);
      this.logger.error(`Migration rollback failed: ${message}`);
      throw new DatabaseOperationError('FAILED', message);
    } finally {
      await lockHandle.release();
    }
  }

  /** Lưu checksum SHA-256 của các migration khai báo vào Redis sau khi chạy thành công. */
  private async saveMigrationChecksums(ds: {
    migrations: { name?: string; up?: unknown; down?: unknown; constructor: { name: string } }[];
  }): Promise<void> {
    if (!this.redis?.isReady() || ds.migrations.length === 0) return;
    const key = databaseKeys(this.redis).migrationChecksums();
    const pipe = this.redis.client.pipeline();
    for (const m of ds.migrations) {
      const name = m.name ?? m.constructor.name;
      pipe.hset(key, name, computeMigrationChecksum(m));
    }
    await pipe.exec().catch(() => undefined);
  }

  /** Lấy mốc thời gian của lần thực thi gần nhất */
  private async lastRun(): Promise<MigrationRun | null> {
    if (!this.redis?.isReady()) return null;
    const raw = await this.redis.client
      .get(databaseKeys(this.redis).lastMigrationRun())
      .catch(() => null);
    return safeJsonParse<MigrationRun | null>(raw, null);
  }
}
