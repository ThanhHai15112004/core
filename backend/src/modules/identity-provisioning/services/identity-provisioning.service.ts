import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import type { IIdentityProvisioningPublicService } from '../contracts/index.js';
import { ScimGroupMemberRepository } from '../repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from '../repositories/scim-group.repository.js';
import { ScimUserLinkRepository } from '../repositories/scim-user-link.repository.js';
import type {
  CreateScimClientRequest,
  ListScimDirectoryQuery,
  ListScimReconciliationsQuery,
  ListScimSyncLogsQuery,
  RunScimReconciliationRequest,
  UpdateScimClientRequest,
} from '../requests/identity-provisioning.requests.js';
import type {
  ScimClientCreatedView,
  ScimClientView,
  ScimGroupSummaryView,
  ScimReconciliationRunView,
  ScimSyncLogView,
  ScimUserLinkView,
} from '../types/identity-provisioning.types.js';
import { ScimClientsService } from './scim-clients.service.js';
import { ScimReconciliationService } from './scim-reconciliation.service.js';
import { ScimSyncLogService } from './scim-sync-log.service.js';

@Injectable()
export class IdentityProvisioningService implements IIdentityProvisioningPublicService {
  constructor(
    private readonly clientsService: ScimClientsService,
    private readonly userLinkRepository: ScimUserLinkRepository,
    private readonly groupRepository: ScimGroupRepository,
    private readonly memberRepository: ScimGroupMemberRepository,
    private readonly syncLogService: ScimSyncLogService,
    private readonly reconciliationService: ScimReconciliationService,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService,
  ) {}

  public async listClients(): Promise<ScimClientView[]> {
    return this.clientsService.listClients();
  }

  public async getClientById(clientId: number): Promise<ScimClientView> {
    return this.clientsService.getClientById(clientId);
  }

  public async createClient(
    dto: CreateScimClientRequest,
    actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    return this.clientsService.createClient(dto, actor);
  }

  public async updateClient(
    clientId: number,
    dto: UpdateScimClientRequest,
    actor?: UserIdentity,
  ): Promise<ScimClientView> {
    return this.clientsService.updateClient(clientId, dto, actor);
  }

  public async rotateClientToken(
    clientId: number,
    actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    return this.clientsService.rotateClientToken(clientId, actor);
  }

  public async deleteClient(
    clientId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.clientsService.deleteClient(clientId, actor);
  }

  public async listUserLinks(
    query: ListScimDirectoryQuery = {},
  ): Promise<PaginatedResult<ScimUserLinkView>> {
    const paged = await this.userLinkRepository.listPaginated(query);
    const items: ScimUserLinkView[] = [];

    for (const link of paged.data) {
      const user = await this.usersPublicService?.getProvisionedUserById?.(link.userId);
      items.push({
        id: Number(link.id),
        clientId: Number(link.clientId),
        userId: Number(link.userId),
        externalId: link.externalId,
        scimUsername: link.scimUsername,
        scimVersion: Number(link.scimVersion),
        active: Boolean(link.active),
        lastSyncedAt: link.lastSyncedAt
          ? new Date(link.lastSyncedAt).toISOString()
          : new Date().toISOString(),
        deprovisionedAt: link.deprovisionedAt ? new Date(link.deprovisionedAt).toISOString() : null,
        deprovisionReason: link.deprovisionReason ?? null,
        userStatus: user?.status ?? null,
        userStatusName: user?.statusName ?? null,
        userEmail: user?.email ?? null,
        userFullName: user?.fullName ?? null,
      });
    }

    return createPaginatedResult(items, paged.meta.total, paged.meta.page, paged.meta.limit);
  }

  public async listGroups(
    query: ListScimDirectoryQuery = {},
  ): Promise<PaginatedResult<ScimGroupSummaryView>> {
    const paged = await this.groupRepository.listPaginated({
      clientId: query.clientId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    const groupIds = paged.data.map((g) => Number(g.id));
    const allMembers = await this.memberRepository.findByGroupIds(groupIds);
    const membersByGroup = new Map<number, number[]>();
    for (const m of allMembers) {
      const list = membersByGroup.get(Number(m.scimGroupId)) ?? [];
      list.push(Number(m.userId));
      membersByGroup.set(Number(m.scimGroupId), list);
    }

    const items: ScimGroupSummaryView[] = paged.data.map((group) => {
      const memberUserIds = membersByGroup.get(Number(group.id)) ?? [];
      return {
        id: Number(group.id),
        clientId: Number(group.clientId),
        externalId: group.externalId ?? null,
        displayName: group.displayName,
        mappedRoleCode: group.mappedRoleCode ?? null,
        scimVersion: Number(group.scimVersion),
        active: Boolean(group.active),
        memberCount: memberUserIds.length,
        memberUserIds,
        lastSyncedAt: group.lastSyncedAt
          ? new Date(group.lastSyncedAt).toISOString()
          : new Date().toISOString(),
      };
    });

    return createPaginatedResult(items, paged.meta.total, paged.meta.page, paged.meta.limit);
  }

  public async listSyncLogs(
    query: ListScimSyncLogsQuery = {},
  ): Promise<PaginatedResult<ScimSyncLogView>> {
    return this.syncLogService.listPaginated(query);
  }

  public async reconcileWithIdp(
    clientId: number,
    input: RunScimReconciliationRequest,
    actor?: UserIdentity,
  ): Promise<ScimReconciliationRunView> {
    return this.reconciliationService.reconcileWithIdp(clientId, input, actor);
  }

  public async listReconciliationRuns(
    query: ListScimReconciliationsQuery = {},
  ): Promise<PaginatedResult<ScimReconciliationRunView>> {
    return this.reconciliationService.listRuns(query);
  }

  public async getReconciliationRunById(runId: number): Promise<ScimReconciliationRunView> {
    return this.reconciliationService.getRunById(runId);
  }
}
