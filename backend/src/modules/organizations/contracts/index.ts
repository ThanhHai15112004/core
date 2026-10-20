import { defaultCodeRegistry } from '@packages/kernel/index.js';

export const ORG_UNIT_TYPE = {
  HEADQUARTERS: 1,
  BRANCH: 2,
  DEPARTMENT: 3,
  TEAM: 4,
} as const;

export const ORGANIZATION_UNIT_TYPE = ORG_UNIT_TYPE;

export type OrganizationUnitTypeCode = (typeof ORG_UNIT_TYPE)[keyof typeof ORG_UNIT_TYPE] | number;
export type OrganizationUnitTypeName = keyof typeof ORG_UNIT_TYPE | (string & {});

export const ORG_UNIT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  ARCHIVED: 3,
} as const;

export const ORGANIZATION_UNIT_STATUS = ORG_UNIT_STATUS;

export type OrganizationUnitStatusCode = (typeof ORG_UNIT_STATUS)[keyof typeof ORG_UNIT_STATUS];
export type OrganizationUnitStatusName = keyof typeof ORG_UNIT_STATUS;

/**
 * Phân giải loại đơn vị/chi nhánh thông qua CodeRegistryService (`organizations.unit_type`).
 * Hỗ trợ cả 4 mã gốc (1..4) lẫn các mã động do Admin tạo thêm (vd: 5 = CAMPUS, 6 = LAB).
 */
export function parseOrgUnitType(val: unknown): OrganizationUnitTypeCode {
  return defaultCodeRegistry.parseToNumericCode(
    'organizations.unit_type',
    val,
    ORG_UNIT_TYPE.BRANCH,
  );
}

/**
 * Tra cứu tên mã loại đơn vị/chi nhánh từ `organizations.unit_type` (O(1) L1 Lookup).
 */
export function getOrgUnitTypeName(code: number): OrganizationUnitTypeName {
  return defaultCodeRegistry.getCodeName('organizations.unit_type', code, 'BRANCH');
}

/**
 * Phân giải trạng thái đơn vị/chi nhánh thông qua CodeRegistryService (`organizations.status`).
 */
export function parseOrgUnitStatus(val: unknown): OrganizationUnitStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    'organizations.status',
    val,
    ORG_UNIT_STATUS.ACTIVE,
  );
  if (resolved === ORG_UNIT_STATUS.INACTIVE || resolved === ORG_UNIT_STATUS.ARCHIVED) {
    return resolved;
  }
  return ORG_UNIT_STATUS.ACTIVE;
}

/**
 * Tra cứu tên trạng thái đơn vị/chi nhánh từ `organizations.status`.
 */
export function getOrgUnitStatusName(code: number): OrganizationUnitStatusName {
  const name = defaultCodeRegistry.getCodeName('organizations.status', code, 'ACTIVE');
  if (name === 'INACTIVE' || name === 'ARCHIVED') {
    return name;
  }
  return 'ACTIVE';
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
  resolveDescendantUnitIds?(rootUnitIds: readonly number[]): Promise<number[]>;
  registerUnitUsageCountDelegate?(delegate: (unitId: number) => Promise<number>): void;
}

export const ORGANIZATIONS_PUBLIC_SERVICE = Symbol('ORGANIZATIONS_PUBLIC_SERVICE');
