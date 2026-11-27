import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  DataBackfillRunnerService,
  DatabaseConnectionService,
  type DataBackfillRunResult,
} from '@packages/database/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MigrationChecksumBackfillScript } from '../../../database/backfills/migration-checksum.backfill.js';
import type {
  DbBackfillJobEntity,
  DbBackfillJobStatus,
} from '../entities/db-backfill-job.entity.js';
import {
  DatabaseActionRejectedException,
  DatabaseNotConnectedException,
  DatabaseNotFoundException,
} from '../exceptions/database-ops.exceptions.js';
import { DbBackfillJobRepository } from '../repositories/db-backfill-job.repository.js';

export const DATABASE_BACKFILL_TOPIC = 'database.backfill';

export interface BackfillDefinitionDto {
  readonly name: string;
  readonly description: string;
  readonly migrationName: string | null;
  readonly tableName: string | null;
  readonly defaultBatchSize: number;
  readonly defaultThrottleMs: number;
}

export interface BackfillJobDto {
  readonly id: number;
  readonly jobCode: string;
  readonly jobName: string;
  readonly migrationName: string | null;
  readonly queueJobId: string | null;
  readonly status: DbBackfillJobStatus;
  readonly batchSize: number;
  readonly throttleMs: number;
  readonly processedRows: number;
  readonly updatedRows: number;
  readonly totalRows: number | null;
  readonly percent: number;
  readonly lastCursor: string | null;
  readonly dryRun: boolean;
  readonly cancelRequested: boolean;
  readonly triggeredBy: string;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface BackfillOverviewDto {
  readonly definitions: readonly BackfillDefinitionDto[];
  readonly jobs: readonly BackfillJobDto[];
}

export interface EnqueueBackfillInput {
  readonly jobName: string;
  readonly batchSize?: number | undefined;
  readonly throttleMs?: number | undefined;
  readonly dryRun?: boolean | undefined;
  readonly triggeredBy?: string | undefined;
  readonly inline?: boolean | undefined;
}

/**
 * Điều phối các tác vụ Backfill dữ liệu lớn tách khỏi Migration:
 * - Đưa job vào queue `system.heavy` (`database.backfill`) hoặc chạy trực tiếp từ CLI.
 * - Lưu tiến độ từng batch + cursor checkpoint vào bảng `db_backfill_jobs`.
 */
@Injectable()
export class BackfillOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(BackfillOrchestratorService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly connection: DatabaseConnectionService,
    private readonly runner: DataBackfillRunnerService,
    private readonly jobRepo: DbBackfillJobRepository,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly publisher?: BaseMessagePublisherProvider,
  ) {
    this.registerBuiltIns();
  }

  public onModuleInit(): void {
    this.registerBuiltIns();
  }

  private registerBuiltIns(): void {
    if (!this.runner.get('migration-checksum-backfill')) {
      this.runner.register(new MigrationChecksumBackfillScript(this.config, this.redis ?? null));
    }
  }

  public async getOverview(limit = 30): Promise<BackfillOverviewDto> {
    const definitions: BackfillDefinitionDto[] = this.runner.list().map((s) => ({
      name: s.name,
      description: s.description,
      migrationName: s.migrationName ?? null,
      tableName: s.tableName ?? null,
      defaultBatchSize: s.defaultBatchSize,
      defaultThrottleMs: s.defaultThrottleMs,
    }));
    const rows = await this.jobRepo.listRecent(limit);
    return {
      definitions,
      jobs: rows.map((r) => this.toDto(r)),
    };
  }

  public async enqueueOrRunBackfill(input: EnqueueBackfillInput): Promise<{
    job: BackfillJobDto;
    executionMode: 'queue' | 'inline';
    result?: DataBackfillRunResult;
  }> {
    const script = this.runner.get(input.jobName);
    if (!script) {
      throw new DatabaseNotFoundException('database.error.BACKFILL_NOT_FOUND', {
        name: input.jobName,
      });
    }

    if (!this.connection.connected()) {
      throw new DatabaseNotConnectedException(this.connection.getStatus().state);
    }

    const batchSize = Math.max(1, input.batchSize ?? script.defaultBatchSize);
    const throttleMs = Math.max(0, input.throttleMs ?? script.defaultThrottleMs);
    const dryRun = Boolean(input.dryRun);
    const jobCode = `bf-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const triggeredBy = input.triggeredBy?.trim() || 'ops';

    const created = await this.jobRepo.saveEntity({
      jobCode,
      jobName: script.name,
      migrationName: script.migrationName ?? null,
      status: 'QUEUED',
      batchSize,
      throttleMs,
      processedRows: 0,
      updatedRows: 0,
      totalRows: null,
      percent: 0,
      lastCursor: null,
      dryRun,
      cancelRequested: false,
      triggeredBy,
    });

    if (!input.inline && this.publisher) {
      try {
        const envelope = await this.publisher.publish(
          DATABASE_BACKFILL_TOPIC,
          {
            operation: 'database_backfill',
            backfillJobId: created.id,
            jobCode: created.jobCode,
            jobName: script.name,
            batchSize,
            throttleMs,
            dryRun,
          },
          QUEUES.SYSTEM_HEAVY,
          {
            idempotencyKey: `db-backfill:${created.jobCode}`,
            index: { backfillJobId: created.id, jobName: script.name },
          },
        );
        const updated = await this.jobRepo.updateFieldsSafe(created.id, {
          queueJobId: envelope.id,
        });
        return {
          job: this.toDto(updated ?? { ...created, queueJobId: envelope.id }),
          executionMode: 'queue',
        };
      } catch (err) {
        this.logger.warn(
          `Queue publish failed for backfill "${created.jobCode}", falling back to inline run: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const result = await this.executeJobById(created.id);
    const reloaded = (await this.jobRepo.findByIdSafe(created.id)) ?? created;
    return {
      job: this.toDto(reloaded),
      executionMode: 'inline',
      result,
    };
  }

