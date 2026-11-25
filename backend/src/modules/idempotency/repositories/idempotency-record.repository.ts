import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BaseTypeOrmRepository,
  TransactionManager,
  isUniqueConstraintError,
} from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { ListIdempotencyRecordsInput } from '../contracts/index.js';
import {
  IDEMPOTENCY_STATUS,
  parseIdempotencyScope,
  type IdempotencyScope,
} from '../enum/idempotency.enum.js';
import { IdempotencyRecordEntity } from '../entities/idempotency-record.entity.js';
import type {
  RawClientRepeatRow,
  RawIdempotencyMetricsSummary,
  RawScopeMetricsRow,
} from '../types/idempotency.types.js';

export interface InsertIdempotencyRecordParams {
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly status: IdempotencyRecordEntity['status'];
  readonly responseStatusCode?: number | null;
  readonly responseBodyJson?: string | null;
  readonly responseHeadersJson?: string | null;
  readonly lockOwner: string | null;
  readonly lockedUntil: Date | null;
  readonly clientIdentifier: string | null;
  readonly correlationId: string | null;
  readonly completedAt?: Date | null;
  readonly expiresAt: Date;
}

export interface ReclaimIdempotencyRecordParams {
  readonly id: number;
  readonly requestFingerprint: string;
  readonly lockOwner: string | null;
  readonly lockedUntil: Date;
  readonly clientIdentifier: string | null;
  readonly correlationId: string | null;
  readonly expiresAt: Date;
  readonly now: Date;
  readonly mode: 'EXPIRED' | 'FAILED' | 'STALE_LEASE' | 'SAME_OWNER';
  readonly expectedLockOwner?: string | null;
}

