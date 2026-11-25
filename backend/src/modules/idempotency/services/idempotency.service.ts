import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  IDEMPOTENCY_DEFAULTS,
  IdempotencyRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  defaultIdempotencyRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  type IdempotencyMetricsSnapshot,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  IIdempotencyPublicService,
  ListIdempotencyRecordsInput,
} from '../contracts/index.js';
import { IDEMPOTENCY_AUDIT_META } from '../enum/idempotency.enum.js';
import { resolveIdempotencyRuntimeConfig } from '../helpers/idempotency-config.helper.js';
import { IdempotencyRecordRepository } from '../repositories/idempotency-record.repository.js';
import { IdempotencyResponseMapper } from '../responses/idempotency.response.js';
import type {
  IdempotencyPurgeOptions,
  IdempotencyPurgeResult,
  IdempotencyRecordDetailView,
  IdempotencyRecordView,
  IdempotencyRevokeResult,
} from '../types/idempotency.types.js';
import { IdempotencyStoreService } from './idempotency-store.service.js';

const MAX_CLEANUP_ITERATIONS = 50;

/**
 * Service quản trị trung tâm cho Chống xử lý trùng (Idempotency — Phase 11.3):
 * - Đăng ký `IdempotencyStoreService` vào `IdempotencyRegistryService` (`@packages/kernel`) lúc bootstrap.
 * - Cung cấp API tra cứu/lọc khóa, xem chi tiết, thống kê tỷ lệ trùng & phát hiện client gửi lặp,
 *   thu hồi khóa thủ công (có Audit Log) và dọn khóa hết hạn theo batch.
 */
@Injectable()
export class IdempotencyService
  implements IIdempotencyPublicService, OnModuleInit, OnModuleDestroy
{
  private readonly idempotencyRegistry: IdempotencyRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private unregisterStore: (() => void) | null = null;

  constructor(
    private readonly recordRepo: IdempotencyRecordRepository,
    private readonly storeService: IdempotencyStoreService,
    @Optional()
    @Inject(IdempotencyRegistryService)
    idempotencyRegistry?: IdempotencyRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService | null,
  ) {
    this.idempotencyRegistry = idempotencyRegistry ?? defaultIdempotencyRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public onModuleInit(): void {
    this.unregisterStore = this.idempotencyRegistry.registerStore(this.storeService);
  }

  public onModuleDestroy(): void {
    this.unregisterStore?.();
    this.unregisterStore = null;
  }

  public async listRecords(
    query: ListIdempotencyRecordsInput,
  ): Promise<PaginatedResult<IdempotencyRecordView>> {
    const paged = await this.recordRepo.listPaginated(query);
    const now = new Date();
    return createPaginatedResult(
      paged.data.map((row) => IdempotencyResponseMapper.toRecordView(row, now)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getRecordById(id: number): Promise<IdempotencyRecordDetailView> {
    const entity = await this.recordRepo.findByIdSafe(Number(id));
    if (!entity) {
      throw new NotFoundAppException('idempotency.recordNotFound', { id });
    }
    return IdempotencyResponseMapper.toRecordDetailView(entity, new Date());
  }

  public async getMetrics(
    windowHours: number = IDEMPOTENCY_DEFAULTS.DEFAULT_METRICS_WINDOW_HOURS,
  ): Promise<IdempotencyMetricsSnapshot> {
    return this.storeService.getMetricsSnapshot(windowHours);
  }

  public async revokeRecord(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<IdempotencyRevokeResult> {
    const entity = await this.recordRepo.findByIdSafe(Number(id));
    if (!entity) {
      throw new NotFoundAppException('idempotency.recordNotFound', { id });
    }

    const beforeView = IdempotencyResponseMapper.toRecordView(entity);
    const deleted = await this.recordRepo.hardDeleteById(Number(entity.id));

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId: parseNumericUserId(actor?.id),
      module: IDEMPOTENCY_AUDIT_META.MODULE,
      feature: IDEMPOTENCY_AUDIT_META.FEATURE_RECORDS,
      action: IDEMPOTENCY_AUDIT_META.ACTION_REVOKE,
      resourceType: IDEMPOTENCY_AUDIT_META.RESOURCE_TYPE,
      resourceId: String(entity.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: { revoked: deleted },
      reason: reason?.trim() || 'Manual revocation of idempotency key',
    });

    return {
      id: Number(entity.id),
      scope: entity.scope,
      scopeTarget: entity.scopeTarget,
      idempotencyKey: entity.idempotencyKey,
      revoked: deleted,
    };
  }

  public async purgeExpiredRecords(
    options?: IdempotencyPurgeOptions,
    actor?: UserIdentity,
  ): Promise<IdempotencyPurgeResult> {
    const now = options?.now ?? new Date();
    const config = resolveIdempotencyRuntimeConfig(this.settingRegistry);
    const batchSize = options?.batchSize
      ? Math.max(50, Math.min(10_000, Math.round(options.batchSize)))
      : config.cleanupBatchSize;

    let purgedCount = 0;
    let batchesExecuted = 0;

    for (let i = 0; i < MAX_CLEANUP_ITERATIONS; i++) {
      const deleted = await this.recordRepo.purgeExpiredBatch(now, batchSize);
      if (deleted <= 0) break;
      purgedCount += deleted;
      batchesExecuted += 1;
      if (deleted < batchSize) break;
    }

    const result: IdempotencyPurgeResult = {
      purgedCount,
      batchesExecuted,
      cutoffAt: now.toISOString(),
      executedAt: new Date().toISOString(),
    };

    if (actor || purgedCount > 0) {
      await this.auditLogService?.record({
        actor: actor ?? null,
        actorUserId: parseNumericUserId(actor?.id),
        module: IDEMPOTENCY_AUDIT_META.MODULE,
        feature: IDEMPOTENCY_AUDIT_META.FEATURE_CLEANUP,
        action: IDEMPOTENCY_AUDIT_META.ACTION_PURGE,
        resourceType: IDEMPOTENCY_AUDIT_META.RESOURCE_TYPE,
        resourceId: 'batch',
        beforeData: null,
        afterData: result as unknown as Record<string, unknown>,
        reason: options?.reason?.trim() || 'Purge expired idempotency records',
      });
    }

    return result;
  }
}
