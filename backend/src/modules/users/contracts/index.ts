export {
  USER_STATUS,
  type UserStatusCode,
  type UserStatusName,
  USER_GENDER,
  type UserGenderCode,
  type UserGenderName,
  USER_IDENTITY_CACHE_PREFIX,
  USERS_CODE_TYPES,
  USERS_SETTING_KEYS,
  USERS_AUDIT_META,
} from '../enum/users.enum.js';

export {
  parseUserStatus,
  getUserStatusName,
  parseUserGender,
  getUserGenderName,
  resolveVietnameseNameParts,
  normalizePhoneNumber,
} from '../helpers/user-normalizer.helper.js';

import type { UserStatusCode, UserStatusName } from '../enum/users.enum.js';

export interface UserProfileView {
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly dateOfBirth: string | null;
  readonly gender: number | null;
  readonly identityNumber: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly bio: string | null;
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
}

export interface UserPreferencesView {
  readonly userId: number;
  readonly preferredLocale: string;
  readonly preferredTimezone: string;
  readonly updatedAt: string;
}

export interface UpdateUserPreferencesInput {
  readonly preferredLocale?: string | undefined;
  readonly preferredTimezone?: string | undefined;
}

export type UserOrganizationHistoryActionType = 'ASSIGN' | 'TRANSFER' | 'UPDATE' | 'END';

