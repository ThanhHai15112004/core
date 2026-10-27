import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  parseWorkflowDefinitionStatus,
  parseWorkflowInstanceStatus,
} from '../contracts/index.js';

export const positiveIntParamSchema = z.coerce.number().int().positive();

const workflowCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Mã quy trình chỉ gồm chữ cái, chữ số, _ và -');

const stateCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Mã trạng thái chỉ gồm chữ cái, chữ số, _ và -');

export const workflowFieldRuleSchema = z.object({
  field: z.string().trim().min(1).max(128),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'exists']),
  value: z.unknown().optional(),
});

export const workflowTransitionConditionsSchema = z.object({
  requiredPermissions: z.array(z.string().trim().min(1)).optional(),
  allowedRoleCodes: z.array(z.string().trim().min(1)).optional(),
  onlyInitiator: z.boolean().optional(),
  onlyAssignedApprover: z.boolean().optional(),
  requireReason: z.boolean().optional(),
  fieldRules: z.array(workflowFieldRuleSchema).optional(),
});

export const workflowTransitionActionSchema = z.object({
  type: z.enum(['RECORD_HISTORY', 'NOTIFY', 'DISPATCH_JOB']),
  title: z.string().trim().max(255).optional(),
  content: z.string().trim().max(2000).optional(),
  notifyTargets: z
    .array(z.enum(['INITIATOR', 'NEXT_APPROVERS', 'CUSTOM_USERS', 'ROLE']))
    .optional(),
  targetUserIds: z.array(z.coerce.number().int().positive()).optional(),
  targetRoleCodes: z.array(z.string().trim().min(1)).optional(),
  jobTopic: z.string().trim().max(128).optional(),
  jobQueue: z.string().trim().max(128).optional(),
  jobPayload: z.record(z.string(), z.unknown()).optional(),
});

export const workflowStateApprovalConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z
    .enum([
      WORKFLOW_APPROVAL_MODE.SINGLE,
      WORKFLOW_APPROVAL_MODE.ALL,
      WORKFLOW_APPROVAL_MODE.ANY,
      WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN,
    ])
    .optional(),
  useManagerChain: z.boolean().optional(),
  maxChainLevels: z.coerce.number().int().min(1).max(10).optional(),
  approverUserIds: z.array(z.coerce.number().int().positive()).optional(),
  approverRoleCodes: z.array(z.string().trim().min(1)).optional(),
  autoTransitionOnApprove: z.string().trim().max(64).nullable().optional(),
  autoTransitionOnReject: z.string().trim().max(64).nullable().optional(),
  autoTransitionOnReturn: z.string().trim().max(64).nullable().optional(),
});

export const workflowStateInputSchema = z.object({
  code: stateCodeSchema,
  name: z.string().trim().min(1).max(128),
  stateType: z
    .enum([
      WORKFLOW_STATE_TYPE.INITIAL,
      WORKFLOW_STATE_TYPE.INTERMEDIATE,
      WORKFLOW_STATE_TYPE.FINAL_APPROVED,
      WORKFLOW_STATE_TYPE.FINAL_REJECTED,
      WORKFLOW_STATE_TYPE.CANCELLED,
    ])
    .default(WORKFLOW_STATE_TYPE.INTERMEDIATE),
  badgeTone: z.string().trim().max(32).default('info'),
  slaHours: z.coerce.number().int().min(1).max(720).nullable().optional(),
  approvalConfig: workflowStateApprovalConfigSchema.nullable().optional(),
  sortOrder: z.coerce.number().int().min(1).optional(),
});

export const workflowTransitionInputSchema = z.object({
  code: stateCodeSchema,
  name: z.string().trim().min(1).max(128),
  fromStateCode: stateCodeSchema,
  toStateCode: stateCodeSchema,
  conditions: workflowTransitionConditionsSchema.nullable().optional(),
  actions: z.array(workflowTransitionActionSchema).nullable().optional(),
  sortOrder: z.coerce.number().int().min(1).optional(),
});

const definitionStatusSchema = z
  .preprocess(
    (val) => (val === undefined || val === '' ? undefined : parseWorkflowDefinitionStatus(val)),
    z.union([
      z.literal(WORKFLOW_DEFINITION_STATUS.ACTIVE),
      z.literal(WORKFLOW_DEFINITION_STATUS.INACTIVE),
      z.literal(WORKFLOW_DEFINITION_STATUS.DRAFT),
      z.literal(WORKFLOW_DEFINITION_STATUS.ARCHIVED),
    ]),
  )
  .optional();

const instanceStatusSchema = z
  .preprocess(
    (val) => (val === undefined || val === '' ? undefined : parseWorkflowInstanceStatus(val)),
    z.union([
      z.literal(WORKFLOW_INSTANCE_STATUS.RUNNING),
      z.literal(WORKFLOW_INSTANCE_STATUS.COMPLETED),
      z.literal(WORKFLOW_INSTANCE_STATUS.REJECTED),
      z.literal(WORKFLOW_INSTANCE_STATUS.CANCELLED),
      z.literal(WORKFLOW_INSTANCE_STATUS.EXPIRED),
    ]),
  )
  .optional();

export const listWorkflowDefinitionsQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  search: optionalQueryParam(z.string().trim().max(128)),
  code: optionalQueryParam(z.string().trim().max(64)),
  targetEntityType: optionalQueryParam(z.string().trim().max(64)),
  status: definitionStatusSchema,
});

export type ListWorkflowDefinitionsQuery = z.infer<typeof listWorkflowDefinitionsQuerySchema>;

export const createWorkflowDefinitionSchema = z.object({
  code: workflowCodeSchema,
  version: z.coerce.number().int().min(1).optional(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).nullable().optional(),
  targetEntityType: z.string().trim().min(1).max(64).default('general'),
  defaultSlaHours: z.coerce.number().int().min(1).max(720).default(24),
  warningBeforeMinutes: z.coerce.number().int().min(5).max(10080).default(120),
  status: definitionStatusSchema,
  states: z.array(workflowStateInputSchema).min(1).optional(),
  transitions: z.array(workflowTransitionInputSchema).optional(),
});

export type CreateWorkflowDefinitionRequest = z.infer<typeof createWorkflowDefinitionSchema>;

export const updateWorkflowDefinitionSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  targetEntityType: z.string().trim().min(1).max(64).optional(),
  defaultSlaHours: z.coerce.number().int().min(1).max(720).optional(),
  warningBeforeMinutes: z.coerce.number().int().min(5).max(10080).optional(),
  status: definitionStatusSchema,
  states: z.array(workflowStateInputSchema).min(1).optional(),
  transitions: z.array(workflowTransitionInputSchema).optional(),
});

export type UpdateWorkflowDefinitionRequest = z.infer<typeof updateWorkflowDefinitionSchema>;

export const replaceWorkflowStatesSchema = z.object({
  states: z.array(workflowStateInputSchema).min(1),
});

export type ReplaceWorkflowStatesRequest = z.infer<typeof replaceWorkflowStatesSchema>;

export const replaceWorkflowTransitionsSchema = z.object({
  transitions: z.array(workflowTransitionInputSchema),
});

export type ReplaceWorkflowTransitionsRequest = z.infer<typeof replaceWorkflowTransitionsSchema>;

export const listWorkflowInstancesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  search: optionalQueryParam(z.string().trim().max(128)),
  workflowCode: optionalQueryParam(z.string().trim().max(64)),
  entityType: optionalQueryParam(z.string().trim().max(64)),
  entityId: optionalQueryParam(z.string().trim().max(128)),
  currentStateCode: optionalQueryParam(z.string().trim().max(64)),
  status: instanceStatusSchema,
  isOverdue: booleanQueryParam(),
  initiatorUserId: optionalQueryParam(z.coerce.number().int().positive()),
  organizationUnitId: optionalQueryParam(z.coerce.number().int().positive()),
});

export type ListWorkflowInstancesQuery = z.infer<typeof listWorkflowInstancesQuerySchema>;

export const startWorkflowInstanceSchema = z.object({
  workflowCode: workflowCodeSchema,
  entityType: z.string().trim().min(1).max(64),
  entityId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(2).max(255),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
  contextData: z.record(z.string(), z.unknown()).optional(),
  dueHoursOverride: z.coerce.number().int().min(1).max(720).nullable().optional(),
});

export type StartWorkflowInstanceRequest = z.infer<typeof startWorkflowInstanceSchema>;

export const executeWorkflowTransitionSchema = z.object({
  transitionCode: stateCodeSchema,
  reason: z.string().trim().max(1000).nullable().optional(),
  contextDataPatch: z.record(z.string(), z.unknown()).optional(),
});

export type ExecuteWorkflowTransitionRequest = z.infer<typeof executeWorkflowTransitionSchema>;

export const decideWorkflowApprovalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'RETURNED']),
  comment: z.string().trim().max(1000).nullable().optional(),
  transitionCodeOverride: z.string().trim().max(64).nullable().optional(),
});

export type DecideWorkflowApprovalRequest = z.infer<typeof decideWorkflowApprovalSchema>;

export const delegateWorkflowApprovalSchema = z.object({
  toUserId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(2).max(500),
});

export type DelegateWorkflowApprovalRequest = z.infer<typeof delegateWorkflowApprovalSchema>;

export const cancelWorkflowInstanceSchema = z.object({
  reason: z.string().trim().min(2).max(500),
  action: z.enum(['CANCEL', 'TERMINATE']).default('CANCEL'),
});

export type CancelWorkflowInstanceRequest = z.infer<typeof cancelWorkflowInstanceSchema>;
