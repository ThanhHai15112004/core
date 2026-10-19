import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RoleEntity } from '../entities/role.entity.js';
import type { ListRolesQuery } from '../requests/roles.requests.js';

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

  /** Tìm danh sách vai trò theo điều kiện lọc */
  public async findFiltered(query: ListRolesQuery): Promise<RoleEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('r').orderBy('r.id', 'ASC');

      if (query.status !== undefined) {
        qb.andWhere('r.status = :status', { status: query.status });
      }
      if (query.dataScope !== undefined) {
        qb.andWhere('r.dataScope = :dataScope', { dataScope: query.dataScope });
      }
      if (query.search) {
        const keyword = `%${query.search.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(r.code) LIKE :keyword OR LOWER(r.name) LIKE :keyword)', { keyword });
      }

      return qb.getMany();
    });
  }
}
