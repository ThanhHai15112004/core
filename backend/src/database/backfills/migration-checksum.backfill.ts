import type { EntityManager } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import {
  computeMigrationChecksum,
  databaseKeys,
  type DataBackfillBatchContext,
  type DataBackfillBatchResult,
  type DataBackfillContract,
} from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';

/**
 * Backfill mẫu chuẩn theo batch + cursor cho `core_migrations`:
 * Đồng bộ mã băm SHA-256 chuẩn của các migration đã chạy theo từng lô nhỏ có checkpoint & throttle.
 */
export class MigrationChecksumBackfillScript implements DataBackfillContract {
  public readonly name = 'migration-checksum-backfill';
  public readonly description =
    'Đồng bộ mã băm SHA-256 cho các bản ghi lịch sử trong bảng migration theo từng batch';
  public readonly defaultBatchSize = 50;
  public readonly defaultThrottleMs = 25;

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService | null = null,
  ) {}

  public async estimateTotal(manager: EntityManager): Promise<number | null> {
    const tableName = this.config.database.migrationsTableName;
    try {
      const rows = (await manager.query(`SELECT COUNT(*) AS cnt FROM ${tableName}`)) as Array<{
        cnt?: unknown;
        count?: unknown;
      }>;
      const count = Number(rows[0]?.cnt ?? rows[0]?.count ?? 0);
      return Number.isFinite(count) ? count : null;
    } catch {
      return null;
    }
  }

  public async processBatch(
    manager: EntityManager,
    ctx: DataBackfillBatchContext,
  ): Promise<DataBackfillBatchResult> {
    const tableName = this.config.database.migrationsTableName;
    const offset = ctx.cursor ? Math.max(0, Number(ctx.cursor) || 0) : 0;

    let rows: Array<{ name?: unknown; timestamp?: unknown }> = [];
    try {
      rows = (await manager.query(
        `SELECT name, timestamp FROM ${tableName} ORDER BY timestamp ASC LIMIT ${Math.max(1, ctx.batchSize)} OFFSET ${offset}`,
      )) as Array<{ name?: unknown; timestamp?: unknown }>;
    } catch {
      return { processedCount: 0, updatedCount: 0, nextCursor: null, done: true };
    }

    if (rows.length === 0) {
      return { processedCount: 0, updatedCount: 0, nextCursor: null, done: true };
    }

    const migrations = manager.connection.migrations ?? [];
    const codeByName = new Map<string, string>();
    for (const m of migrations) {
      const mName = m.name ?? m.constructor.name;
      codeByName.set(mName, computeMigrationChecksum(m));
    }

    const existingChecksums = this.redis?.isReady()
      ? await this.redis.client
          .hgetall(databaseKeys(this.redis).migrationChecksums())
          .catch(() => ({}) as Record<string, string>)
      : ({} as Record<string, string>);

    let updatedCount = 0;
    for (const row of rows) {
      const name = typeof row.name === 'string' ? row.name : '';
      if (!name) continue;
      const expected = codeByName.get(name);
      if (expected && existingChecksums[name] !== expected) {
        updatedCount++;
        if (!ctx.dryRun && this.redis?.isReady()) {
          await this.redis.client
            .hset(databaseKeys(this.redis).migrationChecksums(), name, expected)
            .catch(() => undefined);
        }
      }
    }

    const done = rows.length < ctx.batchSize;
    return {
      processedCount: rows.length,
      updatedCount,
      nextCursor: done ? null : String(offset + rows.length),
      done,
    };
  }
}
