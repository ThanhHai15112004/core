export const ORG_UNIT_TYPE = {
  HEADQUARTERS: 1,
  BRANCH: 2,
  DEPARTMENT: 3,
  TEAM: 4,
} as const;

export const ORGANIZATION_UNIT_TYPE = ORG_UNIT_TYPE;

export type OrganizationUnitTypeCode = (typeof ORG_UNIT_TYPE)[keyof typeof ORG_UNIT_TYPE];
export type OrganizationUnitTypeName = keyof typeof ORG_UNIT_TYPE;

export const ORG_UNIT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  ARCHIVED: 3,
} as const;

export const ORGANIZATION_UNIT_STATUS = ORG_UNIT_STATUS;

export type OrganizationUnitStatusCode = (typeof ORG_UNIT_STATUS)[keyof typeof ORG_UNIT_STATUS];
export type OrganizationUnitStatusName = keyof typeof ORG_UNIT_STATUS;

export function parseOrgUnitType(val: unknown): OrganizationUnitTypeCode {
  if (typeof val === 'number' && (val === 1 || val === 2 || val === 3 || val === 4)) {
    return val;
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (num === 1 || num === 2 || num === 3 || num === 4) return num;
    const upper = val.trim().toUpperCase();
    if (upper === 'HEADQUARTERS' || upper === 'UNIT') return ORG_UNIT_TYPE.HEADQUARTERS;
    if (upper === 'BRANCH') return ORG_UNIT_TYPE.BRANCH;
    if (upper === 'DEPARTMENT') return ORG_UNIT_TYPE.DEPARTMENT;
    if (upper === 'TEAM') return ORG_UNIT_TYPE.TEAM;
  }
  return ORG_UNIT_TYPE.BRANCH;
}

export function getOrgUnitTypeName(code: number): OrganizationUnitTypeName {
  switch (code) {
    case ORG_UNIT_TYPE.HEADQUARTERS:
      return 'HEADQUARTERS';
    case ORG_UNIT_TYPE.DEPARTMENT:
      return 'DEPARTMENT';
    case ORG_UNIT_TYPE.TEAM:
      return 'TEAM';
    case ORG_UNIT_TYPE.BRANCH:
    default:
      return 'BRANCH';
  }
}

export function parseOrgUnitStatus(val: unknown): OrganizationUnitStatusCode {
  if (typeof val === 'number' && (val === 1 || val === 2 || val === 3)) {
    return val;
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (num === 1 || num === 2 || num === 3) return num;
    const upper = val.trim().toUpperCase();
    if (upper === 'INACTIVE') return ORG_UNIT_STATUS.INACTIVE;
    if (upper === 'ARCHIVED') return ORG_UNIT_STATUS.ARCHIVED;
  }
  return ORG_UNIT_STATUS.ACTIVE;
}

export function getOrgUnitStatusName(code: number): OrganizationUnitStatusName {
  switch (code) {
    case ORG_UNIT_STATUS.INACTIVE:
      return 'INACTIVE';
    case ORG_UNIT_STATUS.ARCHIVED:
      return 'ARCHIVED';
    case ORG_UNIT_STATUS.ACTIVE:
    default:
      return 'ACTIVE';
  }
}

export interface OrganizationUnitSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitTypeCode;
  readonly typeName: OrganizationUnitTypeName;
  readonly parentId: number | null;
  readonly status: OrganizationUnitStatusCode;
  readonly statusName: OrganizationUnitStatusName;
}

export interface IOrganizationsPublicService {
  findByIds(ids: readonly number[]): Promise<OrganizationUnitSummary[]>;
  findByCodes(codes: readonly string[]): Promise<OrganizationUnitSummary[]>;
  ensureActiveUnitsExist(ids: readonly number[]): Promise<OrganizationUnitSummary[]>;
}

export const ORGANIZATIONS_PUBLIC_SERVICE = Symbol('ORGANIZATIONS_PUBLIC_SERVICE');
