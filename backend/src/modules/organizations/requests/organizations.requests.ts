import { z } from 'zod';
import { parseSelectFields } from '@packages/http/index.js';
import {
  ORG_UNIT_STATUS,
  type OrganizationUnitStatusCode,
  type OrganizationUnitTypeCode,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';

const orgCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Organization code may only contain letters, digits, _ and -');

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
    if (val === undefined) return undefined;
    if (val === null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : val;
  }, z.number().int().min(1).nullable())
  .optional();

export const createOrganizationUnitSchema = z.object({
  code: orgCodeSchema,
  name: z.string().trim().min(2).max(255),
  type: orgTypeSchema,
  parentId: coerceOptionalIntId,
  managerId: coerceOptionalIntId,
  status: orgStatusSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

export interface CreateOrganizationUnitRequest {
  readonly code: string;
  readonly name: string;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly parentId?: number | null | undefined;
  readonly managerId?: number | null | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly description?: string | null | undefined;
}

export const updateOrganizationUnitSchema = z.object({
  code: orgCodeSchema.optional(),
  name: z.string().trim().min(2).max(255).optional(),
  type: orgTypeSchema,
  parentId: coerceOptionalIntId,
  managerId: coerceOptionalIntId,
  status: orgStatusSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

export interface UpdateOrganizationUnitRequest {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly parentId?: number | null | undefined;
  readonly managerId?: number | null | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly description?: string | null | undefined;
}

export const moveOrganizationUnitQuerySchema = z.object({
  newParentId: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '' || val === 'null' || val === 'ROOT') {
        return null;
      }
      const n = Number(val);
      return Number.isFinite(n) ? n : val;
    }, z.number().int().min(1).nullable())
    .default(null),
});

export interface MoveOrganizationUnitQuery {
  readonly newParentId: number | null;
}

export const moveOrganizationUnitSchema = z.object({
  newParentId: coerceOptionalIntId,
  reason: z.string().trim().max(500).optional(),
});

export interface MoveOrganizationUnitRequest {
  readonly newParentId?: number | null | undefined;
  readonly reason?: string | undefined;
}

export const lockOrganizationUnitSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export interface LockOrganizationUnitRequest {
  readonly reason?: string | undefined;
}

export const ORGANIZATION_UNIT_SELECTABLE_FIELDS = [
  'id',
  'code',
  'name',
  'type',
  'parentId',
  'managerId',
  'managerName',
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
    managerId: z
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
      managerId: raw.managerId,
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
  readonly managerId?: number | undefined;
  readonly sortBy?: 'id' | 'code' | 'name' | 'createdAt' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly sort?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}

export const exportOrganizationUnitsQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  mode: z.enum(['tree', 'list']).default('tree'),
  search: z.string().trim().max(120).optional(),
  type: orgTypeSchema,
  status: orgStatusSchema,
  parentId: z
    .preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(1),
    )
    .optional(),
  managerId: z
    .preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(1),
    )
    .optional(),
  title: z.string().trim().max(200).optional(),
});

export interface ExportOrganizationUnitsQuery {
  readonly format?: 'csv' | 'xlsx' | undefined;
  readonly mode?: 'tree' | 'list' | undefined;
  readonly search?: string | undefined;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly parentId?: number | undefined;
  readonly managerId?: number | undefined;
  readonly title?: string | undefined;
}

export const exportOrganizationTemplateQuerySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});

export interface ExportOrganizationTemplateQuery {
  readonly format?: 'csv' | 'xlsx' | undefined;
}

export const bulkImportOrganizationRowSchema = z.object({
  code: orgCodeSchema,
  name: z.string().trim().min(2).max(255),
  type: orgTypeSchema,
  parentCode: z
    .string()
    .trim()
    .max(64)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  parentId: coerceOptionalIntId,
  managerId: coerceOptionalIntId,
  managerIdentifier: z.string().trim().max(120).nullable().optional(),
  status: orgStatusSchema,
  description: z.string().trim().max(1000).nullable().optional(),
});

export interface BulkImportOrganizationRowInput {
  readonly code: string;
  readonly name: string;
  readonly type?: OrganizationUnitTypeCode | undefined;
  readonly parentCode?: string | null | undefined;
  readonly parentId?: number | null | undefined;
  readonly managerId?: number | null | undefined;
  readonly managerIdentifier?: string | null | undefined;
  readonly status?: OrganizationUnitStatusCode | undefined;
  readonly description?: string | null | undefined;
}

export const bulkImportOrganizationsSchema = z.object({
  items: z.array(bulkImportOrganizationRowSchema).optional(),
  csvContent: z.string().optional(),
  xlsxBase64: z.string().optional(),
  skipDuplicates: z.boolean().default(true),
  updateExisting: z.boolean().default(false),
});

export interface BulkImportOrganizationsRequest {
  readonly items?: readonly BulkImportOrganizationRowInput[] | undefined;
  readonly csvContent?: string | undefined;
  readonly xlsxBase64?: string | undefined;
  readonly skipDuplicates?: boolean | undefined;
  readonly updateExisting?: boolean | undefined;
}
