import { z } from 'zod';

export const workflowStateItemResponseSchema = z.object({
  id: z.number().int(),
  workflowDefinitionId: z.number().int(),
  code: z.string(),
  name: z.string(),
  stateType: z.string(),
  badgeTone: z.string(),
  slaHours: z.number().int().nullable(),
  approvalConfig: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number().int(),
});

export const workflowTransitionItemResponseSchema = z.object({
  id: z.number().int(),
  workflowDefinitionId: z.number().int(),
  code: z.string(),
  name: z.string(),
  fromStateCode: z.string(),
  toStateCode: z.string(),
  conditions: z.record(z.string(), z.unknown()),
  actions: z.array(z.record(z.string(), z.unknown())),
  sortOrder: z.number().int(),
});

export const workflowDefinitionResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  targetEntityType: z.string(),
  defaultSlaHours: z.number().int(),
  warningBeforeMinutes: z.number().int(),
  isSystem: z.boolean(),
  status: z.number().int(),
  statusName: z.string(),
  createdByUserId: z.number().int().nullable(),
  states: z.array(workflowStateItemResponseSchema),
  transitions: z.array(workflowTransitionItemResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workflowHistoryItemResponseSchema = z.object({
  id: z.number().int(),
  workflowInstanceId: z.number().int(),
  transitionCode: z.string().nullable(),
  actionType: z.string(),
  fromStateCode: z.string().nullable(),
  toStateCode: z.string(),
  actorUserId: z.number().int().nullable(),
  actorFullName: z.string().nullable(),
  actorUsername: z.string().nullable(),
  reason: z.string().nullable(),
  triggeredActions: z.array(z.record(z.string(), z.unknown())),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const workflowInstanceResponseSchema = z.object({
  id: z.number().int(),
  workflowDefinitionId: z.number().int(),
  workflowCode: z.string(),
  workflowVersion: z.number().int(),
  workflowName: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string(),
  title: z.string(),
  currentStateCode: z.string(),
  currentStateName: z.string().nullable(),
  currentStateBadgeTone: z.string().nullable(),
  status: z.number().int(),
  statusName: z.string(),
  initiatorUserId: z.number().int().nullable(),
  initiatorFullName: z.string().nullable(),
  organizationUnitId: z.number().int().nullable(),
  currentStepOrder: z.number().int(),
  dueAt: z.string().nullable(),
  warningSentAt: z.string().nullable(),
  overdueNotifiedAt: z.string().nullable(),
  isOverdue: z.boolean(),
  contextData: z.record(z.string(), z.unknown()),
  cancelReason: z.string().nullable(),
  cancelledByUserId: z.number().int().nullable(),
  completedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workflowInstanceDetailResponseSchema = workflowInstanceResponseSchema.extend({
  availableTransitions: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      fromStateCode: z.string(),
      toStateCode: z.string(),
      allowed: z.boolean(),
      blockedReasons: z.array(z.string()),
      requireReason: z.boolean(),
    }),
  ),
  approvalSteps: z.array(
    z.object({
      id: z.number().int(),
      workflowInstanceId: z.number().int(),
      stateCode: z.string(),
      stepOrder: z.number().int(),
      approvalMode: z.string(),
      approverUserId: z.number().int().nullable(),
      approverFullName: z.string().nullable(),
      approverUsername: z.string().nullable(),
      delegatedFromUserId: z.number().int().nullable(),
      approverRoleCode: z.string().nullable(),
      decision: z.string(),
      comment: z.string().nullable(),
      decidedAt: z.string().nullable(),
      decidedByUserId: z.number().int().nullable(),
    }),
  ),
  histories: z.array(workflowHistoryItemResponseSchema),
});

export const workflowSlaScanResponseSchema = z.object({
  scannedAt: z.string(),
  totalRunningChecked: z.number().int(),
  warningsTriggeredCount: z.number().int(),
  overdueMarkedCount: z.number().int(),
  warningInstanceIds: z.array(z.number().int()),
  overdueInstanceIds: z.array(z.number().int()),
});