@Injectable()
export class IdempotencyRecordRepository extends BaseTypeOrmRepository<IdempotencyRecordEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(IdempotencyRecordEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<IdempotencyRecordEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByScopeAndKey(
    scope: IdempotencyScope,
    scopeTarget: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecordEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: {
        scope,
        scopeTarget,
        idempotencyKey,
      },
    });
  }

  /**
   * Chèn nguyên tử một bản ghi khóa chống trùng mới.
   * Trả về `{ inserted: true, entity }` nếu giành được khóa, hoặc `{ inserted: false }` nếu đụng UNIQUE index.
   */
  public async tryInsertRecord(
    params: InsertIdempotencyRecordParams,
  ): Promise<
    | { readonly inserted: true; readonly entity: IdempotencyRecordEntity }
    | { readonly inserted: false }
  > {
    try {
      const entity = await this.saveEntity({
        scope: params.scope,
        scopeTarget: params.scopeTarget,
        idempotencyKey: params.idempotencyKey,
        requestFingerprint: params.requestFingerprint,
        status: params.status,
        responseStatusCode: params.responseStatusCode ?? null,
        responseBodyJson: params.responseBodyJson ?? null,
        responseHeadersJson: params.responseHeadersJson ?? null,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier,
        correlationId: params.correlationId,
        duplicateHits: 0,
        conflictHits: 0,
        lastDuplicateAt: null,
        lastConflictAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: params.completedAt ?? null,
        expiresAt: params.expiresAt,
      });
      return { inserted: true, entity };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return { inserted: false };
      }
      throw err;
    }
  }

  /**
   * Thu hồi nguyên tử một bản ghi đã hết hạn / thất bại / quá lease / hoặc cùng `lockOwner` để tái xử lý an toàn.
   */
  public async tryReclaimRecord(params: ReclaimIdempotencyRecordParams): Promise<boolean> {
    if (!this.isDatabaseReady()) return false;

    const qb = this.repository
      .createQueryBuilder()
      .update(IdempotencyRecordEntity)
      .set({
        requestFingerprint: params.requestFingerprint,
        status: IDEMPOTENCY_STATUS.IN_PROGRESS,
        responseStatusCode: null,
        responseBodyJson: null,
        responseHeadersJson: null,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier,
        correlationId: params.correlationId,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: null,
        expiresAt: params.expiresAt,
        ...(params.mode === 'EXPIRED'
          ? {
              duplicateHits: 0,
              conflictHits: 0,
              lastDuplicateAt: null,
              lastConflictAt: null,
            }
          : {}),
      })
      .where('id = :id', { id: params.id });

    if (params.mode === 'EXPIRED') {
      qb.andWhere('expires_at <= :now', { now: params.now });
    } else if (params.mode === 'FAILED') {
      qb.andWhere('status = :failedStatus', { failedStatus: IDEMPOTENCY_STATUS.FAILED });
    } else if (params.mode === 'STALE_LEASE') {
      qb.andWhere('status = :inProgressStatus', {
        inProgressStatus: IDEMPOTENCY_STATUS.IN_PROGRESS,
      }).andWhere('(locked_until IS NULL OR locked_until <= :now)', { now: params.now });
    } else if (params.mode === 'SAME_OWNER') {
      qb.andWhere('status = :inProgressStatus', {
        inProgressStatus: IDEMPOTENCY_STATUS.IN_PROGRESS,
      }).andWhere('lock_owner = :expectedOwner', {
        expectedOwner: params.expectedLockOwner ?? '',
      });
    }

    const res = await qb.execute();
    return Number(res.affected ?? 0) > 0;
  }

  public async markCompleted(params: {
    readonly id?: number | null | undefined;
    readonly scope: IdempotencyScope;
    readonly scopeTarget: string;
    readonly idempotencyKey: string;
    readonly statusCode: number | null;
    readonly responseBodyJson: string | null;
    readonly responseHeadersJson: string | null;
    readonly now: Date;
  }): Promise<void> {
    if (!this.isDatabaseReady()) return;

    const qb = this.repository.createQueryBuilder().update(IdempotencyRecordEntity).set({
      status: IDEMPOTENCY_STATUS.COMPLETED,
      responseStatusCode: params.statusCode,
      responseBodyJson: params.responseBodyJson,
      responseHeadersJson: params.responseHeadersJson,
      lockedUntil: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      completedAt: params.now,
    });

    if (params.id) {
      qb.where('id = :id', { id: params.id });
    } else {
      qb.where('scope = :scope AND scope_target = :scopeTarget AND idempotency_key = :key', {
        scope: params.scope,
        scopeTarget: params.scopeTarget,
        key: params.idempotencyKey,
      });
    }

    await qb.execute();
  }

  public async markFailed(params: {
    readonly id?: number | null | undefined;
    readonly scope: IdempotencyScope;
    readonly scopeTarget: string;
    readonly idempotencyKey: string;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
  }): Promise<void> {
    if (!this.isDatabaseReady()) return;

    const qb = this.repository
      .createQueryBuilder()
      .update(IdempotencyRecordEntity)
      .set({
        status: IDEMPOTENCY_STATUS.FAILED,
        lockedUntil: null,
        lastErrorCode: params.errorCode ? params.errorCode.slice(0, 80) : null,
        lastErrorMessage: params.errorMessage ? params.errorMessage.slice(0, 1000) : null,
      });

    if (params.id) {
      qb.where('id = :id', { id: params.id });
    } else {
      qb.where('scope = :scope AND scope_target = :scopeTarget AND idempotency_key = :key', {
        scope: params.scope,
        scopeTarget: params.scopeTarget,
        key: params.idempotencyKey,
      });
    }

    await qb.execute();
  }

  public async incrementDuplicateHit(id: number, now: Date): Promise<void> {
    if (!this.isDatabaseReady()) return;
    await this.repository
      .createQueryBuilder()
      .update(IdempotencyRecordEntity)
      .set({
        duplicateHits: () => 'duplicate_hits + 1',
        lastDuplicateAt: now,
      })
      .where('id = :id', { id })
      .execute();
  }

  public async incrementConflictHit(
    id: number,
    now: Date,
    errorMessage?: string | null,
  ): Promise<void> {
    if (!this.isDatabaseReady()) return;
    await this.repository
      .createQueryBuilder()
      .update(IdempotencyRecordEntity)
      .set({
        conflictHits: () => 'conflict_hits + 1',
        lastConflictAt: now,
        ...(errorMessage
          ? {
              lastErrorCode: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              lastErrorMessage: errorMessage.slice(0, 1000),
            }
          : {}),
      })
      .where('id = :id', { id })
      .execute();
  }

  public async listPaginated(
    filter: ListIdempotencyRecordsInput,
  ): Promise<PaginatedResult<IdempotencyRecordEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('rec');

    if (filter.scope) {
      qb.andWhere('rec.scope = :scope', { scope: filter.scope });
    }
    if (filter.scopeTarget?.trim()) {
      qb.andWhere('rec.scopeTarget = :scopeTarget', {
        scopeTarget: filter.scopeTarget.trim(),
      });
    }
    if (filter.status !== undefined) {
      qb.andWhere('rec.status = :status', { status: filter.status });
    }
    if (filter.clientIdentifier?.trim()) {
      qb.andWhere('rec.clientIdentifier = :clientIdentifier', {
        clientIdentifier: filter.clientIdentifier.trim(),
      });
    }
    if (filter.correlationId?.trim()) {
      qb.andWhere('rec.correlationId = :correlationId', {
        correlationId: filter.correlationId.trim(),
      });
    }
    if (filter.onlyDuplicates) {
      qb.andWhere('rec.duplicateHits > 0');
    }
    if (filter.onlyConflicts) {
      qb.andWhere('rec.conflictHits > 0');
    }
    if (filter.includeExpired === false) {
      qb.andWhere('rec.expiresAt > :now', { now: new Date() });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'rec.idempotencyKey',
        'rec.scopeTarget',
        'rec.clientIdentifier',
        'rec.correlationId',
        'rec.lastErrorCode',
        'rec.lastErrorMessage',
      ]);
    }

    qb.orderBy('rec.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }

  public async hardDeleteById(id: number): Promise<boolean> {
    if (!this.isDatabaseReady()) return false;
    const res = await this.repository
      .createQueryBuilder()
      .delete()
      .from(IdempotencyRecordEntity)
      .where('id = :id', { id })
      .execute();
    return Number(res.affected ?? 0) > 0;
  }

  /** Xóa vật lý theo lô các khóa đã hết hạn (`expires_at <= now`) để tránh khóa bảng kéo dài. */
  public async purgeExpiredBatch(now: Date, batchSize: number): Promise<number> {
    if (!this.isDatabaseReady()) return 0;
    const limit = Math.max(1, Math.min(10_000, Math.round(batchSize)));
    const rows = await this.repository
      .createQueryBuilder('rec')
      .select('rec.id', 'id')
      .where('rec.expiresAt <= :now', { now })
      .orderBy('rec.expiresAt', 'ASC')
      .limit(limit)
      .getRawMany<{ id: number | string }>();

    const ids = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return 0;

    const deleted = await this.repository
      .createQueryBuilder()
      .delete()
      .from(IdempotencyRecordEntity)
      .where('id IN (:...ids)', { ids })
      .execute();

    return Number(deleted.affected ?? 0);
  }

  /**
   * Thu thập số liệu tổng hợp cho cửa sổ `windowStart..now`:
   * - Đếm khóa còn hiệu lực vs đã hết hạn chờ dọn.
   * - Phân tích theo 4 luồng (`API` / `JOB` / `WEBHOOK` / `EVENT`).
   * - Top 20 client/nguồn gửi lặp nhiều nhất.
   */
  public async collectMetricsRaw(
    windowStart: Date,
    now: Date = new Date(),
  ): Promise<RawIdempotencyMetricsSummary> {
    if (!this.isDatabaseReady()) {
      return {
        activeKeysCount: 0,
        expiredPendingPurgeCount: 0,
        scopeRows: [],
        clientRows: [],
      };
    }

    const [activeKeysCount, expiredPendingPurgeCount, rawScopeRows, rawClientRows] =
      await Promise.all([
        this.repository.createQueryBuilder('rec').where('rec.expiresAt > :now', { now }).getCount(),
        this.repository
          .createQueryBuilder('rec')
          .where('rec.expiresAt <= :now', { now })
          .getCount(),
        this.repository
          .createQueryBuilder('rec')
          .select('rec.scope', 'scope')
          .addSelect('COUNT(rec.id)', 'uniqueKeys')
          .addSelect(
            `SUM(CASE WHEN rec.status = ${IDEMPOTENCY_STATUS.IN_PROGRESS} THEN 1 ELSE 0 END)`,
            'inProgressCount',
          )
          .addSelect(
            `SUM(CASE WHEN rec.status = ${IDEMPOTENCY_STATUS.COMPLETED} THEN 1 ELSE 0 END)`,
            'completedCount',
          )
          .addSelect(
            `SUM(CASE WHEN rec.status = ${IDEMPOTENCY_STATUS.FAILED} THEN 1 ELSE 0 END)`,
            'failedCount',
          )
          .addSelect('COALESCE(SUM(rec.duplicate_hits), 0)', 'duplicateHits')
          .addSelect('COALESCE(SUM(rec.conflict_hits), 0)', 'conflictHits')
          .where(
            '(rec.createdAt >= :windowStart OR rec.lastDuplicateAt >= :windowStart OR rec.lastConflictAt >= :windowStart)',
            { windowStart },
          )
          .groupBy('rec.scope')
          .getRawMany<{
            scope: string;
            uniqueKeys: string | number;
            inProgressCount: string | number;
            completedCount: string | number;
            failedCount: string | number;
            duplicateHits: string | number;
            conflictHits: string | number;
          }>(),
        this.repository
          .createQueryBuilder('rec')
          .select("COALESCE(rec.client_identifier, 'anonymous')", 'clientIdentifier')
          .addSelect('rec.scope', 'scope')
          .addSelect('rec.scope_target', 'scopeTarget')
          .addSelect('COUNT(rec.id)', 'uniqueKeys')
          .addSelect('COALESCE(SUM(rec.duplicate_hits), 0)', 'duplicateHits')
          .addSelect('COALESCE(SUM(rec.conflict_hits), 0)', 'conflictHits')
          .addSelect('MAX(rec.last_duplicate_at)', 'lastDuplicateAt')
          .where('(rec.duplicate_hits > 0 OR rec.conflict_hits > 0)')
          .andWhere(
            '(rec.createdAt >= :windowStart OR rec.lastDuplicateAt >= :windowStart OR rec.lastConflictAt >= :windowStart)',
            { windowStart },
          )
          .groupBy('rec.client_identifier')
          .addGroupBy('rec.scope')
          .addGroupBy('rec.scope_target')
          .orderBy(
            'COALESCE(SUM(rec.duplicate_hits), 0) + COALESCE(SUM(rec.conflict_hits), 0)',
            'DESC',
          )
          .limit(20)
          .getRawMany<{
            clientIdentifier: string;
            scope: string;
            scopeTarget: string;
            uniqueKeys: string | number;
            duplicateHits: string | number;
            conflictHits: string | number;
            lastDuplicateAt: string | Date | null;
          }>(),
      ]);

    const scopeRows: RawScopeMetricsRow[] = [];
    for (const row of rawScopeRows) {
      const parsedScope = parseIdempotencyScope(row.scope);
      if (!parsedScope) continue;
      scopeRows.push({
        scope: parsedScope,
        uniqueKeys: Number(row.uniqueKeys ?? 0),
        inProgressCount: Number(row.inProgressCount ?? 0),
        completedCount: Number(row.completedCount ?? 0),
        failedCount: Number(row.failedCount ?? 0),
        duplicateHits: Number(row.duplicateHits ?? 0),
        conflictHits: Number(row.conflictHits ?? 0),
      });
    }

    const clientRows: RawClientRepeatRow[] = [];
    for (const row of rawClientRows) {
      const parsedScope = parseIdempotencyScope(row.scope);
      if (!parsedScope) continue;
      const parsedLastDup =
        row.lastDuplicateAt instanceof Date
          ? row.lastDuplicateAt
          : typeof row.lastDuplicateAt === 'string' && row.lastDuplicateAt.trim()
            ? new Date(row.lastDuplicateAt)
            : null;
      clientRows.push({
        clientIdentifier: String(row.clientIdentifier || 'anonymous'),
        scope: parsedScope,
        scopeTarget: String(row.scopeTarget || 'default'),
        uniqueKeys: Number(row.uniqueKeys ?? 0),
        duplicateHits: Number(row.duplicateHits ?? 0),
        conflictHits: Number(row.conflictHits ?? 0),
        lastDuplicateAt:
          parsedLastDup && !Number.isNaN(parsedLastDup.getTime()) ? parsedLastDup : null,
      });
    }

    return {
      activeKeysCount,
      expiredPendingPurgeCount,
      scopeRows,
      clientRows,
    };
  }
}
