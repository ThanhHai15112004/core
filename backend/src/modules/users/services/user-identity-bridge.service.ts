import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { ForbiddenAppException, NotFoundAppException } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  PasswordHasherService,
  TokenService,
} from '@packages/security/index.js';
import {
  type IOrganizationMembersPublicService,
  type IOrganizationMembersUnitPersistenceContract,
  ORGANIZATION_MEMBERS_PUBLIC_SERVICE,
} from '@modules/organization-members/index.js';
import {
  type IRolesPublicService,
  ROLES_PUBLIC_SERVICE,
  type RoleAssignedUserSummary,
} from '@modules/roles/contracts/index.js';
import {
  type SelfRegisterUserInput,
  USER_IDENTITY_CACHE_PREFIX,
  type UpdateUserPreferencesInput,
  type UserAuthCredentialsView,
  type UserAuthIdentityView,
  type UserCredentialRecordView,
  type UserNotificationContactView,
  type UserPreferencesView,
  type UserProfileView,
  type UserStatusCode,
  normalizePhoneNumber,
} from '../contracts/index.js';
import type { UserProfileEntity } from '../entities/user-profile.entity.js';
import type { UserEntity } from '../entities/user.entity.js';
import {
  buildUserAuthCredentialsView,
  buildUserAuthIdentityView,
  executeSelfRegisterUser,
  executeUpdateUserPasswordHash,
  markUserChannelVerified,
  recordUserLoginAttemptState,
  resolveUserPreferencesView,
  resolveUserProfileView,
  updateUserPreferencesRecord,
} from '../helpers/user-auth-bridge.helper.js';
import {
  normalizePreferredLocaleOrThrow,
  normalizePreferredTimezoneOrThrow,
} from '../helpers/user-normalizer.helper.js';
import {
  countActiveUsersByRoleIds,
  filterActiveUserIds,
  listActiveUsersByRoleId,
  resolveActiveUserIdsByOrganizationUnitIds,
  resolveActiveUserIdsByRoleIds,
  resolveUserNotificationContacts,
} from '../helpers/user-profile-hydration.helper.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
import { UserStatusHistoryRepository } from '../repositories/user-status-history.repository.js';
import { UserRepository } from '../repositories/user.repository.js';

