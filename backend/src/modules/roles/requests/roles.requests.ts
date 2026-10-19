import { z } from 'zod';
import { ROLE_STATUS, type RoleStatusCode, parseRoleStatus } from '../contracts/index.js';

const roleStatusSchema = z
  .preprocess(
    (val) => (val === undefined ? undefined : parseRoleStatus(val)),
    z.union([z.literal(ROLE_STATUS.ACTIVE), z.literal(ROLE_STATUS.INACTIVE)]),
  )
  .optional();

const coerceIntArray = z.array(z.preprocess((v) => Number(v), z.number().int().min(1))).optional();

export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'Role code may only contain letters, digits, _ and -'),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  status: roleStatusSchema,
  permissionIds: coerceIntArray,
  permissions: z.array(z.string().trim().min(2).max(128)).optional(),
});

export interface CreateRoleRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly status?: RoleStatusCode | undefined;
  readonly permissionIds?: readonly number[] | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: roleStatusSchema,
  permissionIds: coerceIntArray,
  permissions: z.array(z.string().trim().min(2).max(128)).optional(),
});

export interface UpdateRoleRequest {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly status?: RoleStatusCode | undefined;
  readonly permissionIds?: readonly number[] | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export const setRolePermissionsSchema = z.object({
  permissionIds: coerceIntArray,
  permissions: z.array(z.string().trim().min(2).max(128)).optional(),
});

export interface SetRolePermissionsRequest {
  readonly permissionIds?: readonly number[] | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export const cloneRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'Role code may only contain letters, digits, _ and -'),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  status: roleStatusSchema,
});

export interface CloneRoleRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly status?: RoleStatusCode | undefined;
}

export const listRolesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: roleStatusSchema,
});

export interface ListRolesQuery {
  readonly search?: string | undefined;
  readonly status?: RoleStatusCode | undefined;
}
