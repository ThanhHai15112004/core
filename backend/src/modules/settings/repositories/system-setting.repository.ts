import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SystemSettingEntity } from '../entities/system-setting.entity.js';

@Injectable()
export class SystemSettingRepository extends BaseTypeOrmRepository<SystemSettingEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SystemSettingEntity, dataSource, transactionManager);
  }

  public async findByKey(settingKey: string): Promise<SystemSettingEntity | null> {
    const normalized = settingKey.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { settingKey: normalized },
      }),
    );
  }

  public async findFiltered(params?: {
    groupId?: number | undefined;
    module?: string | undefined;
    namespace?: string | undefined;
    valueType?: number | undefined;
    isSensitive?: boolean | undefined;
    status?: number | undefined;
    q?: string | undefined;
  }): Promise<SystemSettingEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('ss')
        .orderBy('ss.groupId', 'ASC')
        .addOrderBy('ss.sortOrder', 'ASC')
        .addOrderBy('ss.settingKey', 'ASC');

      if (params?.groupId !== undefined) {
        qb.andWhere('ss.groupId = :groupId', {
          groupId: Number(params.groupId),
        });
      }
      if (params?.module?.trim()) {
        qb.andWhere('LOWER(ss.module) = :module', {
          module: params.module.trim().toLowerCase(),
        });
      }
      if (params?.namespace?.trim()) {
        qb.andWhere('LOWER(ss.namespace) = :namespace', {
          namespace: params.namespace.trim().toLowerCase(),
        });
      }
      if (params?.valueType !== undefined) {
        qb.andWhere('ss.valueType = :valueType', { valueType: params.valueType });
      }
      if (params?.isSensitive !== undefined) {
        qb.andWhere('ss.isSensitive = :isSensitive', { isSensitive: params.isSensitive });
      }
      if (params?.status !== undefined) {
        qb.andWhere('ss.status = :status', { status: params.status });
      }
      if (params?.q?.trim()) {
        const keyword = `%${params.q.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(ss.settingKey) LIKE :keyword OR LOWER(ss.name) LIKE :keyword OR LOWER(ss.namespace) LIKE :keyword)',
          { keyword },
        );
      }

      return qb.getMany();
    });
  }
}
