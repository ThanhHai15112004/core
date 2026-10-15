import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { UserOrganizationUnitEntity } from '../entities/user-organization-unit.entity.js';

export interface UserOrganizationInput {
  readonly organizationUnitId: number;
  readonly isPrimary?: boolean | undefined;
  readonly positionTitle?: string | null | undefined;
}

export type UserOrganizationInputItem = UserOrganizationInput;

@Injectable()
export class UserOrganizationUnitRepository extends BaseTypeOrmRepository<UserOrganizationUnitEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserOrganizationUnitEntity, dataSource, transactionManager);
  }

  /** Tìm danh sách đơn vị đã gán cho mảng userIds */
  public async findByUserIds(userIds: readonly number[]): Promise<UserOrganizationUnitEntity[]> {
    if (userIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { userId: In([...userIds]) },
        order: { isPrimary: 'DESC', id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách userIds thuộc một hoặc nhiều organizationUnitIds */
  public async findUserIdsByOrganizationUnitIds(unitIds: readonly number[]): Promise<number[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.executeReadOnly(async (repo) =>
      repo.find({
        where: { organizationUnitId: In([...unitIds]) },
        select: { userId: true },
      }),
    );
    return [...new Set(rows.map((r) => Number(r.userId)))];
  }

  /** Thay thế toàn bộ danh sách đơn vị/chi nhánh của một người dùng */
  public async replaceUserOrganizations(
    userId: number,
    inputs: readonly UserOrganizationInput[],
  ): Promise<UserOrganizationUnitEntity[]> {
    await this.repository.delete({ userId });

    if (inputs.length === 0) {
      return [];
    }

    const deduped = new Map<number, UserOrganizationInput>();
    for (const item of inputs) {
      deduped.set(Number(item.organizationUnitId), item);
    }

    const items = [...deduped.values()];
    const hasPrimary = items.some((i) => i.isPrimary === true);

    const entities = items.map((item, idx) =>
      this.repository.create({
        userId,
        organizationUnitId: Number(item.organizationUnitId),
        isPrimary: hasPrimary ? Boolean(item.isPrimary) : idx === 0,
        positionTitle: item.positionTitle ?? null,
      }),
    );

    return this.repository.save(entities);
  }
}
