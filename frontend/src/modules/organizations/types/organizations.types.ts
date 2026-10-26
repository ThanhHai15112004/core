export type OrgUnitStatusName = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface OrganizationTypeOption {
  readonly code: number;
  readonly key: string;
  readonly label: string;
}

export interface OrganizationManagerOption {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly email?: string | null;
}

export interface OrganizationUnitItem {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: number;
  readonly typeName: string;
  readonly parentId: number | null;
  readonly managerId: number | null;
  readonly managerName?: string | null;
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

export interface CreateOrganizationUnitPayload {
  readonly code: string;
  readonly name: string;
  readonly type: number;
  readonly parentId: number | null;
  readonly managerId?: number | null;
  readonly status: 1 | 2 | 3;
  readonly description?: string | null;
}

export interface UpdateOrganizationUnitPayload {
  readonly code?: string;
  readonly name?: string;
  readonly type?: number;
  readonly parentId?: number | null;
  readonly managerId?: number | null;
  readonly status?: 1 | 2 | 3;
  readonly description?: string | null;
}

export interface ExportOrganizationsResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly mode: 'tree' | 'list';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
}

export interface BulkImportOrganizationsPayload {
  readonly csvContent?: string;
  readonly xlsxBase64?: string;
  readonly skipDuplicates?: boolean;
  readonly updateExisting?: boolean;
}

export interface BulkImportOrganizationsResult {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly importedCodes: readonly string[];
  readonly updatedCodes: readonly string[];
  readonly errors: ReadonlyArray<{
    readonly row: number;
    readonly identifier: string;
    readonly message: string;
  }>;
}