export interface UserOrganizationAssignmentSummary {
  readonly organizationUnitId: number;
  readonly code?: string;
  readonly name?: string;
  readonly type?: number;
  readonly typeName?: string;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface UserOrganizationHistoryItemView {
  readonly id: number;
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly organizationUnitCode?: string | null;
  readonly organizationUnitName?: string | null;
  readonly fromOrganizationUnitId: number | null;
  readonly fromOrganizationUnitCode?: string | null;
  readonly fromOrganizationUnitName?: string | null;
  readonly actionType: UserOrganizationHistoryActionType;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly reason: string | null;
  readonly changedBy: number | null;
  readonly createdAt: string;
}

export interface UserSubordinateSummaryView {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly primaryOrganizationUnitId: number | null;
  readonly primaryOrganizationUnitName?: string | null;
  readonly positionTitle: string | null;
  readonly managerId: number | null;
  readonly temporaryManagerId: number | null;
  readonly temporaryManagerFrom: string | null;
  readonly temporaryManagerUntil: string | null;
  readonly effectiveManagerId: number | null;
  readonly relationType: 'DIRECT' | 'TEMPORARY' | 'INDIRECT';
  readonly level: number;
}

export interface UserApproverSummaryView {
  readonly step: number;
  readonly userId: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: UserStatusCode;
  readonly primaryOrganizationUnitId: number | null;
  readonly positionTitle: string | null;
  readonly sourceType: 'DIRECT_MANAGER' | 'TEMPORARY_MANAGER';
}

export interface UserRoleAssignmentSummary {
  readonly roleId: number;
  readonly code: string;
  readonly name: string;
  readonly dataScope?: number;
  readonly dataScopeName?: string;
}

export interface UserAuthCredentialsView {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly phone: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly passwordHistoryHashes?: readonly string[];
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly emailVerifiedAt: Date | null;
  readonly phoneVerifiedAt: Date | null;
  readonly lockedUntil: Date | null;
  readonly lockReason: string | null;
  readonly failedLoginAttempts: number;
  readonly mfaEnabled: boolean;
  readonly archivedAt: Date | null;
}

export interface UserAuthIdentityView {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly avatarUrl?: string | null;
  readonly phone: string | null;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly emailVerifiedAt?: Date | null;
  readonly phoneVerifiedAt?: Date | null;
  readonly lockedUntil: Date | null;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: number | null;
  readonly managerId?: number | null;
  readonly temporaryManagerId?: number | null;
  readonly temporaryManagerFrom?: Date | string | null;
  readonly temporaryManagerUntil?: Date | string | null;
  readonly effectiveManagerId?: number | null;
  readonly organizationUnitIds: readonly number[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly dataScope?: number;
  readonly dataScopes?: readonly number[];
  readonly preferredLocale?: string;
  readonly preferredTimezone?: string;
  readonly profile?: UserProfileView;
}

export interface SelfRegisterUserInput {
  readonly username?: string | undefined;
  readonly email?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly password: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly fullName?: string | undefined;
  readonly avatarUrl?: string | null | undefined;
  readonly dateOfBirth?: string | null | undefined;
  readonly gender?: number | null | undefined;
  readonly address?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly country?: string | null | undefined;
  readonly bio?: string | null | undefined;
  readonly preferredLocale?: string | null | undefined;
  readonly preferredTimezone?: string | null | undefined;
  readonly status?: UserStatusCode | undefined;
}

export interface AdminResetUserPasswordInput {
  readonly newPassword?: string | undefined;
  readonly useSuggestedPassword?: boolean | undefined;
  readonly revokeSessions?: boolean | undefined;
}

export interface AdminResetUserPasswordResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly generatedPassword?: string;
}

export interface UserLoginHistoryItemView {
  readonly id: number;
  readonly userId: number | null;
  readonly sessionId: number | null;
  readonly identifier: string | null;
  readonly eventType: number;
  readonly eventTypeName: string;
  readonly status: number;
  readonly statusName: 'SUCCESS' | 'FAILED';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface AdminResetUserMfaInput {
  readonly reason: string;
  readonly verificationReference?: string | undefined;
  readonly revokeSessions?: boolean | undefined;
  readonly stepUpToken?: string | undefined;
}

export interface AdminResetUserMfaResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly revokedTrustedDevicesCount: number;
  readonly reason: string;
  readonly verificationReference?: string | null;
  readonly resetByActorId?: number | null;
  readonly resetAt: string;
}

export interface UserNotificationContactView {
  readonly id: number;
  readonly username: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly fullName: string;
  readonly preferredLocale: string;
  readonly preferredTimezone: string;
  readonly primaryOrganizationUnitId: number | null;
}

export interface IUsersPublicService {
  findAuthUserByIdentifier(identifier: string): Promise<UserAuthCredentialsView | null>;
  findAuthCredentialsByUserId?(userId: number): Promise<UserAuthCredentialsView | null>;
  findAuthUserById(userId: number): Promise<UserAuthIdentityView | null>;
  registerSelfUser(input: SelfRegisterUserInput): Promise<UserAuthIdentityView>;
  markEmailVerified(userId: number): Promise<void>;
  markPhoneVerified(userId: number): Promise<void>;
  recordLoginSuccess(userId: number): Promise<void>;
  recordLoginFailure(
    userId: number,
    maxAttempts: number,
    lockDurationMinutes: number,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }>;
  autoUnlockExpiredLock(userId: number): Promise<void>;
  updatePasswordHash(
    userId: number,
    newPasswordHash: string,
    options?: { recordHistory?: boolean; maxHistory?: number },
  ): Promise<void>;
  setMfaEnabled(userId: number, enabled: boolean): Promise<void>;
  getUserPreferences?(userId: number): Promise<UserPreferencesView>;
  updateUserPreferences?(
    userId: number,
    input: UpdateUserPreferencesInput,
  ): Promise<UserPreferencesView>;
  registerAdminPasswordResetDelegate?(
    delegate: (
      userId: number,
      input: AdminResetUserPasswordInput,
      actorId?: number,
    ) => Promise<AdminResetUserPasswordResult>,
  ): void;
  registerAdminRevokeSessionsDelegate?(
    delegate: (userId: number, reason?: string) => Promise<number>,
  ): void;
  registerUserLoginHistoryDelegate?(
    delegate: (userId: number, limit?: number) => Promise<UserLoginHistoryItemView[]>,
  ): void;
  registerAdminResetMfaDelegate?(
    delegate: (
      userId: number,
      input: AdminResetUserMfaInput,
      actorId?: number,
    ) => Promise<AdminResetUserMfaResult>,
  ): void;
  registerStepUpVerificationDelegate?(
    delegate: (userId: number, stepUpToken: string, action?: string) => Promise<boolean>,
  ): void;
  findActiveUserIdsByIds?(userIds: readonly number[]): Promise<number[]>;
  findActiveUserIdsByRoleIds?(roleIds: readonly number[]): Promise<number[]>;
  findActiveUserIdsByOrganizationUnitIds?(unitIds: readonly number[]): Promise<number[]>;
  findUserContactsByIds?(userIds: readonly number[]): Promise<UserNotificationContactView[]>;
  resolveSubordinateUserIds?(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]>;
  listSubordinates?(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<UserSubordinateSummaryView[]>;
  resolveApproverChain?(userId: number, maxLevels?: number): Promise<UserApproverSummaryView[]>;
}

export const USERS_PUBLIC_SERVICE = Symbol('USERS_PUBLIC_SERVICE');
