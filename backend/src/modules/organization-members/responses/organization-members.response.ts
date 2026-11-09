import { z } from 'zod';
import type {
  OrganizationMemberSummaryView,
  UserApproverSummaryView,
  UserOrganizationHistoryActionType,
  UserOrganizationHistoryItemView,
  UserSubordinateSummaryView,
  UserSubordinatesOverviewView,
} from '../contracts/index.js';

export type UserOrganizationHistoryItemResponse = UserOrganizationHistoryItemView;
export type UserSubordinatesOverviewResponse = UserSubordinatesOverviewView;
export type OrganizationMemberResponse = OrganizationMemberSummaryView;

export const userOrganizationSummarySchema = z.object({
  organizationUnitId: z.number().int().min(1),
  code: z.string().optional(),
  name: z.string().optional(),
  type: z.number().int().optional(),
  typeName: z.string().optional(),
  isPrimary: z.boolean(),
  positionTitle: z.string().nullable(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const organizationMemberResponseSchema = z
  .object({
    id: z.number().int().min(1),
    username: z.string(),
    email: z.string().optional(),
    fullName: z.string(),
    primaryOrganizationUnitId: z.number().int().min(1).nullable().optional(),
    managerId: z.number().int().min(1).nullable().optional(),
    temporaryManagerId: z.number().int().min(1).nullable().optional(),
    temporaryManagerFrom: z.string().nullable().optional(),
    temporaryManagerUntil: z.string().nullable().optional(),
    effectiveManagerId: z.number().int().min(1).nullable().optional(),
    organizationUnits: z.array(userOrganizationSummarySchema),
  })
  .passthrough();

export const userOrganizationHistoryItemSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1),
  organizationUnitId: z.number().int().min(1),
  organizationUnitCode: z.string().nullable().optional(),
  organizationUnitName: z.string().nullable().optional(),
  fromOrganizationUnitId: z.number().int().min(1).nullable(),
  fromOrganizationUnitCode: z.string().nullable().optional(),
  fromOrganizationUnitName: z.string().nullable().optional(),
  actionType: z.enum([
    'ASSIGN',
    'TRANSFER',
    'UPDATE',
    'END',
  ] satisfies readonly UserOrganizationHistoryActionType[]),
  isPrimary: z.boolean(),
  positionTitle: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  reason: z.string().nullable(),
  changedBy: z.number().int().min(1).nullable(),
  createdAt: z.string(),
});

export const userSubordinateSummarySchema = z.object({
  id: z.number().int().min(1),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: z.number().int().min(1).max(4),
  statusName: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED']),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  primaryOrganizationUnitName: z.string().nullable().optional(),
  positionTitle: z.string().nullable(),
  managerId: z.number().int().min(1).nullable(),
  temporaryManagerId: z.number().int().min(1).nullable(),
  temporaryManagerFrom: z.string().nullable(),
  temporaryManagerUntil: z.string().nullable(),
  effectiveManagerId: z.number().int().min(1).nullable(),
  relationType: z.enum(['DIRECT', 'TEMPORARY', 'INDIRECT']),
  level: z.number().int().min(1),
});

export const userApproverSummarySchema = z.object({
  step: z.number().int().min(1),
  userId: z.number().int().min(1),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: z.number().int().min(1).max(4),
  primaryOrganizationUnitId: z.number().int().min(1).nullable(),
  positionTitle: z.string().nullable(),
  sourceType: z.enum(['DIRECT_MANAGER', 'TEMPORARY_MANAGER']),
});

export const userSubordinatesOverviewResponseSchema = z.object({
  userId: z.number().int().min(1),
  managerId: z.number().int().min(1),
  directCount: z.number().int().min(0),
  temporaryCount: z.number().int().min(0),
  indirectCount: z.number().int().min(0),
  totalSubordinates: z.number().int().min(0),
  subordinates: z.array(userSubordinateSummarySchema),
  approverChain: z.array(userApproverSummarySchema),
});

export { userSubordinatesOverviewResponseSchema as organizationMemberSubordinatesResponseSchema };

export const organizationMemberDetailResponseSchema = z.object({
  member: organizationMemberResponseSchema,
  history: z.array(userOrganizationHistoryItemSchema),
  subordinatesOverview: userSubordinatesOverviewResponseSchema,
});

export interface OrganizationMemberDetailResponse {
  readonly member: OrganizationMemberResponse;
  readonly history: readonly UserOrganizationHistoryItemResponse[];
  readonly subordinatesOverview: UserSubordinatesOverviewResponse;
}

export type { UserApproverSummaryView, UserSubordinateSummaryView };
