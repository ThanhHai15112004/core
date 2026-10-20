import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { toLikePattern } from '@packages/http/index.js';
import { MenuEntity } from '../entities/menu.entity.js';

@Injectable()
export class MenuRepository extends BaseTypeOrmRepository<MenuEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(MenuEntity, dataSource, transactionManager);
  }

  public async findByCode(code: string): Promise<MenuEntity | null> {
    const normalized = code.trim().toUpperCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  public async findFiltered(params?: {
    status?: number | undefined;
    type?: number | undefined;
    parent?: number | null | undefined;
    level?: number | undefined;
    position?: string | undefined;
    q?: string | undefined;
  }): Promise<MenuEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo
        .createQueryBuilder('m')
        .orderBy('m.level', 'ASC')
        .addOrderBy('m.numOrder', 'ASC')
        .addOrderBy('m.id', 'ASC');

      if (params?.status !== undefined) {
        qb.andWhere('m.status = :status', { status: params.status });
      }
      if (params?.type !== undefined) {
        qb.andWhere('m.type = :type', { type: params.type });
      }
      if (params?.parent !== undefined) {
        if (params.parent === null || params.parent === 0) {
          qb.andWhere('m.parent IS NULL');
        } else {
          qb.andWhere('m.parent = :parent', { parent: params.parent });
        }
      }
      if (params?.level !== undefined) {
        qb.andWhere('m.level = :level', { level: params.level });
      }
      if (params?.position?.trim()) {
        qb.andWhere('UPPER(m.position) = :position', {
          position: params.position.trim().toUpperCase(),
        });
      }
      if (params?.q?.trim()) {
        const keyword = toLikePattern(params.q.trim().toLowerCase(), 'contains');
        qb.andWhere(
          "(LOWER(m.code) LIKE :keyword OR LOWER(m.name) LIKE :keyword OR LOWER(COALESCE(m.link, '')) LIKE :keyword OR LOWER(COALESCE(m.linkApi, '')) LIKE :keyword)",
          { keyword },
        );
      }

      return qb.getMany();
    });
  }
}
