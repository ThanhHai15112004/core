import type {
  UserApproverSummaryView,
  UserOrganizationAssignmentSummary,
  UserOrganizationHistoryItemView,
  UserSubordinateSummaryView,
} from '@modules/users/contracts/index.js';

export interface OrganizationMemberTransferInput {
  readonly fromOrganizationUnitId: number;
  readonly toOrganizationUnitId: number;
  readonly isPrimary?: boolean | undefined;
  readonly positionTitle?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly reason?: string | null | undefined;
}

export interface OrganizationMemberManagersInput {
  readonly managerId?: number | null | undefined;
  readonly temporaryManagerId?: number | null | undefined;
  readonly temporaryManagerFrom?: string | null | undefined;
  readonly temporaryManagerUntil?: string | null | undefined;
}

export interface IOrganizationMembersPublicService {
  getOrganizationHistory(userId: number): Promise<UserOrganizationHistoryItemView[]>;
  listSubordinates(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<UserSubordinateSummaryView[]>;
  resolveSubordinateUserIds(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]>;
  resolveApproverChain(userId: number, maxLevels?: number): Promise<UserApproverSummaryView[]>;
  assignMemberships(
    userId: number,
    organizationUnits: readonly {
      readonly organizationUnitId: number;
      readonly isPrimary?: boolean | undefined;
      readonly positionTitle?: string | null | undefined;
      readonly startDate?: string | null | undefined;
      readonly endDate?: string | null | undefined;
    }[],
    reason?: string | null,
    actorId?: number,
  ): Promise<readonly UserOrganizationAssignmentSummary[]>;
  transferMemberUnit(
    userId: number,
    input: OrganizationMemberTransferInput,
    actorId?: number,
  ): Promise<readonly UserOrganizationAssignmentSummary[]>;
  updateMemberManagers(
    userId: number,
    input: OrganizationMemberManagersInput,
    actorId?: number,
  ): Promise<{
    readonly userId: number;
    readonly managerId: number | null;
    readonly temporaryManagerId: number | null;
    readonly temporaryManagerFrom: string | null;
    readonly temporaryManagerUntil: string | null;
    readonly effectiveManagerId: number | null;
  }>;
}

export const ORGANIZATION_MEMBERS_PUBLIC_SERVICE = Symbol('ORGANIZATION_MEMBERS_PUBLIC_SERVICE');
