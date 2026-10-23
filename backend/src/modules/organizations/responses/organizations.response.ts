import { z } from 'zod';
import type {
  OrganizationUnitStatusCode,
  OrganizationUnitStatusName,
  OrganizationUnitTypeCode,
  OrganizationUnitTypeName,
} from '../contracts/index.js';
import type { OrganizationStats, OrganizationTreeNode } from '../types/organizations.types.js';

export type OrganizationTreeNodeResponse = OrganizationTreeNode;
export type OrganizationStatsResponse = OrganizationStats;

export interface OrganizationUnitResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: OrganizationUnitTypeCode;
  readonly typeName: OrganizationUnitTypeName;
  readonly parentId: number | null;
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
