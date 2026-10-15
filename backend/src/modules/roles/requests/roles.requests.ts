import { z } from 'zod';
import { optionalQueryParam } from '@packages/http/index.js';

export const roleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Role code must be lowercase alphanumeric, underscore or hyphen'),
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).nullable().optional(),
  status: roleStatusSchema.default('ACTIVE'),
  permissions: z.array(z.string().trim().min(1).max(128)).default([]),
});

export type CreateRoleRequest = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: roleStatusSchema.optional(),
  permissions: z.array(z.string().trim().min(1).max(128)).optional(),
});

export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(128)),
});

export type SetRolePermissionsRequest = z.infer<typeof setRolePermissionsSchema>;

export const listRolesQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(120)),
  status: optionalQueryParam(roleStatusSchema),
});

export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
