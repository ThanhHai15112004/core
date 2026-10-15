import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { UserOrganizationUnitEntity } from '../entities/user-organization-unit.entity.js';

export interface UserOrganizationInputItem {
  readonly organizationUnitId: string;
  readonly isPrimary?: boolean | undefined;
  readonly positionTitle?: string | null | undefined;
}

@Injectable()
export class UserOrganizationUnitRepository extends BaseTypeOrmRepository<UserOrganizationUnitEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserOrganizationUnitEntity, dataSource, transactionManager);
  }

  /** Lấy danh sách liên kết đơn vị/chi nhánh theo mảng userIds */
  public async findByUserIds(userIds: readonly string[]): Promise<UserOrganizationUnitEntity[]> {
    if (userIds.length === 0) return [];
    const uniqueIds = [...new Set(userIds)];
    return this.repository.find({
      where: { userId: In(uniqueIds) },
    });
  }

  /** Thay thế danh sách đơn vị/chi nhánh của một người dùng */
  public async replaceUserOrganizations(
    userId: string,
    items: readonly UserOrganizationInputItem[],
  ): Promise<UserOrganizationUnitEntity[]> {
    await this.repository.delete({ userId });
    if (items.length === 0) {
      return [];
    }

    const dedupMap = new Map<string, UserOrganizationInputItem>();
    for (const item of items) {
      dedupMap.set(item.organizationUnitId, item);
    }

    const deduped = [...dedupMap.values()];
    const hasExplicitPrimary = deduped.some((i) => Boolean(i.isPrimary));

    let primaryAssigned = false;
    const entities = deduped.map((item, idx) => {
      let isPrimary = false;
      if (hasExplicitPrimary) {
        if (item.isPrimary && !primaryAssigned) {
          isPrimary = true;
          primaryAssigned = true;
        }
      } else if (idx === 0) {
        isPrimary = true;
        primaryAssigned = true;
      }

      return this.repository.create({
        userId,
        organizationUnitId: item.organizationUnitId,
        isPrimary,
        positionTitle: item.positionTitle ?? null,
      });
    });

    return this.repository.save(entities);
  }
}
