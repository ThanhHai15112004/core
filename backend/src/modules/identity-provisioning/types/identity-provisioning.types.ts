import type { FastifyRequest } from 'fastify';
import type {
  ScimClientStatusCode,
  ScimDeprovisionMode,
  ScimReconciliationDiscrepancyType,
  ScimReconciliationMode,
  ScimSyncOutcome,
} from '../enum/identity-provisioning.enum.js';
import type { ScimClientEntity } from '../entities/scim-client.entity.js';

export interface ScimNamePayload {
  readonly formatted?: string | undefined;
  readonly familyName?: string | undefined;
  readonly givenName?: string | undefined;
}

export interface ScimMultiValuedValue {
  readonly value: string;
  readonly type?: string | undefined;
  readonly primary?: boolean | undefined;
  readonly display?: string | undefined;
}

export interface ScimMeta {
  readonly resourceType: 'User' | 'Group';
  readonly created?: string | undefined;
  readonly lastModified?: string | undefined;
  readonly location?: string | undefined;
  readonly version: string;
}

export interface ScimUserGroupRef {
  readonly value: string;
  readonly display?: string | undefined;
  readonly $ref?: string | undefined;
}

export interface ScimUserResource {
  readonly schemas: readonly string[];
  readonly id: string;
  readonly externalId?: string | undefined;
  readonly userName: string;
  readonly name?: ScimNamePayload | undefined;
  readonly displayName?: string | undefined;
  readonly active: boolean;
  readonly emails?: readonly ScimMultiValuedValue[] | undefined;
  readonly phoneNumbers?: readonly ScimMultiValuedValue[] | undefined;
  readonly groups?: readonly ScimUserGroupRef[] | undefined;
  readonly meta: ScimMeta;
}

export interface ScimGroupMemberRef {
  readonly value: string;
  readonly display?: string | undefined;
  readonly type?: 'User' | undefined;
  readonly $ref?: string | undefined;
}

export interface ScimGroupResource {
  readonly schemas: readonly string[];
  readonly id: string;
  readonly externalId?: string | undefined;
  readonly displayName: string;
  readonly members: readonly ScimGroupMemberRef[];
  readonly meta: ScimMeta;
}

export interface ScimListResponse<T> {
  readonly schemas: readonly string[];
  readonly totalResults: number;
  readonly startIndex: number;
  readonly itemsPerPage: number;
  readonly Resources: readonly T[];
}

export interface ScimPatchOperation {
  readonly op: 'add' | 'replace' | 'remove';
  readonly path?: string | undefined;
  readonly value?: unknown;
}

export interface ScimPatchRequest {
  readonly schemas: readonly string[];
  readonly Operations: readonly ScimPatchOperation[];
}

export interface ScimErrorResponse {
  readonly schemas: readonly string[];
  readonly status: string;
  readonly scimType?: string | undefined;
  readonly detail: string;
}

export interface ScimClientView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly federatedProviderCode: string | null;
  readonly status: ScimClientStatusCode;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly tokenPrefix: string;
  readonly allowedIps: readonly string[];
  readonly scopes: readonly string[];
  readonly deprovisionMode: ScimDeprovisionMode;
  readonly groupRoleMappings: Readonly<Record<string, readonly string[]>>;
  readonly allowedRoleCodes: readonly string[];
  readonly deniedRoleCodes: readonly string[];
  readonly defaultRoleCodes: readonly string[];
  readonly requireIfMatch: boolean;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly rotatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScimClientCreatedView {
  readonly client: ScimClientView;
  readonly plainToken: string;
}

export interface ScimUserLinkView {
  readonly id: number;
  readonly clientId: number;
  readonly userId: number;
  readonly externalId: string;
  readonly scimUsername: string;
  readonly scimVersion: number;
  readonly active: boolean;
  readonly lastSyncedAt: string;
  readonly deprovisionedAt: string | null;
  readonly deprovisionReason: string | null;
  readonly userStatus: number | null;
  readonly userStatusName: string | null;
  readonly userEmail: string | null;
  readonly userFullName: string | null;
}

export interface ScimGroupSummaryView {
  readonly id: number;
  readonly clientId: number;
  readonly externalId: string | null;
  readonly displayName: string;
  readonly mappedRoleCode: string | null;
  readonly scimVersion: number;
  readonly active: boolean;
  readonly memberCount: number;
  readonly memberUserIds: readonly number[];
  readonly lastSyncedAt: string;
}

export interface ScimSyncLogView {
  readonly id: number;
  readonly clientId: number | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly operation: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly externalId: string | null;
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly httpStatus: number;
  readonly outcome: ScimSyncOutcome;
  readonly idempotencyHit: boolean;
  readonly requestSummary: Readonly<Record<string, unknown>> | null;
  readonly responseSummary: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly ipAddress: string | null;
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface IdpUserSnapshotItem {
  readonly externalId: string;
  readonly userName: string;
  readonly email: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly fullName?: string | undefined;
  readonly phone?: string | null | undefined;
  readonly active: boolean;
}

export interface IdpGroupSnapshotItem {
  readonly externalId?: string | undefined;
  readonly displayName: string;
  readonly memberExternalIds: readonly string[];
}

export interface ScimReconciliationDiscrepancy {
  readonly type: ScimReconciliationDiscrepancyType;
  readonly entityType: 'USER' | 'GROUP';
  readonly externalId: string | null;
  readonly localId: number | null;
  readonly identifier: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly resolved?: boolean | undefined;
  readonly resolutionAction?: string | undefined;
}

export interface ScimReconciliationSummary {
  readonly missingInLocal: number;
  readonly orphanInLocal: number;
  readonly attributeDrift: number;
  readonly statusDrift: number;
  readonly groupMissingInLocal: number;
  readonly groupOrphanInLocal: number;
  readonly membershipDrift: number;
}

export interface ScimReconciliationRunView {
  readonly id: number;
  readonly clientId: number;
  readonly mode: ScimReconciliationMode;
  readonly status: string;
  readonly idpUsersCount: number;
  readonly localUsersCount: number;
  readonly idpGroupsCount: number;
  readonly localGroupsCount: number;
  readonly discrepanciesCount: number;
  readonly appliedActionsCount: number;
  readonly summary: ScimReconciliationSummary;
  readonly discrepancies: readonly ScimReconciliationDiscrepancy[];
  readonly triggeredBy: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface ScimAuthenticatedRequest extends FastifyRequest {
  scimClient?: ScimClientEntity;
}

export interface ScimRequestMeta {
  readonly ipAddress: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly baseUrl: string;
}
