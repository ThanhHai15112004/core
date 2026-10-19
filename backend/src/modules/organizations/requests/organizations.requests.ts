import { z } from 'zod';
import {
  ORG_UNIT_STATUS,
  type OrganizationUnitStatusCode,
  type OrganizationUnitTypeCode,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';

const orgTypeSchema = z
  .preprocess(
    (val) => (val === undefined ? undefined : parseOrgUnitType(val)),
    z.number().int().min(1),
  )
  .optional();

const orgStatusSchema = z
  .preprocess(
    (val) => (val === undefined ? undefined : parseOrgUnitStatus(val)),
    z.union([
      z.literal(ORG_UNIT_STATUS.ACTIVE),
      z.literal(ORG_UNIT_STATUS.INACTIVE),
      z.literal(ORG_UNIT_STATUS.ARCHIVED),
    ]),
  )
  .optional();

const coerceOptionalIntId = z
  .preprocess((val) => {
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : val;
  }, z.number().int().min(1).nullable())
  .optional();

export const createOrganizationUnitSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Organization code may only contain letters, digits, _ and -'),
  name: z.string().trim().min(2).max(255),
  type: orgTypeSchema,
  parentId: coerceOptionalIntId,
  status: orgStatusSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

export interface CreateOrganizationUnitRequest {
  readonly code: string;
  readonly name: string;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly parentId?: number | null | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly description?: string | null | undefined;
}

export const updateOrganizationUnitSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  type: orgTypeSchema,
  parentId: coerceOptionalIntId,
  status: orgStatusSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

export interface UpdateOrganizationUnitRequest {
  readonly name?: string | undefined;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly parentId?: number | null | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly description?: string | null | undefined;
}

export const listOrganizationUnitsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  type: orgTypeSchema,
  status: orgStatusSchema,
  parentId: z
    .preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(1),
    )
    .optional(),
});

export interface ListOrganizationUnitsQuery {
  readonly search?: string | undefined;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly parentId?: number | undefined;
}