@Injectable()
export class UserIdentityBridgeService {
  constructor(
    private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_MEMBERS_PUBLIC_SERVICE)
    private readonly userOrgRepository: IOrganizationMembersUnitPersistenceContract &
      Partial<IOrganizationMembersPublicService>,
    private readonly passwordHasher: PasswordHasherService,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Optional()
    @Inject(UserStatusHistoryRepository)
    private readonly statusHistoryRepository: UserStatusHistoryRepository | null = null,
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fieldEncryption: FieldEncryptionService | null = null,
    @Optional()
    @Inject(RedisService)
    private readonly redis: RedisService | null = null,
    @Optional()
    @Inject(UserProfileRepository)
    private readonly userProfileRepository: UserProfileRepository | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(TokenService)
    private readonly tokenService: TokenService | null = null,
  ) {}

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

  public async findAuthCredentialsByUserId(
    userId: number,
  ): Promise<UserAuthCredentialsView | null> {
    const user = await this.userRepository.findByIdWithArchived(userId, true);
    if (!user) return null;
    return this.toAuthCredentialsView(user);
  }

  public async toAuthCredentialsView(user: UserEntity): Promise<UserAuthCredentialsView> {
    return buildUserAuthCredentialsView({
      user,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      getUserCredential: (uid) => this.getUserCredential(uid),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  public async findAuthUserById(userId: number): Promise<UserAuthIdentityView | null> {
    return buildUserAuthIdentityView({
      userId,
      userRepository: this.userRepository,
      userOrgRepository: this.userOrgRepository,
      rolesPublicService: this.rolesPublicService,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  public async getUserPreferences(userId: number): Promise<UserPreferencesView> {
    return resolveUserPreferencesView({
      userId,
      userRepository: this.userRepository,
      userProfileRepository: this.userProfileRepository,
    });
  }

  public async updateUserPreferences(
    userId: number,
    input: UpdateUserPreferencesInput,
  ): Promise<UserPreferencesView> {
    return updateUserPreferencesRecord({
      userId,
      input,
      userRepository: this.userRepository,
      getUserProfile: (uid, u) => this.getUserProfile(uid, u),
      normalizePreferredLocale: (l) => normalizePreferredLocaleOrThrow(l),
      normalizePreferredTimezone: (tz) => normalizePreferredTimezoneOrThrow(tz),
      upsertUserProfile: (uid, d) => this.upsertUserProfile(uid, d),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
      auditLogService: this.auditLogService,
    });
  }

  public async registerSelfUser(input: SelfRegisterUserInput): Promise<UserAuthIdentityView> {
    return executeSelfRegisterUser({
      input,
      userRepository: this.userRepository,
      passwordHasher: this.passwordHasher,
      encryptPhone: (p) => this.encryptPhone(p),
      normalizePreferredLocale: (l) => normalizePreferredLocaleOrThrow(l),
      normalizePreferredTimezone: (tz) => normalizePreferredTimezoneOrThrow(tz),
      upsertUserProfile: (uid, d) => this.upsertUserProfile(uid, d),
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      saveUserPasswordHash: (uid, hash, opts) => this.saveUserPasswordHash(uid, hash, opts),
      findAuthUserById: (uid) => this.findAuthUserById(uid),
    });
  }

  public async markEmailVerified(userId: number): Promise<void> {
    await markUserChannelVerified({
      userId,
      channel: 'EMAIL',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async markPhoneVerified(userId: number): Promise<void> {
    await markUserChannelVerified({
      userId,
      channel: 'PHONE',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async recordLoginSuccess(userId: number): Promise<void> {
    await recordUserLoginAttemptState({
      userId,
      outcome: 'SUCCESS',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async recordLoginFailure(
    userId: number,
    maxAttempts = 5,
    lockDurationMinutes = 15,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }> {
    return recordUserLoginAttemptState({
      userId,
      outcome: 'FAILURE',
      maxAttempts,
      lockDurationMinutes,
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async autoUnlockExpiredLock(userId: number): Promise<void> {
    await recordUserLoginAttemptState({
      userId,
      outcome: 'AUTO_UNLOCK',
      userRepository: this.userRepository,
      recordStatusHistory: (uid, from, to, r, by) => this.recordStatusHistory(uid, from, to, r, by),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async updatePasswordHash(
    userId: number,
    newPasswordHash: string,
    options?: { recordHistory?: boolean; maxHistory?: number },
  ): Promise<void> {
    await executeUpdateUserPasswordHash({
      userId,
      newPasswordHash,
      options,
      userRepository: this.userRepository,
      saveUserPasswordHash: (uid, hash, opts) => this.saveUserPasswordHash(uid, hash, opts),
      invalidateIdentityCache: (uid) => this.invalidateIdentityCache(uid),
    });
  }

  public async getUserCredential(userId: number): Promise<UserCredentialRecordView | null> {
    const uid = Number(userId);
    const credentialStore = this.passwordHasher?.getCredentialStoreAdapter?.();
    if (!credentialStore) return null;
    return credentialStore.getByUserId(uid);
  }

  public async findCredentialsByUserIds(
    userIds: readonly number[],
  ): Promise<ReadonlyMap<number, UserCredentialRecordView>> {
    const result = new Map<number, UserCredentialRecordView>();
    if (userIds.length === 0) return result;
    const credentialStore = this.passwordHasher?.getCredentialStoreAdapter?.();
    if (credentialStore?.getByUserIds) {
      const map = await credentialStore.getByUserIds(userIds);
      for (const [uid, val] of map.entries()) {
        result.set(Number(uid), val);
      }
      return result;
    }
    for (const rawId of userIds) {
      const uid = Number(rawId);
      const cred = await this.getUserCredential(uid);
      if (cred) {
        result.set(uid, cred);
      }
    }
    return result;
  }

  public async saveUserPasswordHash(
    userId: number,
    passwordHash: string,
    options?: {
      readonly recordHistory?: boolean;
      readonly maxHistory?: number;
      readonly passwordChangedAt?: Date | null;
    },
  ): Promise<void> {
    const uid = Number(userId);
    const changedAt =
      options?.passwordChangedAt !== undefined ? options.passwordChangedAt : new Date();
    const credentialStore = this.passwordHasher?.getCredentialStoreAdapter?.();
    if (credentialStore) {
      await credentialStore.saveUserPasswordHash(uid, passwordHash, {
        ...(options?.recordHistory !== undefined ? { recordHistory: options.recordHistory } : {}),
        ...(options?.maxHistory !== undefined ? { maxHistory: options.maxHistory } : {}),
        passwordChangedAt: changedAt,
      });
    }
  }

  public async verifySensitiveActionStepUp(
    actorId?: number,
    stepUpToken?: string,
    requireStepUp?: boolean,
    action?: string,
  ): Promise<void> {
    if (!requireStepUp && !stepUpToken) return;
    if (!stepUpToken || !stepUpToken.trim()) {
      throw new ForbiddenAppException('auth.stepUpAuthenticationRequired', [{ action }]);
    }
    const effectiveTokenService = this.tokenService ?? new TokenService(new CoreConfigService());
    const isValid = await effectiveTokenService.verifyStepUpActionToken(
      actorId ?? 0,
      stepUpToken.trim(),
      action,
    );
    if (!isValid) {
      throw new ForbiddenAppException('auth.invalidOrExpiredStepUpToken', [{ action }]);
    }
  }

  public async setMfaEnabled(userId: number, enabled: boolean): Promise<void> {
    const user = await this.userRepository.findByIdWithArchived(userId, false);
    if (!user) throw new NotFoundAppException('users.notFound', { id: userId });
    user.mfaEnabled = enabled;
    await this.userRepository.saveEntity(user);
    await this.invalidateIdentityCache(userId);
  }

  public async upsertUserProfile(
    userId: number,
    data: Partial<UserProfileEntity>,
  ): Promise<UserProfileEntity> {
    if (!this.userProfileRepository) throw new Error('UserProfileRepository is not initialized');
    return await this.userProfileRepository.upsertByUserId(userId, data);
  }

  public async findProfilesByUserIds(userIds: readonly number[]): Promise<UserProfileEntity[]> {
    if (!this.userProfileRepository) throw new Error('UserProfileRepository is not initialized');
    return await this.userProfileRepository.findByUserIds(userIds);
  }

  public async getUserProfile(userId: number, user?: UserEntity): Promise<UserProfileView> {
    return resolveUserProfileView({
      userId,
      user,
      userProfileRepository: this.userProfileRepository,
    });
  }

  public encryptPhone(phone?: string | null): string | null {
    if (!phone || !phone.trim()) return null;
    const trimmed = phone.trim();
    return this.fieldEncryption ? this.fieldEncryption.encrypt(trimmed) : trimmed;
  }

  public decryptPhone(phone?: string | null): string | null {
    if (!phone) return null;
    return this.fieldEncryption ? this.fieldEncryption.decrypt(phone) : phone;
  }

  public async recordStatusHistory(
    userId: number,
    fromStatus: UserStatusCode | null,
    toStatus: UserStatusCode,
    reason?: string | null,
    changedBy?: number | null,
  ): Promise<void> {
    if (!this.statusHistoryRepository)
      throw new Error('UserStatusHistoryRepository is not initialized');
    await this.statusHistoryRepository.recordTransition({
      userId,
      fromStatus,
      toStatus,
      reason: reason ?? null,
      changedBy: changedBy ?? null,
    });
  }

  public async countUsersByRoleIds(roleIds: readonly number[]): Promise<Map<number, number>> {
    return countActiveUsersByRoleIds({
      roleIds,
      rolesPublicService: this.rolesPublicService,
      userRepository: this.userRepository,
    });
  }

  public async listUsersByRoleId(roleId: number): Promise<RoleAssignedUserSummary[]> {
    return listActiveUsersByRoleId({
      roleId,
      rolesPublicService: this.rolesPublicService,
      userRepository: this.userRepository,
      findProfilesByUserIds: (uids) => this.findProfilesByUserIds(uids),
    });
  }

  public async findActiveUserIdsByIds(userIds: readonly number[]): Promise<number[]> {
    return filterActiveUserIds(this.userRepository, userIds);
  }

  public async findActiveUserIdsByRoleIds(roleIds: readonly number[]): Promise<number[]> {
    return resolveActiveUserIdsByRoleIds({
      roleIds,
      rolesPublicService: this.rolesPublicService,
      userRepository: this.userRepository,
    });
  }

  public async findActiveUserIdsByOrganizationUnitIds(
    unitIds: readonly number[],
  ): Promise<number[]> {
    return resolveActiveUserIdsByOrganizationUnitIds({
      unitIds,
      userOrgRepository: this.userOrgRepository,
      userRepository: this.userRepository,
    });
  }

  public async findUserContactsByIds(
    userIds: readonly number[],
  ): Promise<UserNotificationContactView[]> {
    return resolveUserNotificationContacts({
      userIds,
      userRepository: this.userRepository,
      findProfilesByUserIds: (uids) => this.findProfilesByUserIds(uids),
      decryptPhone: (p) => this.decryptPhone(p),
    });
  }

  public async invalidateIdentityCache(userId: number): Promise<void> {
    if (!this.redis?.isReady()) return;
    await this.redis.client.del(`${USER_IDENTITY_CACHE_PREFIX}${userId}`).catch(() => undefined);
  }
}
