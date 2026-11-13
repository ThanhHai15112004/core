import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { ReplaceUserOrganizationInput } from '../contracts/index.js';
import { UserOrganizationUnitEntity } from '../entities/user-organization-unit.entity.js';

export type { ReplaceUserOrganizationInput };
export type UserOrganizationInputItem = ReplaceUserOrganizationInput;

function parseOptionalDate(val?: Date | string | null): Date | null {
  if (!val) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
        where: { organizationUnitId: In([...organizationUnitIds]) },
        select: { userId: true, startDate: true, endDate: true },
      }),
    );
    const now = Date.now();
    const activeRows = rows.filter((r) => {
      if (r.startDate && new Date(r.startDate).getTime() > now) return false;
      if (r.endDate && new Date(r.endDate).getTime() < now) return false;
      return true;
    });
    return [...new Set(activeRows.map((r) => Number(r.userId)))];
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
    await this.repository.delete({ userId });

    if (inputs.length === 0) {
      return [];
    }

    const deduped = new Map<number, ReplaceUserOrganizationInput>();
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
        positionTitle: item.positionTitle?.trim() || null,
        startDate: parseOptionalDate(item.startDate),
        endDate: parseOptionalDate(item.endDate),
      }),
    );
    return this.repository.save(entities);
  }
}
