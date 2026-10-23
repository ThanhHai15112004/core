import type {
  UserOrganizationAssignmentSummary,
  UserProfileView,
  UserRoleAssignmentSummary,
  UserStatusCode,
} from '../contracts/index.js';
import type { CreateUserRequest } from '../requests/users.requests.js';

export type UserStatusTransitionAction =
  | 'user.lock'
  | 'user.unlock'
  | 'user.deactivate'
  | 'user.activate'
  | 'user.archive'
  | 'user.restore';

export interface PreparedCreateUserContext {
  readonly normalizedEmail: string;
  readonly finalUsername: string;
  readonly normalizedPhone: string | null;
  readonly phoneHash: string | null;
  readonly roleIds: number[];
  readonly orgInputs: NonNullable<CreateUserRequest['organizationUnits']>;
}

export interface PreparedUpdateUserFields {
  readonly nextFirstName: string;
  readonly nextLastName: string;
  readonly nextFullName: string;
}

export interface UserStatusTransitionOptions {
  readonly id: number;
  readonly toStatus: UserStatusCode;
  readonly action: UserStatusTransitionAction;
  readonly reason: string;
  readonly actorId?: number | undefined;
  readonly lockedUntil?: Date | null | undefined;
  readonly lockReason?: string | null | undefined;
  readonly preserveLockReason?: boolean | undefined;
  readonly archiveTimestamp?: Date | null | undefined;
  readonly resetFailedAttempts?: boolean | undefined;
}

export interface HydratedUserContext {
  readonly profile: UserProfileView | null;
  readonly roles: readonly UserRoleAssignmentSummary[];
  readonly organizationUnits: readonly UserOrganizationAssignmentSummary[];
  readonly decryptedPhone: string | null;
}
