import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  ORGANIZATION_CODE_TYPE_KEYS,
  ORG_UNIT_STATUS,
  ORG_UNIT_TYPE,
} from '../enum/organizations.enum.js';

export {
  ORG_UNIT_TYPE,
  ORGANIZATION_UNIT_TYPE,
  ORG_UNIT_STATUS,
  ORGANIZATION_UNIT_STATUS,
} from '../enum/organizations.enum.js';

export type OrganizationUnitTypeCode = (typeof ORG_UNIT_TYPE)[keyof typeof ORG_UNIT_TYPE] | number;
export type OrganizationUnitTypeName = keyof typeof ORG_UNIT_TYPE | (string & {});

export type OrganizationUnitStatusCode = (typeof ORG_UNIT_STATUS)[keyof typeof ORG_UNIT_STATUS];
export type OrganizationUnitStatusName = keyof typeof ORG_UNIT_STATUS;

/**
 * Phân giải loại đơn vị/chi nhánh thông qua CodeRegistryService (`organizations.unit_type`).
 * Hỗ trợ cả 4 mã gốc (1..4) lẫn các mã động do Admin tạo thêm (vd: 5 = CAMPUS, 6 = LAB).
 */
export function parseOrgUnitType(val: unknown): OrganizationUnitTypeCode {
  return defaultCodeRegistry.parseToNumericCode(
    ORGANIZATION_CODE_TYPE_KEYS.UNIT_TYPE,
    val,
    ORG_UNIT_TYPE.BRANCH,
  );
}

/**
 * Tra cứu tên mã loại đơn vị/chi nhánh từ `organizations.unit_type` (O(1) L1 Lookup).
 */
export function getOrgUnitTypeName(code: number): OrganizationUnitTypeName {
  return defaultCodeRegistry.getCodeName(ORGANIZATION_CODE_TYPE_KEYS.UNIT_TYPE, code, 'BRANCH');
}

/**
 * Phân giải trạng thái đơn vị/chi nhánh thông qua CodeRegistryService (`organizations.status`).
 */
export function parseOrgUnitStatus(val: unknown): OrganizationUnitStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    ORGANIZATION_CODE_TYPE_KEYS.STATUS,
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
  const name = defaultCodeRegistry.getCodeName(ORGANIZATION_CODE_TYPE_KEYS.STATUS, code, 'ACTIVE');
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
  getSubtreeUnitIds?(unitId: number): Promise<number[]>;
  registerUnitUsageCountDelegate?(delegate: (unitId: number) => Promise<number>): void;
}

export const ORGANIZATIONS_PUBLIC_SERVICE = Symbol('ORGANIZATIONS_PUBLIC_SERVICE');
