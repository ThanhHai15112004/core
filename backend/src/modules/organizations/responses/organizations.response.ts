import { z } from 'zod';
import type {
  OrganizationUnitStatusCode,
  OrganizationUnitStatusName,
  OrganizationUnitTypeCode,
  OrganizationUnitTypeName,
} from '../contracts/index.js';
import type {
  OrganizationMoveImpact,
  OrganizationStats,
  OrganizationTreeNode,
} from '../types/organizations.types.js';

export type OrganizationTreeNodeResponse = OrganizationTreeNode;
export type OrganizationStatsResponse = OrganizationStats;
export type OrganizationMoveImpactResponse = OrganizationMoveImpact;

export interface OrganizationUnitResponse {
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const organizationUnitResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  type: z.number().int().min(1),
  typeName: z.string().min(1),
  parentId: z.number().int().min(1).nullable(),
  managerId: z.number().int().min(1).nullable(),
  managerName: z.string().nullable().optional(),
  status: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const organizationTreeNodeResponseSchema: z.ZodType<OrganizationTreeNodeResponse> = z.lazy(
  () =>
    organizationUnitResponseSchema.extend({
      depth: z.number().int().min(1),
      path: z.string(),
      childrenCount: z.number().int().min(0),
      descendantCount: z.number().int().min(0),
      children: z.array(organizationTreeNodeResponseSchema),
    }),
);

export const organizationStatsResponseSchema = z.object({
  totalUnits: z.number().int().min(0),
  activeUnits: z.number().int().min(0),
  inactiveUnits: z.number().int().min(0),
  archivedUnits: z.number().int().min(0),
  rootUnits: z.number().int().min(0),
  maxDepthObserved: z.number().int().min(0),
  maxDepthAllowed: z.number().int().min(1),
  byType: z.object({
    headquarters: z.number().int().min(0),
    branch: z.number().int().min(0),
    department: z.number().int().min(0),
    team: z.number().int().min(0),
    custom: z.number().int().min(0),
  }),
});

export const organizationMoveImpactResponseSchema = z.object({
  unitId: z.number().int().min(1),
  unitCode: z.string(),
  unitName: z.string(),
  oldParentId: z.number().int().min(1).nullable(),
  newParentId: z.number().int().min(1).nullable(),
  oldPath: z.string(),
  newPath: z.string(),
  oldDepth: z.number().int().min(1),
  newDepth: z.number().int().min(1),
  maxDepthInMovedSubtree: z.number().int().min(1),
  maxDepthAllowed: z.number().int().min(1),
  affectedUnitIds: z.array(z.number().int().min(1)),
  affectedUnitCount: z.number().int().min(1),
  directChildrenCount: z.number().int().min(0),
  affectedUserCount: z.number().int().min(0),
  requiresPermissionScopeRefresh: z.boolean(),
});

export interface MoveOrganizationUnitResponse {
  readonly unit: OrganizationUnitResponse;
  readonly impact: OrganizationMoveImpactResponse;
}

export const moveOrganizationUnitResponseSchema = z.object({
  unit: organizationUnitResponseSchema,
  impact: organizationMoveImpactResponseSchema,
});

export interface ExportOrganizationsResponse {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly mode: 'tree' | 'list';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
}

export const exportOrganizationsResponseSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx']),
  mode: z.enum(['tree', 'list']),
  totalExported: z.number().int().min(0),
  csvContent: z.string(),
  xlsxBase64: z.string(),
});

export interface BulkImportOrganizationsErrorItem {
  readonly row: number;
  readonly identifier: string;
  readonly message: string;
}

export interface BulkImportOrganizationsResultResponse {
  readonly totalRows: number;
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly importedCodes: readonly string[];
  readonly updatedCodes: readonly string[];
  readonly errors: readonly BulkImportOrganizationsErrorItem[];
}

export const bulkImportOrganizationsResultResponseSchema = z.object({
  totalRows: z.number().int().min(0),
  importedCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  importedCodes: z.array(z.string()),
  updatedCodes: z.array(z.string()),
  errors: z.array(
    z.object({
      row: z.number().int().min(1),
      identifier: z.string(),
      message: z.string(),
    }),
  ),
});
