import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { sanitizeDbMessage } from '../utils/error-classify.js';
import {
  DatabaseMonitoringService,
  DatabaseUnavailableError,
} from '../monitoring/database-monitoring.service.js';
import { recordDbEvent } from '../monitoring/db-events.js';

export type SessionAction = 'cancel' | 'terminate';

export type MigrationIntegrityStatus = 'ok' | 'modified' | 'missing_source';

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
}

const MIGRATE_LOCK_SEC = 600;

/** Tính mã băm SHA-256 đại diện cho nội dung logic (`up`/`down`) của một class Migration. */
export function computeMigrationChecksum(migration: {
  name?: string;
  up?: unknown;
  down?: unknown;
  constructor?: { name?: string };
}): string {
  const name = migration.name ?? migration.constructor?.name ?? '';
  const upSource = typeof migration.up === 'function' ? migration.up.toString() : '';
  const downSource = typeof migration.down === 'function' ? migration.down.toString() : '';
  const normalized = `${name}|${upSource}|${downSource}`.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** Thao tác vận hành database: test connection, cancel query, terminate session, migration. */
@Injectable()
export class DatabaseOperationsService {
  private readonly logger = new Logger('DatabaseOperations');

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly monitoring: DatabaseMonitoringService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Kiểm tra kết nối tới dịch vụ bộ nhớ đệm */
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
  public async migrations(): Promise<{ items: MigrationInfo[]; lastRun: MigrationRun | null }> {
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);
    const table = this.config.database.migrationsTableName;
    const applied = await this.monitoring
      .withContext((ctx) =>
        ctx.run<{ name: string; timestamp: number }>(`SELECT name, timestamp FROM ${table}`),
      )
      .catch(() => [] as { name: string; timestamp: number }[]);
    const appliedNames = new Map(applied.map((a) => [String(a.name), Number(a.timestamp)]));

    const storedChecksums = this.redis?.isReady()
      ? await this.redis.client
          .hgetall(databaseKeys(this.redis).migrationChecksums())
          .catch(() => ({}) as Record<string, string>)
      : ({} as Record<string, string>);

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

  /** Thực thi các tệp migration cơ sở dữ liệu chưa được áp dụng (có kiểm tra bất biến & Redis Lock). */
  public async runMigrations(): Promise<MigrationRun> {
    if (!this.config.database.migrationsEnabled)
      throw new DatabaseOperationError('MIGRATIONS_DISABLED', 'Running migrations is disabled');
    const ds = this.connection.connected();
    if (!ds) throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);

    if (this.config.database.migrationStrict) {
      const { items } = await this.migrations();
      const tampered = items.filter((m) => m.status === 'applied' && m.integrity !== 'ok');
      if (tampered.length > 0) {
        const detail = tampered.map((m) => `${m.name} (${m.integrity})`).join(', ');
        throw new DatabaseOperationError(
          'MIGRATION_TAMPERED',
          `Immutable migration policy violated: applied migration(s) modified or missing in source: ${detail}`,
        );
      }
    }

    const keys = this.redis ? databaseKeys(this.redis) : null;
    if (keys && this.redis?.isReady()) {
      const locked = await this.redis.client.set(
        keys.migrateLock(),
        '1',
        'EX',
        MIGRATE_LOCK_SEC,
        'NX',
      );
      if (locked !== 'OK')
        throw new DatabaseOperationError('BUSY', 'Another migration run is in progress');
    }
    const startedAt = Date.now();
    let run: MigrationRun;
    try {
      const executed = await ds.runMigrations({ transaction: 'each' });
      run = {
        at: new Date().toISOString(),
        status: 'completed',
        executed: executed.map((m) => m.name),
        error: null,
        durationMs: Date.now() - startedAt,
      };
      await this.saveMigrationChecksums(ds);
      this.logger.log(`Migrations completed: ${run.executed.join(', ') || 'none pending'}`);
    } catch (err) {
      run = {
        at: new Date().toISOString(),
        status: 'failed',
        executed: [],
        error: sanitizeDbMessage(err),
        durationMs: Date.now() - startedAt,
      };
      this.logger.error(`Migrations failed: ${run.error}`);
    } finally {
      if (keys && this.redis?.isReady())
        await this.redis.client.del(keys.migrateLock()).catch(() => undefined);
    }
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

  /** Hoàn tác (rollback) bản migration gần nhất (yêu cầu Redis Lock và chặn trên Production nếu không có `force`). */
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

    const keys = this.redis ? databaseKeys(this.redis) : null;
    if (keys && this.redis?.isReady()) {
      const locked = await this.redis.client.set(
        keys.migrateLock(),
        '1',
        'EX',
        MIGRATE_LOCK_SEC,
        'NX',
      );
      if (locked !== 'OK')
        throw new DatabaseOperationError('BUSY', 'Another migration operation is in progress');
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
      if (keys && this.redis?.isReady())
        await this.redis.client.del(keys.migrateLock()).catch(() => undefined);
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
    try {
      return raw ? (JSON.parse(raw) as MigrationRun) : null;
    } catch {
      return null;
    }
  }
}
