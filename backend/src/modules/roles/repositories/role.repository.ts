import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { RoleEntity } from '../entities/role.entity.js';
import type { RoleStatus } from '../contracts/index.js';

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
    return this.repository.findOne({
      where: { code: code.trim().toLowerCase() },
    });
  }

  /** Tìm danh sách vai trò theo mảng ID */
  public async findByIds(roleIds: readonly string[]): Promise<RoleEntity[]> {
    if (roleIds.length === 0) return [];
    const uniqueIds = [...new Set(roleIds)];
    return this.repository.find({
      where: { id: In(uniqueIds) },
    });
  }

  /** Tìm danh sách vai trò theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<RoleEntity[]> {
    if (codes.length === 0) return [];
    const normalized = [...new Set(codes.map((c) => c.trim().toLowerCase()))];
    return this.repository.find({
      where: { code: In(normalized) },
    });
  }

  /** Lấy danh sách vai trò có lọc theo từ khóa hoặc trạng thái */
  public async findFiltered(
    filter: { q?: string | undefined; status?: RoleStatus | undefined } = {},
  ): Promise<RoleEntity[]> {
    const qb = this.repository.createQueryBuilder('r');

    if (filter.q && filter.q.trim().length > 0) {
      const kw = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(r.code) LIKE :kw OR LOWER(r.name) LIKE :kw)', { kw });
    }

    if (filter.status) {
      qb.andWhere('r.status = :status', { status: filter.status });
    }

    qb.orderBy('r.code', 'ASC');
    return qb.getMany();
  }
}
