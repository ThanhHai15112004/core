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
import { FieldEncryptionService, PasswordHasherService } from '@packages/security/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
  type OrganizationUnitSummary,
} from '@modules/organizations/contracts/index.js';
import {
  type IRolesPublicService,
  ROLE_STATUS,
  ROLES_PUBLIC_SERVICE,
  type RoleSummary,
} from '@modules/roles/contracts/index.js';
import {
  type IUsersPublicService,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserOrganizationAssignmentSummary,
  type UserRoleAssignmentSummary,
  type UserStatusCode,
  getUserStatusName,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import type { UserEntity } from '../entities/user.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UserRoleRepository } from '../repositories/user-role.repository.js';
import { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import { UserStatusHistoryRepository } from '../repositories/user-status-history.repository.js';
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
import type { UserResponse, UserStatusHistoryItemResponse } from '../responses/users.response.js';

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
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
    @Optional()
    @Inject(UserStatusHistoryRepository)
    private readonly statusHistoryRepository: UserStatusHistoryRepository | null = null,
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fieldEncryption: FieldEncryptionService | null = null,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
    @Optional()
    @Inject(RedisService)
    private readonly redis: RedisService | null = null,
  ) {}

  /** Tìm kiếm và lọc danh sách người dùng có phân trang (Mục 3.1.9) */
  public async listPaginated(query: ListUsersQuery): Promise<PaginatedResult<UserResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.userRepository.searchPaginated(query);
    const enriched = await this.hydrateUsersList(items);
    return createPaginatedResult(enriched, total, page, limit);
  }

  /** Xem chi tiết một người dùng theo ID số nguyên */
  public async getById(id: number, includeArchived = true): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, includeArchived);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }
    const [hydrated] = await this.hydrateUsersList([user]);
    return hydrated!;
  }

  /** Xem lịch sử thay đổi trạng thái của một người dùng (Mục 3.1.10) */
  public async getStatusHistory(userId: number): Promise<UserStatusHistoryItemResponse[]> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }
    if (!this.statusHistoryRepository) {
      return [];
    }
    const rows = await this.statusHistoryRepository.findByUserId(userId);
    return rows.map((r) => {
      const fromCode =
        r.fromStatus !== undefined && r.fromStatus !== null ? parseUserStatus(r.fromStatus) : null;
      const toCode = parseUserStatus(r.toStatus);
      return {
        id: Number(r.id),
        userId: Number(r.userId),
        fromStatus: fromCode,
        fromStatusName: fromCode !== null ? getUserStatusName(fromCode) : null,
        toStatus: toCode,
        toStatusName: getUserStatusName(toCode),
        reason: r.reason ?? null,
        changedBy: r.changedBy !== undefined && r.changedBy !== null ? Number(r.changedBy) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Tạo mới người dùng kèm gán vai trò và đơn vị/chi nhánh (Mục 3.1.1) */
  public async create(dto: CreateUserRequest, actorId?: number): Promise<UserResponse> {
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
    if (orgInputs.length > 0 && this.organizationsPublicService) {
      await this.organizationsPublicService.ensureActiveUnitsExist(
        orgInputs.map((o) => o.organizationUnitId),
      );
    }

    const nameParts = resolveVietnameseNameParts({
      firstName: dto.firstName,
      lastName: dto.lastName,
      fullName: dto.fullName,
    });
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const primaryOrgInput = orgInputs.find((o) => o.isPrimary) ?? orgInputs[0];
    const initialStatus = dto.status ?? USER_STATUS.ACTIVE;
    const encryptedPhone = this.encryptPhone(dto.phone);

    const work = async (): Promise<UserEntity> => {
      const savedUser = await this.userRepository.saveEntity({
        username: normalizedUsername,
        email: normalizedEmail,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        fullName: nameParts.fullName,
        phone: encryptedPhone,
        avatarUrl: dto.avatarUrl ?? null,
        passwordHash,
        status: initialStatus,
        failedLoginAttempts: 0,
        mfaEnabled: false,
        primaryOrganizationUnitId: primaryOrgInput?.organizationUnitId ?? null,
        passwordChangedAt: new Date(),
      });

      if (roleIds.length > 0) {
        await this.userRoleRepository.replaceUserRoles(Number(savedUser.id), roleIds, actorId);
      }

      if (orgInputs.length > 0) {
        await this.userOrgRepository.replaceUserOrganizations(Number(savedUser.id), orgInputs);
      }

      await this.recordStatusHistory(
        Number(savedUser.id),
        null,
        initialStatus,
        'Initial account creation',
        actorId,
      );

      return savedUser;
    };

    const created = this.transactionManager
      ? await this.transactionManager.runInTransaction(work)
      : await work();

    return this.getById(Number(created.id));
  }

  /** Cập nhật thông tin hồ sơ người dùng (Mục 3.1.2) */
  public async update(id: number, dto: UpdateUserRequest): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    if (dto.email !== undefined) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const duplicate = await this.userRepository.findByEmail(normalizedEmail, true);
        if (duplicate && Number(duplicate.id) !== Number(id)) {
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

    if (dto.firstName !== undefined || dto.lastName !== undefined || dto.fullName !== undefined) {
      const resolved = resolveVietnameseNameParts({
        firstName: dto.firstName ?? user.firstName,
        lastName: dto.lastName ?? user.lastName,
        fullName:
          dto.fullName ??
          (dto.firstName !== undefined || dto.lastName !== undefined
            ? `${dto.lastName ?? user.lastName} ${dto.firstName ?? user.firstName}`.trim()
            : user.fullName),
      });
      user.firstName = resolved.firstName;
      user.lastName = resolved.lastName;
      user.fullName = resolved.fullName;
    }

    if (dto.phone !== undefined) user.phone = this.encryptPhone(dto.phone);
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;

    if (dto.expectedVersion !== undefined) {
      await this.userRepository.updateWithOptimisticLock(id, dto.expectedVersion, {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
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
  public async lockUser(id: number, dto: LockUserRequest, actorId?: number): Promise<UserResponse> {
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

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.LOCKED;
    user.lockReason = dto.reason.trim();
    user.lockedUntil = lockedUntilDate;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(id, prevStatus, USER_STATUS.LOCKED, user.lockReason, actorId);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Mở khóa tài khoản người dùng và đặt lại bộ đếm đăng nhập sai (Mục 3.1.3 & 3.1.10) */
  public async unlockUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(id, prevStatus, USER_STATUS.ACTIVE, 'Account unlocked', actorId);
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Vô hiệu hóa tài khoản người dùng — chuyển trạng thái sang INACTIVE (2) (Mục 3.1.4 & 3.1.10) */
  public async deactivateUser(
    id: number,
    reason?: string | null,
    actorId?: number,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.INACTIVE;
    if (reason !== undefined) {
      user.lockReason = reason ? reason.trim() : null;
    }

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      id,
      prevStatus,
      USER_STATUS.INACTIVE,
      reason ?? 'Account deactivated',
      actorId,
    );
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Kích hoạt lại tài khoản người dùng — chuyển trạng thái sang ACTIVE (1) (Mục 3.1.10) */
  public async activateUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      id,
      prevStatus,
      USER_STATUS.ACTIVE,
      'Account activated',
      actorId,
    );
    await this.invalidateIdentityCache(id);
    return this.getById(id);
  }

  /** Chuyển đổi trực tiếp trạng thái Active (1) / Inactive (2) / Locked (3) / Archived (4) (Mục 3.1.10) */
  public async changeStatus(
    id: number,
    dto: ChangeUserStatusRequest,
    actorId?: number,
  ): Promise<UserResponse> {
    if (dto.status === USER_STATUS.LOCKED) {
      return this.lockUser(
        id,
        {
          reason: dto.reason || 'Locked by administrator',
          lockedUntil: dto.lockedUntil ?? null,
        },
        actorId,
      );
    }
    if (dto.status === USER_STATUS.INACTIVE) {
      return this.deactivateUser(id, dto.reason ?? null, actorId);
    }
    if (dto.status === USER_STATUS.ARCHIVED) {
      return this.archiveUser(id, actorId);
    }
    return this.activateUser(id, actorId);
  }

  /** Lưu trữ (Archive / Soft Delete) người dùng (status = 4) (Mục 3.1.4) */
  public async archiveUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    const now = new Date();
    user.status = USER_STATUS.ARCHIVED;
    user.archivedAt = now;
    user.deletedAt = now;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      id,
      prevStatus,
      USER_STATUS.ARCHIVED,
      'Account archived',
      actorId,
    );
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Khôi phục người dùng đã lưu trữ (Restore Archived User) (Mục 3.1.4) */
  public async restoreUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.archivedAt = null;
    user.deletedAt = null;
    user.status = USER_STATUS.INACTIVE;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      id,
      prevStatus,
      USER_STATUS.INACTIVE,
      'Account restored from archive',
      actorId,
    );
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Gán danh sách vai trò cho người dùng (Mục 3.1.5) */
  public async assignRoles(
    id: number,
    dto: AssignUserRolesRequest,
    actorId?: number,
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
    id: number,
    dto: AssignUserOrganizationsRequest,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const unitIds = dto.organizationUnits.map((o) => o.organizationUnitId);
    if (unitIds.length > 0 && this.organizationsPublicService) {
      await this.organizationsPublicService.ensureActiveUnitsExist(unitIds);
    }

    const work = async (): Promise<void> => {
      const savedLinks = await this.userOrgRepository.replaceUserOrganizations(
        id,
        dto.organizationUnits,
      );
      const primaryLink = savedLinks.find((l) => l.isPrimary) ?? savedLinks[0];
      user.primaryOrganizationUnitId = primaryLink ? Number(primaryLink.organizationUnitId) : null;
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

    const statusCode =
      user.deletedAt || user.archivedAt ? USER_STATUS.ARCHIVED : parseUserStatus(user.status);
    return {
      id: Number(user.id),
      username: user.username,
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      fullName: user.fullName,
      passwordHash: user.passwordHash,
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      lockedUntil: user.lockedUntil ?? null,
      lockReason: user.lockReason ?? null,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
      mfaEnabled: Boolean(user.mfaEnabled),
      archivedAt: user.archivedAt ?? user.deletedAt ?? null,
    };
  }

  /** Hợp đồng công khai cho module Auth: Lấy danh tính đầy đủ kèm roles, permissions và đơn vị */
  public async findAuthUserById(userId: number): Promise<UserAuthIdentityView | null> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (
      !user ||
      user.deletedAt ||
      user.archivedAt ||
      Number(user.status) === USER_STATUS.ARCHIVED
    ) {
      return null;
    }

    const [roleLinks, orgLinks] = await Promise.all([
      this.userRoleRepository.findByUserIds([userId]),
      this.userOrgRepository.findByUserIds([userId]),
    ]);

    const roleIds = roleLinks.map((r) => Number(r.roleId));
    const roleSummaries =
      roleIds.length > 0 ? await this.rolesPublicService.findByIds(roleIds) : [];
    const activeRoles = roleSummaries.filter((r) => Number(r.status) === ROLE_STATUS.ACTIVE);

    const roleCodes = activeRoles.map((r) => r.code);
    const permissions = [...new Set(activeRoles.flatMap((r) => r.permissions))];
    const organizationUnitIds = orgLinks.map((o) => Number(o.organizationUnitId));
    const statusCode = parseUserStatus(user.status);

    return {
      id: Number(user.id),
      username: user.username,
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      fullName: user.fullName,
      phone: this.decryptPhone(user.phone),
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      lockedUntil: user.lockedUntil ?? null,
      mfaEnabled: Boolean(user.mfaEnabled),
      primaryOrganizationUnitId:
        user.primaryOrganizationUnitId !== undefined && user.primaryOrganizationUnitId !== null
          ? Number(user.primaryOrganizationUnitId)
          : null,
      organizationUnitIds,
      roles: roleCodes.length > 0 ? roleCodes : ['user'],
      permissions,
    };
  }

  /** Hợp đồng công khai: Ghi nhận đăng nhập thành công */
  public async recordLoginSuccess(userId: number): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) return;
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    if (
      Number(user.status) === USER_STATUS.LOCKED &&
      user.lockedUntil &&
      user.lockedUntil.getTime() <= Date.now()
    ) {
      const prev = parseUserStatus(user.status);
      user.status = USER_STATUS.ACTIVE;
      user.lockedUntil = null;
      user.lockReason = null;
      await this.recordStatusHistory(
        userId,
        prev,
        USER_STATUS.ACTIVE,
        'Auto-unlocked after lock expiration',
      );
    }
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Ghi nhận đăng nhập thất bại và tự động khóa tài khoản khi vượt ngưỡng */
  public async recordLoginFailure(
    userId: number,
    maxAttempts = 5,
    lockDurationMinutes = 15,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      return { failedAttempts: 0, locked: false, lockedUntil: null };
    }

    const prevStatus = parseUserStatus(user.status);
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    let locked = false;
    let lockedUntil: Date | null = user.lockedUntil ?? null;

    if (user.failedLoginAttempts >= maxAttempts) {
      locked = true;
      lockedUntil = new Date(Date.now() + lockDurationMinutes * 60_000);
      user.status = USER_STATUS.LOCKED;
      user.lockedUntil = lockedUntil;
      user.lockReason = `Locked automatically after ${user.failedLoginAttempts} failed login attempts`;
    }

    await this.userRepository.saveEntity(user);
    if (locked && prevStatus !== USER_STATUS.LOCKED) {
      await this.recordStatusHistory(userId, prevStatus, USER_STATUS.LOCKED, user.lockReason);
    }
    await this.invalidateIdentityCache(userId);

    return {
      failedAttempts: user.failedLoginAttempts,
      locked,
      lockedUntil,
    };
  }

  /** Hợp đồng công khai: Tự động mở khóa khi thời hạn tạm khóa đã hết */
  public async autoUnlockExpiredLock(userId: number): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) return;
    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;
    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      userId,
      prevStatus,
      USER_STATUS.ACTIVE,
      'Auto-unlocked after lock expiration',
    );
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Cập nhật mật khẩu mới cho người dùng */
  public async updatePasswordHash(userId: number, newPasswordHash: string): Promise<void> {
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
  public async setMfaEnabled(userId: number, enabled: boolean): Promise<void> {
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
    const userIds = users.map((u) => Number(u.id));

    const [allRoleLinks, allOrgLinks] = await Promise.all([
      this.userRoleRepository.findByUserIds(userIds),
      this.userOrgRepository.findByUserIds(userIds),
    ]);

    const distinctRoleIds = [...new Set(allRoleLinks.map((l) => Number(l.roleId)))];
    const distinctOrgIds = [...new Set(allOrgLinks.map((l) => Number(l.organizationUnitId)))];

    const [roleSummaries, orgSummaries] = await Promise.all([
      distinctRoleIds.length > 0
        ? this.rolesPublicService.findByIds(distinctRoleIds)
        : Promise.resolve([] as RoleSummary[]),
      distinctOrgIds.length > 0 && this.organizationsPublicService
        ? this.organizationsPublicService.findByIds(distinctOrgIds)
        : Promise.resolve([] as OrganizationUnitSummary[]),
    ]);

    const roleMap = new Map(roleSummaries.map((r) => [Number(r.id), r]));
    const orgMap = new Map(orgSummaries.map((o) => [Number(o.id), o]));

    const rolesByUser = new Map<number, UserRoleAssignmentSummary[]>();
    for (const link of allRoleLinks) {
      const roleInfo = roleMap.get(Number(link.roleId));
      if (!roleInfo) continue;
      const uid = Number(link.userId);
      const list = rolesByUser.get(uid) ?? [];
      list.push({
        roleId: Number(roleInfo.id),
        code: roleInfo.code,
        name: roleInfo.name,
      });
      rolesByUser.set(uid, list);
    }

    const orgsByUser = new Map<number, UserOrganizationAssignmentSummary[]>();
    for (const link of allOrgLinks) {
      const orgInfo = orgMap.get(Number(link.organizationUnitId));
      const uid = Number(link.userId);
      const list = orgsByUser.get(uid) ?? [];
      list.push({
        organizationUnitId: Number(link.organizationUnitId),
        ...(orgInfo
          ? {
              code: orgInfo.code,
              name: orgInfo.name,
              type: orgInfo.type,
              typeName: orgInfo.typeName,
            }
          : {}),
        isPrimary: Boolean(link.isPrimary),
        positionTitle: link.positionTitle ?? null,
      });
      orgsByUser.set(uid, list);
    }

    return users.map((user) =>
      this.mapper.toResponse(user, {
        roles: rolesByUser.get(Number(user.id)) ?? [],
        organizationUnits: orgsByUser.get(Number(user.id)) ?? [],
        decryptedPhone: this.decryptPhone(user.phone),
      }),
    );
  }

  private encryptPhone(phone?: string | null): string | null {
    if (!phone || !phone.trim()) return null;
    const trimmed = phone.trim();
    if (!this.fieldEncryption) return trimmed;
    return this.fieldEncryption.encrypt(trimmed);
  }

  private decryptPhone(phone?: string | null): string | null {
    if (!phone) return null;
    if (!this.fieldEncryption) return phone;
    return this.fieldEncryption.decrypt(phone);
  }

  private async recordStatusHistory(
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ): Promise<void> {
    if (!this.statusHistoryRepository) return;
    await this.statusHistoryRepository
      .recordTransition({
        userId,
        fromStatus,
        toStatus,
        reason: reason ?? null,
        changedBy: changedBy ?? null,
      })
      .catch(() => undefined);
  }

  /** Xóa cache danh tính người dùng trên Redis khi thông tin quyền/trạng thái thay đổi */
  private async invalidateIdentityCache(userId: number): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.del(`${USER_IDENTITY_CACHE_PREFIX}${userId}`).catch(() => undefined);
  }
}
