import { z } from 'zod';
import { resolveDateRange } from '@packages/kernel/index.js';
import { parseSelectFields } from '@packages/http/index.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  ROLE_STATUS,
  type RoleStatusCode,
  parseDataScope,
  parseRoleStatus,
} from '../contracts/index.js';

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

export const AUDIT_LOG_SELECTABLE_FIELDS = [
  'id',
  'actorType',
  'actorTypeName',
  'actorUserId',
  'actorServiceAccountId',
  'actorApiClientId',
  'actorIdentifier',
  'module',
  'feature',
  'action',
  'resourceType',
  'resourceId',
  'beforeData',
  'afterData',
  'reason',
  'ipAddress',
  'userAgent',
  'requestId',
  'correlationId',
  'createdAt',
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

const modulePermissionDeclarationSchema = z.union([
  z.string().trim().min(2).max(128),
  z.object({
    code: z.string().trim().min(2).max(128),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    featureGroup: z.string().trim().min(1).max(100).optional(),
  }),
]);

export const syncPermissionsSchema = z
  .object({
    modules: z
      .array(
        z.object({
          module: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(/^[a-z0-9_-]+$/i, 'Module name may only contain letters, digits, _ and -'),
          displayName: z.string().trim().min(1).max(150).optional(),
          permissions: z.array(modulePermissionDeclarationSchema),
        }),
      )
      .optional(),
    replaceActiveModules: z.boolean().optional(),
  })
  .default({});

export interface SyncPermissionsRequest {
  readonly modules?:
    | readonly {
        readonly module: string;
        readonly displayName?: string | undefined;
        readonly permissions: readonly (
          | string
          | {
              readonly code: string;
              readonly name?: string | undefined;
              readonly description?: string | null | undefined;
              readonly featureGroup?: string | undefined;
            }
        )[];
      }[]
    | undefined;
  readonly replaceActiveModules?: boolean | undefined;
}

const optionalPositiveIntQuery = z
  .preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(1).optional(),
  )
  .optional();

export const listAuditLogsQuerySchema = z
  .object({
    page: optionalPositiveIntQuery,
    limit: optionalPositiveIntQuery,
    q: z.string().trim().max(150).optional(),
    search: z.string().trim().max(150).optional(),
    actorType: z
      .preprocess(
        (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
        z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      )
      .optional(),
    actorUserId: optionalPositiveIntQuery,
    actorServiceAccountId: optionalPositiveIntQuery,
    module: z.string().trim().max(64).optional(),
    feature: z.string().trim().max(128).optional(),
    action: z.string().trim().max(128).optional(),
    resourceType: z.string().trim().max(64).optional(),
    resourceId: z.string().trim().max(64).optional(),
    requestId: z.string().trim().max(128).optional(),
    correlationId: z.string().trim().max(128).optional(),
    ipAddress: z.string().trim().max(64).optional(),
    fromDate: z.string().trim().max(64).optional(),
    toDate: z.string().trim().max(64).optional(),
    sortBy: z.enum(['id', 'createdAt', 'module', 'action']).optional(),
    sortOrder: normalizedSortOrderSchema,
    sort: z.string().trim().max(120).optional(),
    fields: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((raw): ListAuditLogsQuery => {
    resolveDateRange(raw.fromDate, raw.toDate, {
      fromFieldName: 'fromDate',
      toFieldName: 'toDate',
    });
    const fields = parseSelectFields(raw.fields, AUDIT_LOG_SELECTABLE_FIELDS);
    const keyword = raw.q ?? raw.search;
    return {
      page: raw.page,
      limit: raw.limit,
      q: keyword,
      search: keyword,
      actorType: raw.actorType,
      actorUserId: raw.actorUserId,
      actorServiceAccountId: raw.actorServiceAccountId,
      module: raw.module,
      feature: raw.feature,
      action: raw.action,
      resourceType: raw.resourceType,
      resourceId: raw.resourceId,
      requestId: raw.requestId,
      correlationId: raw.correlationId,
      ipAddress: raw.ipAddress,
      fromDate: raw.fromDate,
      toDate: raw.toDate,
      sortBy: raw.sortBy,
      sortOrder: raw.sortOrder,
      sort: raw.sort,
      fields,
    };
  });

export interface ListAuditLogsQuery {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly q?: string | undefined;
  readonly search?: string | undefined;
  readonly actorType?: 1 | 2 | 3 | undefined;
  readonly actorUserId?: number | undefined;
  readonly actorServiceAccountId?: number | undefined;
  readonly module?: string | undefined;
  readonly feature?: string | undefined;
  readonly action?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly ipAddress?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly sortBy?: 'id' | 'createdAt' | 'module' | 'action' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly sort?: string | undefined;
  readonly fields?: readonly string[] | undefined;
}
