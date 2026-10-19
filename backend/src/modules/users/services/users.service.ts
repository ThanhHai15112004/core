import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
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
  type RoleAssignedUserSummary,
  type RoleSummary,
} from '@modules/roles/contracts/index.js';
import {
  type AdminResetUserMfaInput,
  type AdminResetUserMfaResult,
  type AdminResetUserPasswordInput,
  type AdminResetUserPasswordResult,
  type IUsersPublicService,
  type SelfRegisterUserInput,
  USER_STATUS,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserLoginHistoryItemView,
  type UserOrganizationAssignmentSummary,
  type UserProfileView,
  type UserRoleAssignmentSummary,
  type UserStatusCode,
  getUserStatusName,
  normalizePhoneNumber,
  parseUserStatus,
  resolveVietnameseNameParts,
} from '../contracts/index.js';
import type { UserEntity } from '../entities/user.entity.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
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
  private adminPasswordResetDelegate?: (
    userId: number,
    input: AdminResetUserPasswordInput,
    actorId?: number,
  ) => Promise<AdminResetUserPasswordResult>;
  private adminRevokeSessionsDelegate?: (userId: number, reason?: string) => Promise<number>;
  private userLoginHistoryDelegate?: (
    userId: number,
    limit?: number,
  ) => Promise<UserLoginHistoryItemView[]>;
  private adminResetMfaDelegate?: (
    userId: number,
    input: AdminResetUserMfaInput,
    actorId?: number,
  ) => Promise<AdminResetUserMfaResult>;
  private stepUpVerificationDelegate?: (
    userId: number,
    stepUpToken: string,
    action?: string,
  ) => Promise<boolean>;

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
    @Optional()
    @Inject(UserProfileRepository)
    private readonly userProfileRepository: UserProfileRepository | null = null,
  ) {
    this.rolesPublicService.registerRoleUserCountDelegate?.((roleIds) =>
      this.countUsersByRoleIds(roleIds),
    );
    this.rolesPublicService.registerRoleUsersListDelegate?.((roleId) =>
      this.listUsersByRoleId(roleId),
    );
  }

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

  /** Tạo mới người dùng kèm lưu bảng Core (`users`) và bảng Chi tiết (`user_profiles`) (Mục 3.1.1) */
  public async create(dto: CreateUserRequest, actorId?: number): Promise<UserResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const rawUsername =
      dto.username && dto.username.trim().length >= 3
        ? dto.username.trim().toLowerCase()
        : (normalizedEmail.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user';
    const normalizedUsername = rawUsername.length >= 3 ? rawUsername : `${rawUsername}_usr`;

    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const phoneHash = normalizedPhone ? this.passwordHasher.sha256(normalizedPhone) : null;

    const [existingByUsername, existingByEmail, existingByPhone] = await Promise.all([
      this.userRepository.findByUsername(normalizedUsername, true),
      this.userRepository.findByEmail(normalizedEmail, true),
      phoneHash && typeof this.userRepository.findByPhoneHash === 'function'
        ? this.userRepository.findByPhoneHash(phoneHash, true)
        : Promise.resolve(null),
    ]);

    if (existingByUsername && dto.username) {
      throw new ConflictAppException(
        'users.duplicateUsername',
        [{ username: normalizedUsername }],
        { username: normalizedUsername },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const finalUsername = existingByUsername
      ? `${normalizedUsername}_${Date.now().toString(36).slice(-4)}`
      : normalizedUsername;

    if (existingByEmail) {
      throw new ConflictAppException(
        'users.duplicateEmail',
        [{ email: normalizedEmail }],
        { email: normalizedEmail },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    if (existingByPhone && normalizedPhone) {
      throw new ConflictAppException(
        'users.duplicatePhone',
        [{ phone: normalizedPhone }],
        { phone: normalizedPhone },
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
    const encryptedPhone = this.encryptPhone(normalizedPhone ?? dto.phone);

    const work = async (): Promise<UserEntity> => {
      const savedUser = await this.userRepository.saveEntity({
        username: finalUsername,
        email: normalizedEmail,
        phone: encryptedPhone,
        phoneHash,
        passwordHash,
        status: initialStatus,
        failedLoginAttempts: 0,
        mfaEnabled: false,
        primaryOrganizationUnitId: primaryOrgInput?.organizationUnitId ?? null,
        passwordChangedAt: new Date(),
      });

      const userId = Number(savedUser.id);
      await this.upsertUserProfile(userId, {
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        fullName: nameParts.fullName,
        avatarUrl: dto.avatarUrl ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        identityNumber: dto.identityNumber ?? null,
        address: dto.address ?? null,
        city: dto.city ?? null,
        country: dto.country ?? null,
        bio: dto.bio ?? null,
      });

      if (roleIds.length > 0) {
        await this.userRoleRepository.replaceUserRoles(userId, roleIds, actorId);
      }

      if (orgInputs.length > 0) {
        await this.userOrgRepository.replaceUserOrganizations(userId, orgInputs);
      }

      await this.recordStatusHistory(
        userId,
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

  /** Cập nhật thông tin tài khoản Core (`users`) và chi tiết cá nhân (`user_profiles`) (Mục 3.1.2) */
  public async update(id: number, dto: UpdateUserRequest): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
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

    if (dto.phone !== undefined) {
      const normalizedPhone = normalizePhoneNumber(dto.phone);
      const nextPhoneHash = normalizedPhone ? this.passwordHasher.sha256(normalizedPhone) : null;
      if (
        normalizedPhone &&
        nextPhoneHash &&
        nextPhoneHash !== user.phoneHash &&
        typeof this.userRepository.findByPhoneHash === 'function'
      ) {
        const duplicatePhone = await this.userRepository.findByPhoneHash(nextPhoneHash, true);
        if (duplicatePhone && Number(duplicatePhone.id) !== Number(id)) {
          throw new ConflictAppException(
            'users.duplicatePhone',
            [{ phone: normalizedPhone }],
            { phone: normalizedPhone },
            HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          );
        }
      }
      user.phone = this.encryptPhone(normalizedPhone ?? dto.phone);
      user.phoneHash = nextPhoneHash;
    }

    const currentProfile = await this.getUserProfile(id, user);
    let nextFirstName = currentProfile.firstName;
    let nextLastName = currentProfile.lastName;
    let nextFullName = currentProfile.fullName;

    if (dto.firstName !== undefined || dto.lastName !== undefined || dto.fullName !== undefined) {
      const resolved = resolveVietnameseNameParts({
        firstName: dto.firstName ?? currentProfile.firstName,
        lastName: dto.lastName ?? currentProfile.lastName,
        fullName:
          dto.fullName ??
          (dto.firstName !== undefined || dto.lastName !== undefined
            ? `${dto.lastName ?? currentProfile.lastName} ${dto.firstName ?? currentProfile.firstName}`.trim()
            : currentProfile.fullName),
      });
      nextFirstName = resolved.firstName;
      nextLastName = resolved.lastName;
      nextFullName = resolved.fullName;
    }

    await this.upsertUserProfile(id, {
      firstName: nextFirstName,
      lastName: nextLastName,
      fullName: nextFullName,
      avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl : (currentProfile.avatarUrl ?? null),
      dateOfBirth:
        dto.dateOfBirth !== undefined ? dto.dateOfBirth : (currentProfile.dateOfBirth ?? null),
      gender: dto.gender !== undefined ? dto.gender : (currentProfile.gender ?? null),
      identityNumber:
        dto.identityNumber !== undefined
          ? dto.identityNumber
          : (currentProfile.identityNumber ?? null),
      address: dto.address !== undefined ? dto.address : (currentProfile.address ?? null),
      city: dto.city !== undefined ? dto.city : (currentProfile.city ?? null),
      country: dto.country !== undefined ? dto.country : (currentProfile.country ?? null),
      bio: dto.bio !== undefined ? dto.bio : (currentProfile.bio ?? null),
    });

    if (dto.expectedVersion !== undefined) {
      await this.userRepository.updateWithOptimisticLock(id, dto.expectedVersion, {
        email: user.email,
        phone: user.phone ?? null,
        phoneHash: user.phoneHash ?? null,
      });
    } else {
      await this.userRepository.saveEntity(user);
    }

    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Khóa tài khoản người dùng kèm lý do và thời hạn khóa tùy chọn (Mục 3.1.3 & 3.1.10) */
  public async lockUser(id: number, dto: LockUserRequest, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
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
    user.archivedAt = null;
    user.deletedAt = null;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(id, prevStatus, USER_STATUS.LOCKED, user.lockReason, actorId);
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Mở khóa tài khoản người dùng và đặt lại bộ đếm đăng nhập sai (Mục 3.1.3 & 3.1.10) */
  public async unlockUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;
    user.archivedAt = null;
    user.deletedAt = null;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(id, prevStatus, USER_STATUS.ACTIVE, 'Account unlocked', actorId);
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
  }

  /** Vô hiệu hóa tài khoản người dùng — chuyển trạng thái sang INACTIVE (2) (Mục 3.1.4 & 3.1.10) */
  public async deactivateUser(
    id: number,
    reason?: string | null,
    actorId?: number,
  ): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.INACTIVE;
    user.archivedAt = null;
    user.deletedAt = null;
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
    return this.getById(id, true);
  }

  /** Kích hoạt lại tài khoản người dùng — chuyển trạng thái sang ACTIVE (1) (Mục 3.1.10) */
  public async activateUser(id: number, actorId?: number): Promise<UserResponse> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const prevStatus = parseUserStatus(user.status);
    user.status = USER_STATUS.ACTIVE;
    user.lockedUntil = null;
    user.lockReason = null;
    user.failedLoginAttempts = 0;
    user.archivedAt = null;
    user.deletedAt = null;

    await this.userRepository.saveEntity(user);
    await this.recordStatusHistory(
      id,
      prevStatus,
      USER_STATUS.ACTIVE,
      'Account activated',
      actorId,
    );
    await this.invalidateIdentityCache(id);
    return this.getById(id, true);
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

  /** Gán danh sách vai trò cho người dùng (Mục 3.1.5 & 3.5.7 — hỗ trợ xác thực lại khi thao tác nhạy cảm) */
  public async assignRoles(
    id: number,
    dto: AssignUserRolesRequest,
    actorId?: number,
  ): Promise<UserResponse> {
    await this.verifySensitiveActionStepUp(
      actorId,
      dto.stepUpToken,
      dto.requireStepUp,
      'users.assignRoles',
    );

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

  /** Hợp đồng công khai cho module Auth: Tìm thông tin đăng nhập theo username, email hoặc số điện thoại */
  public async findAuthUserByIdentifier(
    identifier: string,
  ): Promise<UserAuthCredentialsView | null> {
    const trimmed = identifier.trim();
    const normalizedPhone = normalizePhoneNumber(trimmed);
    const phoneHash =
      normalizedPhone && /^[0-9+]+$/.test(trimmed.replace(/[\s.\-()]/g, ''))
        ? this.passwordHasher.sha256(normalizedPhone)
        : null;

    let user = await this.userRepository.findByIdentifier(trimmed, phoneHash);
    if (!user && phoneHash && typeof this.userRepository.findByPhoneHash === 'function') {
      user = await this.userRepository.findByPhoneHash(phoneHash, true);
    }

    if (!user) return null;
    return this.toAuthCredentialsView(user);
  }

  /** Hợp đồng công khai cho module Auth: Tìm thông tin xác thực và lịch sử mật khẩu theo userId */
  public async findAuthCredentialsByUserId(
    userId: number,
  ): Promise<UserAuthCredentialsView | null> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (!user) return null;
    return this.toAuthCredentialsView(user);
  }

  private async toAuthCredentialsView(user: UserEntity): Promise<UserAuthCredentialsView> {
    const profile = await this.getUserProfile(Number(user.id), user);
    const statusCode =
      user.deletedAt || user.archivedAt ? USER_STATUS.ARCHIVED : parseUserStatus(user.status);
    return {
      id: Number(user.id),
      username: user.username,
      email: user.email ?? '',
      phone: this.decryptPhone(user.phone),
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.fullName,
      passwordHash: user.passwordHash,
      passwordHistoryHashes: this.parsePasswordHistory(Number(user.id), user),
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt ?? null,
      lockedUntil: user.lockedUntil ?? null,
      lockReason: user.lockReason ?? null,
      failedLoginAttempts: user.failedLoginAttempts ?? 0,
      mfaEnabled: Boolean(user.mfaEnabled),
      archivedAt: user.archivedAt ?? user.deletedAt ?? null,
    };
  }

  /** Hợp đồng công khai cho module Auth: Lấy danh tính đầy đủ kèm hồ sơ user_profiles, roles, permissions và đơn vị */
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

    const [roleLinks, orgLinks, profile] = await Promise.all([
      this.userRoleRepository.findByUserIds([userId]),
      this.userOrgRepository.findByUserIds([userId]),
      this.getUserProfile(userId, user),
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
      email: user.email ?? '',
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
      phone: this.decryptPhone(user.phone),
      status: statusCode,
      statusName: getUserStatusName(statusCode),
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt ?? null,
      lockedUntil: user.lockedUntil ?? null,
      mfaEnabled: Boolean(user.mfaEnabled),
      primaryOrganizationUnitId:
        user.primaryOrganizationUnitId !== undefined && user.primaryOrganizationUnitId !== null
          ? Number(user.primaryOrganizationUnitId)
          : null,
      organizationUnitIds,
      roles: roleCodes.length > 0 ? roleCodes : ['user'],
      permissions,
      profile,
    };
  }

  /** Hợp đồng công khai cho module Auth: Tự đăng ký tài khoản bằng Email hoặc SĐT (Mục 3.2.1 & 3.2.2) */
  public async registerSelfUser(input: SelfRegisterUserInput): Promise<UserAuthIdentityView> {
    const normalizedEmail = input.email?.trim().toLowerCase() || null;
    const normalizedPhone = normalizePhoneNumber(input.phone);

    if (!normalizedEmail && !normalizedPhone) {
      throw new BadRequestAppException('auth.emailOrPhoneRequired');
    }

    const phoneHash = normalizedPhone ? this.passwordHasher.sha256(normalizedPhone) : null;
    const fallbackEmail =
      normalizedEmail ?? `${normalizedPhone ?? Date.now().toString(36)}@phone.local`;

    let baseUsername = input.username?.trim().toLowerCase() ?? '';
    if (!baseUsername || baseUsername.length < 3) {
      if (normalizedEmail) {
        baseUsername =
          (normalizedEmail.split('@')[0] ?? 'user').replace(/[^a-z0-9._-]/g, '') || 'user';
      } else if (normalizedPhone) {
        baseUsername = `u_${normalizedPhone.replace(/[^0-9]/g, '')}`;
      } else {
        baseUsername = 'user';
      }
    }
    if (baseUsername.length < 3) {
      baseUsername = `${baseUsername}_usr`;
    }

    const [existingByUsername, existingByEmail, existingByPhone] = await Promise.all([
      this.userRepository.findByUsername(baseUsername, true),
      this.userRepository.findByEmail(fallbackEmail, true),
      phoneHash && typeof this.userRepository.findByPhoneHash === 'function'
        ? this.userRepository.findByPhoneHash(phoneHash, true)
        : Promise.resolve(null),
    ]);

    if (existingByUsername && input.username) {
      throw new ConflictAppException(
        'users.duplicateUsername',
        [{ username: baseUsername }],
        { username: baseUsername },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    if (existingByEmail && normalizedEmail) {
      throw new ConflictAppException(
        'users.duplicateEmail',
        [{ email: normalizedEmail }],
        { email: normalizedEmail },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    if (existingByPhone && normalizedPhone) {
      throw new ConflictAppException(
        'users.duplicatePhone',
        [{ phone: normalizedPhone }],
        { phone: normalizedPhone },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const finalUsername = existingByUsername
      ? `${baseUsername}_${Date.now().toString(36).slice(-4)}`
      : baseUsername;

    const nameParts = resolveVietnameseNameParts({
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: input.fullName,
    });

    const passwordHash = await this.passwordHasher.hash(input.password);
    const encryptedPhone = this.encryptPhone(normalizedPhone ?? input.phone);
    const initialStatus = input.status ?? USER_STATUS.ACTIVE;

    const savedUser = await this.userRepository.saveEntity({
      username: finalUsername,
      email: fallbackEmail,
      phone: encryptedPhone,
      phoneHash,
      passwordHash,
      status: initialStatus,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      failedLoginAttempts: 0,
      mfaEnabled: false,
      primaryOrganizationUnitId: null,
      passwordChangedAt: new Date(),
    });

    const userId = Number(savedUser.id);
    await this.upsertUserProfile(userId, {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      fullName: nameParts.fullName,
      avatarUrl: input.avatarUrl ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      bio: input.bio ?? null,
    });

    await this.recordStatusHistory(userId, null, initialStatus, 'Self-registered account', userId);

    const identity = await this.findAuthUserById(userId);
    return identity!;
  }

  /** Hợp đồng công khai: Đánh dấu địa chỉ Email đã được xác minh (Mục 3.2.6) */
  public async markEmailVerified(userId: number): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }
    user.emailVerifiedAt = new Date();
    if (Number(user.status) === USER_STATUS.INACTIVE) {
      const prev = parseUserStatus(user.status);
      user.status = USER_STATUS.ACTIVE;
      await this.recordStatusHistory(
        userId,
        prev,
        USER_STATUS.ACTIVE,
        'Activated after email verification',
        userId,
      );
    }
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Hợp đồng công khai: Đánh dấu số điện thoại đã được xác minh bằng OTP (Mục 3.2.7) */
  public async markPhoneVerified(userId: number): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }
    user.phoneVerifiedAt = new Date();
    if (Number(user.status) === USER_STATUS.INACTIVE) {
      const prev = parseUserStatus(user.status);
      user.status = USER_STATUS.ACTIVE;
      await this.recordStatusHistory(
        userId,
        prev,
        USER_STATUS.ACTIVE,
        'Activated after phone OTP verification',
        userId,
      );
    }
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
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

  /** Hợp đồng công khai: Cập nhật mật khẩu mới cho người dùng và lưu lịch sử hash mật khẩu cũ (Mục 3.3.5) */
  public async updatePasswordHash(
    userId: number,
    newPasswordHash: string,
    options?: { recordHistory?: boolean; maxHistory?: number },
  ): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }

    if (
      options?.recordHistory !== false &&
      user.passwordHash &&
      user.passwordHash !== newPasswordHash
    ) {
      const maxHistory = Math.max(1, Math.min(20, options?.maxHistory ?? 10));
      const currentHistory = this.parsePasswordHistory(userId, user);
      const nextHistory = [
        user.passwordHash,
        ...currentHistory.filter((h) => h !== user.passwordHash),
      ].slice(0, maxHistory);
      user.passwordHistoryHashesJson = JSON.stringify(nextHistory);
    }

    user.passwordHash = newPasswordHash;
    user.passwordChangedAt = new Date();
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  /** Đăng ký delegate xử lý reset mật khẩu từ PasswordService (module Auth) để tránh phụ thuộc vòng */
  public registerAdminPasswordResetDelegate(
    delegate: (
      userId: number,
      input: AdminResetUserPasswordInput,
      actorId?: number,
    ) => Promise<AdminResetUserPasswordResult>,
  ): void {
    this.adminPasswordResetDelegate = delegate;
  }

  /** Đăng ký delegate thu hồi phiên đăng nhập từ SessionService (module Auth) */
  public registerAdminRevokeSessionsDelegate(
    delegate: (userId: number, reason?: string) => Promise<number>,
  ): void {
    this.adminRevokeSessionsDelegate = delegate;
  }

  /** Đăng ký delegate tra cứu lịch sử đăng nhập & đăng xuất từ SessionService (module Auth) */
  public registerUserLoginHistoryDelegate(
    delegate: (userId: number, limit?: number) => Promise<UserLoginHistoryItemView[]>,
  ): void {
    this.userLoginHistoryDelegate = delegate;
  }

  /** Đăng ký delegate xử lý Reset MFA có kiểm soát từ module Auth (Mục 3.5.8) */
  public registerAdminResetMfaDelegate(
    delegate: (
      userId: number,
      input: AdminResetUserMfaInput,
      actorId?: number,
    ) => Promise<AdminResetUserMfaResult>,
  ): void {
    this.adminResetMfaDelegate = delegate;
  }

  /** Đăng ký delegate kiểm tra Step-Up Token cho thao tác nhạy cảm từ module Auth (Mục 3.5.7) */
  public registerStepUpVerificationDelegate(
    delegate: (userId: number, stepUpToken: string, action?: string) => Promise<boolean>,
  ): void {
    this.stepUpVerificationDelegate = delegate;
  }

  /** Kiểm tra xác thực lại (Step-Up Authentication) khi thực hiện thao tác nhạy cảm (Mục 3.5.7) */
  public async verifySensitiveActionStepUp(
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ): Promise<void> {
    if (!requireStepUp && !stepUpToken) {
      return;
    }
    if (!stepUpToken || !stepUpToken.trim()) {
      throw new ForbiddenAppException('auth.stepUpAuthenticationRequired', [{ action }]);
    }
    if (!this.stepUpVerificationDelegate) {
      return;
    }
    const targetActorId = actorId ?? 0;
    const isValid = await this.stepUpVerificationDelegate(
      targetActorId,
      stepUpToken.trim(),
      action,
    );
    if (!isValid) {
      throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken', [{ action }]);
    }
  }

  /** Reset MFA có kiểm soát từ trang quản trị (Mục 3.5.8 — Có xác minh hoặc phê duyệt) */
  public async adminResetMfa(
    id: number,
    dto: AdminResetUserMfaInput,
    actorId?: number,
  ): Promise<AdminResetUserMfaResult> {
    const reason = dto.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new BadRequestAppException('auth.mfaResetReasonRequired');
    }

    if (dto.stepUpToken) {
      await this.verifySensitiveActionStepUp(actorId, dto.stepUpToken, true, 'users.resetMfa');
    }

    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    if (this.adminResetMfaDelegate) {
      const result = await this.adminResetMfaDelegate(id, dto, actorId);
      await this.invalidateIdentityCache(id);
      return result;
    }

    user.mfaEnabled = false;
    await this.userRepository.saveEntity(user);
    const revokedSessionsCount =
      dto.revokeSessions !== false && this.adminRevokeSessionsDelegate
        ? await this.adminRevokeSessionsDelegate(id, `MFA reset by administrator: ${reason}`)
        : 0;
    await this.invalidateIdentityCache(id);

    return {
      reset: true,
      userId: Number(id),
      revokedSessionsCount,
      revokedTrustedDevicesCount: 0,
      reason,
      verificationReference: dto.verificationReference ?? null,
      resetByActorId: actorId ?? null,
      resetAt: new Date().toISOString(),
    };
  }

  /** Thu hồi toàn bộ phiên đăng nhập của người dùng khi có sự cố (Mục 3.4.6) */
  public async revokeUserSessions(
    id: number,
    reason?: string,
    actorId?: number,
  ): Promise<{
    revoked: true;
    userId: number;
    revokedCount: number;
    revokedSessionsCount: number;
    reason: string;
  }> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    const effectiveReason =
      reason?.trim() ||
      (actorId
        ? `Revoked all sessions by administrator #${actorId} due to security incident`
        : 'Revoked all sessions by administrator due to security incident');

    const revokedCount = this.adminRevokeSessionsDelegate
      ? await this.adminRevokeSessionsDelegate(id, effectiveReason)
      : 0;

    await this.invalidateIdentityCache(id);
    return {
      revoked: true,
      userId: Number(id),
      revokedCount,
      revokedSessionsCount: revokedCount,
      reason: effectiveReason,
    };
  }

  /** Xem lịch sử đăng nhập và đăng xuất của một người dùng theo thời gian, IP và thiết bị (Mục 3.4.7) */
  public async getLoginHistory(id: number, limit = 50): Promise<UserLoginHistoryItemView[]> {
    const user = await this.userRepository.findByIdWithArchived(id, true);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }
    if (!this.userLoginHistoryDelegate) {
      return [];
    }
    return this.userLoginHistoryDelegate(id, limit);
  }

  /** Alias tương thích cho `getLoginHistory()` (Mục 3.4.7) */
  public async getUserLoginHistory(id: number, limit = 50): Promise<UserLoginHistoryItemView[]> {
    return this.getLoginHistory(id, limit);
  }

  /** Đặt lại mật khẩu người dùng từ trang quản trị (Mục 3.3.3 — chỉ người có quyền mới thực hiện) */
  public async adminResetPassword(
    id: number,
    dto: AdminResetUserPasswordInput,
    actorId?: number,
  ): Promise<AdminResetUserPasswordResult> {
    const user = await this.userRepository.findByIdWithArchived(id, false);
    if (!user) {
      throw new NotFoundAppException('users.notFound', { id });
    }

    if (this.adminPasswordResetDelegate) {
      return this.adminPasswordResetDelegate(id, dto, actorId);
    }

    const useSuggested = Boolean(dto.useSuggestedPassword || !dto.newPassword?.trim());
    const plainPassword = useSuggested
      ? this.passwordHasher.generateSuggestedPassword()
      : dto.newPassword!.trim();
    const newHash = await this.passwordHasher.hash(plainPassword);
    await this.updatePasswordHash(id, newHash);
    if (Number(user.status) === USER_STATUS.LOCKED) {
      await this.unlockUser(id, actorId);
    } else if (user.failedLoginAttempts > 0) {
      user.failedLoginAttempts = 0;
      await this.userRepository.saveEntity(user);
    }

    return {
      reset: true,
      userId: Number(id),
      revokedSessionsCount: 0,
      ...(useSuggested ? { generatedPassword: plainPassword } : {}),
    };
  }

  private parsePasswordHistory(_userId: number, user?: UserEntity): string[] {
    if (!user?.passwordHistoryHashesJson) {
      return [];
    }
    const parsed = JSON.parse(user.passwordHistoryHashesJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
    return [];
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

  /** Ghép nối thông tin hồ sơ chi tiết (`user_profiles`), vai trò và đơn vị/chi nhánh cho danh sách UserEntity */
  public async hydrateUsersList(users: readonly UserEntity[]): Promise<UserResponse[]> {
    if (users.length === 0) return [];
    const userIds = users.map((u) => Number(u.id));

    const [allRoleLinks, allOrgLinks, allProfiles] = await Promise.all([
      this.userRoleRepository.findByUserIds(userIds),
      this.userOrgRepository.findByUserIds(userIds),
      this.findProfilesByUserIds(userIds),
    ]);

    const profileByUser = new Map<number, UserProfileEntity>();
    for (const p of allProfiles) {
      profileByUser.set(Number(p.userId), p);
    }

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
        profile: profileByUser.get(Number(user.id)) ?? null,
        roles: rolesByUser.get(Number(user.id)) ?? [],
        organizationUnits: orgsByUser.get(Number(user.id)) ?? [],
        decryptedPhone: this.decryptPhone(user.phone),
      }),
    );
  }

  private async upsertUserProfile(
    userId: number,
    data: Partial<UserProfileEntity>,
  ): Promise<UserProfileEntity> {
    if (!this.userProfileRepository) {
      throw new Error('UserProfileRepository is not initialized');
    }
    return await this.userProfileRepository.upsertByUserId(userId, data);
  }

  private async findProfilesByUserIds(userIds: readonly number[]): Promise<UserProfileEntity[]> {
    if (!this.userProfileRepository) {
      throw new Error('UserProfileRepository is not initialized');
    }
    return await this.userProfileRepository.findByUserIds(userIds);
  }

  private async getUserProfile(userId: number, user?: UserEntity): Promise<UserProfileView> {
    if (!this.userProfileRepository) {
      throw new Error('UserProfileRepository is not initialized');
    }
    const profile = await this.userProfileRepository.findByUserId(userId);

    return {
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
      fullName:
        profile?.fullName ??
        (`${profile?.lastName ?? ''} ${profile?.firstName ?? ''}`.trim() || user?.username || ''),
      avatarUrl: profile?.avatarUrl ?? null,
      dateOfBirth: profile?.dateOfBirth ?? null,
      gender: profile?.gender ?? null,
      identityNumber: profile?.identityNumber ?? null,
      address: profile?.address ?? null,
      city: profile?.city ?? null,
      country: profile?.country ?? null,
      bio: profile?.bio ?? null,
    };
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
    if (!this.statusHistoryRepository) {
      throw new Error('UserStatusHistoryRepository is not initialized');
    }
    await this.statusHistoryRepository.recordTransition({
      userId,
      fromStatus,
      toStatus,
      reason: reason ?? null,
      changedBy: changedBy ?? null,
    });
  }

  /** Đếm số lượng người dùng (chưa bị xóa/lưu trữ) đang sử dụng từng vai trò (Mục 4.1) */
  private async countUsersByRoleIds(roleIds: readonly number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (roleIds.length === 0) return counts;

    const links = await this.loadRoleLinks(roleIds);
    if (links.length === 0) return counts;

    const distinctUserIds = [...new Set(links.map((l) => Number(l.userId)))];
    const activeUserIds = new Set<number>();
    await Promise.all(
      distinctUserIds.map(async (uid) => {
        const u = await this.userRepository.findByIdWithArchived(uid, false);
        if (u && !u.deletedAt && !u.archivedAt && Number(u.status) !== USER_STATUS.ARCHIVED) {
          activeUserIds.add(uid);
        }
      }),
    );

    const seenPairs = new Set<string>();
    for (const link of links) {
      const uid = Number(link.userId);
      const rid = Number(link.roleId);
      if (!activeUserIds.has(uid)) continue;
      const key = `${rid}:${uid}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }
    return counts;
  }

  /** Lấy danh sách người dùng đang được gán một vai trò cụ thể (Mục 4.1) */
  private async listUsersByRoleId(roleId: number): Promise<RoleAssignedUserSummary[]> {
    const links = await this.loadRoleLinks([roleId]);
    if (links.length === 0) return [];

    const assignedAtByUserId = new Map<number, Date>();
    for (const link of links) {
      const uid = Number(link.userId);
      if (!assignedAtByUserId.has(uid)) {
        assignedAtByUserId.set(uid, link.createdAt ?? new Date());
      }
    }

    const userIds = [...assignedAtByUserId.keys()];
    const users: UserEntity[] = [];
    for (const uid of userIds) {
      const u = await this.userRepository.findByIdWithArchived(uid, false);
      if (u && !u.deletedAt && !u.archivedAt && Number(u.status) !== USER_STATUS.ARCHIVED) {
        users.push(u);
      }
    }
    if (users.length === 0) return [];

    const profiles = await this.findProfilesByUserIds(users.map((u) => Number(u.id)));
    const profileMap = new Map<number, UserProfileEntity>();
    for (const p of profiles) {
      profileMap.set(Number(p.userId), p);
    }

    return users.map((u) => {
      const uid = Number(u.id);
      const prof = profileMap.get(uid);
      const statusCode = parseUserStatus(u.status);
      const assignedAt = assignedAtByUserId.get(uid) ?? u.createdAt ?? new Date();
      return {
        id: uid,
        username: u.username,
        email: u.email ?? '',
        fullName:
          prof?.fullName || `${prof?.lastName ?? ''} ${prof?.firstName ?? ''}`.trim() || u.username,
        status: statusCode,
        statusName: getUserStatusName(statusCode),
        primaryOrganizationUnitId:
          u.primaryOrganizationUnitId !== undefined && u.primaryOrganizationUnitId !== null
            ? Number(u.primaryOrganizationUnitId)
            : null,
        assignedAt: assignedAt.toISOString(),
      };
    });
  }

  private async loadRoleLinks(roleIds: readonly number[]) {
    if (typeof this.userRoleRepository.findByRoleIds === 'function') {
      return this.userRoleRepository.findByRoleIds(roleIds);
    }
    if (typeof this.userRoleRepository.findUserIdsByRoleIds === 'function') {
      const uids = await this.userRoleRepository.findUserIdsByRoleIds(roleIds);
      const allLinks = await this.userRoleRepository.findByUserIds(uids);
      const roleSet = new Set(roleIds.map(Number));
      return allLinks.filter((l) => roleSet.has(Number(l.roleId)));
    }
    return [];
  }

  /** Xóa cache danh tính người dùng trên Redis khi thông tin quyền/trạng thái thay đổi */
  private async invalidateIdentityCache(userId: number): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.del(`${USER_IDENTITY_CACHE_PREFIX}${userId}`).catch(() => undefined);
  }
}
