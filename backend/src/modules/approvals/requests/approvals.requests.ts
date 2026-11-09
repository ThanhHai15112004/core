import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

export const createApprovalDelegationRuleSchema = z.object({
  fromUserId: z.number().int().min(1).optional(),
  toUserId: z.number().int().min(1),
  effectiveFrom: z.string().trim().min(10).max(64),
  effectiveUntil: z.string().trim().min(10).max(64),
  workflowCodes: z.array(z.string().trim().min(1).max(64)).max(50).optional().default([]),
  entityTypes: z.array(z.string().trim().min(1).max(64)).max(50).optional().default([]),
  organizationUnitId: z.number().int().min(1).nullable().optional().default(null),
  reason: z.string().trim().max(500).nullable().optional().default(null),
});

export type CreateApprovalDelegationRuleRequest = z.infer<
  typeof createApprovalDelegationRuleSchema
>;

export const listApprovalDelegationRulesQuerySchema = z.object({
  fromUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  toUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  activeOnly: optionalQueryParam(booleanQueryParam()),
});

export type ListApprovalDelegationRulesQuery = z.infer<
  typeof listApprovalDelegationRulesQuerySchema
>;

export const decideApprovalInstanceStepSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'RETURN', 'APPROVED', 'REJECTED', 'RETURNED']),
    stepId: z.number().int().min(1).optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
    targetStateCode: z.string().trim().max(64).optional(),
    returnToStateCode: z.string().trim().max(64).nullable().optional(),
    contextDataPatch: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (
        data.decision === 'REJECT' ||
        data.decision === 'RETURN' ||
        data.decision === 'REJECTED' ||
        data.decision === 'RETURNED'
      ) {
        return Boolean(data.comment && data.comment.trim().length >= 2);
      }
      return true;
    },
    {
      message: 'A reason/comment is required when rejecting or returning to a previous step',
    },
  );

export type DecideApprovalInstanceStepRequest = z.infer<typeof decideApprovalInstanceStepSchema>;

export const delegateApprovalInstanceStepSchema = z.object({
  stepId: z.number().int().min(1).nullable().optional(),
  toUserId: z.number().int().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
  effectiveFrom: z.string().trim().max(64).optional(),
  effectiveUntil: z.string().trim().max(64).optional(),
  workflowCodes: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

export type DelegateApprovalInstanceStepRequest = z.infer<
  typeof delegateApprovalInstanceStepSchema
>;
