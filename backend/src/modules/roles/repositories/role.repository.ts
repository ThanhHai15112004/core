import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RoleEntity } from '../entities/role.entity.js';
import type { ListRolesQuery } from '../requests/roles.requests.js';

const ROLE_SORT_COLUMN_MAP: Readonly<Record<string, string>> = {
  id: 'r.id',
  code: 'r.code',
  name: 'r.name',
  createdAt: 'r.createdAt',
};

@Injectable()
export class RoleRepository extends BaseTypeOrmRepository<RoleEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(RoleEntity, dataSource, transactionManager);
  }

  /** Tìm vai trò theo mã code */
  public async findByCode(code: string): Promise<RoleEntity | null> {
    const normalized = code.trim().toLowerCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  /** Tìm danh sách vai trò theo mảng ID số nguyên */
  public async findByIds(ids: readonly number[]): Promise<RoleEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách vai trò theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<RoleEntity[]> {
    if (codes.length === 0) return [];
    const normalized = codes.map((c) => c.trim().toLowerCase());
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { code: In(normalized) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách vai trò theo điều kiện lọc (Query Core 8.1) */
  public async findFiltered(query: ListRolesQuery): Promise<RoleEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('r');

      if (query.status !== undefined) {
        qb.andWhere('r.status = :status', { status: query.status });
      }
      if (query.dataScope !== undefined) {
        qb.andWhere('r.dataScope = :dataScope', { dataScope: query.dataScope });
      }
      this.applyKeywordSearch(qb, query.search ?? query.q, ['r.code', 'r.name'], {
        paramPrefix: 'roleKw',
      });
      this.applySort(qb, query, ROLE_SORT_COLUMN_MAP, {
        defaultSortBy: 'id',
        defaultSortOrder: 'ASC',
        tieBreakerField: 'id',
      });

      return qb.getMany();
    });
  }
}
