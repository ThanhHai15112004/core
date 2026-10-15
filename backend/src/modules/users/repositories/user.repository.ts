import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { UserStatusCode } from '../contracts/index.js';
import { UserEntity } from '../entities/user.entity.js';

export interface SearchUsersFilter {
  readonly q?: string | undefined;
  readonly status?: UserStatusCode | undefined;
  readonly roleId?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly includeArchived?: boolean | undefined;
  readonly mfaEnabled?: boolean | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly sortBy?:
    | 'id'
    | 'createdAt'
    | 'firstName'
    | 'lastName'
    | 'fullName'
    | 'email'
    | 'username'
    | 'status'
    | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
}

@Injectable()
export class UserRepository extends BaseTypeOrmRepository<UserEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(UserEntity, dataSource, transactionManager);
  }

  /** Tìm người dùng theo email (không phân biệt hoa thường) */
  public async findByEmail(email: string, withDeleted = false): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: { email: email.trim().toLowerCase() },
      withDeleted,
    });
  }

  /** Tìm người dùng theo username (không phân biệt hoa thường) */
  public async findByUsername(username: string, withDeleted = false): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: { username: username.trim().toLowerCase() },
      withDeleted,
    });
  }

  /** Tìm người dùng theo identifier (email hoặc username) phục vụ đăng nhập */
  public async findByIdentifier(identifier: string): Promise<UserEntity | null> {
    const normalized = identifier.trim().toLowerCase();
    return this.repository
      .createQueryBuilder('u')
      .withDeleted()
      .where('LOWER(u.email) = :id OR LOWER(u.username) = :id', { id: normalized })
      .getOne();
  }

  /** Tìm người dùng theo ID số nguyên (hỗ trợ lấy cả bản ghi đã lưu trữ/soft-delete) */
  public async findByIdWithArchived(id: number, withDeleted = false): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: { id: Number(id) },
      withDeleted,
    });
  }

  /** Tìm kiếm và lọc người dùng có phân trang (hỗ trợ lọc theo vai trò, đơn vị/chi nhánh, trạng thái) */
  public async searchPaginated(
    filter: SearchUsersFilter = {},
  ): Promise<{ items: UserEntity[]; total: number }> {
    const page = Math.max(1, Math.trunc(filter.page ?? 1));
    const limit = Math.max(1, Math.min(500, Math.trunc(filter.limit ?? 20)));
    const skip = (page - 1) * limit;

    const qb = this.repository.createQueryBuilder('u');
    if (filter.includeArchived || filter.status === 4) {
      qb.withDeleted();
    }

    if (filter.q && filter.q.trim().length > 0) {
      const kw = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere(
        "(LOWER(u.username) LIKE :kw OR LOWER(u.email) LIKE :kw OR LOWER(u.first_name) LIKE :kw OR LOWER(u.last_name) LIKE :kw OR LOWER(u.full_name) LIKE :kw OR LOWER(COALESCE(u.phone, '')) LIKE :kw)",
        { kw },
      );
    }

    if (filter.status !== undefined) {
      qb.andWhere('u.status = :status', { status: filter.status });
    }

    if (filter.mfaEnabled !== undefined) {
      qb.andWhere('u.mfa_enabled = :mfaEnabled', { mfaEnabled: filter.mfaEnabled });
    }

    if (filter.roleId !== undefined) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = :roleId AND ur.deleted_at IS NULL)',
        { roleId: filter.roleId },
      );
    }

    if (filter.organizationUnitId !== undefined) {
      qb.andWhere(
        '(u.primary_organization_unit_id = :orgId OR EXISTS (SELECT 1 FROM user_organization_units uou WHERE uou.user_id = u.id AND uou.organization_unit_id = :orgId AND uou.deleted_at IS NULL))',
        { orgId: filter.organizationUnitId },
      );
    }

    const sortColumnMap: Record<NonNullable<SearchUsersFilter['sortBy']>, string> = {
      id: 'u.id',
      createdAt: 'u.createdAt',
      firstName: 'u.firstName',
      lastName: 'u.lastName',
      fullName: 'u.fullName',
      email: 'u.email',
      username: 'u.username',
      status: 'u.status',
    };
    const sortCol = sortColumnMap[filter.sortBy ?? 'id'] ?? 'u.id';
    const sortDir = filter.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    qb.orderBy(sortCol, sortDir).skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
