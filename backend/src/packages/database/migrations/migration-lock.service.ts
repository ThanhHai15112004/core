import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import type { MigrationLockHandle } from './migration-safety.types.js';

const PG_ADVISORY_LOCK_BASE = 748_392_000;
const RELEASE_REDIS_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class MigrationLockBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationLockBusyError';
  }
}

export interface AcquireMigrationLockOptions {
  readonly ttlSec?: number;
  readonly owner?: string;
  readonly dataSource?: DataSource | null;
}

export interface LockTimeoutOptions {
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly driver: string;
}

/**
 * Khóa phân tán 2 lớp cho Migration (Dual Lock):
 * 1. Database Advisory Lock (`pg_try_advisory_lock` trên PostgreSQL / `GET_LOCK` trên MySQL)
 *    giữ trên một QueryRunner riêng biệt → bảo vệ ngay cả khi Redis mất kết nối.
 * 2. Redis Lock với `ownerToken` duy nhất + Lua compare-and-delete → bảo vệ đa node/cluster.
 */
@Injectable()
export class MigrationLockService {
  private readonly logger = new Logger(MigrationLockService.name);
  private readonly inProcessLocks = new Set<string>();

  constructor(
    private readonly config: CoreConfigService,
    @Optional() private readonly connection?: DatabaseConnectionService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public async acquire(options: AcquireMigrationLockOptions = {}): Promise<MigrationLockHandle> {
    const ttlSec = options.ttlSec ?? this.config.database.migrationLockTtlSec;
    const owner = options.owner ?? `pid-${process.pid}`;
    const token = randomUUID();
    const ds = options.dataSource ?? this.connection?.connected() ?? null;
    const driver = String(ds?.options.type ?? this.config.database.connection);
    const lockScope = `${this.config.database.database}:${this.config.database.migrationsTableName}`;

    if (this.inProcessLocks.has(lockScope)) {
      throw new MigrationLockBusyError(
        'Another migration operation is already active in this process.',
      );
    }
    this.inProcessLocks.add(lockScope);

    let dbRunner: QueryRunner | null = null;
    let dbLockAcquired = false;
    let redisLockAcquired = false;
    let advisoryLockKey: number | string | null = null;

    try {
      // Layer 1: DB Advisory Lock (ưu tiên PostgreSQL / MySQL)
      if (
        ds &&
        typeof ds.createQueryRunner === 'function' &&
        (driver === 'postgres' || driver === 'mysql' || driver === 'mariadb')
      ) {
        dbRunner = ds.createQueryRunner();
        await dbRunner.connect();

        if (driver === 'postgres') {
          const pgKey = this.computePgAdvisoryKey(lockScope);
          advisoryLockKey = pgKey;
          const rows = (await dbRunner.query('SELECT pg_try_advisory_lock($1) AS acquired', [
            pgKey,
          ])) as Array<{ acquired?: boolean }>;
          dbLockAcquired = Boolean(rows[0]?.acquired);
          if (!dbLockAcquired) {
            throw new MigrationLockBusyError(
              `Database advisory lock (${pgKey}) is currently held by another migration instance.`,
            );
          }
        } else {
          const mysqlKey = `core_migrate_${this.config.database.migrationsTableName}`.slice(0, 64);
          advisoryLockKey = mysqlKey;
          const rows = (await dbRunner.query('SELECT GET_LOCK(?, 0) AS acquired', [
            mysqlKey,
          ])) as Array<{ acquired?: number | string | null }>;
          dbLockAcquired = Number(rows[0]?.acquired ?? 0) === 1;
          if (!dbLockAcquired) {
            throw new MigrationLockBusyError(
              `Database GET_LOCK("${mysqlKey}") is currently held by another migration instance.`,
            );
          }
        }
      }

      // Layer 2: Redis Distributed Lock với owner token
      if (this.redis?.isReady()) {
        const redisKey = databaseKeys(this.redis).migrateLock();
        const result = await this.redis.client.set(redisKey, token, 'EX', ttlSec, 'NX');
        if (result !== 'OK') {
          throw new MigrationLockBusyError('Another migration run holds the Redis migration lock.');
        }
        redisLockAcquired = true;
      }
    } catch (err) {
      await this.cleanupOnAcquireError({
        lockScope,
        driver,
        advisoryLockKey,
        dbRunner,
        dbLockAcquired,
        redisLockAcquired,
        token,
      });
      throw err;
    }

    let released = false;
    const handle: MigrationLockHandle = {
      token,
      owner,
      acquiredAt: new Date().toISOString(),
      dbLockAcquired,
      redisLockAcquired,
      driver,
      advisoryLockKey,
      release: async () => {
        if (released) return;
        released = true;
        await this.cleanupOnAcquireError({
          lockScope,
          driver,
          advisoryLockKey,
          dbRunner,
          dbLockAcquired,
          redisLockAcquired,
          token,
        });
      },
    };

    return handle;
  }

  /**
   * Áp dụng `lock_timeout` & `statement_timeout` cho QueryRunner khi thực thi DDL để tránh
   * migration treo lâu hoặc xếp hàng lock gây sập toàn bộ traffic API.
   */
  public async withLockTimeout<T>(
    queryRunner: QueryRunner,
    options: LockTimeoutOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockMs = Math.max(500, Math.round(options.lockTimeoutMs));
    const stmtMs = Math.max(0, Math.round(options.statementTimeoutMs));
    const driver = options.driver.toLowerCase();

    if (driver === 'postgres' || driver === 'pgsql' || driver === 'postgresql') {
      await queryRunner.query(`SET lock_timeout = '${lockMs}ms'`);
      if (stmtMs > 0) {
        await queryRunner.query(`SET statement_timeout = '${stmtMs}ms'`);
      }
      try {
        return await fn();
      } finally {
        await queryRunner.query('RESET lock_timeout').catch(() => undefined);
        if (stmtMs > 0) {
          await queryRunner.query('RESET statement_timeout').catch(() => undefined);
        }
      }
    }

    if (driver === 'mysql' || driver === 'mariadb') {
      const waitSec = Math.max(1, Math.ceil(lockMs / 1000));
      await queryRunner.query(`SET SESSION lock_wait_timeout = ${waitSec}`);
      try {
        return await fn();
      } finally {
        await queryRunner.query('SET SESSION lock_wait_timeout = DEFAULT').catch(() => undefined);
      }
    }

    return fn();
  }

  private async cleanupOnAcquireError(ctx: {
    lockScope: string;
    driver: string;
    advisoryLockKey: number | string | null;
    dbRunner: QueryRunner | null;
    dbLockAcquired: boolean;
    redisLockAcquired: boolean;
    token: string;
  }): Promise<void> {
    this.inProcessLocks.delete(ctx.lockScope);

    if (ctx.redisLockAcquired && this.redis?.isReady()) {
      const redisKey = databaseKeys(this.redis).migrateLock();
      await this.redis.client
        .eval(RELEASE_REDIS_LOCK_LUA, 1, redisKey, ctx.token)
        .catch((err) => this.logger.warn(`Failed releasing Redis migration lock: ${String(err)}`));
    }

    if (ctx.dbRunner) {
      if (ctx.dbLockAcquired && ctx.advisoryLockKey !== null) {
        if (ctx.driver === 'postgres') {
          await ctx.dbRunner
            .query('SELECT pg_advisory_unlock($1)', [ctx.advisoryLockKey])
            .catch(() => undefined);
        } else {
          await ctx.dbRunner
            .query('SELECT RELEASE_LOCK(?)', [ctx.advisoryLockKey])
            .catch(() => undefined);
        }
      }
      await ctx.dbRunner.release().catch(() => undefined);
    }
  }

  private computePgAdvisoryKey(scope: string): number {
    let hash = 0;
    for (let i = 0; i < scope.length; i++) {
      hash = (hash * 31 + scope.charCodeAt(i)) % 1_000_000;
    }
    return PG_ADVISORY_LOCK_BASE + Math.abs(hash);
  }
}
