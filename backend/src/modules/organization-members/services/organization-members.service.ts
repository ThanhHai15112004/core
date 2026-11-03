import { Injectable } from '@nestjs/common';
import { BadRequestAppException, type PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  type UserApproverSummaryView,
  type UserOrganizationAssignmentSummary,
  type UserOrganizationHistoryItemResponse,
  type UserResponse,
  UsersService,
  type UserSubordinateSummaryView,
  type UserSubordinatesOverviewResponse,
} from '@modules/users/index.js';
import type {
  IOrganizationMembersPublicService,
  OrganizationMemberManagersInput,
  OrganizationMemberTransferInput,
} from '../contracts/index.js';
import type {
  AssignOrganizationMembershipsRequest,
  ListMemberSubordinatesQuery,
  ListOrganizationMembersQuery,
  TransferOrganizationMemberRequest,
  UpdateOrganizationMemberManagersRequest,
} from '../requests/organization-members.requests.js';
import type { OrganizationMemberDetailResponse } from '../responses/organization-members.response.js';

@Injectable()
export class OrganizationMembersService implements IOrganizationMembersPublicService {
  constructor(private readonly usersService: UsersService) {}

  public async listMembersPaginated(
    query: ListOrganizationMembersQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.listPaginated(
      {
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(query.organizationUnitId !== undefined
          ? { organizationUnitId: query.organizationUnitId }
          : {}),
        ...(query.managerId !== undefined ? { managerId: query.managerId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
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
    const [member, history, subordinatesOverview] = await Promise.all([
      this.usersService.getById(userId, true, actor),
      this.usersService.getOrganizationHistory(userId, actor),
      this.usersService.getSubordinatesOverview(userId, undefined, actor),
    ]);
    return {
      member,
      history,
      subordinatesOverview,
    };
  }

  public async assignOrganizationMemberships(
    userId: number,
    dto: AssignOrganizationMembershipsRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    for (const unit of dto.organizationUnits) {
      if (unit.startDate && unit.endDate) {
        const startMs = new Date(unit.startDate).getTime();
        const endMs = new Date(unit.endDate).getTime();
        if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
          throw new BadRequestAppException('organization-members.invalidMembershipPeriod');
        }
      }
    }
    return this.usersService.assignOrganizations(userId, dto, actorId, actor);
  }

  public async assignMemberships(
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
  ): Promise<readonly UserOrganizationAssignmentSummary[]> {
    const updated = await this.assignOrganizationMemberships(
      userId,
      {
        organizationUnits: organizationUnits.map((item) => ({
          organizationUnitId: item.organizationUnitId,
          isPrimary: Boolean(item.isPrimary),
          positionTitle: item.positionTitle ?? null,
          startDate: item.startDate ?? null,
          endDate: item.endDate ?? null,
        })),
        reason: reason ?? null,
      },
      actorId,
    );
    return updated.organizationUnits;
  }

  public async transferMemberOrganization(
    userId: number,
    dto: TransferOrganizationMemberRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    if (Number(dto.fromOrganizationUnitId) === Number(dto.toOrganizationUnitId)) {
      throw new BadRequestAppException('organization-members.sameTransferUnit');
    }
    if (dto.startDate && dto.endDate) {
      const startMs = new Date(dto.startDate).getTime();
      const endMs = new Date(dto.endDate).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs < startMs) {
        throw new BadRequestAppException('organization-members.invalidMembershipPeriod');
      }
    }

    const current = await this.usersService.getById(userId, true, actor);
    const existingLinks = current.organizationUnits ?? [];
    const sourceLink = existingLinks.find(
      (item) => Number(item.organizationUnitId) === Number(dto.fromOrganizationUnitId),
    );
    if (!sourceLink) {
      throw new BadRequestAppException('organization-members.sourceUnitNotAssigned', [
        {
          userId,
          fromOrganizationUnitId: dto.fromOrganizationUnitId,
        },
      ]);
    }

    const nextUnits = existingLinks
      .filter((item) => Number(item.organizationUnitId) !== Number(dto.fromOrganizationUnitId))
      .map((item) => ({
        organizationUnitId: Number(item.organizationUnitId),
        isPrimary: dto.isPrimary === true ? false : Boolean(item.isPrimary),
        positionTitle: item.positionTitle ?? null,
        startDate: item.startDate ?? null,
        endDate: item.endDate ?? null,
      }));

    const existingDestIdx = nextUnits.findIndex(
      (item) => Number(item.organizationUnitId) === Number(dto.toOrganizationUnitId),
    );
    const transferredEntry = {
      organizationUnitId: Number(dto.toOrganizationUnitId),
      isPrimary: dto.isPrimary !== undefined ? Boolean(dto.isPrimary) : Boolean(sourceLink.isPrimary),
      positionTitle:
        dto.positionTitle !== undefined ? dto.positionTitle : (sourceLink.positionTitle ?? null),
      startDate: dto.startDate ?? new Date().toISOString(),
      endDate: dto.endDate ?? null,
    };

    if (existingDestIdx >= 0) {
      nextUnits[existingDestIdx] = transferredEntry;
    } else {
      nextUnits.push(transferredEntry);
    }

    if (nextUnits.length > 0 && !nextUnits.some((u) => u.isPrimary)) {
      nextUnits[0] = { ...nextUnits[0]!, isPrimary: true };
    }

    return this.usersService.assignOrganizations(
      userId,
      {
        organizationUnits: nextUnits,
        reason:
          dto.reason ??
          `Transferred from unit #${dto.fromOrganizationUnitId} to unit #${dto.toOrganizationUnitId}`,
      },
      actorId,
      actor,
    );
  }

  public async transferMemberUnit(
    userId: number,
    input: OrganizationMemberTransferInput,
    actorId?: number,
  ): Promise<readonly UserOrganizationAssignmentSummary[]> {
    const updated = await this.transferMemberOrganization(userId, input, actorId);
    return updated.organizationUnits;
  }

  public async updateManagers(
    userId: number,
    dto: UpdateOrganizationMemberManagersRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<UserResponse> {
    if (dto.temporaryManagerId !== undefined && dto.temporaryManagerId !== null) {
      const fromDate = dto.temporaryManagerFrom ? new Date(dto.temporaryManagerFrom) : new Date();
      const untilDate = dto.temporaryManagerUntil ? new Date(dto.temporaryManagerUntil) : null;
      if (
        !untilDate ||
        Number.isNaN(fromDate.getTime()) ||
        Number.isNaN(untilDate.getTime()) ||
        untilDate.getTime() <= fromDate.getTime()
      ) {
        throw new BadRequestAppException('organization-members.invalidTemporaryManagerPeriod');
      }
    }
    return this.usersService.update(
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

  public async updateMemberManagers(
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
  }> {
    const updated = await this.updateManagers(userId, input, actorId);
    return {
      userId: updated.id,
      managerId: updated.managerId ?? null,
      temporaryManagerId: updated.temporaryManagerId ?? null,
      temporaryManagerFrom: updated.temporaryManagerFrom ?? null,
      temporaryManagerUntil: updated.temporaryManagerUntil ?? null,
      effectiveManagerId: updated.effectiveManagerId ?? null,
    };
  }

  public async getOrganizationHistory(
    userId: number,
    actor?: UserIdentity,
  ): Promise<UserOrganizationHistoryItemResponse[]> {
    return this.usersService.getOrganizationHistory(userId, actor);
  }

  public async getSubordinatesOverview(
    userId: number,
    query?: ListMemberSubordinatesQuery,
    actor?: UserIdentity,
  ): Promise<UserSubordinatesOverviewResponse> {
    return this.usersService.getSubordinatesOverview(userId, query, actor);
  }

  public async listSubordinates(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<UserSubordinateSummaryView[]> {
    return this.usersService.listSubordinates(managerId, options);
  }

  public async resolveSubordinateUserIds(
    managerId: number,
    options?: { readonly directOnly?: boolean; readonly includeTemporary?: boolean },
  ): Promise<number[]> {
    return this.usersService.resolveSubordinateUserIds(managerId, options);
  }

  public async resolveApproverChain(
    userId: number,
    maxLevels = 5,
  ): Promise<UserApproverSummaryView[]> {
    return this.usersService.resolveApproverChain(userId, maxLevels);
  }
}