  public async executeJobById(
    jobId: number,
    onExternalProgress?: (snapshot: {
      processedRows: number;
      totalRows: number | null;
      percent: number;
      cursor: string | null;
    }) => Promise<void> | void,
  ): Promise<DataBackfillRunResult> {
    const jobRow = await this.jobRepo.findByIdSafe(jobId);
    if (!jobRow) {
      throw new DatabaseNotFoundException('database.error.BACKFILL_NOT_FOUND', {
        name: `#${jobId}`,
      });
    }

    if (jobRow.cancelRequested || jobRow.status === 'CANCELLED') {
      await this.jobRepo.updateFieldsSafe(jobId, {
        status: 'CANCELLED',
        completedAt: new Date(),
      });
      return {
        name: jobRow.jobName,
        status: 'CANCELLED',
        processedRows: jobRow.processedRows,
        updatedRows: jobRow.updatedRows,
        totalRows: jobRow.totalRows,
        percent: jobRow.percent,
        lastCursor: jobRow.lastCursor,
        batchesExecuted: 0,
        durationMs: 0,
      };
    }

    await this.jobRepo.updateFieldsSafe(jobId, {
      status: 'RUNNING',
      startedAt: jobRow.startedAt ?? new Date(),
      errorMessage: null,
    });

    try {
      const result = await this.runner.run(jobRow.jobName, {
        batchSize: jobRow.batchSize,
        throttleMs: jobRow.throttleMs,
        initialCursor: jobRow.lastCursor,
        dryRun: jobRow.dryRun,
        shouldCancel: () => this.jobRepo.isCancelRequested(jobId),
        onProgress: async (snap) => {
          await this.jobRepo.updateFieldsSafe(jobId, {
            processedRows: snap.processedRows,
            updatedRows: snap.updatedRows,
            totalRows: snap.totalRows,
            percent: snap.percent,
            lastCursor: snap.cursor,
          });
          if (onExternalProgress) {
            await onExternalProgress({
              processedRows: snap.processedRows,
              totalRows: snap.totalRows,
              percent: snap.percent,
              cursor: snap.cursor,
            });
          }
        },
      });

      const finalStatus: DbBackfillJobStatus =
        result.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED';
      await this.jobRepo.updateFieldsSafe(jobId, {
        status: finalStatus,
        processedRows: result.processedRows,
        updatedRows: result.updatedRows,
        totalRows: result.totalRows,
        percent: result.percent,
        lastCursor: result.lastCursor,
        completedAt: new Date(),
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.jobRepo.updateFieldsSafe(jobId, {
        status: 'FAILED',
        errorMessage: msg,
        completedAt: new Date(),
      });
      throw err;
    }
  }

  public async cancelJob(jobId: number): Promise<BackfillJobDto> {
    const existing = await this.jobRepo.findByIdSafe(jobId);
    if (!existing) {
      throw new DatabaseNotFoundException('database.error.BACKFILL_NOT_FOUND', {
        name: `#${jobId}`,
      });
    }
    if (
      existing.status === 'COMPLETED' ||
      existing.status === 'FAILED' ||
      existing.status === 'CANCELLED'
    ) {
      throw new DatabaseActionRejectedException(
        'BACKFILL_ALREADY_FINISHED',
        'database.error.BACKFILL_ALREADY_FINISHED',
        { status: existing.status },
        409,
      );
    }

    const updated = await this.jobRepo.updateFieldsSafe(jobId, {
      cancelRequested: true,
      ...(existing.status === 'QUEUED' ? { status: 'CANCELLED', completedAt: new Date() } : {}),
    });
    return this.toDto(updated ?? existing);
  }

  private toDto(row: DbBackfillJobEntity): BackfillJobDto {
    return {
      id: row.id,
      jobCode: row.jobCode,
      jobName: row.jobName,
      migrationName: row.migrationName,
      queueJobId: row.queueJobId,
      status: row.status,
      batchSize: row.batchSize,
      throttleMs: row.throttleMs,
      processedRows: row.processedRows,
      updatedRows: row.updatedRows,
      totalRows: row.totalRows,
      percent: row.percent,
      lastCursor: row.lastCursor,
      dryRun: row.dryRun,
      cancelRequested: row.cancelRequested,
      triggeredBy: row.triggeredBy,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }
}
