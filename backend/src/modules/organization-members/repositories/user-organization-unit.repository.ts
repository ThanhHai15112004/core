import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { ReplaceUserOrganizationInput } from '../contracts/index.js';
import { UserOrganizationUnitEntity } from '../entities/user-organization-unit.entity.js';

export type { ReplaceUserOrganizationInput };
export type UserOrganizationInputItem = ReplaceUserOrganizationInput;

@Injectable()
export class UserOrganizationUnitRepository extends BaseTypeOrmRepository<UserOrganizationUnitEntity> {
  constructor(dataSource: DataSource, @Optional() transactionManager?: TransactionManager) {
    super(UserOrganizationUnitEntity, dataSource, transactionManager);
  }

  public async findByUserIds(userIds: readonly number[]): Promise<UserOrganizationUnitEntity[]> {
    if (userIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { userId: In([...userIds]) },
        order: { isPrimary: 'DESC', id: 'ASC' },
      }),
    );
  }

  public async findUserIdsByOrganizationUnitIds(
    organizationUnitIds: readonly number[],
  ): Promise<number[]> {
    if (organizationUnitIds.length === 0) return [];
    const rows = await this.executeReadOnly((repo) =>
      repo.find({
        select: ['userId'],
        where: { organizationUnitId: In([...organizationUnitIds]) },
      }),
    );
    return [...new Set(rows.map((r) => Number(r.userId)))];
  }

  public async countByPositionTitles(candidates: readonly string[]): Promise<number> {
    const normalized = [
      ...new Set(candidates.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0)),
    ];
    if (normalized.length === 0) return 0;

    return this.executeReadOnly(async (repo) =>
      repo
        .createQueryBuilder('uou')
        .where('LOWER(TRIM(uou.positionTitle)) IN (:...titles)', { titles: normalized })
        .getCount(),
    );
  }

  public async replaceUserOrganizations(
    userId: number,
    inputs: readonly ReplaceUserOrganizationInput[],
  ): Promise<UserOrganizationUnitEntity[]> {
    const repo = this.getRepository();
    await repo.delete({ userId });

    if (inputs.length === 0) {
      return [];
    }

    const entities = inputs.map((item) =>
      repo.create({
        userId,
        organizationUnitId: item.organizationUnitId,
        isPrimary: item.isPrimary,
        positionTitle: item.positionTitle,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
      }),
    );
    return repo.save(entities);
  }
}
