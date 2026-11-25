import {
  type CreateDomainEventInput,
  type DomainEvent,
  createDomainEvent,
} from '@packages/kernel/index.js';
import type { UserResponse } from '../responses/users.response.js';

export const USER_DOMAIN_EVENT_TYPES = {
  CREATED: 'UserCreated',
  UPDATED: 'UserUpdated',
  LOCKED: 'UserLocked',
  UNLOCKED: 'UserUnlocked',
  DEACTIVATED: 'UserDeactivated',
  ACTIVATED: 'UserActivated',
  ARCHIVED: 'UserArchived',
  RESTORED: 'UserRestored',
  ROLES_ASSIGNED: 'UserRolesAssigned',
  ORGANIZATIONS_ASSIGNED: 'UserOrganizationsAssigned',
} as const;

export type UserDomainEventType =
  (typeof USER_DOMAIN_EVENT_TYPES)[keyof typeof USER_DOMAIN_EVENT_TYPES];

/** Payload tối giản của `UserCreated` — tuyệt đối không chứa ORM Entity hay passwordHash/secret. */
export interface UserCreatedEventPayload extends Record<string, unknown> {
  readonly userId: number;
  readonly username: string;
  readonly status: number;
  readonly primaryOrganizationUnitId: number | null;
  readonly roleIds: readonly number[];
}

/** Payload tối giản của `UserUpdated` — chỉ gồm định danh và danh sách tên trường đã cập nhật. */
export interface UserUpdatedEventPayload extends Record<string, unknown> {
  readonly userId: number;
  readonly username: string;
  readonly status: number;
  readonly changedFields: readonly string[];
}

export function buildUserCreatedEventInput(
  user: Pick<UserResponse, 'id' | 'username' | 'status' | 'primaryOrganizationUnitId'> & {
    readonly roles?:
      | readonly {
          readonly roleId: number;
          readonly code?: string | undefined;
          readonly name?: string | undefined;
        }[]
      | undefined;
  },
  actorId?: number | null,
): CreateDomainEventInput<UserCreatedEventPayload> {
  return {
    type: USER_DOMAIN_EVENT_TYPES.CREATED,
    dotName: 'user.created',
    version: 1,
    sourceModule: 'users',
    aggregateType: 'User',
    aggregateId: String(user.id),
    actorId: actorId ?? null,
    payload: {
      userId: user.id,
      username: user.username,
      status: user.status,
      primaryOrganizationUnitId: user.primaryOrganizationUnitId ?? null,
      roleIds: Array.isArray(user.roles)
        ? user.roles.map((r) => Number(r.roleId)).filter((roleId) => Number.isFinite(roleId))
        : [],
    },
  };
}

export function buildUserUpdatedEventInput(
  user: Pick<UserResponse, 'id' | 'username' | 'status'>,
  changedFields: readonly string[],
  actorId?: number | null,
): CreateDomainEventInput<UserUpdatedEventPayload> {
  return {
    type: USER_DOMAIN_EVENT_TYPES.UPDATED,
    dotName: 'user.updated',
    version: 1,
    sourceModule: 'users',
    aggregateType: 'User',
    aggregateId: String(user.id),
    actorId: actorId ?? null,
    payload: {
      userId: user.id,
      username: user.username,
      status: user.status,
      changedFields: [...changedFields],
    },
  };
}

export function createUserCreatedEvent(
  user: Pick<UserResponse, 'id' | 'username' | 'status' | 'primaryOrganizationUnitId' | 'roles'>,
  actorId?: number | null,
): DomainEvent<UserCreatedEventPayload> {
  return createDomainEvent(buildUserCreatedEventInput(user, actorId));
}
