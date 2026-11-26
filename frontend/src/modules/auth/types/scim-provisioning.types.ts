export type ScimDeprovisionMode = 'LOCK_AND_REVOKE' | 'DEACTIVATE_AND_REVOKE';
export type ScimSyncOutcome = 'SUCCESS' | 'NOOP_DUPLICATE' | 'CONFLICT' | 'FAILED';
export type ScimReconciliationMode = 'DRY_RUN' | 'APPLY';

export interface ScimClientItem {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly federatedProviderCode: string | null;
  readonly status: 1 | 2;
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

export interface ScimClientCreatedResult {
  readonly client: ScimClientItem;
  readonly plainToken: string;
}

export interface ScimUserLinkItem {
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

export interface ScimGroupItem {
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

export interface ScimSyncLogItem {
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
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly ipAddress: string | null;
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface ScimReconciliationDiscrepancyItem {
  readonly type: string;
  readonly entityType: 'USER' | 'GROUP';
  readonly externalId: string | null;
  readonly localId: number | null;
  readonly identifier: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly resolved?: boolean;
  readonly resolutionAction?: string;
}

export interface ScimReconciliationRunItem {
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
  readonly summary: {
    readonly missingInLocal: number;
    readonly orphanInLocal: number;
    readonly attributeDrift: number;
    readonly statusDrift: number;
    readonly groupMissingInLocal: number;
    readonly groupOrphanInLocal: number;
    readonly membershipDrift: number;
  };
  readonly discrepancies: readonly ScimReconciliationDiscrepancyItem[];
  readonly startedAt: string;
  readonly completedAt: string | null;
}
