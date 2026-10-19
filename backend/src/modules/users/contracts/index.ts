import { defaultCodeRegistry } from '@packages/kernel/index.js';

export const USER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  LOCKED: 3,
  ARCHIVED: 4,
} as const;

export type UserStatusCode = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export type UserStatusName = keyof typeof USER_STATUS;

export const USER_GENDER = {
  MALE: 1,
  FEMALE: 2,
  OTHER: 3,
} as const;

export type UserGenderCode = (typeof USER_GENDER)[keyof typeof USER_GENDER];
export type UserGenderName = keyof typeof USER_GENDER;

/**
 * Phân giải trạng thái người dùng thông qua CodeRegistryService (`users.status`).
 * Không còn hardcode chuỗi từ khóa tiếng Việt trong code — toàn bộ aliases được quản lý động tại `code_values`.
 */
export function parseUserStatus(val: unknown): UserStatusCode {
  if (val === 0 || val === '0') {
    return USER_STATUS.INACTIVE;
  }
  const resolved = defaultCodeRegistry.parseToNumericCode('users.status', val, USER_STATUS.ACTIVE);
  if (resolved === 1 || resolved === 2 || resolved === 3 || resolved === 4) {
    return resolved;
  }
  const behavior = defaultCodeRegistry.resolveBehaviorCode('users.status', resolved);
  if (behavior === 'INACTIVE') return USER_STATUS.INACTIVE;
  if (behavior === 'LOCKED') return USER_STATUS.LOCKED;
  if (behavior === 'ARCHIVED') return USER_STATUS.ARCHIVED;
  return USER_STATUS.ACTIVE;
}

/**
 * Tra cứu tên mã trạng thái người dùng từ `users.status` (O(1) L1 Lookup).
 */
export function getUserStatusName(code: number): UserStatusName {
  const behavior = defaultCodeRegistry.resolveBehaviorCode('users.status', code);
  if (behavior === 'INACTIVE' || behavior === 'LOCKED' || behavior === 'ARCHIVED') {
    return behavior;
  }
  return 'ACTIVE';
}

/**
 * Phân giải giới tính người dùng thông qua CodeRegistryService (`users.gender`).
 */
export function parseUserGender(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  return defaultCodeRegistry.parseToNumericCode('users.gender', val, USER_GENDER.OTHER);
}

/**
 * Tra cứu tên mã giới tính từ `users.gender`.
 */
export function getUserGenderName(code?: number | null): string | null {
  if (code === undefined || code === null) return null;
  return defaultCodeRegistry.getCodeName('users.gender', code, 'OTHER');
}

/**
 * Tách hoặc chuẩn hóa firstName, lastName và fullName theo chuẩn tiếng Việt
 * (lastName = Họ và tên đệm, firstName = Tên gọi)
 */
export function resolveVietnameseNameParts(input: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  fullName?: string | null | undefined;
}): { firstName: string; lastName: string; fullName: string } {
  const rawFirst = input.firstName?.trim() ?? '';
  const rawLast = input.lastName?.trim() ?? '';
  const rawFull = input.fullName?.trim() ?? '';

  if (rawFirst && rawLast) {
    return {
      firstName: rawFirst,
      lastName: rawLast,
      fullName: rawFull || `${rawLast} ${rawFirst}`.trim(),
    };
  }

  if (rawFull) {
    const parts = rawFull.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return {
        firstName: rawFirst || parts[0]!,
        lastName: rawLast || parts[0]!,
        fullName: rawFull,
      };
    }
    const first = rawFirst || parts[parts.length - 1]!;
    const last = rawLast || parts.slice(0, -1).join(' ');
    return {
      firstName: first,
      lastName: last,
      fullName: rawFull,
    };
  }

  const fallbackFirst = rawFirst || 'User';
  const fallbackLast = rawLast || 'Core';
  return {
    firstName: fallbackFirst,
    lastName: fallbackLast,
    fullName: `${fallbackLast} ${fallbackFirst}`.trim(),
  };
}

/**
 * Chuẩn hóa số điện thoại về định dạng thống nhất (ví dụ +84909123456 -> 0909123456)
 * phục vụ tạo mã băm SHA-256 (blind index `phone_hash`) và tra cứu đăng nhập/đăng ký.
 */
export function normalizePhoneNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.trim().replace(/[\s.\-()]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+84')) {
    return `0${cleaned.slice(3)}`;
  }
  if (cleaned.startsWith('84') && cleaned.length >= 10 && cleaned.length <= 12) {
    return `0${cleaned.slice(2)}`;
  }
  return cleaned;
}

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
}

export interface UserOrganizationAssignmentSummary {
  readonly organizationUnitId: number;
  readonly code?: string;
  readonly name?: string;
  readonly type?: number;
  readonly typeName?: string;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
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
  readonly organizationUnitIds: readonly number[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly dataScope?: number;
  readonly dataScopes?: readonly number[];
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
}

export const USERS_PUBLIC_SERVICE = Symbol('USERS_PUBLIC_SERVICE');
