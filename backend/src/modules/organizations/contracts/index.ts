export type OrganizationUnitType = 'UNIT' | 'BRANCH' | 'DEPARTMENT';
export type OrganizationUnitStatus = 'ACTIVE' | 'INACTIVE';

export interface OrganizationUnitSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitType;
  readonly parentId: string | null;
  readonly status: OrganizationUnitStatus;
}

export interface IOrganizationsPublicService {
  findByIds(ids: readonly string[]): Promise<OrganizationUnitSummary[]>;
  findByCodes(codes: readonly string[]): Promise<OrganizationUnitSummary[]>;
  ensureActiveUnitsExist(ids: readonly string[]): Promise<OrganizationUnitSummary[]>;
}

export const ORGANIZATIONS_PUBLIC_SERVICE = Symbol('ORGANIZATIONS_PUBLIC_SERVICE');
