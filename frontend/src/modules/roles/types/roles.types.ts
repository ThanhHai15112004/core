import type {
  DataScopeCode,
  DataScopeName,
  RoleStatusCode,
  RoleStatusName,
} from '../enum/roles.enum';

export interface RoleItem {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly dataScope: DataScopeCode;
  readonly dataScopeName: DataScopeName;
  readonly status: RoleStatusCode;
  readonly statusName: RoleStatusName;
  readonly permissionIds: readonly number[];
  readonly permissions: readonly string[];
  readonly userCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleAssignedUser {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: number;
  readonly statusName: string;
  readonly primaryOrganizationUnitId: number | null;
  readonly assignedAt: string;
}

export interface PermissionCatalogItem {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly featureGroup: string;
  readonly description: string | null;
  readonly status: 1 | 2;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly isOrphaned: boolean;
}

export interface PermissionFunctionalGroup {
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly featureGroup: string;
  readonly totalPermissions: number;
  readonly permissions: readonly PermissionCatalogItem[];
}

export interface SyncPermissionsResult {
  readonly totalDeclared: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly orphanedCount: number;
  readonly createdCodes: readonly string[];
  readonly updatedCodes: readonly string[];
  readonly orphanedCodes: readonly string[];
  readonly syncedModules: readonly string[];
}

export interface OrphanedPermissionWarning {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly assignedRoles: readonly {
    readonly id: number;
    readonly code: string;
    readonly name: string;
  }[];
  readonly warningMessage: string;
}

export interface RolePermissionMatrixRow {
  readonly permissionId: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly featureGroup: string;
  readonly isOrphaned: boolean;
  readonly grantedRoleIds: readonly number[];
  readonly grantedRoleCodes: readonly string[];
  readonly roleGrants: Readonly<Record<string, boolean>>;
}

export interface RolePermissionMatrix {
  readonly roles: readonly {
    readonly id: number;
    readonly code: string;
    readonly name: string;
    readonly isSystem: boolean;
    readonly dataScope: DataScopeCode;
    readonly dataScopeName: DataScopeName;
    readonly status: RoleStatusCode;
    readonly statusName: RoleStatusName;
    readonly totalGrantedPermissions: number;
  }[];
  readonly modules: readonly string[];
  readonly rows: readonly RolePermissionMatrixRow[];
  readonly summary: {
    readonly totalRoles: number;
    readonly totalPermissions: number;
    readonly totalOrphanedPermissions: number;
  };
}

export interface EffectiveDataScopeFilter {
  readonly isUnrestricted: boolean;
  readonly effectiveScope: DataScopeCode;
  readonly effectiveScopeName: DataScopeName;
  readonly grantedScopes: readonly DataScopeCode[];
  readonly allowedUserIds: readonly number[];
  readonly allowedOrganizationUnitIds: readonly number[];
  readonly customAttributes: Readonly<Record<string, unknown>>;
  readonly appliedRuleCodes: readonly string[];
}

export interface CustomScopeRuleItem {
  readonly code: string;
  readonly resource: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly priority: number;
}

export interface EffectiveDataScopeOverview {
  readonly filter: EffectiveDataScopeFilter;
  readonly registeredCustomRules: readonly CustomScopeRuleItem[];
}

export interface AuditLogItem {
  readonly id: number;
  readonly actorType: number;
  readonly actorTypeName?: string;
  readonly actorUserId: number | null;
  readonly actorServiceAccountId: number | null;
  readonly actorDisplayName: string | null;
  readonly module: string;
  readonly feature: string;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly reason: string | null;
  readonly beforeData: Record<string, unknown> | null;
  readonly afterData: Record<string, unknown> | null;
  readonly changedFields?: readonly string[];
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface AuditLogPaginatedResponse {
  readonly data: readonly AuditLogItem[];
  readonly meta: {
    readonly page: number;
    readonly limit: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
}

export interface SecurityEventItem {
  readonly id: string;
  readonly eventType: string;
  readonly severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  readonly actorId: number | null;
  readonly targetUserId: number | null;
  readonly module: string;
  readonly feature: string;
  readonly action: string;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly occurredAt: string;
}

export interface SecurityAlertItem {
  readonly id: string;
  readonly anomalyType: string;
  readonly severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  readonly actorId: number | null;
  readonly ipAddress: string | null;
  readonly message: string;
  readonly details: Record<string, unknown>;
  readonly detectedAt: string;
}

export interface CreateRolePayload {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly dataScope?: DataScopeCode;
  readonly status?: RoleStatusCode;
  readonly permissions?: readonly string[];
}

export interface UpdateRolePayload {
  readonly name?: string;
  readonly description?: string | null;
  readonly dataScope?: DataScopeCode;
  readonly status?: RoleStatusCode;
  readonly permissions?: readonly string[];
}

export interface CloneRolePayload {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly dataScope?: DataScopeCode;
  readonly status?: RoleStatusCode;
}

export interface RegisterCustomScopeRulePayload {
  readonly code: string;
  readonly resource: string;
  readonly module?: string;
  readonly name: string;
  readonly description?: string | null;
  readonly allowedOrganizationUnitIds?: readonly number[];
  readonly allowedUserIds?: readonly number[];
  readonly allowAllIfHasPermission?: string;
}

