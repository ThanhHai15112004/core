import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  ACCESS_REVIEW_DECISION,
  ACCESS_REVIEW_STATUS,
  BREAK_GLASS_STATUS,
  PRIVILEGED_GRANT_STATUS,
  PRIVILEGED_SENSITIVITY_LEVEL,
  PRIVILEGED_TARGET_TYPE,
} from '../enum/privileged-access.enum.js';

export const idParamSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const reviewItemParamsSchema = z.object({
  id: z.coerce.number().int().min(1),
  itemId: z.coerce.number().int().min(1),
});

export const UpsertPrivilegedTargetRequestSchema = z.object({
  targetType: z.enum([PRIVILEGED_TARGET_TYPE.ROLE, PRIVILEGED_TARGET_TYPE.PERMISSION]),
  targetCode: z.string().trim().min(2).max(128),
  displayName: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  sensitivityLevel: z
    .enum([PRIVILEGED_SENSITIVITY_LEVEL.HIGH, PRIVILEGED_SENSITIVITY_LEVEL.CRITICAL])
    .optional()
    .default(PRIVILEGED_SENSITIVITY_LEVEL.HIGH),
  requireMfaStepUp: z.boolean().optional().default(true),
  requireApproval: z.boolean().optional().default(true),
  autoApproveAllowed: z.boolean().optional().default(false),
  maxGrantMinutes: z.number().int().min(5).max(10080).optional().default(120),
  alertOnUse: z.boolean().optional().default(true),
  reviewIntervalDays: z.number().int().min(7).max(365).optional().default(90),
  isEnabled: z.boolean().optional().default(true),
});

export type UpsertPrivilegedTargetRequest = z.infer<typeof UpsertPrivilegedTargetRequestSchema>;

export const UpdatePrivilegedTargetRequestSchema = UpsertPrivilegedTargetRequestSchema.omit({
  targetType: true,
  targetCode: true,
}).partial();

export type UpdatePrivilegedTargetRequest = z.infer<typeof UpdatePrivilegedTargetRequestSchema>;

export const ListPrivilegedTargetsQuerySchema = z.object({
  targetType: optionalQueryParam(
    z.enum([PRIVILEGED_TARGET_TYPE.ROLE, PRIVILEGED_TARGET_TYPE.PERMISSION]),
  ),
  isEnabled: optionalQueryParam(booleanQueryParam()),
  search: optionalQueryParam(z.string().trim().max(150)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListPrivilegedTargetsQuery = z.infer<typeof ListPrivilegedTargetsQuerySchema>;

export const ListDirectoryUsersQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(150)),
  privilegedOnly: optionalQueryParam(booleanQueryParam()),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListDirectoryUsersQuery = z.infer<typeof ListDirectoryUsersQuerySchema>;

export const CreatePrivilegedGrantRequestSchema = z.object({
  userId: z.number().int().min(1).optional(),
  targetType: z.enum([PRIVILEGED_TARGET_TYPE.ROLE, PRIVILEGED_TARGET_TYPE.PERMISSION]),
  targetCode: z.string().trim().min(2).max(128),
  reason: z.string().trim().min(5).max(1000),
  ticketRef: z.string().trim().max(120).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(10080).default(60),
});

export type CreatePrivilegedGrantRequest = z.infer<typeof CreatePrivilegedGrantRequestSchema>;

export const GrantDecisionRequestSchema = z.object({
  comment: z.string().trim().max(500).nullable().optional(),
});

export type GrantDecisionRequest = z.infer<typeof GrantDecisionRequestSchema>;

export const ListPrivilegedGrantsQuerySchema = z.object({
  userId: optionalQueryParam(intQueryParam({ min: 1 })),
  status: optionalQueryParam(
    z.union([
      intQueryParam({ min: 1, max: 6 }),
      z.enum(['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'EXPIRED', 'REVOKED', 'CANCELLED']),
    ]),
  ),
  targetType: optionalQueryParam(
    z.enum([PRIVILEGED_TARGET_TYPE.ROLE, PRIVILEGED_TARGET_TYPE.PERMISSION]),
  ),
  targetCode: optionalQueryParam(z.string().trim().max(128)),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListPrivilegedGrantsQuery = z.infer<typeof ListPrivilegedGrantsQuerySchema>;

export const CreateBreakGlassAccountRequestSchema = z
  .object({
    mode: z.enum(['LINK_EXISTING', 'CREATE_NEW']).optional(),
    existingUserId: z.number().int().min(1).optional(),
    existingIdentifier: z.string().trim().min(2).max(255).optional(),
    username: z.string().trim().min(3).max(64).optional(),
    email: z.string().trim().email().max(255).optional(),
    password: z.string().min(12).max(128).optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    code: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Break-glass code must contain only letters, digits, _ or -'),
    label: z.string().trim().min(2).max(160),
    description: z.string().trim().max(500).nullable().optional(),
    roleCode: z.string().trim().min(2).max(64).optional().default('super_admin'),
    requireMfa: z.boolean().optional().default(true),
    maxActivationMinutes: z.number().int().min(5).max(480).optional().default(60),
    alertRecipients: z.array(z.string().trim().min(1).max(150)).max(50).optional().default([]),
    sealImmediately: z.boolean().optional().default(true),
    activationReason: z.string().trim().max(1000).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
  })
  .superRefine((val, ctx) => {
    const isCreate =
      val.mode === 'CREATE_NEW' ||
      (!val.existingUserId && !val.existingIdentifier && Boolean(val.username || val.email));
    if (isCreate) {
      if (!val.username || !val.email || !val.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'username, email, and password are required when creating a new break-glass user',
          path: ['username'],
        });
      }
    } else if (!val.existingUserId && !val.existingIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'existingUserId or existingIdentifier is required when linking an existing user',
        path: ['existingUserId'],
      });
    }
  });

export type CreateBreakGlassAccountRequest = z.infer<typeof CreateBreakGlassAccountRequestSchema>;

export const ActivateBreakGlassRequestSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  ticketRef: z.string().trim().max(120).nullable().optional(),
});

