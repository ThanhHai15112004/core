export const USER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  LOCKED: 3,
  ARCHIVED: 4,
} as const;

export type UserStatusCode = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export type UserStatusName = keyof typeof USER_STATUS;

export function parseUserStatus(val: unknown): UserStatusCode {
  if (typeof val === 'number' && (val === 1 || val === 2 || val === 3 || val === 4)) {
    return val;
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (num === 1 || num === 2 || num === 3 || num === 4) return num;
    const upper = val.trim().toUpperCase();
    if (upper === 'INACTIVE') return USER_STATUS.INACTIVE;
    if (upper === 'LOCKED') return USER_STATUS.LOCKED;
    if (upper === 'ARCHIVED') return USER_STATUS.ARCHIVED;
  }
  return USER_STATUS.ACTIVE;
}

export function getUserStatusName(code: number): UserStatusName {
  switch (code) {
    case USER_STATUS.INACTIVE:
      return 'INACTIVE';
    case USER_STATUS.LOCKED:
      return 'LOCKED';
    case USER_STATUS.ARCHIVED:
      return 'ARCHIVED';
    case USER_STATUS.ACTIVE:
    default:
      return 'ACTIVE';
  }
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
}

export interface UserAuthCredentialsView {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
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
  readonly phone: string | null;
  readonly status: UserStatusCode;
  readonly statusName: UserStatusName;
  readonly lockedUntil: Date | null;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: number | null;
  readonly organizationUnitIds: readonly number[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface IUsersPublicService {
  findAuthUserByIdentifier(identifier: string): Promise<UserAuthCredentialsView | null>;
  findAuthUserById(userId: number): Promise<UserAuthIdentityView | null>;
  recordLoginSuccess(userId: number): Promise<void>;
  recordLoginFailure(
    userId: number,
    maxAttempts: number,
    lockDurationMinutes: number,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }>;
  autoUnlockExpiredLock(userId: number): Promise<void>;
  updatePasswordHash(userId: number, newPasswordHash: string): Promise<void>;
  setMfaEnabled(userId: number, enabled: boolean): Promise<void>;
}

export const USERS_PUBLIC_SERVICE = Symbol('USERS_PUBLIC_SERVICE');
