export const ORG_UNIT_TYPE = {
  HEADQUARTERS: 1,
  BRANCH: 2,
  DEPARTMENT: 3,
  TEAM: 4,
} as const;

export const ORGANIZATION_UNIT_TYPE = ORG_UNIT_TYPE;

export const ORG_UNIT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  ARCHIVED: 3,
} as const;

export const ORGANIZATION_UNIT_STATUS = ORG_UNIT_STATUS;

export const DEFAULT_MAX_HIERARCHY_DEPTH = 10;
export const DEFAULT_INCLUDE_INACTIVE_IN_SCOPE = true;

export const ORGANIZATION_SETTING_KEYS = {
  MAX_DEPTH: 'organizations.hierarchy.max_depth',
  INCLUDE_INACTIVE_IN_SCOPE: 'organizations.hierarchy.include_inactive_in_scope',
} as const;

export const ORGANIZATION_CODE_TYPE_KEYS = {
  UNIT_TYPE: 'organizations.unit_type',
  STATUS: 'organizations.status',
} as const;
