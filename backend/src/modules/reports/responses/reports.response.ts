import { z } from 'zod';

export const reportTemporaryDownloadResponseSchema = z.object({
  token: z.string(),
  downloadUrl: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  totalExported: z.number(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  expiresAt: z.string(),
  csvContent: z.string().optional(),
  xlsxBase64: z.string().optional(),
  pdfBase64: z.string().optional(),
});

export interface ReportExecutionResponse {
  readonly reportCode: string;
  readonly reportName: string;
  readonly module: string;
  readonly category: 'REPORT' | 'DASHBOARD';
  readonly requiredPermission: string;
  readonly historyId: number;
  readonly jobId: string | null;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  readonly executionMode: 'SYNC' | 'QUEUE' | 'SCHEDULED';
  readonly dataSourceUsed: 'REPLICA' | 'PRIMARY' | 'CACHE';
  readonly cacheHit: boolean;
  readonly cacheKey: string | null;
  readonly parameters: {
    readonly fromDate: string | null;
    readonly toDate: string | null;
    readonly statuses: readonly (string | number)[];
    readonly organizationUnitId: number | null;
    readonly includeSubUnits: boolean;
    readonly filters: Readonly<Record<string, unknown>>;
  };
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly format?: 'csv' | 'xlsx' | 'pdf' | null | undefined;
  readonly fileName?: string | null | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly notifiedChannels: readonly ('EMAIL' | 'IN_APP')[];
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

export const registeredReportDefinitionResponseSchema = z.object({
  code: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(['REPORT', 'DASHBOARD']),
  requiredPermission: z.string(),
  isHeavy: z.boolean(),
  heavyRecordThreshold: z.number(),
  cacheTtlSeconds: z.number(),
  supportsReadReplica: z.boolean(),
  supportedFormats: z.array(z.enum(['xlsx', 'csv', 'pdf'])),
  parameters: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      type: z.enum([
        'date-range',
        'status',
        'organization-unit',
        'filter',
        'string',
        'number',
        'boolean',
      ]),
      required: z.boolean().optional(),
      defaultValue: z.unknown().optional(),
      allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  ),
  isSystem: z.boolean(),
  status: z.number(),
});

export const reportExecutionResponseSchema = z.object({
  reportCode: z.string(),
  reportName: z.string(),
  module: z.string(),
  category: z.enum(['REPORT', 'DASHBOARD']),
  requiredPermission: z.string(),
  historyId: z.number(),
  jobId: z.string().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  executionMode: z.enum(['SYNC', 'QUEUE', 'SCHEDULED']),
  dataSourceUsed: z.enum(['REPLICA', 'PRIMARY', 'CACHE']),
  cacheHit: z.boolean(),
  cacheKey: z.string().nullable(),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  totalRecords: z.number(),
  summary: z.record(z.string(), z.unknown()),
  rows: z.array(z.record(z.string(), z.unknown())),
  format: z.enum(['csv', 'xlsx', 'pdf']).nullable().optional(),
  fileName: z.string().nullable().optional(),
  downloadToken: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  notifiedChannels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});

export const reportScheduleItemResponseSchema = z.object({
  id: z.number(),
  reportCode: z.string(),
  module: z.string(),
  name: z.string(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  cronExpression: z.string(),
  hour: z.number(),
  minute: z.number(),
  dayOfWeek: z.number().nullable(),
  dayOfMonth: z.number().nullable(),
  timezone: z.string(),
  format: z.enum(['xlsx', 'csv', 'pdf']),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  channels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  recipientEmails: z.array(z.string()),
  recipientUserIds: z.array(z.number()),
  ttlSeconds: z.number(),
  actorId: z.number().nullable(),
  isActive: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const reportHistoryItemResponseSchema = z.object({
  id: z.number(),
  jobId: z.string().nullable(),
  scheduleId: z.number().nullable(),
  reportCode: z.string(),
  module: z.string(),
  reportName: z.string(),
  actorId: z.number().nullable(),
  parameters: z.object({
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
    statuses: z.array(z.union([z.string(), z.number()])),
    organizationUnitId: z.number().nullable(),
    includeSubUnits: z.boolean(),
    filters: z.record(z.string(), z.unknown()),
  }),
  executionMode: z.enum(['SYNC', 'QUEUE', 'SCHEDULED']),
  dataSourceUsed: z.enum(['REPLICA', 'PRIMARY', 'CACHE']),
  cacheHit: z.boolean(),
  cacheKey: z.string().nullable(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  format: z.enum(['xlsx', 'csv', 'pdf']).nullable(),
  fileName: z.string().nullable(),
  totalRecords: z.number(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  downloadToken: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isExpired: z.boolean(),
  notifiedChannels: z.array(z.enum(['EMAIL', 'IN_APP'])),
  recipientEmails: z.array(z.string()),
  recipientUserIds: z.array(z.number()),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
});
