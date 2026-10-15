import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { PasswordHasherService } from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
  type OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import {
  type IRolesPublicService,
  ROLES_PUBLIC_SERVICE,
  type RoleSummary,
} from '@modules/roles/contracts/index.js';
import type {
  IUsersPublicService,
  UserAuthCredentialsView,
  UserAuthIdentityView,
  UserOrganizationAssignmentSummary,
  UserRoleAssignmentSummary,
} from '../contracts/index.js';
import type { UserEntity } from '../entities/user.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UserRoleRepository } from '../repositories/user-role.repository.js';
import { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import { UsersMapper } from '../mappers/users.mapper.js';
import type {
  AssignUserOrganizationsRequest,
  AssignUserRolesRequest,
  ChangeUserStatusRequest,
  CreateUserRequest,
  ListUsersQuery,
  LockUserRequest,
  UpdateUserRequest,
} from '../requests/users.requests.js';
import type { UserResponse } from '../responses/users.response.js';

export const USER_IDENTITY_CACHE_PREFIX = 'iam:user:identity:';

@Injectable()
export class UsersService implements IUsersPublicService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly userOrgRepository: UserOrganizationUnitRepository,
    private readonly mapper: UsersMapper,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService,
    @Optional() private readonly transactionManager: TransactionManager | null = null,
    @Optional() private readonly redis: RedisService | null = null,
  ) {}

  /** Tìm kiếm và lọc danh sách người dùng có phân trang (Mục 3.1.9) */
  public async listPaginated(query: ListUsersQuery): Promise<PaginatedResult<UserResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.userRepository.searchPaginated(query);
    const enriched = await this.hydrateUsersList(items);
    return createPaginatedResult(enriched, total, page, limit);
  }

  /** Xem chi tiết một người dùng theo ID */
  public async getById(id: string, includeArchived = true): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, includeArchived);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }
    const [hydrated] = await this.hydrateUsersList([user]);
    return hydrated!;
  }

  /** Tạo mới người dùng kèm gán vai trò và đơn vị/chi nhánh (Mục 3.1.1) */
  public async create(dto: CreateUserRequest, actorId?: string): Promise<UserResponse> {
    const normalizedUsername = dto.username.trim().toLowerCase();
    const normalizedEmail = dto.email.trim().toLowerCase();

    const [existingByUsername, existingByEmail] = await Promise.all([
      this.userRepository.findByUsername(normalizedUsername, true),
      this.userRepository.findByEmail(normalizedEmail, true),
    ]);

    if (existingByUsername) {
      throw new ConflictAppException(
        'users.duplicateUsername',
        [{ username: normalizedUsername }],
        { username: normalizedUsername },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    if (existingByEmail) {
      throw new ConflictAppException(
        'users.duplicateEmail',
        [{ email: normalizedEmail }],
        { email: normalizedEmail },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const roleIds = dto.roleIds ?? [];
    if (roleIds.length > 0) {
      await this.rolesPublicService.ensureActiveRolesExist(roleIds);
    }

    const orgInputs = dto.organizationUnits ?? [];
    if (orgInputs.length > 0) {
      await this.organizationsPublicService.ensureActiveUnitsExist(
        orgInputs.map((o) => o.organizationUnitId),
      );
    }

    const passwordHash = await this.passwordHasher.hash(dto.password);
    const primaryOrgInput = orgInputs.find((o) => o.isPrimary) ?? orgInputs[0];

    const work = async (): Promise<UserEntity> => {
      const savedUser = await this.userRepository.saveEntity({
        username: normalizedUsername,
        email: normalizedEmail,
        fullName: dto.fullName.trim(),
        phone: dto.phone ? dto.phone.trim() : null,
        avatarUrl: dto.avatarUrl ?? null,
        passwordHash,
        status: dto.status ?? 'ACTIVE',
        failedLoginAttempts: 0,
        mfaEnabled: false,
        primaryOrganizationUnitId: primaryOrgInput?.organizationUnitId ?? null,
        passwordChangedAt: new Date(),
      });

      if (roleIds.length > 0) {
        await this.userRoleRepository.replaceUserRoles(savedUser.id, roleIds, actorId);
      }

      if (orgInputs.length > 0) {
        await this.userOrgRepository.replaceUserOrganizations(savedUser.id, orgInputs);
      }

      return savedUser;
    };

    const created = this.transactionManager
      ? await this.transactionManager.runInTransaction(work)
      : await work();

    return this.getById(created.id);
  }

  /** Cập nhật thông tin hồ sơ người dùng (Mục 3.1.2) */
  public async update(id: string, dto: UpdateUserRequest): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    if (dto.email !== undefined) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const duplicate = await this.userRepository.findByEmail(normalizedEmail, true);
        if (duplicate && duplicate.id !== id) {
          throw new ConflictAppException(
            'users.duplicateEmail',
            [{ email: normalizedEmail }],
            { email: normalizedEmail },
            HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          );
        }
        user.email = normalizedEmail;
      }
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) user.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;

    if (dto.expectedVersion !== undefined) {
      await this.userRepository.updateWithOptimisticLock(id, dto.expectedVersion, {
        email: user.email,
        fullName: user.fullName,
        phone: user.phone ?? null,
        avatarUrl: user.avatarUrl ?? null,
      });
    } else {
      await this.userRepository.saveEntity(user);
    }

    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Khóa tài khoản người dùng kèm lý do và thời hạn khóa tùy chọn (Mục 3.1.3 & 3.1.10) */
  public async lockUser(id: string, dto: LockUserRequest): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    let lockedUntilDate: Date | null = null;
    if (dto.lockedUntil) {
      lockedUntilDate = new Date(dto.lockedUntil);
      if (Number.isNaN(lockedUntilDate.getTime()) || lockedUntilDate.getTime() <= Date.now()) {
        throw new BadRequestAppException('users.invalidLockedUntilDate');
      }
    }

    user.status = 'LOCKED';
    user.lockReason = dto.reason.trim();
    user.lockedUntil = lockedUntilDate;

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Mở khóa tài khoản người dùng và đặt lại bộ đếm đăng nhập sai (Mục 3.1.3 & 3.1.10) */
  public async unlockUser(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    user.status = 'ACTIVE';
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Vô hiệu hóa tài khoản người dùng — chuyển trạng thái sang INACTIVE (Mục 3.1.4 & 3.1.10) */
  public async deactivateUser(id: string, reason?: string | null): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    user.status = 'INACTIVE';
    if (reason !== undefined) {
      user.lockReason = reason ? reason.trim() : null;
    }

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Kích hoạt lại tài khoản người dùng — chuyển trạng thái sang ACTIVE (Mục 3.1.10) */
  public async activateUser(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    user.status = 'ACTIVE';
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Chuyển đổi trực tiếp trạng thái Active / Inactive / Locked (Mục 3.1.10) */
  public async changeStatus(id: string, dto: ChangeUserStatusRequest): Promise<UserResponse> {
    if (dto.status === 'LOCKED') {
      return this.lockUser(id, {
        reason: dto.reason || 'Locked by administrator',
        lockedUntil: dto.lockedUntil ?? null,
      });
    }
    if (dto.status === 'INACTIVE') {
      return this.deactivateUser(id, dto.reason ?? null);
    }
    return this.activateUser(id);
  }

  /** Lưu trữ (Archive / Soft Delete) người dùng (Mục 3.1.4) */
  public async archiveUser(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const now = new Date();
    user.status = 'INACTIVE';
    user.archivedAt = now;
    user.deletedAt = now;

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Khôi phục người dùng đã lưu trữ (Restore Archived User) (Mục 3.1.4) */
  public async restoreUser(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    user.archivedAt = null;
    user.deletedAt = null;
    user.status = 'INACTIVE';

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Gán danh sách vai trò cho người dùng (Mục 3.1.5) */
  public async assignRoles(
    id: string,
    dto: AssignUserRolesRequest,
    actorId?: string,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    if (dto.roleIds.length > 0) {
      await this.rolesPublicService.ensureActiveRolesExist(dto.roleIds);
    }

    await this.userRoleRepository.replaceUserRoles(id, dto.roleIds, actorId);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Gán người dùng vào một hoặc nhiều đơn vị/chi nhánh (Mục 3.1.6) */
  public async assignOrganizations(
    id: string,
    dto: AssignUserOrganizationsRequest,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const unitIds = dto.organizationUnits.map((o) => o.organizationUnitId);
    if (unitIds.length > 0) {
      await this.organizationsPublicService.ensureActiveUnitsExist(unitIds);
    }

    const work = async (): Promise<void> => {
      const savedLinks = await this.userOrgRepository.replaceUserOrganizations(
        id,
        dto.organizationUnits,
      );
      const primaryLink = savedLinks.find((l) => l.isPrimary) ?? savedLinks[0];
      user.primaryOrganizationUnitId = primaryLink?.organizationUnitId ?? null;
      await this.userRepository.saveEntity(user);
    };

    if (this.transactionManager) {
      await this.transactionManager.runInTransaction(work);
    } else {
      await work();
    }

    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Hợp đồng công khai cho module Auth: Tìm thông tin đăng nhập theo username hoặc email */
  public async findAuthUserByIdentifier(
    identifier: string,
  ): Promise<UserAuthCredentialsView | null> {
    const user = await this.userRepository.findByIdentifier(identifier);
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      passwordHash: user.passwordHash,
      status: user.status,
      lockedUntil: user.lockedUntil ?? null,
      lockReason: user.lockReason ?? null,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
      mfaEnabled: Boolean(user.mfaEnabled),
      archivedAt: user.archivedAt ?? user.deletedAt ?? null,
    };
  }

  /** Hợp đồng công khai cho module Auth: Lấy danh tính đầy đủ kèm roles, permissions và đơn vị */
  public async findAuthUserById(userId: string): Promise<UserAuthIdentityView | null> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (!user || user.deletedAt || user.archivedAt) {
      return null;
    }

    const [roleLinks, orgLinks] = await Promise.all([
      this.userRoleRepository.findByUserIds([userId]),
      this.userOrgRepository.findByUserIds([userId]),
    ]);

    const roleIds = roleLinks.map((r) => r.roleId);
    const roleSummaries =
      roleIds.length > 0 ? await this.rolesPublicService.findByIds(roleIds) : [];
    const activeRoles = roleSummaries.filter((r) => r.status === 'ACTIVE');

    const roleCodes = activeRoles.map((r) => r.code);
    const permissions = [...new Set(activeRoles.flatMap((r) => r.permissions))];

    const organizationUnitIds = orgLinks.map((o) => o.organizationUnitId);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone ?? null,
      status: user.status,
      lockedUntil: user.lockedUntil ?? null,
      mfaEnabled: Boolean(user.mfaEnabled),
      primaryOrganizationUnitId: user.primaryOrganizationUnitId ?? null,
      organizationUnitIds,
      roles: roleCodes.length > 0 ? roleCodes : ['user'],
      permissions,
    };
  }

  /** Hợp đồng công khai: Ghi nhận đăng nhập thành công */
  public async recordLoginSuccess(userId: string): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) return;
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    if (user.status === 'LOCKED' && user.lockedUntil && user.lockedUntil.getTime() <= Date.now()) {
      user.status = 'ACTIVE';
      user.lockedUntil = null;
      user.lockReason = null;
    }
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Ghi nhận đăng nhập thất bại và tự động khóa tài khoản khi vượt ngưỡng */
  public async recordLoginFailure(
    userId: string,
    maxAttempts = 5,
    lockDurationMinutes = 15,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      return { failedAttempts: 0, locked: false, lockedUntil: null };
    }

    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    let locked = false;
    let lockedUntil: Date | null = user.lockedUntil ?? null;

    if (user.failedLoginAttempts >= maxAttempts) {
      locked = true;
      lockedUntil = new Date(Date.now() + lockDurationMinutes * 60_000);
      user.status = 'LOCKED';
      user.lockedUntil = lockedUntil;
      user.lockReason = `Locked automatically after ${user.failedLoginAttempts} failed login attempts`;
    }

    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);

    return {
      failedAttempts: user.failedLoginAttempts,
      locked,
      lockedUntil,
    };
  }

  /** Hợp đồng công khai: Tự động mở khóa khi thời hạn tạm khóa đã hết */
  public async autoUnlockExpiredLock(userId: string): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) return;
    user.status = 'ACTIVE';
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Cập nhật mật khẩu mới cho người dùng */
  public async updatePasswordHash(userId: string, newPasswordHash: string): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }
    user.passwordHash = newPasswordHash;
    user.passwordChangedAt = new Date();
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Bật hoặc tắt cờ xác thực nhiều lớp (MFA) trên hồ sơ người dùng */
  public async setMfaEnabled(userId: string, enabled: boolean): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }
    user.mfaEnabled = enabled;
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Ghép nối thông tin vai trò và đơn vị/chi nhánh cho danh sách UserEntity */
  public async hydrateUsersList(users: readonly UserEntity[]): Promise<UserResponse[]> {
    if (users.length === 0) return [];
    const userIds = users.map((u) => u.id);

    const [allRoleLinks, allOrgLinks] = await Promise.all([
      this.userRoleRepository.findByUserIds(userIds),
      this.userOrgRepository.findByUserIds(userIds),
    ]);

    const distinctRoleIds = [...new Set(allRoleLinks.map((l) => l.roleId))];
    const distinctOrgIds = [...new Set(allOrgLinks.map((l) => l.organizationUnitId))];

    const [roleSummaries, orgSummaries] = await Promise.all([
      distinctRoleIds.length > 0
        ? this.rolesPublicService.findByIds(distinctRoleIds)
        : Promise.resolve([] as RoleSummary[]),
      distinctOrgIds.length > 0
        ? this.organizationsPublicService.findByIds(distinctOrgIds)
        : Promise.resolve([] as OrganizationUnitSummary[]),
    ]);

    const roleMap = new Map(roleSummaries.map((r) => [r.id, r]));
    const orgMap = new Map(orgSummaries.map((o) => [o.id, o]));

    const rolesByUser = new Map<string, UserRoleAssignmentSummary[]>();
    for (const link of allRoleLinks) {
      const roleInfo = roleMap.get(link.roleId);
      if (!roleInfo) continue;
      const list = rolesByUser.get(link.userId) ?? [];
      list.push({
        roleId: roleInfo.id,
        code: roleInfo.code,
        name: roleInfo.name,
      });
      rolesByUser.set(link.userId, list);
    }

    const orgsByUser = new Map<string, UserOrganizationAssignmentSummary[]>();
    for (const link of allOrgLinks) {
      const orgInfo = orgMap.get(link.organizationUnitId);
      const list = orgsByUser.get(link.userId) ?? [];
      list.push({
        organizationUnitId: link.organizationUnitId,
        ...(orgInfo
          ? {
              code: orgInfo.code,
              name: orgInfo.name,
              type: orgInfo.type,
            }
          : {}),
        isPrimary: Boolean(link.isPrimary),
        positionTitle: link.positionTitle ?? null,
      });
      orgsByUser.set(link.userId, list);
    }

    return users.map((user) =>
      this.mapper.toResponse(user, rolesByUser.get(user.id) ?? [], orgsByUser.get(user.id) ?? []),
    );
  }

  /** Xóa cache danh tính người dùng trên Redis khi thông tin quyền/trạng thái thay đổi */
  private async invalidateIdentityCache(userId: string): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.del(`${USER_IDENTITY_CACHE_PREFIX}${userId}`).catch(() => undefined);
  }
}
