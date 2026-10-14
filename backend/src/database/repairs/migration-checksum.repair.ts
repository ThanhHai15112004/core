import crypto from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import type { DataRepairContract, DataRepairExecutionResult } from '@packages/database/index.js';
import { databaseKeys } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';

/**
 * Kịch bản sửa dữ liệu hạ tầng (Domain-Agnostic):
 * Quét bảng lịch sử di trú (`core_migrations`) và đồng bộ mã băm SHA-256 (`checksum`)
 * vào kho lưu trữ đối chiếu cho các bản di trú đã chạy trước khi bật tính năng kiểm tra toàn vẹn.
 */
export class MigrationChecksumRepairScript implements DataRepairContract {
  public readonly name = 'migration-checksum-sync';
  public readonly description =
    'Đồng bộ và điền bù mã băm SHA-256 cho các bản ghi lịch sử trong bảng core_migrations';

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService | null = null,
  ) {}

  public async execute(
    manager: EntityManager,
    context: { readonly dryRun: boolean },
  ): Promise<DataRepairExecutionResult> {
    const tableName = this.config.database.migrationsTableName;
    const migrations = manager.connection.migrations ?? [];

    let rows: Array<{ name?: unknown; timestamp?: unknown }> = [];
    try {
      rows = (await manager.query(`SELECT name, timestamp FROM ${tableName}`)) as Array<{
        name?: unknown;
        timestamp?: unknown;
      }>;
    } catch {
      return {
        scannedCount: 0,
        affectedCount: 0,
        summary: `Bảng ${tableName} chưa tồn tại hoặc chưa có bản ghi migration nào.`,
      };
    }

    const codeByName = new Map<string, string>();
    for (const m of migrations) {
      const mName = m.name ?? m.constructor.name;
      const rawSource = `${mName}:${m.up.toString()}:${m.down.toString()}`;
      const checksum = crypto.createHash('sha256').update(rawSource).digest('hex');
      codeByName.set(mName, checksum);
    }

    const existingChecksums =
      this.redis && this.redis.isReady()
        ? await this.redis.client.hgetall(databaseKeys(this.redis).migrationChecksums())
        : {};

    const missingNames: string[] = [];
    for (const row of rows) {
      const rowName = typeof row.name === 'string' ? row.name : '';
      if (!rowName) continue;
      const expectedChecksum = codeByName.get(rowName);
      if (expectedChecksum && !existingChecksums[rowName]) {
        missingNames.push(rowName);
        if (!context.dryRun && this.redis && this.redis.isReady()) {
          await this.redis.client.hset(
            databaseKeys(this.redis).migrationChecksums(),
            rowName,
            expectedChecksum,
          );
        }
      }
    }

    return {
      scannedCount: rows.length,
      affectedCount: missingNames.length,
      summary:
        missingNames.length > 0
          ? `${context.dryRun ? '[DRY-RUN] Dự kiến đồng bộ' : 'Đã đồng bộ'} checksum cho ${missingNames.length}/${rows.length} bản ghi migration.`
          : `Tất cả ${rows.length} bản ghi migration đã có đầy đủ checksum hợp lệ.`,
      details: {
        tableName,
        repairedMigrations: missingNames,
      },
    };
  }
}
