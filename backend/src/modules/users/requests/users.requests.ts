import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

export const userStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']);

export const userOrganizationAssignmentInputSchema = z.object({
  organizationUnitId: z.string().uuid(),
  isPrimary: z.boolean().optional().default(false),
  positionTitle: z.string().trim().max(128).nullable().optional(),
});

export type UserOrganizationAssignmentInput = z.infer<typeof userOrganizationAssignmentInputSchema>;

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Username may only contain letters, digits, dot, underscore or hyphen',
    ),
  email: z.string().trim().email().max(255),
  fullName: z.string().trim().min(2).max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  password: z.string().min(8).max(128),
  status: userStatusSchema.default('ACTIVE'),
  roleIds: z.array(z.string().uuid()).default([]),
  organizationUnits: z.array(userOrganizationAssignmentInputSchema).default([]),
});

export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const lockUserSchema = z.object({
  reason: z.string().trim().min(2).max(255),
  lockedUntil: z.string().datetime().nullable().optional(),
});

export type LockUserRequest = z.infer<typeof lockUserSchema>;

export const changeUserStatusSchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().max(255).nullable().optional(),
  lockedUntil: z.string().datetime().nullable().optional(),
});

export type ChangeUserStatusRequest = z.infer<typeof changeUserStatusSchema>;

export const assignUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()),
});

export type AssignUserRolesRequest = z.infer<typeof assignUserRolesSchema>;

export const assignUserOrganizationsSchema = z.object({
  organizationUnits: z.array(userOrganizationAssignmentInputSchema),
});

export type AssignUserOrganizationsRequest = z.infer<typeof assignUserOrganizationsSchema>;

export const listUsersQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(120)),
  status: optionalQueryParam(userStatusSchema),
  roleId: optionalQueryParam(z.string().uuid()),
  organizationUnitId: optionalQueryParam(z.string().uuid()),
  includeArchived: optionalQueryParam(booleanQueryParam()),
  mfaEnabled: optionalQueryParam(booleanQueryParam()),
  page: optionalQueryParam(intQueryParam({ min: 1 })).default(1),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })).default(20),
  sortBy: optionalQueryParam(
    z.enum(['createdAt', 'fullName', 'email', 'username', 'status']),
  ).default('createdAt'),
  sortOrder: optionalQueryParam(z.enum(['ASC', 'DESC'])).default('DESC'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const bulkImportUserRowSchema = z.object({
  username: z.string().trim().min(3).max(64),
  email: z.string().trim().email().max(255),
  fullName: z.string().trim().min(2).max(255),
  phone: z.string().trim().max(32).nullable().optional(),
  password: z.string().min(8).max(128).optional(),
  status: userStatusSchema.optional().default('ACTIVE'),
  roleCodes: z.array(z.string().trim().min(1)).optional().default([]),
  organizationCodes: z.array(z.string().trim().min(1)).optional().default([]),
});

export type BulkImportUserRowInput = z.infer<typeof bulkImportUserRowSchema>;

export const bulkImportUsersSchema = z
  .object({
    csvContent: z.string().min(1).optional(),
    items: z.array(bulkImportUserRowSchema).optional(),
    defaultPassword: z.string().min(8).max(128).optional(),
    skipDuplicates: z.boolean().default(true),
  })
  .refine(
    (data) => Boolean(data.csvContent) || (Array.isArray(data.items) && data.items.length > 0),
    {
      message: 'Either csvContent or non-empty items array must be provided',
    },
  );

export type BulkImportUsersRequest = z.infer<typeof bulkImportUsersSchema>;