export type ActivateBreakGlassRequest = z.infer<typeof ActivateBreakGlassRequestSchema>;

export const SealBreakGlassRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

export type SealBreakGlassRequest = z.infer<typeof SealBreakGlassRequestSchema>;

export const ListBreakGlassAccountsQuerySchema = z.object({
  status: optionalQueryParam(intQueryParam({ min: 1, max: 4 })),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListBreakGlassAccountsQuery = z.infer<typeof ListBreakGlassAccountsQuerySchema>;

export const ListPrivilegedAlertsQuerySchema = z.object({
  eventType: optionalQueryParam(z.string().trim().max(64)),
  severity: optionalQueryParam(z.string().trim().max(16)),
  actorUserId: optionalQueryParam(intQueryParam({ min: 1 })),
  unacknowledgedOnly: optionalQueryParam(booleanQueryParam()),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListPrivilegedAlertsQuery = z.infer<typeof ListPrivilegedAlertsQuerySchema>;

export const AcknowledgeAlertRequestSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

export type AcknowledgeAlertRequest = z.infer<typeof AcknowledgeAlertRequestSchema>;

export const CreatePrivilegedReviewRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  dueDays: z.number().int().min(1).max(90).optional(),
});

export type CreatePrivilegedReviewRequest = z.infer<typeof CreatePrivilegedReviewRequestSchema>;

export const DecideReviewItemRequestSchema = z.object({
  decision: z.enum(['KEEP', 'REVOKE']),
  note: z.string().trim().max(500).nullable().optional(),
});

export type DecideReviewItemRequest = z.infer<typeof DecideReviewItemRequestSchema>;

export const ListPrivilegedReviewsQuerySchema = z.object({
  status: optionalQueryParam(
    z.union([intQueryParam({ min: 1, max: 3 }), z.enum(['OPEN', 'COMPLETED', 'CANCELLED'])]),
  ),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListPrivilegedReviewsQuery = z.infer<typeof ListPrivilegedReviewsQuerySchema>;

export {
  PRIVILEGED_GRANT_STATUS,
  BREAK_GLASS_STATUS,
  ACCESS_REVIEW_STATUS,
  ACCESS_REVIEW_DECISION,
};
