import type {
  OrganizationUnitStatusCode,
  OrganizationUnitStatusName,
  OrganizationUnitTypeCode,
  OrganizationUnitTypeName,
} from '../contracts/index.js';

export type UnitUsageCountDelegate = (unitId: number) => Promise<number>;

export interface HierarchyNodeInput {
  readonly id: number;
  readonly parentId?: number | null | undefined;
  readonly status?: number | undefined;
}

export interface OrganizationTreeNode {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitTypeCode;
  readonly typeName: OrganizationUnitTypeName;
  readonly parentId: number | null;
  readonly status: OrganizationUnitStatusCode;
  readonly statusName: OrganizationUnitStatusName;
  readonly description: string | null;
  readonly depth: number;
  readonly path: string;
  readonly childrenCount: number;
  readonly descendantCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly children: OrganizationTreeNode[];
}

export interface OrganizationStats {
  readonly totalUnits: number;
  readonly activeUnits: number;
  readonly inactiveUnits: number;
  readonly archivedUnits: number;
  readonly rootUnits: number;
  readonly maxDepthObserved: number;
  readonly maxDepthAllowed: number;
  readonly byType: {
    readonly headquarters: number;
    readonly branch: number;
    readonly department: number;
    readonly team: number;
    readonly custom: number;
  };
}
