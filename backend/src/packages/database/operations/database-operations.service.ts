import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { sanitizeDbMessage } from '../instrumentation/error-classify.js';
import {
  DatabaseMonitoringService,
  DatabaseUnavailableError,
} from '../monitoring/database-monitoring.service.js';
import { recordDbEvent } from '../monitoring/db-events.js';

export type SessionAction = 'cancel' | 'terminate';

export class DatabaseOperationError extends Error {
  constructor(
    public readonly code:
      | 'ACTIONS_DISABLED'
      | 'MIGRATIONS_DISABLED'
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

  /** Migration khai báo (DataSource.migrations) so với bảng lịch sử → applied / pending. */
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
    const declared = ds.migrations.map((m) => {
      const name = m.name ?? m.constructor.name;
      const timestamp = Number(/(\d{13})$/.exec(name)?.[1] ?? NaN);
      return { name, timestamp: Number.isFinite(timestamp) ? timestamp : null };
    });
    const names = new Set([...declared.map((d) => d.name), ...appliedNames.keys()]);
    const items: MigrationInfo[] = [...names].map((name) => {
      const ts = appliedNames.get(name) ?? declared.find((d) => d.name === name)?.timestamp ?? null;
      return {
        name,
        timestamp: ts,
        status: appliedNames.has(name) ? 'applied' : 'pending',
        // TypeORM không lưu thời điểm chạy; timestamp trong tên là lúc tạo migration.
        appliedAt: null,
      };
    });
    items.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return { items, lastRun: await this.lastRun() };
  }

  public async runMigrations(): Promise<MigrationRun> {
    if (!this.config.database.migrationsEnabled)
      throw new DatabaseOperationError('MIGRATIONS_DISABLED', 'Running migrations is disabled');
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
