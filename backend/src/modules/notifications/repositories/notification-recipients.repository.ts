import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  BaseTypeOrmRepository,
  type PaginatedQueryBuilderResult,
  TransactionManager,
} from '@packages/database/index.js';
import type { RawPaginationInput } from '@packages/kernel/index.js';
import { NotificationRecipientEntity } from '../entities/notification-recipient.entity.js';
import { NotificationEntity } from '../entities/notification.entity.js';
import { NOTIFICATION_CHANNEL, NOTIFICATION_INBOX_STATUS } from '../enum/notifications.enum.js';

export interface NotificationInboxFilterOptions extends RawPaginationInput {
  readonly recipientUserId: number;
  readonly inboxStatus?: number | undefined;
  readonly isRead?: boolean | undefined;
  readonly category?: number | undefined;
  readonly priority?: number | undefined;
  readonly search?: string | undefined;
}

export interface NotificationDispatchAggregateStats {
  readonly notificationId: number;
  readonly readCount: number;
  readonly archivedCount: number;
  readonly deletedFromInboxCount: number;
}

@Injectable()
export class NotificationRecipientsRepository extends BaseTypeOrmRepository<NotificationRecipientEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(NotificationRecipientEntity, dataSource, transactionManager);
  }

  public async findInboxEntryForUser(
    entryId: number,
    recipientUserId: number,
  ): Promise<NotificationRecipientEntity | null> {
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: {
          id: entryId,
          recipientUserId,
        },
      }),
    );
  }

  public async findByNotificationId(
    notificationId: number,
  ): Promise<NotificationRecipientEntity[]> {
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { notificationId },
        order: { id: 'ASC' },
      }),
    );
  }

  public async findPaginatedUserInbox(
    options: NotificationInboxFilterOptions,
  ): Promise<PaginatedQueryBuilderResult<NotificationRecipientEntity>> {
    return this.executeReadOnly(async (repo) => {
      const targetInboxStatus = options.inboxStatus ?? NOTIFICATION_INBOX_STATUS.ACTIVE;
      const qb = repo
        .createQueryBuilder('r')
        .innerJoin(NotificationEntity, 'n', 'n.id = r.notificationId AND n.deletedAt IS NULL')
        .where('r.deletedAt IS NULL')
        .andWhere('r.recipientUserId = :recipientUserId', {
          recipientUserId: options.recipientUserId,
        })
        .andWhere('r.channel = :inAppChannel', {
          inAppChannel: NOTIFICATION_CHANNEL.IN_APP,
        })
        .andWhere('r.inboxStatus = :inboxStatus', {
          inboxStatus: targetInboxStatus,
        });

      if (options.isRead !== undefined) {
        qb.andWhere('r.isRead = :isRead', { isRead: options.isRead });
      }
      if (options.category !== undefined) {
        qb.andWhere('n.category = :category', { category: options.category });
      }
      if (options.priority !== undefined) {
        qb.andWhere('n.priority = :priority', { priority: options.priority });
      }
      if (options.search && options.search.trim().length > 0) {
        const kw = `%${options.search.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(n.title) LIKE :kw OR LOWER(n.content) LIKE :kw OR LOWER(n.code) LIKE :kw)',
          { kw },
        );
      }

      qb.orderBy('r.deliveredAt', 'DESC').addOrderBy('r.id', 'DESC');

      return this.paginateQueryBuilder(qb, options, {
        settingPrefix: 'notifications.pagination',
      });
    });
  }

  public async getUnreadSummaryForUser(recipientUserId: number): Promise<{
    unreadCount: number;
    totalActiveCount: number;
    totalArchivedCount: number;
    byCategory: Map<number, number>;
  }> {
    return this.executeReadOnly(async (repo) => {
      const activeRows = await repo
        .createQueryBuilder('r')
        .innerJoin(NotificationEntity, 'n', 'n.id = r.notificationId AND n.deletedAt IS NULL')
        .select('r.inboxStatus', 'inboxStatus')
        .addSelect('r.isRead', 'isRead')
        .addSelect('n.category', 'category')
        .where('r.deletedAt IS NULL')
        .andWhere('r.recipientUserId = :recipientUserId', { recipientUserId })
        .andWhere('r.channel = :channel', { channel: NOTIFICATION_CHANNEL.IN_APP })
        .andWhere('r.inboxStatus IN (:...statuses)', {
          statuses: [NOTIFICATION_INBOX_STATUS.ACTIVE, NOTIFICATION_INBOX_STATUS.ARCHIVED],
        })
        .getRawMany<{
          inboxStatus: number | string;
          isRead: boolean | number | string;
          category: number | string;
        }>();

      let unreadCount = 0;
      let totalActiveCount = 0;
      let totalArchivedCount = 0;
      const byCategory = new Map<number, number>();

      for (const row of activeRows) {
        const status = Number(row.inboxStatus);
        const isRead =
          row.isRead === true || row.isRead === 1 || row.isRead === '1' || row.isRead === 'true';
        const category = Number(row.category);

        if (status === NOTIFICATION_INBOX_STATUS.ACTIVE) {
          totalActiveCount++;
          if (!isRead) {
            unreadCount++;
            byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
          }
        } else if (status === NOTIFICATION_INBOX_STATUS.ARCHIVED) {
          totalArchivedCount++;
        }
      }

      return {
        unreadCount,
        totalActiveCount,
        totalArchivedCount,
        byCategory,
      };
    });
  }

  public async markAllAsReadForUser(recipientUserId: number, category?: number): Promise<number> {
    const entries = await this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('r')
        .innerJoin(NotificationEntity, 'n', 'n.id = r.notificationId AND n.deletedAt IS NULL')
        .where('r.deletedAt IS NULL')
        .andWhere('r.recipientUserId = :recipientUserId', { recipientUserId })
        .andWhere('r.channel = :channel', { channel: NOTIFICATION_CHANNEL.IN_APP })
        .andWhere('r.inboxStatus = :activeStatus', {
          activeStatus: NOTIFICATION_INBOX_STATUS.ACTIVE,
        })
        .andWhere('r.isRead = :isRead', { isRead: false });

      if (category !== undefined) {
        qb.andWhere('n.category = :category', { category });
      }

      return qb.getMany();
    });

    if (entries.length === 0) return 0;

    const now = new Date();
    for (const entry of entries) {
      entry.isRead = true;
      entry.readAt = now;
    }
    await this.repository.save(entries);
    return entries.length;
  }

  public async aggregateStatsByNotificationIds(
    notificationIds: readonly number[],
  ): Promise<Map<number, NotificationDispatchAggregateStats>> {
    const uniqueIds = [
      ...new Set(notificationIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1)),
    ];
    const map = new Map<number, NotificationDispatchAggregateStats>();
    if (uniqueIds.length === 0) return map;

    const rows = await this.executeReadOnly(async (repo) =>
      repo.find({
        where: { notificationId: In(uniqueIds) },
        select: {
          notificationId: true,
          isRead: true,
          inboxStatus: true,
        },
      }),
    );

    for (const id of uniqueIds) {
      map.set(id, {
        notificationId: id,
        readCount: 0,
        archivedCount: 0,
        deletedFromInboxCount: 0,
      });
    }

    for (const r of rows) {
      const nid = Number(r.notificationId);
      const current = map.get(nid) ?? {
        notificationId: nid,
        readCount: 0,
        archivedCount: 0,
        deletedFromInboxCount: 0,
      };
      map.set(nid, {
        notificationId: nid,
        readCount: current.readCount + (r.isRead ? 1 : 0),
        archivedCount:
          current.archivedCount +
          (Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.ARCHIVED ? 1 : 0),
        deletedFromInboxCount:
          current.deletedFromInboxCount +
          (Number(r.inboxStatus) === NOTIFICATION_INBOX_STATUS.DELETED ? 1 : 0),
      });
    }

    return map;
  }
}
