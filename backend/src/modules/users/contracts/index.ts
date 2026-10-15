export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export interface UserOrganizationAssignmentSummary {
  readonly organizationUnitId: string;
  readonly code?: string;
  readonly name?: string;
  readonly type?: string;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
}

export interface UserRoleAssignmentSummary {
  readonly roleId: string;
  readonly code: string;
  readonly name: string;
}

export interface UserAuthCredentialsView {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly lockedUntil: Date | null;
  readonly lockReason: string | null;
  readonly failedLoginAttempts: number;
  readonly mfaEnabled: boolean;
  readonly archivedAt: Date | null;
}

export interface UserAuthIdentityView {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly status: UserStatus;
  readonly lockedUntil: Date | null;
  readonly mfaEnabled: boolean;
  readonly primaryOrganizationUnitId: string | null;
  readonly organizationUnitIds: readonly string[];
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface IUsersPublicService {
  findAuthUserByIdentifier(identifier: string): Promise<UserAuthCredentialsView | null>;
  findAuthUserById(userId: string): Promise<UserAuthIdentityView | null>;
  recordLoginSuccess(userId: string): Promise<void>;
  recordLoginFailure(
    userId: string,
    maxAttempts: number,
    lockDurationMinutes: number,
  ): Promise<{ failedAttempts: number; locked: boolean; lockedUntil: Date | null }>;
  autoUnlockExpiredLock(userId: string): Promise<void>;
  updatePasswordHash(userId: string, newPasswordHash: string): Promise<void>;
  setMfaEnabled(userId: string, enabled: boolean): Promise<void>;
}

export const USERS_PUBLIC_SERVICE = Symbol('USERS_PUBLIC_SERVICE');
