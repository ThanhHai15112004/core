import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';

export type UserOrganizationHistoryActionType = 'ASSIGN' | 'TRANSFER' | 'UPDATE' | 'END';

export interface UserOrganizationAssignmentSummary {
  readonly organizationUnitId: number;
  readonly code?: string;
  readonly name?: string;
  readonly type?: number;
  readonly typeName?: string;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface UserOrganizationHistoryItemView {
  readonly id: number;
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly organizationUnitCode?: string | null;
  readonly organizationUnitName?: string | null;
  readonly fromOrganizationUnitId: number | null;
  readonly fromOrganizationUnitCode?: string | null;
  readonly fromOrganizationUnitName?: string | null;
  readonly actionType: UserOrganizationHistoryActionType;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly reason: string | null;
  readonly changedBy: number | null;
  readonly createdAt: string;
}

export interface UserSubordinateSummaryView {
  readonly id: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 1 | 2 | 3 | 4;
  readonly statusName: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'ARCHIVED';
  readonly primaryOrganizationUnitId: number | null;
  readonly primaryOrganizationUnitName?: string | null;
  readonly positionTitle: string | null;
  readonly managerId: number | null;
  readonly temporaryManagerId: number | null;
  readonly temporaryManagerFrom: string | null;
  readonly temporaryManagerUntil: string | null;
  readonly effectiveManagerId: number | null;
  readonly relationType: 'DIRECT' | 'TEMPORARY' | 'INDIRECT';
  readonly level: number;
}

export interface UserApproverSummaryView {
  readonly step: number;
  readonly userId: number;
  readonly username: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 1 | 2 | 3 | 4;
  readonly primaryOrganizationUnitId: number | null;
  readonly positionTitle: string | null;
  readonly sourceType: 'DIRECT_MANAGER' | 'TEMPORARY_MANAGER';
}

export interface UserSubordinatesOverviewView {
  readonly userId: number;
  readonly managerId: number;
  readonly directCount: number;
  readonly temporaryCount: number;
  readonly indirectCount: number;
  readonly totalSubordinates: number;
  readonly subordinates: readonly UserSubordinateSummaryView[];
  readonly approverChain: readonly UserApproverSummaryView[];
}

export interface UserOrganizationUnitLinkView {
  readonly id?: number;
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface ReplaceUserOrganizationInput {
  readonly organizationUnitId: number;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
}

export interface RecordUserOrganizationHistoryInput {
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly fromOrganizationUnitId: number | null;
  readonly actionType: UserOrganizationHistoryActionType;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly reason: string | null;
  readonly changedBy: number | null;
}

export interface UserOrganizationHistoryRecordView {
  readonly id: number;
  readonly userId: number;
  readonly organizationUnitId: number;
  readonly fromOrganizationUnitId: number | null;
  readonly actionType: UserOrganizationHistoryActionType;
  readonly isPrimary: boolean;
  readonly positionTitle: string | null;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly reason: string | null;
  readonly changedBy: number | null;
  readonly createdAt: Date;
}

export interface IOrganizationMembersUnitPersistenceContract {
  findByUserIds(userIds: readonly number[]): Promise<UserOrganizationUnitLinkView[]>;
  findUserIdsByOrganizationUnitIds?(organizationUnitIds: readonly number[]): Promise<number[]>;
  countByPositionTitles?(candidates: readonly string[]): Promise<number>;
  replaceUserOrganizations(
    userId: number,
    inputs: readonly ReplaceUserOrganizationInput[],
  ): Promise<UserOrganizationUnitLinkView[]>;
}

export interface IOrganizationMembersHistoryPersistenceContract {
  recordHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryRecordView[]>;
  findByUserId(userId: number): Promise<UserOrganizationHistoryRecordView[]>;
}

export interface OrganizationMemberSummaryView {
  readonly id: number;
  readonly username: string;
  readonly email?: string;
  readonly fullName: string;
  readonly primaryOrganizationUnitId?: number | null;
  readonly managerId?: number | null;
  readonly temporaryManagerId?: number | null;
  readonly temporaryManagerFrom?: string | null;
  readonly temporaryManagerUntil?: string | null;
  readonly effectiveManagerId?: number | null;
  readonly organizationUnits: readonly UserOrganizationAssignmentSummary[];
  readonly [key: string]: unknown;
}

export interface OrganizationMemberUsersDelegate<
  TMember extends OrganizationMemberSummaryView = OrganizationMemberSummaryView,
> {
  listPaginated(
    query: {
      readonly q?: string | undefined;
      readonly organizationUnitId?: number | undefined;
      readonly managerId?: number | undefined;
      readonly status?: 1 | 2 | 3 | 4 | undefined;
      readonly page?: number | undefined;
      readonly limit?: number | undefined;
      readonly sortBy?: 'id' | undefined;
      readonly sortOrder?: 'ASC' | 'DESC' | undefined;
    },
    actor?: UserIdentity,
  ): Promise<PaginatedResult<TMember>>;
  getById(userId: number, includeRelations?: boolean, actor?: UserIdentity): Promise<TMember>;
  assignOrganizations(
    userId: number,
    dto: {
      readonly organizationUnits: ReadonlyArray<{
        readonly organizationUnitId: number;
        readonly isPrimary: boolean;
        readonly positionTitle?: string | null | undefined;
        readonly startDate?: string | null | undefined;
        readonly endDate?: string | null | undefined;
      }>;
      readonly reason?: string | null | undefined;
    },
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<TMember>;
  update(
    userId: number,
    dto: {
      readonly managerId?: number | null | undefined;
      readonly temporaryManagerId?: number | null | undefined;
      readonly temporaryManagerFrom?: string | null | undefined;
      readonly temporaryManagerUntil?: string | null | undefined;
    },
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<TMember>;
  getOrganizationHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemView[]>;
  getSubordinatesOverview(
    userId: number,
    query?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
    actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewView>;
  listSubordinates?(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
    actor?: UserIdentity,
  ): Promise<UserSubordinateSummaryView[]>;
  resolveSubordinateUserIds?(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]>;
  resolveApproverChain?(userId: number, maxLevels?: number): Promise<UserApproverSummaryView[]>;
}

export interface IOrganizationMembersPublicService
  extends
    IOrganizationMembersUnitPersistenceContract,
    IOrganizationMembersHistoryPersistenceContract {
  registerMemberUsersDelegate(delegate: OrganizationMemberUsersDelegate): void;
  findUserOrganizationLinksByUserIds(
    userIds: readonly number[],
  ): Promise<UserOrganizationUnitLinkView[]>;
  findUserIdsByOrganizationUnitIds(organizationUnitIds: readonly number[]): Promise<number[]>;
  countByPositionTitles(candidates: readonly string[]): Promise<number>;
  recordOrganizationHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryRecordView[]>;
  findOrganizationHistoriesByUserId(userId: number): Promise<UserOrganizationHistoryRecordView[]>;
  getMemberAssignments(userId: number): Promise<UserOrganizationAssignmentSummary[]>;
  assignOrganizationMemberships(
    userId: number,
    input: {
      readonly organizationUnits: ReadonlyArray<{
        readonly organizationUnitId: number;
        readonly isPrimary?: boolean | undefined;
        readonly positionTitle?: string | null | undefined;
        readonly startDate?: string | null | undefined;
        readonly endDate?: string | null | undefined;
      }>;
      readonly reason?: string | null | undefined;
    },
    actorId?: number,
  ): Promise<UserOrganizationAssignmentSummary[]>;
  transferMemberOrganization(
    userId: number,
    input: {
      readonly fromOrganizationUnitId: number;
      readonly toOrganizationUnitId: number;
      readonly isPrimary?: boolean | undefined;
      readonly positionTitle?: string | null | undefined;
      readonly startDate?: string | null | undefined;
      readonly endDate?: string | null | undefined;
      readonly reason?: string | null | undefined;
    },
    actorId?: number,
  ): Promise<UserOrganizationAssignmentSummary[]>;
  getOrganizationHistory(userId: number): Promise<UserOrganizationHistoryItemView[]>;
  resolveSubordinateUserIds(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]>;
  listSubordinates(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<UserSubordinateSummaryView[]>;
  resolveApproverChain(userId: number, maxLevels?: number): Promise<UserApproverSummaryView[]>;
}

export const ORGANIZATION_MEMBERS_PUBLIC_SERVICE = Symbol('ORGANIZATION_MEMBERS_PUBLIC_SERVICE');
