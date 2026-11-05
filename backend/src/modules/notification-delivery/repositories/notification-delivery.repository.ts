import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In, LessThanOrEqual, type Repository } from 'typeorm';
import {
  BaseTypeOrmRepository,
  type PaginatedQueryBuilderResult,
  TransactionManager,
  paginateSelectQueryBuilder,
} from '@packages/database/index.js';
import type { RawPaginationInput } from '@packages/kernel/index.js';
import { NOTIFICATION_DELIVERY_STATUS } from '../enum/notification-delivery.enum.js';
import { NotificationDeliveryEntity } from '../entities/notification-delivery.entity.js';
import { NotificationPushSubscriptionEntity } from '../entities/notification-push-subscription.entity.js';
import { NotificationQuotaUsageEntity } from '../entities/notification-quota-usage.entity.js';
import { NotificationSuppressionEntity } from '../entities/notification-suppression.entity.js';

export interface NotificationDeliveryFilterOptions extends RawPaginationInput {
  readonly notificationId?: number | undefined;
  readonly recipientUserId?: number | undefined;
  readonly channel?: number | undefined;
  readonly status?: number | undefined;
  readonly providerCode?: string | undefined;
  readonly batchKey?: string | undefined;
  readonly search?: string | undefined;
}

export interface NotificationSuppressionFilterOptions extends RawPaginationInput {
  readonly channel?: number | undefined;
  readonly reason?: number | undefined;
  readonly isActive?: boolean | undefined;
  readonly search?: string | undefined;
}

