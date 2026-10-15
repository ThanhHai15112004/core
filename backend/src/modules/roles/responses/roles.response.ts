import { z } from 'zod';
import type { RoleStatus, RoleSummary } from '../contracts/index.js';

export interface RoleResponse extends RoleSummary {
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PermissionCatalogItemResponse {
  readonly code: string;
  readonly module: string;
  readonly description: string;
}

export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  permissions: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const permissionCatalogItemSchema = z.object({
  code: z.string(),
  module: z.string(),
  description: z.string(),
});

export type { RoleStatus, RoleSummary };
