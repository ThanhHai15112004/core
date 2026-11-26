export const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';

export const SCIM_SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  LIST_RESPONSE: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  PATCH_OP: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error',
  SERVICE_PROVIDER_CONFIG: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  RESOURCE_TYPE: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  SCHEMA: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const;

export const SCIM_CLIENT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type ScimClientStatusCode = (typeof SCIM_CLIENT_STATUS)[keyof typeof SCIM_CLIENT_STATUS];

export const SCIM_DEPROVISION_MODE = {
  LOCK_AND_REVOKE: 'LOCK_AND_REVOKE',
  DEACTIVATE_AND_REVOKE: 'DEACTIVATE_AND_REVOKE',
} as const;

export type ScimDeprovisionMode =
  (typeof SCIM_DEPROVISION_MODE)[keyof typeof SCIM_DEPROVISION_MODE];

export const SCIM_SYNC_OUTCOME = {
  SUCCESS: 'SUCCESS',
  NOOP_DUPLICATE: 'NOOP_DUPLICATE',
  CONFLICT: 'CONFLICT',
  FAILED: 'FAILED',
} as const;

export type ScimSyncOutcome = (typeof SCIM_SYNC_OUTCOME)[keyof typeof SCIM_SYNC_OUTCOME];

export const SCIM_RECONCILIATION_MODE = {
  DRY_RUN: 'DRY_RUN',
  APPLY: 'APPLY',
} as const;

export type ScimReconciliationMode =
  (typeof SCIM_RECONCILIATION_MODE)[keyof typeof SCIM_RECONCILIATION_MODE];

export const SCIM_RECONCILIATION_DISCREPANCY_TYPE = {
  MISSING_IN_LOCAL: 'MISSING_IN_LOCAL',
  ORPHAN_IN_LOCAL: 'ORPHAN_IN_LOCAL',
  ATTRIBUTE_DRIFT: 'ATTRIBUTE_DRIFT',
  STATUS_DRIFT: 'STATUS_DRIFT',
  GROUP_MISSING_IN_LOCAL: 'GROUP_MISSING_IN_LOCAL',
  GROUP_ORPHAN_IN_LOCAL: 'GROUP_ORPHAN_IN_LOCAL',
  MEMBERSHIP_DRIFT: 'MEMBERSHIP_DRIFT',
} as const;

export type ScimReconciliationDiscrepancyType =
  (typeof SCIM_RECONCILIATION_DISCREPANCY_TYPE)[keyof typeof SCIM_RECONCILIATION_DISCREPANCY_TYPE];

export const SCIM_PROTECTED_DENIED_ROLES = ['SUPER_ADMIN'] as const;

export const SCIM_FEATURE_FLAGS = {
  SCIM_V2: 'identity_provisioning.scim_v2',
} as const;

export const SCIM_SETTING_KEYS = {
  MAX_PAGE_SIZE: 'identity_provisioning.max_page_size',
  DEFAULT_DEPROVISION_MODE: 'identity_provisioning.default_deprovision_mode',
  SYNC_LOG_RETENTION_DAYS: 'identity_provisioning.sync_log_retention_days',
  REQUIRE_IF_MATCH_ON_WRITE: 'identity_provisioning.require_if_match_on_write',
} as const;

export const SCIM_AUDIT_META = {
  MODULE: 'identity-provisioning',
  FEATURE_CLIENT: 'scim_client',
  FEATURE_USER: 'scim_user',
  FEATURE_GROUP: 'scim_group',
  FEATURE_ROLE_SYNC: 'scim_role_sync',
  FEATURE_RECONCILE: 'scim_reconciliation',
} as const;

export const SCIM_EVENTS = {
  USER_PROVISIONED: 'identity-provisioning.user.provisioned',
  USER_UPDATED: 'identity-provisioning.user.updated',
  USER_DEPROVISIONED: 'identity-provisioning.user.deprovisioned',
  GROUP_SYNCED: 'identity-provisioning.group.synced',
  RECONCILIATION_COMPLETED: 'identity-provisioning.reconciliation.completed',
} as const;

export const SCIM_CLIENT_SCOPES = {
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  GROUPS_READ: 'groups:read',
  GROUPS_WRITE: 'groups:write',
} as const;

export const DEFAULT_SCIM_CLIENT_SCOPES: readonly string[] = [
  SCIM_CLIENT_SCOPES.USERS_READ,
  SCIM_CLIENT_SCOPES.USERS_WRITE,
  SCIM_CLIENT_SCOPES.GROUPS_READ,
  SCIM_CLIENT_SCOPES.GROUPS_WRITE,
];
