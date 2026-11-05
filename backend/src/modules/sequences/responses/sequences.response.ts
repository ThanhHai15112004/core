import { z } from 'zod';

export const sequenceCounterSnapshotResponseSchema = z.object({
  sequenceKey: z.string(),
  periodKey: z.string(),
  organizationUnitId: z.number().int().nullable(),
  unitScopeKey: z.string(),
  currentValue: z.number().int(),
  updatedAt: z.string(),
});

export const sequenceRuleResponseSchema = z.object({
  id: z.number().int(),
  key: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  prefix: z.string(),
  suffix: z.string(),
  separator: z.string(),
  dateFormat: z.number().int(),
  dateFormatName: z.enum(['NONE', 'YYYY', 'YY', 'YYYYMM', 'YYMM', 'YYYYMMDD', 'YYMMDD']),
  templatePattern: z.string().nullable(),
  resolvedTemplate: z.string(),
  paddingLength: z.number().int(),
  startValue: z.number().int(),
  step: z.number().int(),
  resetPolicy: z.number().int(),
  resetPolicyName: z.enum(['NEVER', 'YEARLY', 'MONTHLY', 'DAILY']),
  scopeByUnit: z.boolean(),
  timezone: z.string(),
  samplePreview: z.string(),
  currentPeriodKey: z.string(),
  currentCounterValue: z.number().int(),
  counters: z.array(sequenceCounterSnapshotResponseSchema),
  isSystem: z.boolean(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'ARCHIVED']),
  updatedBy: z.number().int().nullable(),
  updatedAt: z.string(),
});

export const sequencePreviewResponseSchema = z.object({
  sampleCode: z.string(),
  nextSampleCodes: z.array(z.string()),
  resolvedTemplate: z.string(),
  dateFormat: z.number().int(),
  dateFormatName: z.enum(['NONE', 'YYYY', 'YY', 'YYYYMM', 'YYMM', 'YYYYMMDD', 'YYMMDD']),
  resetPolicy: z.number().int(),
  resetPolicyName: z.enum(['NEVER', 'YEARLY', 'MONTHLY', 'DAILY']),
  periodKey: z.string(),
  unitScopeKey: z.string(),
  dateSegment: z.string(),
  paddingLength: z.number().int(),
  startValue: z.number().int(),
  step: z.number().int(),
});

export const sequenceGeneratedResponseSchema = z.object({
  key: z.string(),
  module: z.string(),
  code: z.string(),
  sequenceNumber: z.number().int(),
  paddedSequence: z.string(),
  periodKey: z.string(),
  unitScopeKey: z.string(),
  organizationUnitId: z.number().int().nullable(),
  dateSegment: z.string(),
  generatedAt: z.string(),
});

export const sequenceRuleHistoryResponseSchema = z.object({
  id: z.number().int(),
  sequenceId: z.number().int(),
  sequenceKey: z.string(),
  action: z.enum(['CREATE', 'UPDATE', 'RESET_COUNTER', 'ARCHIVE']),
  oldState: z.record(z.string(), z.unknown()).nullable(),
  newState: z.record(z.string(), z.unknown()),
  actorUserId: z.number().int().nullable(),
  actorIdentifier: z.string().nullable(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  createdAt: z.string(),
});

export const syncSequencesResultResponseSchema = z.object({
  syncedModules: z.array(z.string()),
  totalSequences: z.number().int(),
});
