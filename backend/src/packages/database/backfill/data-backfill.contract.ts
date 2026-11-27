import type { EntityManager } from 'typeorm';

export interface DataBackfillBatchContext {
  readonly cursor: string | null;
  readonly batchSize: number;
  readonly dryRun: boolean;
}

export interface DataBackfillBatchResult {
  readonly processedCount: number;
  readonly updatedCount: number;
  readonly nextCursor: string | null;
  readonly done: boolean;
}

/**
 * Hợp đồng Backfill dữ liệu lớn tách khỏi DDL Migration.
 * Mỗi batch chạy độc lập theo cursor để tránh giữ lock bảng dài và dễ tạm dừng/tiếp tục.
 */
export interface DataBackfillContract {
  readonly name: string;
  readonly description: string;
  readonly migrationName?: string;
  readonly tableName?: string;
  readonly defaultBatchSize: number;
  readonly defaultThrottleMs: number;
  estimateTotal(manager: EntityManager): Promise<number | null>;
  processBatch(
    manager: EntityManager,
    ctx: DataBackfillBatchContext,
  ): Promise<DataBackfillBatchResult>;
}

export interface DataBackfillProgressSnapshot {
  readonly name: string;
  readonly batchIndex: number;
  readonly processedRows: number;
  readonly updatedRows: number;
  readonly totalRows: number | null;
  readonly percent: number;
  readonly cursor: string | null;
}

export interface DataBackfillRunOptions {
  readonly batchSize?: number;
  readonly throttleMs?: number;
  readonly initialCursor?: string | null;
  readonly dryRun?: boolean;
  readonly maxBatches?: number;
  readonly onProgress?: (snapshot: DataBackfillProgressSnapshot) => Promise<void> | void;
  readonly shouldCancel?: () => Promise<boolean> | boolean;
}

export interface DataBackfillRunResult {
  readonly name: string;
  readonly status: 'COMPLETED' | 'CANCELLED' | 'DRY_RUN_COMPLETED';
  readonly processedRows: number;
  readonly updatedRows: number;
  readonly totalRows: number | null;
  readonly percent: number;
  readonly lastCursor: string | null;
  readonly batchesExecuted: number;
  readonly durationMs: number;
}
