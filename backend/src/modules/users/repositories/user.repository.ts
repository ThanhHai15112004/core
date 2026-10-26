import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type Repository } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import {
  type CountMode,
  type FilterCondition,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type { ResolvedDataScopeFilter } from '@packages/security/index.js';
import type { UserStatusCode } from '../contracts/index.js';
import { UserEntity } from '../entities/user.entity.js';

export type UserSortField =
  'id' | 'createdAt' | 'firstName' | 'lastName' | 'fullName' | 'email' | 'username' | 'status';

export const USER_SEARCHABLE_COLUMNS = [
  'u.username',
  'u.email',
  'up.first_name',
  'up.last_name',
  'up.full_name',
  'u.phone',
] as const;

export const USER_SORT_COLUMN_MAP: Readonly<Record<UserSortField, string>> = {
  id: 'u.id',
  createdAt: 'u.createdAt',
  firstName: 'up.first_name',
  lastName: 'up.last_name',
  fullName: 'up.full_name',
  email: 'u.email',
  username: 'u.username',
  status: 'u.status',
};

export const USER_ALLOWED_FILTER_COLUMN_MAP: Readonly<Record<string, string>> = {
  id: 'u.id',
  username: 'u.username',
  email: 'u.email',
  status: 'u.status',
  mfaEnabled: 'u.mfa_enabled',
  managerId: 'u.manager_id',
  primaryOrganizationUnitId: 'u.primary_organization_unit_id',
  createdAt: 'u.createdAt',
};

export interface SearchUsersFilter {
  readonly q?: string | undefined;
  readonly search?: string | undefined;
  readonly status?: UserStatusCode | undefined;
  readonly roleId?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly managerId?: number | undefined;
  readonly scopeFilter?: ResolvedDataScopeFilter | undefined;
  readonly includeArchived?: boolean | undefined;
  readonly mfaEnabled?: boolean | undefined;
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly filterConditions?: readonly FilterCondition[] | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: CountMode | undefined;
  readonly sort?: string | undefined;
  readonly sortBy?: UserSortField | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | 'asc' | 'desc' | undefined;
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

  /** Tìm người dùng theo mã băm SHA-256 của số điện thoại (blind index) */
  public async findByPhoneHash(phoneHash: string, withDeleted = false): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: { phoneHash: phoneHash.trim().toLowerCase() },
      withDeleted,
    });
  }

  /** Tìm người dùng theo identifier (email, username hoặc mã băm SĐT) phục vụ đăng nhập */
  public async findByIdentifier(
    identifier: string,
    phoneHash?: string | null,
  ): Promise<UserEntity | null> {
    const normalized = identifier.trim().toLowerCase();
    const qb = this.repository.createQueryBuilder('u').withDeleted();
    if (phoneHash) {
      qb.where(
        'LOWER(u.email) = :id OR LOWER(u.username) = :id OR (u.phone_hash IS NOT NULL AND u.phone_hash = :phoneHash)',
        { id: normalized, phoneHash },
      );
    } else {
      qb.where('LOWER(u.email) = :id OR LOWER(u.username) = :id', { id: normalized });
    }
    return qb.getOne();
  }

  /** Tìm người dùng theo ID số nguyên (hỗ trợ lấy cả bản ghi đã lưu trữ/soft-delete) */
  public async findByIdWithArchived(id: number, withDeleted = false): Promise<UserEntity | null> {
    return this.repository.findOne({
      where: { id: Number(id) },
      withDeleted,
    });
  }

  /**
   * Tìm toàn bộ ID nhân sự cấp dưới trực tiếp và gián tiếp theo cây quản lý (`manager_id` — Mục 4.3.3).
   */
  public async findSubordinateUserIds(managerId: number): Promise<number[]> {
    const rootId = Number(managerId);
    if (!Number.isInteger(rootId) || rootId <= 0) return [];

    const allUsers = await this.repository.find({
      select: { id: true, managerId: true },
    });

    const childrenByManager = new Map<number, number[]>();
    for (const u of allUsers) {
      if (u.managerId !== undefined && u.managerId !== null) {
        const mId = Number(u.managerId);
        const list = childrenByManager.get(mId) ?? [];
        list.push(Number(u.id));
        childrenByManager.set(mId, list);
      }
    }

    const subordinates = new Set<number>();
    const visited = new Set<number>([rootId]);
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const directReports = childrenByManager.get(current) ?? [];
      for (const subId of directReports) {
        if (!visited.has(subId)) {
          visited.add(subId);
          subordinates.add(subId);
          queue.push(subId);
        }
      }
    }

    return [...subordinates].sort((a, b) => a - b);
  }

  /**
   * Thực thi tìm kiếm người dùng chỉ đọc phục vụ Báo cáo & Dashboard (Mục 8.4.8 — Hỗ trợ đọc từ Read Replica khi hệ thống có cấu hình `replication`).
   */
  public async searchPaginatedReadOnly(
    filter: SearchUsersFilter = {},
    preferReplica = true,
  ): Promise<{
    readonly items: UserEntity[];
    readonly total: number;
    readonly dataSourceUsed: 'REPLICA' | 'PRIMARY';
  }> {
    if (!preferReplica) {
      const result = await this.searchPaginated(filter);
      return {
        items: result.items,
        total: result.total,
        dataSourceUsed: 'PRIMARY',
      };
    }

    const { data, dataSourceUsed } = await this.executeReadOnlyWithMeta((readRepo) =>
      this.searchPaginated(filter, readRepo),
    );
    return {
      items: data.items,
      total: data.total,
      dataSourceUsed,
    };
  }

  /** Tìm kiếm và lọc người dùng có phân trang (hỗ trợ lọc theo hồ sơ user_profiles, vai trò, đơn vị/chi nhánh, cây quản lý và Phạm vi dữ liệu Data Scope Mục 4.3) */
  public async searchPaginated(
    filter: SearchUsersFilter = {},
    repoOverride?: Repository<UserEntity>,
  ): Promise<{ items: UserEntity[]; total: number }> {
    const maxPageSize = defaultSettingRegistry.getNumber(
      'users.pagination.max_page_size',
      undefined,
      500,
    );
    const maxExportRows = defaultSettingRegistry.getNumber(
      'users.export.max_rows',
      undefined,
      5000,
    );

    const activeRepo =
      repoOverride && typeof repoOverride.createQueryBuilder === 'function'
        ? repoOverride
        : this.repository;

    const qb = activeRepo
      .createQueryBuilder('u')
      .leftJoin('user_profiles', 'up', 'up.user_id = u.id AND up.deleted_at IS NULL');
    if (filter.includeArchived || filter.status === 4) {
      qb.withDeleted();
    }

    this.applyKeywordSearch(qb, filter.search ?? filter.q, USER_SEARCHABLE_COLUMNS);

    if (filter.status !== undefined) {
      qb.andWhere('u.status = :status', { status: filter.status });
    }

    if (filter.mfaEnabled !== undefined) {
      qb.andWhere('u.mfa_enabled = :mfaEnabled', { mfaEnabled: filter.mfaEnabled });
    }

    if (filter.managerId !== undefined) {
      qb.andWhere('u.manager_id = :managerId', { managerId: filter.managerId });
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

    this.applyDateRange(
      qb,
      'u.createdAt',
      {
        from: filter.createdFrom ?? filter.fromDate,
        to: filter.createdTo ?? filter.toDate,
      },
      {
        fromFieldName: filter.createdFrom !== undefined ? 'createdFrom' : 'fromDate',
        toFieldName: filter.createdTo !== undefined ? 'createdTo' : 'toDate',
      },
    );

    if (filter.filterConditions && filter.filterConditions.length > 0) {
      this.applyFilterConditions(qb, filter.filterConditions, USER_ALLOWED_FILTER_COLUMN_MAP);
    }

    // Mục 4.3.5 & 8.1: Áp dụng phạm vi dữ liệu (Data Scope) qua Query Core dùng chung ở Backend
    this.applyDataScope(qb, filter.scopeFilter, {
      userColumn: 'u.id',
      orgUnitColumn: 'u.primary_organization_unit_id',
      orgMembershipSubquery: {
        table: 'user_organization_units',
        alias: 'uou_s',
        foreignKeyColumn: 'user_id',
        entityPrimaryColumn: 'u.id',
        orgUnitColumn: 'organization_unit_id',
        softDeleteColumn: 'deleted_at',
      },
    });

    this.applySort(qb, filter, USER_SORT_COLUMN_MAP, {
      defaultSortBy: 'id',
      defaultSortOrder: 'ASC',
      tieBreakerField: 'id',
    });

    const { items, total } = await this.paginateQueryBuilder(qb, filter, {
      defaultLimitKey: 'users.pagination.default_page_size',
      defaultLimit: 20,
      maxLimit: Math.max(maxPageSize, maxExportRows),
    });
    return { items, total };
  }
}
