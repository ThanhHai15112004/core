import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { OUTBOX_EVENT_STATUS, type OutboxEventStatusCode } from '../enum/outbox.enum.js';
import { OutboxEventEntity } from '../entities/outbox-event.entity.js';
import type { ListOutboxEventsInput } from '../contracts/index.js';
import type { RawOutboxMetricsCounts } from '../types/outbox.types.js';

@Injectable()
export class OutboxEventRepository extends BaseTypeOrmRepository<OutboxEventEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(OutboxEventEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<OutboxEventEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByEventId(eventId: string): Promise<OutboxEventEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { eventId } });
  }

  public async listPaginated(
    filter: ListOutboxEventsInput,
  ): Promise<PaginatedResult<OutboxEventEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }

    const qb = this.repository.createQueryBuilder('evt');

    if (filter.status !== undefined) {
      qb.andWhere('evt.status = :status', { status: filter.status });
    }
    if (filter.sourceModule?.trim()) {
      qb.andWhere('evt.sourceModule = :sourceModule', {
        sourceModule: filter.sourceModule.trim().toLowerCase(),
      });
    }
    if (filter.eventType?.trim()) {
      const normalized = filter.eventType.trim();
      qb.andWhere('(evt.eventType = :eventType OR evt.dotName = :dotName)', {
        eventType: normalized,
        dotName: normalized.toLowerCase(),
      });
    }
    if (filter.aggregateType?.trim()) {
      qb.andWhere('evt.aggregateType = :aggregateType', {
        aggregateType: filter.aggregateType.trim(),
      });
    }
    if (filter.aggregateId?.trim()) {
      qb.andWhere('evt.aggregateId = :aggregateId', {
        aggregateId: filter.aggregateId.trim(),
      });
    }
    if (filter.correlationId?.trim()) {
      qb.andWhere('evt.correlationId = :correlationId', {
        correlationId: filter.correlationId.trim(),
      });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'evt.eventId',
        'evt.eventType',
        'evt.dotName',
        'evt.sourceModule',
        'evt.aggregateId',
        'evt.correlationId',
        'evt.lastErrorCode',
        'evt.lastErrorMessage',
      ]);
    }

    qb.orderBy('evt.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  /**
   * Giữ lease an toàn theo lô cho một Worker (`workerId`), tương thích MySQL, PostgreSQL và SQLite:
   * 1. Tìm tối đa `batchSize` bản ghi đến hạn (`PENDING`/`FAILED` có `next_attempt_at <= now`
   *    hoặc `PROCESSING` bị treo hết hạn `locked_until <= now`).
   * 2. Chạy `UPDATE` có điều kiện nguyên tử để gán `status = PROCESSING`, `locked_by`, `locked_until`.
   * 3. Chỉ trả về đúng những bản ghi mà `workerId` này giành được lease.
   */
  public async claimNextBatch(
    workerId: string,
    batchSize: number,
    leaseTimeoutMs: number,
    now: Date = new Date(),
  ): Promise<OutboxEventEntity[]> {
    if (!this.isDatabaseReady()) return [];

    const limit = Math.max(1, Math.min(500, Math.round(batchSize)));
    const claimableStatuses: OutboxEventStatusCode[] = [
      OUTBOX_EVENT_STATUS.PENDING,
      OUTBOX_EVENT_STATUS.FAILED,
    ];

    const candidates = await this.repository
      .createQueryBuilder('evt')
      .select('evt.id', 'id')
      .where(
        '((evt.status IN (:...claimableStatuses) AND (evt.nextAttemptAt IS NULL OR evt.nextAttemptAt <= :now)) OR (evt.status = :processingStatus AND evt.lockedUntil IS NOT NULL AND evt.lockedUntil <= :now))',
        {
          claimableStatuses,
          processingStatus: OUTBOX_EVENT_STATUS.PROCESSING,
          now,
        },
      )
      .orderBy('evt.id', 'ASC')
      .take(limit)
      .getRawMany<{ id: string | number }>();

    const candidateIds = candidates
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (candidateIds.length === 0) {
      return [];
    }

    const lockedUntil = new Date(now.getTime() + Math.max(5_000, leaseTimeoutMs));

    await this.repository
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({
        status: OUTBOX_EVENT_STATUS.PROCESSING,
        lockedBy: workerId,
        lockedUntil,
      })
      .where('id IN (:...ids)', { ids: candidateIds })
      .andWhere(
        '((status IN (:...claimableStatuses) AND (next_attempt_at IS NULL OR next_attempt_at <= :now)) OR (status = :processingStatus AND locked_until IS NOT NULL AND locked_until <= :now))',
        {
          claimableStatuses,
          processingStatus: OUTBOX_EVENT_STATUS.PROCESSING,
          now,
        },
      )
      .execute();

    return this.repository
      .createQueryBuilder('evt')
      .where('evt.id IN (:...ids)', { ids: candidateIds })
      .andWhere('evt.status = :processingStatus', {
        processingStatus: OUTBOX_EVENT_STATUS.PROCESSING,
      })
      .andWhere('evt.lockedBy = :workerId', { workerId })
      .orderBy('evt.id', 'ASC')
      .getMany();
  }

  public async markPublished(
    id: number,
    workerId: string,
    attemptCount: number,
    publishedAt: Date,
  ): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({
        status: OUTBOX_EVENT_STATUS.PUBLISHED,
        attemptCount,
        lastAttemptedAt: publishedAt,
        publishedAt,
        nextAttemptAt: null,
        lockedBy: null,
        lockedUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      .where('id = :id', { id })
      .andWhere('locked_by = :workerId', { workerId })
      .execute();
  }

  public async markFailed(params: {
    readonly id: number;
    readonly workerId: string;
    readonly attemptCount: number;
    readonly nextAttemptAt: Date;
    readonly attemptedAt: Date;
    readonly errorCode: string;
    readonly errorMessage: string;
  }): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({
        status: OUTBOX_EVENT_STATUS.FAILED,
        attemptCount: params.attemptCount,
        lastAttemptedAt: params.attemptedAt,
        nextAttemptAt: params.nextAttemptAt,
        lockedBy: null,
        lockedUntil: null,
        lastErrorCode: params.errorCode.slice(0, 80),
        lastErrorMessage: params.errorMessage.slice(0, 1000),
      })
      .where('id = :id', { id: params.id })
      .andWhere('locked_by = :workerId', { workerId: params.workerId })
      .execute();
  }

  public async markDeadLetter(params: {
    readonly id: number;
    readonly workerId: string;
    readonly attemptCount: number;
    readonly attemptedAt: Date;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly reason: string;
  }): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({
        status: OUTBOX_EVENT_STATUS.DEAD_LETTER,
        attemptCount: params.attemptCount,
        lastAttemptedAt: params.attemptedAt,
        nextAttemptAt: null,
        lockedBy: null,
        lockedUntil: null,
        lastErrorCode: params.errorCode.slice(0, 80),
        lastErrorMessage: params.errorMessage.slice(0, 1000),
        deadLetteredAt: params.attemptedAt,
        deadLetterReason: params.reason.slice(0, 500),
      })
      .where('id = :id', { id: params.id })
      .andWhere('locked_by = :workerId', { workerId: params.workerId })
      .execute();
  }

  /** Đọc số liệu tồn đọng và độ trễ thô phục vụ giám sát và cảnh báo Outbox. */
  public async getRawMetrics(now: Date = new Date()): Promise<RawOutboxMetricsCounts> {
    if (!this.isDatabaseReady()) {
      return {
        pendingCount: 0,
        processingCount: 0,
        failedCount: 0,
        deadLetterCount: 0,
        publishedLast24hCount: 0,
        oldestPendingCreatedAt: null,
        avgPublishLagMs: null,
      };
    }

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [statusRows, publishedLast24hCount, oldestRow, recentPublished] = await Promise.all([
      this.repository
        .createQueryBuilder('evt')
        .select('evt.status', 'status')
        .addSelect('COUNT(*)', 'cnt')
        .groupBy('evt.status')
        .getRawMany<{ status: string | number; cnt: string | number }>(),
      this.repository
        .createQueryBuilder('evt')
        .where('evt.status = :published', { published: OUTBOX_EVENT_STATUS.PUBLISHED })
        .andWhere('evt.publishedAt >= :since24h', { since24h })
        .getCount(),
      this.repository
        .createQueryBuilder('evt')
        .select('MIN(evt.createdAt)', 'oldest')
        .where('evt.status IN (:...backlog)', {
          backlog: [OUTBOX_EVENT_STATUS.PENDING, OUTBOX_EVENT_STATUS.FAILED],
        })
        .getRawOne<{ oldest: Date | string | null }>(),
      this.repository
        .createQueryBuilder('evt')
        .select(['evt.createdAt', 'evt.publishedAt'])
        .where('evt.status = :published', { published: OUTBOX_EVENT_STATUS.PUBLISHED })
        .andWhere('evt.publishedAt IS NOT NULL')
        .andWhere('evt.publishedAt >= :since24h', { since24h })
        .orderBy('evt.publishedAt', 'DESC')
        .take(200)
        .getMany(),
    ]);

    const counts = new Map<number, number>();
    for (const row of statusRows) {
      counts.set(Number(row.status), Number(row.cnt) || 0);
    }

    const rawOldest = oldestRow?.oldest ?? null;
    const oldestPendingCreatedAt =
      rawOldest instanceof Date
        ? rawOldest
        : typeof rawOldest === 'string' && rawOldest
          ? new Date(rawOldest)
          : null;

    let avgPublishLagMs: number | null = null;
    if (recentPublished.length > 0) {
      let totalLagMs = 0;
      let validSamples = 0;
      for (const item of recentPublished) {
        if (item.publishedAt && item.createdAt) {
          totalLagMs += Math.max(0, item.publishedAt.getTime() - item.createdAt.getTime());
          validSamples += 1;
        }
      }
      if (validSamples > 0) {
        avgPublishLagMs = Math.round(totalLagMs / validSamples);
      }
    }

    return {
      pendingCount: counts.get(OUTBOX_EVENT_STATUS.PENDING) ?? 0,
      processingCount: counts.get(OUTBOX_EVENT_STATUS.PROCESSING) ?? 0,
      failedCount: counts.get(OUTBOX_EVENT_STATUS.FAILED) ?? 0,
      deadLetterCount: counts.get(OUTBOX_EVENT_STATUS.DEAD_LETTER) ?? 0,
      publishedLast24hCount,
      oldestPendingCreatedAt:
        oldestPendingCreatedAt && !Number.isNaN(oldestPendingCreatedAt.getTime())
          ? oldestPendingCreatedAt
          : null,
      avgPublishLagMs,
    };
  }

  /**
   * Xóa cứng theo lô các bản ghi `PUBLISHED` hoặc `DEAD_LETTER` đã quá hạn lưu trữ
   * để bảng `outbox_events` không phình to vô hạn và tránh khóa bảng dài.
   */
  public async purgeExpiredByStatus(
    status: typeof OUTBOX_EVENT_STATUS.PUBLISHED | typeof OUTBOX_EVENT_STATUS.DEAD_LETTER,
    cutoffDate: Date,
    batchSize: number,
  ): Promise<number> {
    if (!this.isDatabaseReady()) return 0;

    const limit = Math.max(1, Math.min(10_000, Math.round(batchSize)));
    const qb = this.repository
      .createQueryBuilder('evt')
      .withDeleted()
      .select('evt.id', 'id')
      .where('evt.status = :status', { status });

    if (status === OUTBOX_EVENT_STATUS.PUBLISHED) {
      qb.andWhere(
        '(evt.publishedAt <= :cutoff OR (evt.publishedAt IS NULL AND evt.updatedAt <= :cutoff))',
        {
          cutoff: cutoffDate,
        },
      );
    } else {
      qb.andWhere(
        '(evt.deadLetteredAt <= :cutoff OR (evt.deadLetteredAt IS NULL AND evt.updatedAt <= :cutoff))',
        { cutoff: cutoffDate },
      );
    }

    const rows = await qb
      .orderBy('evt.id', 'ASC')
      .take(limit)
      .getRawMany<{ id: string | number }>();
    const ids = rows.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(OutboxEventEntity)
      .where('id IN (:...ids)', { ids })
      .execute();

    return result.affected ?? ids.length;
  }
}
