import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  DATA_REPAIR_ACTION_MODE,
  RECONCILIATION_DISCREPANCY_STATUS,
  parseDataRepairStatus,
  parseReconciliationDiscrepancyStatus,
  parseReconciliationDiscrepancyType,
  parseReconciliationRunStatus,
  parseReconciliationSeverity,
} from '../enum/reconciliation.enum.js';

const comparableRecordSchema = z.object({
  recordKey: z.string().trim().min(1).max(180),
  entityType: z.string().trim().max(80).nullable().optional(),
  entityId: z.string().trim().max(128).nullable().optional(),
  status: z.string().trim().max(64).nullable().optional(),
  amount: z.coerce.number().nullable().optional(),
  currency: z.string().trim().max(12).nullable().optional(),
  occurredAt: z.string().trim().max(64).nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

const matchingRulesSchema = z
  .object({
    amountTolerance: z.coerce.number().min(0).optional(),
    compareFields: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
    statusAliases: z.record(z.string(), z.string()).optional(),
    ignoreCaseOnStatus: z.boolean().optional(),
  })
  .optional();

export const CreateReconciliationJobSchema = z.object({
  jobCode: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  adapterCode: z.string().trim().min(2).max(64),
  targetModule: z.string().trim().min(2).max(64).optional(),
  scheduleCron: z.string().trim().max(64).nullable().optional(),
  isEnabled: z.boolean().optional(),
  defaultAssigneeUserId: z.coerce.number().int().positive().nullable().optional(),
  matchingRules: matchingRulesSchema,
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateReconciliationJobRequest = z.infer<typeof CreateReconciliationJobSchema>;

export const UpdateReconciliationJobSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  scheduleCron: z.string().trim().max(64).nullable().optional(),
  isEnabled: z.boolean().optional(),
  defaultAssigneeUserId: z.coerce.number().int().positive().nullable().optional(),
  matchingRules: matchingRulesSchema,
  config: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateReconciliationJobRequest = z.infer<typeof UpdateReconciliationJobSchema>;

export const ListReconciliationJobsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    adapterCode: optionalQueryParam(z.string().trim().min(1).max(64)),
    targetModule: optionalQueryParam(z.string().trim().min(1).max(64)),
    isEnabled: booleanQueryParam(),
    search: optionalQueryParam(z.string().trim().min(1).max(160)),
  }),
);

export type ListReconciliationJobsQuery = z.infer<typeof ListReconciliationJobsQuerySchema>;

export const TriggerReconciliationRunSchema = z.object({
  periodStart: z.string().trim().optional(),
  periodEnd: z.string().trim().optional(),
  async: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().trim().min(3).max(200).optional(),
  internalRecords: z.array(comparableRecordSchema).optional(),
  externalRecords: z.array(comparableRecordSchema).optional(),
  internalCsv: z.string().optional(),
  externalCsv: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export type TriggerReconciliationRunRequest = z.infer<typeof TriggerReconciliationRunSchema>;

const optionalRunStatusSchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseReconciliationRunStatus(val);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid reconciliation run status' });
      return z.NEVER;
    }
    return parsed;
  }),
);

export const ListReconciliationRunsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    jobId: optionalQueryParam(z.coerce.number().int().positive()),
    adapterCode: optionalQueryParam(z.string().trim().min(1).max(64)),
    triggerMode: optionalQueryParam(z.enum(['SCHEDULED', 'MANUAL'])),
    status: optionalRunStatusSchema,
    search: optionalQueryParam(z.string().trim().min(1).max(160)),
  }),
);

export type ListReconciliationRunsQuery = z.infer<typeof ListReconciliationRunsQuerySchema>;

const optionalDiscrepancyTypeSchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseReconciliationDiscrepancyType(val);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid discrepancy type' });
      return z.NEVER;
    }
    return parsed;
  }),
);

const optionalSeveritySchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseReconciliationSeverity(val);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid severity level' });
      return z.NEVER;
    }
    return parsed;
  }),
);

const optionalDiscrepancyStatusSchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseReconciliationDiscrepancyStatus(val);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid discrepancy status' });
      return z.NEVER;
    }
    return parsed;
  }),
);

export const ListDiscrepanciesQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    runId: optionalQueryParam(z.coerce.number().int().positive()),
    jobId: optionalQueryParam(z.coerce.number().int().positive()),
    discrepancyType: optionalDiscrepancyTypeSchema,
    severity: optionalSeveritySchema,
    status: optionalDiscrepancyStatusSchema,
    assigneeUserId: optionalQueryParam(z.coerce.number().int().positive()),
    search: optionalQueryParam(z.string().trim().min(1).max(180)),
  }),
);

export type ListDiscrepanciesQuery = z.infer<typeof ListDiscrepanciesQuerySchema>;

export const DiscrepancyReportQuerySchema = z.object({
  runId: optionalQueryParam(z.coerce.number().int().positive()),
  jobId: optionalQueryParam(z.coerce.number().int().positive()),
});

export type DiscrepancyReportQuery = z.infer<typeof DiscrepancyReportQuerySchema>;

export const AssignDiscrepancySchema = z.object({
  assigneeUserId: z.coerce.number().int().positive(),
  note: z.string().trim().max(500).optional(),
});

export type AssignDiscrepancyRequest = z.infer<typeof AssignDiscrepancySchema>;

export const UpdateDiscrepancyStatusSchema = z.object({
  status: z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseReconciliationDiscrepancyStatus(val);
    if (
      parsed === null ||
      (parsed !== RECONCILIATION_DISCREPANCY_STATUS.OPEN &&
        parsed !== RECONCILIATION_DISCREPANCY_STATUS.RESOLVED &&
        parsed !== RECONCILIATION_DISCREPANCY_STATUS.IGNORED)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Allowed manual status values: OPEN, RESOLVED, IGNORED',
      });
      return z.NEVER;
    }
    return parsed;
  }),
  note: z.string().trim().min(3).max(500),
});

export type UpdateDiscrepancyStatusRequest = z.infer<typeof UpdateDiscrepancyStatusSchema>;

export const PreviewDataRepairSchema = z.object({
  discrepancyId: z.coerce.number().int().positive().nullable().optional(),
  parentRepairId: z.coerce.number().int().positive().nullable().optional(),
  actionMode: z
    .enum([DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR, DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION])
    .optional(),
  handlerCode: z.string().trim().min(2).max(80),
  targetModule: z.string().trim().min(2).max(64).optional(),
  targetEntityType: z.string().trim().min(2).max(80).optional(),
  targetEntityId: z.string().trim().min(1).max(128).optional(),
  compensationType: z.string().trim().min(2).max(64).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().min(3).max(500),
});

export type PreviewDataRepairRequest = z.infer<typeof PreviewDataRepairSchema>;

export const ProposeDataRepairSchema = PreviewDataRepairSchema.extend({
  forceSensitive: z.boolean().optional(),
});

export type ProposeDataRepairRequest = z.infer<typeof ProposeDataRepairSchema>;

export const DecideDataRepairSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export type DecideDataRepairRequest = z.infer<typeof DecideDataRepairSchema>;

export const CreateCompensationSchema = z.object({
  handlerCode: z.string().trim().min(2).max(80).optional(),
  compensationType: z.string().trim().min(2).max(64),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().min(3).max(500),
});

export type CreateCompensationRequest = z.infer<typeof CreateCompensationSchema>;

const optionalRepairStatusSchema = optionalQueryParam(
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const parsed = parseDataRepairStatus(val);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid data repair status' });
      return z.NEVER;
    }
    return parsed;
  }),
);

export const ListDataRepairsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    discrepancyId: optionalQueryParam(z.coerce.number().int().positive()),
    status: optionalRepairStatusSchema,
    actionMode: optionalQueryParam(
      z.enum([DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR, DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION]),
    ),
    isSensitive: booleanQueryParam(),
    search: optionalQueryParam(z.string().trim().min(1).max(160)),
  }),
);

export type ListDataRepairsQuery = z.infer<typeof ListDataRepairsQuerySchema>;
