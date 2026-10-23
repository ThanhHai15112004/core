export type OrgUnitStatusName = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface OrganizationUnitItem {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: number;
  readonly typeName: string;
  readonly parentId: number | null;
  readonly status: 1 | 2 | 3;
  readonly statusName: OrgUnitStatusName;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrganizationTreeNode extends OrganizationUnitItem {
  readonly depth: number;
  readonly path: string;
  readonly childrenCount: number;
  readonly descendantCount: number;
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

export interface CreateOrganizationUnitPayload {
  readonly code: string;
  readonly name: string;
  readonly type: number;
  readonly parentId: number | null;
  readonly status: 1 | 2 | 3;
  readonly description?: string | null;
}

export interface UpdateOrganizationUnitPayload {
  readonly name?: string;
  readonly type?: number;
  readonly parentId?: number | null;
  readonly status?: 1 | 2 | 3;
  readonly description?: string | null;
}

