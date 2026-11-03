import { z } from 'zod';

export const approvalDelegationRuleResponseSchema = z.object({
  id: z.number().int().positive(),
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string(),
  workflowCodes: z.array(z.string()),
  entityTypes: z.array(z.string()),
  organizationUnitId: z.number().int().nullable(),
  reason: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type ApprovalDelegationRuleResponse = {
  readonly id: number;
  readonly fromUserId: number;
  readonly toUserId: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly workflowCodes: readonly string[];
  readonly entityTypes: readonly string[];
  readonly organizationUnitId: number | null;
  readonly reason: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
};

export const approvalStepSummaryResponseSchema = z.object({
  id: z.number().int().positive(),
  workflowInstanceId: z.number().int().positive(),
  stateCode: z.string(),
  stepOrder: z.number().int(),
  approvalMode: z.string(),
  approverUserId: z.number().int().nullable(),
  delegatedFromUserId: z.number().int().nullable(),
  approverRoleCode: z.string().nullable(),
  decision: z.string(),
  comment: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByUserId: z.number().int().nullable(),
  createdAt: z.string(),
});

export const approvalInstanceStepsOverviewResponseSchema = z.object({
  instanceId: z.number().int().positive(),
  workflowCode: z.string(),
  currentStateCode: z.string(),
  currentStepOrder: z.number().int(),
  status: z.number().int(),
  statusName: z.string(),
  approvalSteps: z.array(approvalStepSummaryResponseSchema),
});
