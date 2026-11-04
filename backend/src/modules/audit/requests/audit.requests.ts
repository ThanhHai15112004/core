import { z } from 'zod';
import { resolveDateRange } from '@packages/kernel/index.js';
import { parseSelectFields } from '@packages/http/index.js';

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
