import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

const coercePositiveInt = z.preprocess((v) => Number(v), z.number().int().min(1));

export const memberUserStatusSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const upper = val.trim().toUpperCase();
      if (upper === 'ACTIVE' || upper === '1') return 1;
      if (upper === 'INACTIVE' || upper === '2') return 2;
      if (upper === 'LOCKED' || upper === '3') return 3;
      if (upper === 'ARCHIVED' || upper === '4') return 4;
    }
    return val;
  },
  z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
);

export const userOrganizationAssignmentInputSchema = z
  .object({
    organizationUnitId: coercePositiveInt,
    isPrimary: z.boolean().optional().default(false),
    positionTitle: z.string().trim().max(128).nullable().optional(),
    startDate: z.string().trim().max(64).nullable().optional(),
    endDate: z.string().trim().max(64).nullable().optional(),
  })
  .refine(
    (item) => {
      if (!item.startDate || !item.endDate) return true;
      const startMs = new Date(item.startDate).getTime();
      const endMs = new Date(item.endDate).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;
      return endMs >= startMs;
    },
    {
      message: 'Organization membership endDate must be greater than or equal to startDate',
    },
  );

export type UserOrganizationAssignmentInput = z.infer<typeof userOrganizationAssignmentInputSchema>;

export const assignOrganizationMembershipsSchema = z.object({
  organizationUnits: z.array(userOrganizationAssignmentInputSchema),
  reason: z.string().trim().max(255).nullable().optional(),
});

export type AssignOrganizationMembershipsRequest = z.infer<
  typeof assignOrganizationMembershipsSchema
>;

export const listMemberSubordinatesQuerySchema = z.object({
  directOnly: optionalQueryParam(booleanQueryParam()),
  includeTemporary: optionalQueryParam(booleanQueryParam()),
});

export type ListMemberSubordinatesQuery = z.infer<typeof listMemberSubordinatesQuerySchema>;

export const listOrganizationMembersQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(200)),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  managerId: optionalQueryParam(intQueryParam({ min: 1 })),
  status: optionalQueryParam(memberUserStatusSchema),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 500 })),
});

export type ListOrganizationMembersQuery = z.infer<typeof listOrganizationMembersQuerySchema>;

export const transferOrganizationMemberSchema = z
  .object({
    fromOrganizationUnitId: coercePositiveInt,
    toOrganizationUnitId: coercePositiveInt,
    isPrimary: z.boolean().optional(),
    positionTitle: z.string().trim().max(128).nullable().optional(),
    startDate: z.string().trim().max(64).nullable().optional(),
    endDate: z.string().trim().max(64).nullable().optional(),
    reason: z.string().trim().max(255).nullable().optional(),
  })
  .refine((data) => data.fromOrganizationUnitId !== data.toOrganizationUnitId, {
    message: 'toOrganizationUnitId must differ from fromOrganizationUnitId',
  });

export type TransferOrganizationMemberRequest = z.infer<typeof transferOrganizationMemberSchema>;

export const updateOrganizationMemberManagersSchema = z.object({
  managerId: coercePositiveInt.nullable().optional(),
  temporaryManagerId: coercePositiveInt.nullable().optional(),
  temporaryManagerFrom: z.string().trim().max(64).nullable().optional(),
  temporaryManagerUntil: z.string().trim().max(64).nullable().optional(),
});

export type UpdateOrganizationMemberManagersRequest = z.infer<
  typeof updateOrganizationMemberManagersSchema
>;
