import { z } from 'zod';
import { parseSelectFields } from '@packages/http/index.js';
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

export const ORGANIZATION_UNIT_SELECTABLE_FIELDS = [
  'id',
  'code',
  'name',
  'type',
  'parentId',
  'status',
  'description',
  'createdAt',
  'updatedAt',
] as const;

export const listOrganizationUnitsQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    q: z.string().trim().max(120).optional(),
    type: orgTypeSchema,
    status: orgStatusSchema,
    parentId: z
      .preprocess(
        (v) => (v === undefined || v === '' ? undefined : Number(v)),
        z.number().int().min(1),
      )
      .optional(),
    sortBy: z.enum(['id', 'code', 'name', 'createdAt']).optional(),
    sortOrder: z
      .preprocess(
        (val) => {
          if (typeof val === 'string') {
            const upper = val.trim().toUpperCase();
            if (upper === 'ASC' || upper === 'DESC') return upper;
          }
          return val;
        },
        z.enum(['ASC', 'DESC']),
      )
      .optional(),
    sort: z.string().trim().max(120).optional(),
    fields: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((raw): ListOrganizationUnitsQuery => {
    const fields = parseSelectFields(raw.fields, ORGANIZATION_UNIT_SELECTABLE_FIELDS);
    const keyword = raw.search ?? raw.q;
    return {
      search: keyword,
      q: keyword,
      type: raw.type,
      status: raw.status,
      parentId: raw.parentId,
      sortBy: raw.sortBy,
      sortOrder: raw.sortOrder,
      sort: raw.sort,
      fields,
    };
  });

export interface ListOrganizationUnitsQuery {
  readonly search?: string | undefined;
  readonly q?: string | undefined;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly parentId?: number | undefined;
  readonly sortBy?: 'id' | 'code' | 'name' | 'createdAt' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly sort?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}
