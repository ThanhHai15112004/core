import { z } from 'zod';
import type {
  OrganizationUnitStatus,
  OrganizationUnitSummary,
  OrganizationUnitType,
} from '../contracts/index.js';

export interface OrganizationUnitResponse extends OrganizationUnitSummary {
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const organizationUnitResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: z.enum(['UNIT', 'BRANCH', 'DEPARTMENT']),
  parentId: z.string().uuid().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type { OrganizationUnitType, OrganizationUnitStatus, OrganizationUnitSummary };