@Injectable()
export class NotificationDeliveryRepository extends BaseTypeOrmRepository<NotificationDeliveryEntity> {
  public readonly suppressionRepo: Repository<NotificationSuppressionEntity>;
  public readonly pushSubRepo: Repository<NotificationPushSubscriptionEntity>;
  public readonly quotaUsageRepo: Repository<NotificationQuotaUsageEntity>;

  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(NotificationDeliveryEntity, dataSource, transactionManager);
    this.suppressionRepo = dataSource.getRepository(NotificationSuppressionEntity);
    this.pushSubRepo = dataSource.getRepository(NotificationPushSubscriptionEntity);
    this.quotaUsageRepo = dataSource.getRepository(NotificationQuotaUsageEntity);
  }

  // ==================== DELIVERIES ====================

  public async findDeliveryById(id: number): Promise<NotificationDeliveryEntity | null> {
    return this.executeReadOnly(async (repo) => repo.findOne({ where: { id } }));
  }

  public async findDeliveryByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<NotificationDeliveryEntity | null> {
    const trimmed = idempotencyKey.trim();
    if (!trimmed) return null;
    return this.executeReadOnly(async (repo) =>
      repo.findOne({ where: { idempotencyKey: trimmed } }),
    );
  }

  public async findDeliveriesByNotificationId(
    notificationId: number,
  ): Promise<NotificationDeliveryEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { notificationId },
        order: { id: 'ASC' },
      }),
    );
  }

  public async countDeliveriesByTemplateCode(
    templateCode: string,
    channel?: number,
  ): Promise<number> {
    const cleanCode = templateCode.trim().toUpperCase();
    return this.executeReadOnly(async (repo) =>
      repo.count({
        where: {
          templateCode: cleanCode,
          ...(channel !== undefined ? { channel } : {}),
        },
      }),
    );
  }

  public async findDueRetryDeliveries(
    now: Date,
    limit = 100,
  ): Promise<NotificationDeliveryEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: {
          status: NOTIFICATION_DELIVERY_STATUS.QUEUED,
          nextRetryAt: LessThanOrEqual(now),
        },
        order: { nextRetryAt: 'ASC', id: 'ASC' },
        take: Math.max(1, limit),
      }),
    );
  }

  public async findPaginatedDeliveries(
    options: NotificationDeliveryFilterOptions,
  ): Promise<PaginatedQueryBuilderResult<NotificationDeliveryEntity>> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('d').where('d.deletedAt IS NULL');

      if (options.notificationId !== undefined) {
        qb.andWhere('d.notificationId = :notificationId', {
          notificationId: options.notificationId,
        });
      }
      if (options.recipientUserId !== undefined) {
        qb.andWhere('d.recipientUserId = :recipientUserId', {
          recipientUserId: options.recipientUserId,
        });
      }
      if (options.channel !== undefined) {
        qb.andWhere('d.channel = :channel', { channel: options.channel });
      }
      if (options.status !== undefined) {
        qb.andWhere('d.status = :status', { status: options.status });
      }
      if (options.providerCode && options.providerCode.trim()) {
        qb.andWhere('d.providerCode = :providerCode', {
          providerCode: options.providerCode.trim().toUpperCase(),
        });
      }
      if (options.batchKey && options.batchKey.trim()) {
        qb.andWhere('d.batchKey = :batchKey', { batchKey: options.batchKey.trim() });
      }
      if (options.search && options.search.trim()) {
        const kw = `%${options.search.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(d.destination) LIKE :kw OR LOWER(d.renderedBody) LIKE :kw OR LOWER(d.batchKey) LIKE :kw)',
          { kw },
        );
      }

      qb.orderBy('d.id', 'DESC');
      return this.paginateQueryBuilder(qb, options, {
        settingPrefix: 'notifications.pagination',
      });
    });
  }

  // ==================== SUPPRESSIONS ====================

  public async findActiveSuppressionsForDestinations(
    channel: number,
    destinations: readonly string[],
  ): Promise<Set<string>> {
    const normalized = [
      ...new Set(destinations.map((d) => d.trim().toLowerCase()).filter(Boolean)),
    ];
    if (normalized.length === 0) return new Set();

    const rows = await this.suppressionRepo.find({
      where: {
        channel,
        destination: In(normalized),
        isActive: true,
      },
    });
    const now = new Date();
    const blocked = new Set<string>();
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
        continue;
      }
      blocked.add(row.destination.trim().toLowerCase());
    }
    return blocked;
  }

  public async upsertSuppression(params: {
    channel: number;
    destination: string;
    reason: number;
    providerCode?: string | null | undefined;
    errorCode?: string | null | undefined;
    errorMessage?: string | null | undefined;
    sourceNotificationId?: number | null | undefined;
    expiresAt?: Date | null | undefined;
  }): Promise<NotificationSuppressionEntity> {
    const cleanDest =
      params.channel === 4 ? params.destination.trim() : params.destination.trim().toLowerCase();
    const existing = await this.suppressionRepo.findOne({
      where: { channel: params.channel, destination: cleanDest },
    });
    const now = new Date();
    if (existing) {
      existing.reason = params.reason;
      existing.providerCode = params.providerCode ?? existing.providerCode ?? null;
      existing.errorCode = params.errorCode ?? existing.errorCode ?? null;
      existing.errorMessage = params.errorMessage ?? existing.errorMessage ?? null;
      existing.sourceNotificationId =
        params.sourceNotificationId ?? existing.sourceNotificationId ?? null;
      existing.isActive = true;
      existing.suppressedAt = now;
      existing.expiresAt = params.expiresAt ?? null;
      return this.suppressionRepo.save(existing);
    }

    const created = this.suppressionRepo.create({
      channel: params.channel,
      destination: cleanDest,
      reason: params.reason,
      providerCode: params.providerCode ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
      sourceNotificationId: params.sourceNotificationId ?? null,
      isActive: true,
      suppressedAt: now,
      expiresAt: params.expiresAt ?? null,
    });
    return this.suppressionRepo.save(created);
  }

  public async removeSuppressionById(id: number): Promise<boolean> {
    const existing = await this.suppressionRepo.findOne({ where: { id } });
    if (!existing) return false;
    existing.isActive = false;
    await this.suppressionRepo.save(existing);
    return true;
  }

  public async findPaginatedSuppressions(
    options: NotificationSuppressionFilterOptions,
  ): Promise<PaginatedQueryBuilderResult<NotificationSuppressionEntity>> {
    const qb = this.suppressionRepo.createQueryBuilder('s').where('s.deletedAt IS NULL');

    if (options.channel !== undefined) {
      qb.andWhere('s.channel = :channel', { channel: options.channel });
    }
    if (options.reason !== undefined) {
      qb.andWhere('s.reason = :reason', { reason: options.reason });
    }
    if (options.isActive !== undefined) {
      qb.andWhere('s.isActive = :isActive', { isActive: options.isActive });
    }
    if (options.search && options.search.trim()) {
      const kw = `%${options.search.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(s.destination) LIKE :kw OR LOWER(s.errorMessage) LIKE :kw)', { kw });
    }

    qb.orderBy('s.suppressedAt', 'DESC').addOrderBy('s.id', 'DESC');
    return paginateSelectQueryBuilder(qb, options, {
      settingPrefix: 'notifications.pagination',
    });
  }

  // ==================== PUSH SUBSCRIPTIONS ====================

  public async findActivePushSubscriptionsByUserIds(
    userIds: readonly number[],
  ): Promise<NotificationPushSubscriptionEntity[]> {
    const uniqueIds = [...new Set(userIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1))];
    if (uniqueIds.length === 0) return [];
    return this.pushSubRepo.find({
      where: {
        userId: In(uniqueIds),
        isActive: true,
      },
      order: { id: 'DESC' },
    });
  }

  public async findUserPushSubscriptions(
    userId: number,
  ): Promise<NotificationPushSubscriptionEntity[]> {
    return this.pushSubRepo.find({
      where: { userId },
      order: { isActive: 'DESC', id: 'DESC' },
    });
  }

  public async upsertPushSubscription(params: {
    userId: number;
    platform: number;
    deviceToken: string;
    endpoint?: string | null | undefined;
    p256dhKey?: string | null | undefined;
    authKey?: string | null | undefined;
    deviceName?: string | null | undefined;
  }): Promise<NotificationPushSubscriptionEntity> {
    const cleanToken = params.deviceToken.trim();
    const existing = await this.pushSubRepo.findOne({
      where: { userId: params.userId, deviceToken: cleanToken },
    });
    if (existing) {
      existing.platform = params.platform;
      existing.endpoint = params.endpoint ?? existing.endpoint ?? null;
      existing.p256dhKey = params.p256dhKey ?? existing.p256dhKey ?? null;
      existing.authKey = params.authKey ?? existing.authKey ?? null;
      existing.deviceName = params.deviceName ?? existing.deviceName ?? null;
      existing.isActive = true;
      existing.invalidatedAt = null;
      existing.failureReason = null;
      existing.lastUsedAt = new Date();
      return this.pushSubRepo.save(existing);
    }

    const created = this.pushSubRepo.create({
      userId: params.userId,
      platform: params.platform,
      deviceToken: cleanToken,
      endpoint: params.endpoint ?? null,
      p256dhKey: params.p256dhKey ?? null,
      authKey: params.authKey ?? null,
      deviceName: params.deviceName ?? null,
      isActive: true,
      invalidatedAt: null,
      failureReason: null,
      lastUsedAt: new Date(),
    });
    return this.pushSubRepo.save(created);
  }

  public async deactivatePushToken(deviceToken: string, reason: string): Promise<void> {
    const subs = await this.pushSubRepo.find({
      where: { deviceToken: deviceToken.trim(), isActive: true },
    });
    if (subs.length === 0) return;
    const now = new Date();
    for (const sub of subs) {
      sub.isActive = false;
      sub.invalidatedAt = now;
      sub.failureReason = reason.slice(0, 255);
      await this.pushSubRepo.save(sub);
    }
  }

  public async removeUserPushSubscription(id: number, userId: number): Promise<boolean> {
    const existing = await this.pushSubRepo.findOne({ where: { id, userId } });
    if (!existing) return false;
    await this.pushSubRepo.delete({ id: existing.id });
    return true;
  }

  // ==================== QUOTA & COST LEDGER ====================

  public async getOrCreateQuotaUsage(params: {
    channel: number;
    providerCode: string;
    periodType: 'DAILY' | 'MONTHLY';
    periodKey: string;
    currency: string;
  }): Promise<NotificationQuotaUsageEntity> {
    const existing = await this.quotaUsageRepo.findOne({
      where: {
        channel: params.channel,
        providerCode: params.providerCode,
        periodType: params.periodType,
        periodKey: params.periodKey,
      },
    });
    if (existing) return existing;

    const created = this.quotaUsageRepo.create({
      channel: params.channel,
      providerCode: params.providerCode,
      periodType: params.periodType,
      periodKey: params.periodKey,
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      totalSuppressed: 0,
      totalSegments: 0,
      totalCost: '0.0000',
      currency: params.currency,
    });
    return this.quotaUsageRepo.save(created);
  }

  public async recordQuotaDelta(params: {
    channel: number;
    providerCode: string;
    dailyPeriodKey: string;
    monthlyPeriodKey: string;
    currency: string;
    sentDelta?: number;
    deliveredDelta?: number;
    failedDelta?: number;
    suppressedDelta?: number;
    segmentsDelta?: number;
    costDelta?: number;
  }): Promise<void> {
    const periods: Array<{ type: 'DAILY' | 'MONTHLY'; key: string }> = [
      { type: 'DAILY', key: params.dailyPeriodKey },
      { type: 'MONTHLY', key: params.monthlyPeriodKey },
    ];

    for (const p of periods) {
      const usage = await this.getOrCreateQuotaUsage({
        channel: params.channel,
        providerCode: params.providerCode,
        periodType: p.type,
        periodKey: p.key,
        currency: params.currency,
      });
      usage.totalSent = Number(usage.totalSent) + (params.sentDelta ?? 0);
      usage.totalDelivered = Number(usage.totalDelivered) + (params.deliveredDelta ?? 0);
      usage.totalFailed = Number(usage.totalFailed) + (params.failedDelta ?? 0);
      usage.totalSuppressed = Number(usage.totalSuppressed) + (params.suppressedDelta ?? 0);
      usage.totalSegments = Number(usage.totalSegments) + (params.segmentsDelta ?? 0);
      const currentCost = Number(usage.totalCost ?? 0);
      usage.totalCost = (currentCost + (params.costDelta ?? 0)).toFixed(4);
      usage.currency = params.currency;
      await this.quotaUsageRepo.save(usage);
    }
  }
}

export { NotificationDeliveryRepository as NotificationChannelsRepository };
