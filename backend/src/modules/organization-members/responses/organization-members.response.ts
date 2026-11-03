import { z } from 'zod';
import {
  type UserOrganizationHistoryItemResponse,
  type UserResponse,
  type UserSubordinatesOverviewResponse,
  userOrganizationHistoryItemSchema,
  userResponseSchema,
  userSubordinatesOverviewResponseSchema,
} from '@modules/users/index.js';

export {
  userOrganizationHistoryItemSchema,
  userResponseSchema as organizationMemberResponseSchema,
  userSubordinatesOverviewResponseSchema as organizationMemberSubordinatesResponseSchema,
};

export const organizationMemberDetailResponseSchema = z.object({
  member: userResponseSchema,
  history: z.array(userOrganizationHistoryItemSchema),
  subordinatesOverview: userSubordinatesOverviewResponseSchema,
});

export interface OrganizationMemberDetailResponse {
  readonly member: UserResponse;
  readonly history: readonly UserOrganizationHistoryItemResponse[];
  readonly subordinatesOverview: UserSubordinatesOverviewResponse;
}
