import type {
  DataScopeCustomRuleMetadata,
  ResolvedDataScopeFilter,
  SecurityEventSeverity,
  SecurityEventTypeCode,
} from '@packages/security/index.js';

export interface NormalizedPermissionDeclaration {
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly moduleDisplayName: string;
  readonly featureGroup: string;
  readonly description: string | null;
}

export interface DeclarativeCustomScopeRuleInput {
  readonly code: string;
  readonly resource: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly allowedOrganizationUnitIds?: readonly number[] | undefined;
  readonly allowedUserIds?: readonly number[] | undefined;
  readonly allowAllIfHasPermission?: string | undefined;
}

export interface EffectiveDataScopeOverview {
  readonly filter: ResolvedDataScopeFilter;
  readonly registeredCustomRules: DataScopeCustomRuleMetadata[];
}

export interface SecurityEventsQueryFilter {
  readonly eventType?: SecurityEventTypeCode | string | undefined;
  readonly actorId?: number | undefined;
  readonly targetUserId?: number | undefined;
  readonly limit?: number | undefined;
}

export interface SecurityAlertsQueryFilter {
  readonly anomalyType?: string | undefined;
  readonly severity?: SecurityEventSeverity | undefined;
  readonly actorId?: number | undefined;
  readonly limit?: number | undefined;
}
