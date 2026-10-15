import { z } from 'zod';
import { optionalQueryParam } from '@packages/http/index.js';

export const organizationUnitTypeSchema = z.enum(['UNIT', 'BRANCH', 'DEPARTMENT']);
export const organizationUnitStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createOrganizationUnitSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code must contain only letters, digits, underscore or hyphen'),
  name: z.string().trim().min(2).max(255),
  type: organizationUnitTypeSchema.default('BRANCH'),
  parentId: z.string().uuid().nullable().optional(),
  status: organizationUnitStatusSchema.default('ACTIVE'),
  description: z.string().trim().max(1000).nullable().optional(),
});

export type CreateOrganizationUnitRequest = z.infer<typeof createOrganizationUnitSchema>;

export const updateOrganizationUnitSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  type: organizationUnitTypeSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
  status: organizationUnitStatusSchema.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export type UpdateOrganizationUnitRequest = z.infer<typeof updateOrganizationUnitSchema>;

export const listOrganizationUnitsQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(120)),
  type: optionalQueryParam(organizationUnitTypeSchema),
  status: optionalQueryParam(organizationUnitStatusSchema),
  parentId: optionalQueryParam(z.string().uuid()),
});

export type ListOrganizationUnitsQuery = z.infer<typeof listOrganizationUnitsQuerySchema>;
