import { Inject, Injectable, Optional } from '@nestjs/common';
import { BadRequestAppException, type PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  IOrganizationMembersPublicService,
  OrganizationMemberSummaryView,
  OrganizationMemberUsersDelegate,
  RecordUserOrganizationHistoryInput,
  ReplaceUserOrganizationInput,
  UserApproverSummaryView,
  UserOrganizationAssignmentSummary,
  UserOrganizationHistoryItemView,
  UserOrganizationHistoryRecordView,
  UserOrganizationUnitLinkView,
  UserSubordinateSummaryView,
} from '../contracts/index.js';
import { UserOrganizationHistoryRepository } from '../repositories/user-organization-history.repository.js';
import { UserOrganizationUnitRepository } from '../repositories/user-organization-unit.repository.js';
import type {
  AssignOrganizationMembershipsRequest,
  ListMemberSubordinatesQuery,
  ListOrganizationMembersQuery,
  TransferOrganizationMemberRequest,
  UpdateOrganizationMemberManagersRequest,
} from '../requests/organization-members.requests.js';
import type {
  OrganizationMemberDetailResponse,
  OrganizationMemberResponse,
  UserOrganizationHistoryItemResponse,
  UserSubordinatesOverviewResponse,
} from '../responses/organization-members.response.js';

@Injectable()
export class OrganizationMembersService implements IOrganizationMembersPublicService {
  private readonly userOrgRepository: UserOrganizationUnitRepository | null;
  private usersDelegate: OrganizationMemberUsersDelegate | null = null;

  constructor(
    @Optional()
    @Inject(UserOrganizationUnitRepository)
    userOrgRepoOrDelegate:
      UserOrganizationUnitRepository | OrganizationMemberUsersDelegate | null = null,
    @Optional()
    @Inject(UserOrganizationHistoryRepository)
    private readonly orgHistoryRepository: UserOrganizationHistoryRepository | null = null,
  ) {
    if (userOrgRepoOrDelegate && 'getById' in userOrgRepoOrDelegate) {
      this.usersDelegate = userOrgRepoOrDelegate;
      this.userOrgRepository = null;
    } else {
      this.userOrgRepository = userOrgRepoOrDelegate;
    }
  }

  public registerMemberUsersDelegate(delegate: OrganizationMemberUsersDelegate): void {
    this.usersDelegate = delegate;
  }

  private requireUsersDelegate(): OrganizationMemberUsersDelegate {
    if (!this.usersDelegate) {
      throw new BadRequestAppException('organization-members.delegateUnavailable');
    }
    return this.usersDelegate;
  }

  public async findByUserIds(userIds: readonly number[]): Promise<UserOrganizationUnitLinkView[]> {
    if (!this.userOrgRepository) return [];
    return this.userOrgRepository.findByUserIds(userIds);
  }

  public async findUserOrganizationLinksByUserIds(
    userIds: readonly number[],
  ): Promise<UserOrganizationUnitLinkView[]> {
    return this.findByUserIds(userIds);
  }

  public async findUserIdsByOrganizationUnitIds(
    organizationUnitIds: readonly number[],
  ): Promise<number[]> {
    if (!this.userOrgRepository) return [];
    return this.userOrgRepository.findUserIdsByOrganizationUnitIds(organizationUnitIds);
  }

  public async countByPositionTitles(candidates: readonly string[]): Promise<number> {
    if (!this.userOrgRepository) return 0;
    return this.userOrgRepository.countByPositionTitles(candidates);
  }

  public async replaceUserOrganizations(
    userId: number,
    inputs: readonly ReplaceUserOrganizationInput[],
  ): Promise<UserOrganizationUnitLinkView[]> {
    if (!this.userOrgRepository) return [];
    return this.userOrgRepository.replaceUserOrganizations(userId, inputs);
  }

  public async recordHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryRecordView[]> {
    if (!this.orgHistoryRepository) return [];
    return this.orgHistoryRepository.recordHistories(inputs);
  }

  public async recordOrganizationHistories(
    inputs: readonly RecordUserOrganizationHistoryInput[],
  ): Promise<UserOrganizationHistoryRecordView[]> {
    return this.recordHistories(inputs);
  }

