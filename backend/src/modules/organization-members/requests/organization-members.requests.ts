import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  assignUserOrganizationsSchema,
  listUserSubordinatesQuerySchema,
  userOrganizationAssignmentInputSchema,
  userStatusSchema,
} from '@modules/users/index.js';

const coercePositiveInt = z.preprocess((v) => Number(v), z.number().int().min(1));

export {
  assignUserOrganizationsSchema as assignOrganizationMembershipsSchema,
  listUserSubordinatesQuerySchema as listMemberSubordinatesQuerySchema,
  userOrganizationAssignmentInputSchema,
};

export type AssignOrganizationMembershipsRequest = z.infer<typeof assignUserOrganizationsSchema>;
export type ListMemberSubordinatesQuery = z.infer<typeof listUserSubordinatesQuerySchema>;

export const listOrganizationMembersQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(200)),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  managerId: optionalQueryParam(intQueryParam({ min: 1 })),
  status: optionalQueryParam(userStatusSchema),
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
