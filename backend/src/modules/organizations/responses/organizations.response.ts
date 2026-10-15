import { z } from 'zod';
import type {
  OrganizationUnitStatusCode,
  OrganizationUnitStatusName,
  OrganizationUnitTypeCode,
  OrganizationUnitTypeName,
} from '../contracts/index.js';

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
  type: z.number().int().min(1).max(4),
  typeName: z.enum(['HEADQUARTERS', 'BRANCH', 'DEPARTMENT', 'TEAM']),
  parentId: z.number().int().min(1).nullable(),
  status: z.number().int().min(1).max(3),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
