import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { NotificationPreferenceEntity } from '../entities/notification-preference.entity.js';

@Injectable()
export class NotificationPreferencesRepository extends BaseTypeOrmRepository<NotificationPreferenceEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(NotificationPreferenceEntity, dataSource, transactionManager);
  }

  public async findByUserId(userId: number): Promise<NotificationPreferenceEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { userId },
        order: { category: 'ASC' },
      }),
    );
  }

  public async findByUserIdsAndCategory(
    userIds: readonly number[],
    category: number,
  ): Promise<NotificationPreferenceEntity[]> {
    const uniqueUserIds = [
      ...new Set(userIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1)),
    ];
    if (uniqueUserIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: {
          userId: In(uniqueUserIds),
          category,
        },
      }),
    );
  }

  public async upsertPreference(input: {
    userId: number;
    category: number;
    inAppEnabled: boolean;
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
    mutedUntil?: Date | null;
  }): Promise<NotificationPreferenceEntity> {
    const existing = await this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          userId: input.userId,
          category: input.category,
        },
      }),
    );

    if (existing) {
      existing.inAppEnabled = input.inAppEnabled;
      existing.emailEnabled = input.emailEnabled;
      existing.smsEnabled = input.smsEnabled;
      existing.pushEnabled = input.pushEnabled;
      existing.mutedUntil = input.mutedUntil ?? null;
      return this.saveEntity(existing);
    }

    const created = this.repository.create({
      userId: input.userId,
      category: input.category,
      inAppEnabled: input.inAppEnabled,
      emailEnabled: input.emailEnabled,
      smsEnabled: input.smsEnabled,
      pushEnabled: input.pushEnabled,
      mutedUntil: input.mutedUntil ?? null,
    });
    return this.saveEntity(created);
  }
}
