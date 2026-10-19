import { z } from 'zod';
import type {
  PermissionStatusCode,
  PermissionStatusName,
  RoleStatusCode,
  RoleStatusName,
} from '../contracts/index.js';

export interface PermissionCatalogItemResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly description: string | null;
  readonly status: PermissionStatusCode;
  readonly statusName: PermissionStatusName;
}

export const permissionCatalogItemResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  module: z.string(),
  description: z.string().nullable(),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
});

export interface RoleResponse {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly status: RoleStatusCode;
  readonly statusName: RoleStatusName;
  readonly permissionIds: readonly number[];
  readonly permissions: readonly string[];
  readonly userCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const roleResponseSchema = z.object({
  id: z.number().int().min(1),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
  permissionIds: z.array(z.number().int().min(1)),
  permissions: z.array(z.string()),
  userCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export interface RoleAssignedUserResponse {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: number;
  readonly statusName: string;
  readonly primaryOrganizationUnitId: number | null;
  readonly assignedAt: string;
}

export const roleAssignedUserResponseSchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  status: z.number().int(),
  statusName: z.string(),
  primaryOrganizationUnitId: z.number().int().nullable(),
  assignedAt: z.string(),
});
