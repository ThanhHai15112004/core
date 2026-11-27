import { Injectable, Logger } from '@nestjs/common';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { TransactionManager } from '../transaction/transaction-manager.service.js';
import type {
  DataBackfillContract,
  DataBackfillRunOptions,
  DataBackfillRunResult,
} from './data-backfill.contract.js';

class BackfillDryRunRollback extends Error {
  constructor(
    public readonly batchResult: {
      processedCount: number;
      updatedCount: number;
      nextCursor: string | null;
      done: boolean;
    },
  ) {
    super('BACKFILL_DRY_RUN_ROLLBACK');
  }
}

/**
 * Bộ chạy Backfill dữ liệu lớn theo từng batch nhỏ (resumable cursor + throttle + cooperative cancel).
 */
@Injectable()
export class DataBackfillRunnerService {
  private readonly logger = new Logger(DataBackfillRunnerService.name);
  private readonly registry = new Map<string, DataBackfillContract>();

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly transactionManager: TransactionManager,
  ) {}

  public register(...scripts: DataBackfillContract[]): void {
    for (const s of scripts) {
      this.registry.set(s.name, s);
    }
  }

  public list(): DataBackfillContract[] {
    return Array.from(this.registry.values());
  }

  public get(name: string): DataBackfillContract | undefined {
    return this.registry.get(name);
  }

  public async run(
    name: string,
    options: DataBackfillRunOptions = {},
  ): Promise<DataBackfillRunResult> {
    const ds = this.connection.connected();
    if (!ds) {
      throw new Error(
        `Database is not connected (state: ${this.connection.getStatus().state}). Cannot run backfill "${name}".`,
      );
    }

    const script = this.registry.get(name);
    if (!script) {
      const available = Array.from(this.registry.keys()).join(', ') || 'none';
      throw new Error(`Backfill script "${name}" not found. Available: ${available}`);
    }

    const batchSize = Math.max(1, options.batchSize ?? script.defaultBatchSize);
    const throttleMs = Math.max(0, options.throttleMs ?? script.defaultThrottleMs);
    const dryRun = options.dryRun ?? false;
    const maxBatches = options.maxBatches ?? 100_000;
    const startedAt = Date.now();

    const totalRows = await script.estimateTotal(ds.manager).catch(() => null);

    let cursor: string | null = options.initialCursor ?? null;
    let processedRows = 0;
    let updatedRows = 0;
    let batchesExecuted = 0;
    let cancelled = false;

    while (batchesExecuted < maxBatches) {
      if (options.shouldCancel && (await options.shouldCancel())) {
        cancelled = true;
        break;
      }

      let batchOut: {
        processedCount: number;
        updatedCount: number;
        nextCursor: string | null;
        done: boolean;
      };

      try {
        batchOut = await this.transactionManager.runInTransaction(async (manager) => {
          const res = await script.processBatch(manager, { cursor, batchSize, dryRun });
          if (dryRun) {
            throw new BackfillDryRunRollback(res);
          }
          return res;
        });
      } catch (err) {
        if (err instanceof BackfillDryRunRollback) {
          batchOut = err.batchResult;
        } else {
          throw err;
        }
      }

      batchesExecuted++;
      processedRows += Math.max(0, batchOut.processedCount);
      updatedRows += Math.max(0, batchOut.updatedCount);
      cursor = batchOut.nextCursor;

      const percent = batchOut.done
        ? 100
        : totalRows && totalRows > 0
          ? Math.min(99, Math.round((processedRows / totalRows) * 100))
          : Math.min(99, batchesExecuted * 10);

      if (options.onProgress) {
        await options.onProgress({
          name: script.name,
          batchIndex: batchesExecuted,
          processedRows,
          updatedRows,
          totalRows,
          percent,
          cursor,
        });
      }

      if (batchOut.done || (batchOut.processedCount === 0 && !batchOut.nextCursor)) {
        break;
      }

      if (throttleMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, throttleMs));
      }
    }

    const durationMs = Date.now() - startedAt;
    const finalStatus: DataBackfillRunResult['status'] = cancelled
      ? 'CANCELLED'
      : dryRun
        ? 'DRY_RUN_COMPLETED'
        : 'COMPLETED';
    const finalPercent =
      finalStatus === 'CANCELLED'
        ? totalRows && totalRows > 0
          ? Math.min(99, Math.round((processedRows / totalRows) * 100))
          : 0
        : 100;

    this.logger.log(
      `Backfill "${script.name}" ${finalStatus}: processed=${processedRows}, updated=${updatedRows}, batches=${batchesExecuted}, duration=${durationMs}ms`,
    );

    return {
      name: script.name,
      status: finalStatus,
      processedRows,
      updatedRows,
      totalRows,
      percent: finalPercent,
      lastCursor: cursor,
      batchesExecuted,
      durationMs,
    };
  }
}
