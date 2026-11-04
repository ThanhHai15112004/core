import { z } from 'zod';
import { parseSelectFields } from '@packages/http/index.js';
import {
  AUDIT_LOG_SELECTABLE_FIELDS,
  type ListAuditLogsQuery,
  listAuditLogsQuerySchema,
} from '@modules/audit/index.js';
import { type SyncPermissionsRequest, syncPermissionsSchema } from '@modules/permissions/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  ROLE_STATUS,
  type RoleStatusCode,
  parseDataScope,
  parseRoleStatus,
} from '../contracts/index.js';

export {
  AUDIT_LOG_SELECTABLE_FIELDS,
  type ListAuditLogsQuery,
  listAuditLogsQuerySchema,
  type SyncPermissionsRequest,
  syncPermissionsSchema,
};

const roleStatusSchema = z
  .preprocess(
    (val) => (val === undefined ? undefined : parseRoleStatus(val)),
    z.union([z.literal(ROLE_STATUS.ACTIVE), z.literal(ROLE_STATUS.INACTIVE)]),
  )
  .optional();

export const roleDataScopeSchema = z
  .preprocess(
    (val) => (val === undefined ? undefined : parseDataScope(val)),
    z.union([
      z.literal(DATA_SCOPE.ALL),
      z.literal(DATA_SCOPE.ORG_UNIT),
      z.literal(DATA_SCOPE.SUBORDINATES),
      z.literal(DATA_SCOPE.SELF),
    ]),
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
  dataScope: roleDataScopeSchema,
  status: roleStatusSchema,
  permissionIds: coerceIntArray,
  permissions: z.array(z.string().trim().min(2).max(128)).optional(),
});

export interface CreateRoleRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly dataScope?: DataScopeCode | undefined;
  readonly status?: RoleStatusCode | undefined;
  readonly permissionIds?: readonly number[] | undefined;
  readonly permissions?: readonly string[] | undefined;
}

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  dataScope: roleDataScopeSchema,
  status: roleStatusSchema,
  permissionIds: coerceIntArray,
  permissions: z.array(z.string().trim().min(2).max(128)).optional(),
});

export interface UpdateRoleRequest {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly dataScope?: DataScopeCode | undefined;
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

export const assignUserRolesSchema = z.object({
  roleIds: z
    .array(z.preprocess((v) => Number(v), z.number().int().min(1)))
    .min(1, 'At least one role is required'),
  stepUpToken: z.string().trim().min(10).optional(),
  requireStepUp: z.boolean().optional(),
});

export interface AssignUserRolesRequest {
  readonly roleIds: readonly number[];
  readonly stepUpToken?: string | undefined;
  readonly requireStepUp?: boolean | undefined;
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
  dataScope: roleDataScopeSchema,
  status: roleStatusSchema,
});

export interface CloneRoleRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly dataScope?: DataScopeCode | undefined;
  readonly status?: RoleStatusCode | undefined;
}

export const ROLE_SELECTABLE_FIELDS = [
  'id',
  'code',
  'name',
  'description',
  'isSystem',
  'dataScope',
  'dataScopeName',
  'status',
  'userCount',
  'permissions',
  'permissionItems',
  'createdAt',
  'updatedAt',
] as const;

const normalizedSortOrderSchema = z
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
  .optional();

export const listRolesQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    q: z.string().trim().max(120).optional(),
    status: roleStatusSchema,
    dataScope: roleDataScopeSchema,
    sortBy: z.enum(['id', 'code', 'name', 'createdAt']).optional(),
    sortOrder: normalizedSortOrderSchema,
    sort: z.string().trim().max(120).optional(),
    fields: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((raw): ListRolesQuery => {
    const fields = parseSelectFields(raw.fields, ROLE_SELECTABLE_FIELDS);
    return {
      search: raw.search ?? raw.q,
      q: raw.q ?? raw.search,
      status: raw.status,
      dataScope: raw.dataScope,
      sortBy: raw.sortBy,
      sortOrder: raw.sortOrder,
      sort: raw.sort,
      fields,
    };
  });

export interface ListRolesQuery {
  readonly search?: string | undefined;
  readonly q?: string | undefined;
  readonly status?: RoleStatusCode | undefined;
  readonly dataScope?: DataScopeCode | undefined;
  readonly sortBy?: 'id' | 'code' | 'name' | 'createdAt' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly sort?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}