  public async findByUserId(userId: number): Promise<UserOrganizationHistoryRecordView[]> {
    if (!this.orgHistoryRepository) return [];
    return this.orgHistoryRepository.findByUserId(userId);
  }

  public async findOrganizationHistoriesByUserId(
    userId: number,
  ): Promise<UserOrganizationHistoryRecordView[]> {
    return this.findByUserId(userId);
  }

  public async listMembersPaginated(
    query: ListOrganizationMembersQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<OrganizationMemberResponse>> {
    return this.requireUsersDelegate().listPaginated(
      {
        q: query.q,
        organizationUnitId: query.organizationUnitId,
        managerId: query.managerId,
        status: query.status,
        page: query.page,
        limit: query.limit,
        sortBy: 'id',
        sortOrder: 'ASC',
      },
      actor,
    );
  }

  public async getMemberDetail(
    userId: number,
    actor?: UserIdentity,
  ): Promise<OrganizationMemberDetailResponse> {
    const delegate = this.requireUsersDelegate();
    const [member, history, subordinatesOverview] = await Promise.all([
      delegate.getById(userId, true, actor),
      delegate.getOrganizationHistory(userId, actor),
      delegate.getSubordinatesOverview(userId, { includeTemporary: true }, actor),
    ]);
    return {
      member,
      history,
      subordinatesOverview,
    };
  }

  public async getMemberAssignments(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationAssignmentSummary[]> {
    const member = await this.requireUsersDelegate().getById(userId, true, actor);
    return [...(member.organizationUnits ?? [])];
  }

  public async assignMemberships(
    userId: number,
    dto: AssignOrganizationMembershipsRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<OrganizationMemberResponse> {
    for (const item of dto.organizationUnits) {
      if (item.startDate && item.endDate) {
        const startMs = new Date(item.startDate).getTime();
        const endMs = new Date(item.endDate).getTime();
        if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
          throw new BadRequestAppException('organization-members.invalidMembershipPeriod');
        }
      }
    }
    return this.requireUsersDelegate().assignOrganizations(userId, dto, actorId, actor);
  }

  public async assignOrganizationMemberships(
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
  ): Promise<UserOrganizationAssignmentSummary[]> {
    const updated = await this.assignMemberships(
      userId,
      {
        organizationUnits: input.organizationUnits.map((u) => ({
          organizationUnitId: u.organizationUnitId,
          isPrimary: Boolean(u.isPrimary),
          positionTitle: u.positionTitle ?? null,
          startDate: u.startDate ?? null,
          endDate: u.endDate ?? null,
        })),
        reason: input.reason ?? null,
      },
      actorId,
    );
    return [...(updated.organizationUnits ?? [])];
  }

  public async transferMemberUnit(
    userId: number,
    dto: TransferOrganizationMemberRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<OrganizationMemberResponse> {
    if (dto.fromOrganizationUnitId === dto.toOrganizationUnitId) {
      throw new BadRequestAppException('organization-members.sameTransferUnit');
    }

    if (dto.startDate && dto.endDate) {
      const startMs = new Date(dto.startDate).getTime();
      const endMs = new Date(dto.endDate).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
        throw new BadRequestAppException('organization-members.invalidMembershipPeriod');
      }
    }

    const delegate = this.requireUsersDelegate();
    const current = await delegate.getById(userId, true, actor);
    const existingUnits = current.organizationUnits ?? [];
    const sourceUnit = existingUnits.find(
      (u) => Number(u.organizationUnitId) === Number(dto.fromOrganizationUnitId),
    );
    if (!sourceUnit) {
      throw new BadRequestAppException('organization-members.sourceUnitNotAssigned', [
        {
          field: 'fromOrganizationUnitId',
          message: `User #${userId} is not currently assigned to organization unit #${dto.fromOrganizationUnitId}`,
        },
      ]);
    }

    const transferredIsPrimary = dto.isPrimary ?? sourceUnit.isPrimary;
    const remainingUnits = existingUnits
      .filter(
        (u) =>
          Number(u.organizationUnitId) !== Number(dto.fromOrganizationUnitId) &&
          Number(u.organizationUnitId) !== Number(dto.toOrganizationUnitId),
      )
      .map((u) => ({
        organizationUnitId: Number(u.organizationUnitId),
        isPrimary: transferredIsPrimary ? false : Boolean(u.isPrimary),
        positionTitle: u.positionTitle ?? null,
        startDate: u.startDate ?? null,
        endDate: u.endDate ?? null,
      }));

    const nextUnits = [
      ...remainingUnits,
      {
        organizationUnitId: Number(dto.toOrganizationUnitId),
        isPrimary:
          transferredIsPrimary ||
          remainingUnits.length === 0 ||
          !remainingUnits.some((u) => u.isPrimary),
        positionTitle:
          dto.positionTitle !== undefined ? dto.positionTitle : (sourceUnit.positionTitle ?? null),
        startDate: dto.startDate !== undefined ? dto.startDate : new Date().toISOString(),
        endDate: dto.endDate !== undefined ? dto.endDate : null,
      },
    ];

    return delegate.assignOrganizations(
      userId,
      {
        organizationUnits: nextUnits,
        reason:
          dto.reason ??
          `Transfer from unit #${dto.fromOrganizationUnitId} to unit #${dto.toOrganizationUnitId}`,
      },
      actorId,
      actor,
    );
  }

  public async transferMemberOrganization(
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
  ): Promise<UserOrganizationAssignmentSummary[]> {
    const updated = await this.transferMemberUnit(userId, input, actorId);
    return [...(updated.organizationUnits ?? [])];
  }

  public async updateMemberManagers(
    userId: number,
    dto: UpdateOrganizationMemberManagersRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<OrganizationMemberSummaryView> {
    if (dto.temporaryManagerFrom && dto.temporaryManagerUntil) {
      const fromMs = new Date(dto.temporaryManagerFrom).getTime();
      const untilMs = new Date(dto.temporaryManagerUntil).getTime();
      if (!Number.isNaN(fromMs) && !Number.isNaN(untilMs) && untilMs <= fromMs) {
        throw new BadRequestAppException('organization-members.invalidTemporaryManagerPeriod');
      }
    }

    return this.requireUsersDelegate().update(
      userId,
      {
        ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
        ...(dto.temporaryManagerId !== undefined
          ? { temporaryManagerId: dto.temporaryManagerId }
          : {}),
        ...(dto.temporaryManagerFrom !== undefined
          ? { temporaryManagerFrom: dto.temporaryManagerFrom }
          : {}),
        ...(dto.temporaryManagerUntil !== undefined
          ? { temporaryManagerUntil: dto.temporaryManagerUntil }
          : {}),
      },
      actorId,
      actor,
    );
  }

  public async getOrganizationHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemView[]> {
    return this.requireUsersDelegate().getOrganizationHistory(userId, actor);
  }

  public async getMemberHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    return this.requireUsersDelegate().getOrganizationHistory(userId, actor);
  }

  public async getSubordinatesOverview(
    userId: number,
    query?: ListMemberSubordinatesQuery,
    actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    return this.requireUsersDelegate().getSubordinatesOverview(
      userId,
      {
        ...(query?.directOnly !== undefined ? { directOnly: query.directOnly } : {}),
        ...(query?.includeTemporary !== undefined
          ? { includeTemporary: query.includeTemporary }
          : {}),
      },
      actor,
    );
  }

  public async resolveSubordinateUserIds(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]> {
    const delegate = this.requireUsersDelegate();
    if (typeof delegate.resolveSubordinateUserIds === 'function') {
      return delegate.resolveSubordinateUserIds(managerId, options);
    }
    return [];
  }

  public async listSubordinates(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
    actor?: UserIdentity,
  ): Promise<UserSubordinateSummaryView[]> {
    const delegate = this.requireUsersDelegate();
    if (typeof delegate.listSubordinates === 'function') {
      return delegate.listSubordinates(managerId, options, actor);
    }
    return [];
  }

  public async resolveApproverChain(
    userId: number,
    maxLevels?: number,
  ): Promise<UserApproverSummaryView[]> {
    const delegate = this.requireUsersDelegate();
    if (typeof delegate.resolveApproverChain === 'function') {
      return delegate.resolveApproverChain(userId, maxLevels);
    }
    return [];
  }
}
