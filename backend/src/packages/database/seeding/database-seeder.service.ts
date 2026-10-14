import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { DatabaseOperationError } from '../operations/database-operations.service.js';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { TransactionManager } from '../transaction/transaction-manager.service.js';
import { sanitizeDbMessage } from '../utils/error-classify.js';
import type {
  SeederContract,
  SeederItemResult,
  SeederRunSummary,
  SeederScope,
} from './seeder.contract.js';

const SEED_LOCK_SEC = 300;

export interface RunSeedersOptions {
  /** Lọc theo nhóm seeder (`all` chạy cả `master` và `development` nếu môi trường cho phép). */
  scope?: 'all' | SeederScope;
}

/**
 * Dịch vụ điều phối chạy Seeder hạ tầng (Domain-Agnostic):
 * - Khóa phân tán Redis (`db:lock:seed`) chống chạy đồng thời.
 * - Chốt chặn bảo mật: Cấm chạy seeder `development` trên môi trường `production`.
 * - Thực thi từng seeder trong một Transaction độc lập qua `TransactionManager`.
 */
@Injectable()
export class DatabaseSeederService {
  private readonly logger = new Logger('DatabaseSeeder');

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly transactionManager: TransactionManager,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Thực thi danh sách các Seeder theo thứ tự ưu tiên (`order`) và phạm vi (`scope`). */
  public async runSeeders(
    seeders: SeederContract[],
    options?: RunSeedersOptions,
  ): Promise<SeederRunSummary> {
    const scopeFilter = options?.scope ?? 'all';
    const isProd = this.config.isProduction;

    if (scopeFilter === 'development' && isProd) {
      throw new DatabaseOperationError(
        'SEED_ENV_FORBIDDEN',
        'Cannot run development seeders in production environment',
      );
    }

    if (!this.connection.connected()) {
      throw new DatabaseOperationError('UNAVAILABLE', this.connection.getStatus().state);
    }

    const keys = this.redis ? databaseKeys(this.redis) : null;
    if (keys && this.redis?.isReady()) {
      const locked = await this.redis.client.set(keys.seedLock(), '1', 'EX', SEED_LOCK_SEC, 'NX');
      if (locked !== 'OK') {
        throw new DatabaseOperationError('BUSY', 'Another seeder execution is in progress');
      }
    }

    const sorted = [...seeders].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    const items: SeederItemResult[] = [];

    try {
      for (const seeder of sorted) {
        if (scopeFilter !== 'all' && seeder.scope !== scopeFilter) {
          continue;
        }

        if (seeder.scope === 'development' && isProd) {
          items.push({
            name: seeder.name,
            scope: seeder.scope,
            status: 'skipped',
            affected: 0,
            durationMs: 0,
            details: 'Skipped in production environment',
          });
          continue;
        }

        const startedAt = Date.now();
        try {
          const res = await this.transactionManager.runInTransaction((manager) =>
            seeder.run({
              manager,
              driver: this.connection.driver,
              environment: this.config.app.env,
            }),
          );
          const durationMs = Date.now() - startedAt;
          items.push({
            name: seeder.name,
            scope: seeder.scope,
            status: 'completed',
            affected: res.affected,
            durationMs,
            ...(res.details ? { details: res.details } : {}),
          });
          this.logger.log(
            `Seeder [${seeder.name}] (${seeder.scope}) completed: ${res.affected} record(s) in ${durationMs}ms`,
          );
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const message = sanitizeDbMessage(err);
          items.push({
            name: seeder.name,
            scope: seeder.scope,
            status: 'failed',
            affected: 0,
            durationMs,
            error: message,
          });
          this.logger.error(`Seeder [${seeder.name}] failed: ${message}`);
          throw new DatabaseOperationError('FAILED', `Seeder "${seeder.name}" failed: ${message}`);
        }
      }
    } finally {
      if (keys && this.redis?.isReady()) {
        await this.redis.client.del(keys.seedLock()).catch(() => undefined);
      }
    }

    return {
      at: new Date().toISOString(),
      environment: this.config.app.env,
      total: items.length,
      completed: items.filter((i) => i.status === 'completed').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      failed: items.filter((i) => i.status === 'failed').length,
      items,
    };
  }
}
