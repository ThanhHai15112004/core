import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { SettingGroupEntity } from '../entities/setting-group.entity.js';

@Injectable()
export class SettingGroupRepository extends BaseTypeOrmRepository<SettingGroupEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(SettingGroupEntity, dataSource, transactionManager);
  }

  public async findByCode(code: string): Promise<SettingGroupEntity | null> {
    const normalized = code.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  public async findFiltered(params?: {
    module?: string | undefined;
    status?: number | undefined;
    q?: string | undefined;
  }): Promise<SettingGroupEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('sg')
        .orderBy('sg.sortOrder', 'ASC')
        .addOrderBy('sg.code', 'ASC');

      if (params?.module?.trim()) {
        qb.andWhere('LOWER(sg.module) = :module', {
          module: params.module.trim().toLowerCase(),
        });
      }
      if (params?.status !== undefined) {
        qb.andWhere('sg.status = :status', { status: params.status });
      }
      if (params?.q?.trim()) {
        const keyword = `%${params.q.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(sg.code) LIKE :keyword OR LOWER(sg.name) LIKE :keyword)', {
          keyword,
        });
      }

      return qb.getMany();
    });
  }
}
