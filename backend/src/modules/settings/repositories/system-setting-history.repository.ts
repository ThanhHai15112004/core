import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { resolvePagination } from '@packages/kernel/index.js';
import { SystemSettingHistoryEntity } from '../entities/system-setting-history.entity.js';

@Injectable()
export class SystemSettingHistoryRepository extends BaseTypeOrmRepository<SystemSettingHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SystemSettingHistoryEntity, dataSource, transactionManager);
  }

  public async searchFiltered(params?: {
    settingId?: number | undefined;
    environment?: number | undefined;
    organizationUnitId?: number | undefined;
    actorUserId?: number | undefined;
    limit?: number | undefined;
  }): Promise<SystemSettingHistoryEntity[]> {
    const { limit } = resolvePagination(params, { defaultLimit: 50, maxLimit: 200 });
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('sh').orderBy('sh.id', 'DESC').take(limit);

      if (params?.settingId !== undefined) {
        qb.andWhere('sh.settingId = :settingId', {
          settingId: Number(params.settingId),
        });
      }
      if (params?.environment !== undefined) {
        qb.andWhere('sh.environment = :environment', {
          environment: Number(params.environment),
        });
      }
      if (params?.organizationUnitId !== undefined) {
        qb.andWhere('sh.organizationUnitId = :organizationUnitId', {
          organizationUnitId: params.organizationUnitId,
        });
      }
      if (params?.actorUserId !== undefined) {
        qb.andWhere('sh.actorUserId = :actorUserId', {
          actorUserId: params.actorUserId,
        });
      }

      return qb.getMany();
    });
  }
}
