import type {
  OrganizationUnitStatusCode,
  OrganizationUnitStatusName,
  OrganizationUnitTypeCode,
  OrganizationUnitTypeName,
  UnitManagerResolverDelegate,
  UnitManagerSummary,
} from '../contracts/index.js';

export type UnitUsageCountDelegate = (unitId: number) => Promise<number>;
export type { UnitManagerResolverDelegate, UnitManagerSummary };

export interface HierarchyNodeInput {
  readonly id: number;
  readonly code?: string | undefined;
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
  readonly managerId: number | null;
  readonly managerName?: string | null | undefined;
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

export interface OrganizationMoveImpact {
  readonly unitId: number;
  readonly unitCode: string;
  readonly unitName: string;
  readonly oldParentId: number | null;
  readonly newParentId: number | null;
  readonly oldPath: string;
  readonly newPath: string;
  readonly oldDepth: number;
  readonly newDepth: number;
  readonly maxDepthInMovedSubtree: number;
  readonly maxDepthAllowed: number;
  readonly affectedUnitIds: readonly number[];
  readonly affectedUnitCount: number;
  readonly directChildrenCount: number;
  readonly affectedUserCount: number;
  readonly requiresPermissionScopeRefresh: boolean;
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
