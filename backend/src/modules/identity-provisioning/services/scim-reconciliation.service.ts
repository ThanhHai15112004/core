import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DomainEventBusService,
  NotFoundAppException,
  type PaginatedResult,
  defaultDomainEventBus,
  safeJsonParse,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USER_STATUS,
  USERS_PUBLIC_SERVICE,
} from '@modules/users/contracts/index.js';
import {
  SCIM_AUDIT_META,
  SCIM_EVENTS,
  SCIM_RECONCILIATION_DISCREPANCY_TYPE,
  SCIM_RECONCILIATION_MODE,
  SCIM_SCHEMAS,
} from '../enum/identity-provisioning.enum.js';
import type { ScimReconciliationRunEntity } from '../entities/scim-reconciliation-run.entity.js';
import { ScimGroupMemberRepository } from '../repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from '../repositories/scim-group.repository.js';
import {
  type ListScimReconciliationsFilter,
  ScimReconciliationRunRepository,
} from '../repositories/scim-reconciliation-run.repository.js';
import { ScimUserLinkRepository } from '../repositories/scim-user-link.repository.js';
import type { RunScimReconciliationRequest } from '../requests/identity-provisioning.requests.js';
import type {
  ScimReconciliationDiscrepancy,
  ScimReconciliationRunView,
  ScimReconciliationSummary,
  ScimRequestMeta,
} from '../types/identity-provisioning.types.js';
import { ScimClientsService } from './scim-clients.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import { ScimUsersService } from './scim-users.service.js';

function emptySummary(): ScimReconciliationSummary {
  return {
    missingInLocal: 0,
    orphanInLocal: 0,
    attributeDrift: 0,
    statusDrift: 0,
    groupMissingInLocal: 0,
    groupOrphanInLocal: 0,
    membershipDrift: 0,
  };
}

function buildInternalMeta(httpPath: string): ScimRequestMeta {
  return {
    ipAddress: null,
    requestId: null,
    correlationId: null,
    httpMethod: 'POST',
    httpPath,
    baseUrl: '/api/v1/scim/v2',
  };
}

@Injectable()
export class ScimReconciliationService {
  private readonly domainEventBus: DomainEventBusService;

  constructor(
    private readonly clientsService: ScimClientsService,
    private readonly userLinkRepository: ScimUserLinkRepository,
    private readonly groupRepository: ScimGroupRepository,
    private readonly memberRepository: ScimGroupMemberRepository,
    private readonly reconRunRepository: ScimReconciliationRunRepository,
    private readonly scimUsersService: ScimUsersService,
    private readonly scimGroupsService: ScimGroupsService,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() domainEventBus?: DomainEventBusService,
  ) {
    this.domainEventBus = domainEventBus ?? defaultDomainEventBus;
  }

  public toView(entity: ScimReconciliationRunEntity): ScimReconciliationRunView {
    const rawSummary = safeJsonParseObject(entity.summaryJson) ?? {};
    const summary: ScimReconciliationSummary = {
      missingInLocal: Number(rawSummary['missingInLocal'] ?? 0),
      orphanInLocal: Number(rawSummary['orphanInLocal'] ?? 0),
      attributeDrift: Number(rawSummary['attributeDrift'] ?? 0),
      statusDrift: Number(rawSummary['statusDrift'] ?? 0),
      groupMissingInLocal: Number(rawSummary['groupMissingInLocal'] ?? 0),
      groupOrphanInLocal: Number(rawSummary['groupOrphanInLocal'] ?? 0),
      membershipDrift: Number(rawSummary['membershipDrift'] ?? 0),
    };
    const rawDiscrepancies = safeJsonParse<unknown>(entity.discrepanciesJson, []);
    const discrepancies = Array.isArray(rawDiscrepancies)
      ? (rawDiscrepancies as ScimReconciliationDiscrepancy[])
      : [];

    return {
      id: Number(entity.id),
      clientId: Number(entity.clientId),
      mode: entity.mode,
      status: entity.status,
      idpUsersCount: Number(entity.idpUsersCount),
      localUsersCount: Number(entity.localUsersCount),
      idpGroupsCount: Number(entity.idpGroupsCount),
      localGroupsCount: Number(entity.localGroupsCount),
      discrepanciesCount: Number(entity.discrepanciesCount),
      appliedActionsCount: Number(entity.appliedActionsCount),
      summary,
      discrepancies,
      triggeredBy: entity.triggeredBy !== null ? Number(entity.triggeredBy) : null,
      startedAt: entity.startedAt
        ? new Date(entity.startedAt).toISOString()
        : new Date().toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
    };
  }

  public async listRuns(
    filter: ListScimReconciliationsFilter,
  ): Promise<PaginatedResult<ScimReconciliationRunView>> {
    const paged = await this.reconRunRepository.listPaginated(filter);
    return createPaginatedResult(
      paged.data.map((item) => this.toView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getRunById(runId: number): Promise<ScimReconciliationRunView> {
    const found = await this.reconRunRepository.findById(runId);
    if (!found) {
      throw new NotFoundAppException('identity-provisioning.reconciliationNotFound', {
        id: runId,
      });
    }
    return this.toView(found);
  }

  public async reconcileWithIdp(
    clientId: number,
    input: RunScimReconciliationRequest,
    actor?: UserIdentity,
  ): Promise<ScimReconciliationRunView> {
    const startedAt = new Date();
    const client = await this.clientsService.getClientEntityOrThrow(clientId);
    const mode = input.mode ?? SCIM_RECONCILIATION_MODE.DRY_RUN;
    const isApply = mode === SCIM_RECONCILIATION_MODE.APPLY;

    const localLinks = await this.userLinkRepository.findByClient(client.id);
    const linkByExternalId = new Map(localLinks.map((l) => [l.externalId, l]));
    const linkByUserId = new Map(localLinks.map((l) => [Number(l.userId), l]));

    const localGroups = await this.groupRepository.findByClient(client.id);
    const groupMembers = await this.memberRepository.findByClient(client.id);
    const memberIdsByGroupId = new Map<number, number[]>();
    for (const m of groupMembers) {
      const list = memberIdsByGroupId.get(Number(m.scimGroupId)) ?? [];
      list.push(Number(m.userId));
      memberIdsByGroupId.set(Number(m.scimGroupId), list);
    }

    const idpUserByExt = new Map(input.idpUsers.map((u) => [u.externalId.trim(), u]));
    const discrepancies: ScimReconciliationDiscrepancy[] = [];
    const summaryMutable = { ...emptySummary() };
    let appliedActionsCount = 0;
    const internalMeta = buildInternalMeta(`/api/v1/identity-provisioning/clients/${clientId}/reconcile`);

    // 1. Đối soát IdP Users -> Local SCIM Links & Users
    for (const idpUser of input.idpUsers) {
      const extId = idpUser.externalId.trim();
      const link = linkByExternalId.get(extId);
      if (!link) {
        summaryMutable.missingInLocal += 1;
        let resolved = false;
        let resolutionAction: string | undefined;

        if (isApply && input.applySyncMissingAndDrifts) {
          await this.scimUsersService.createUser(
            client,
            {
              schemas: [SCIM_SCHEMAS.USER],
              externalId: extId,
              userName: idpUser.userName,
              active: idpUser.active,
              emails: [{ value: idpUser.email, type: 'work', primary: true }],
              name: {
                givenName: idpUser.firstName,
                familyName: idpUser.lastName,
                formatted: idpUser.fullName,
              },
              ...(idpUser.phone ? { phoneNumbers: [{ value: idpUser.phone, type: 'work', primary: true }] } : {}),
            },
            internalMeta,
          );
          resolved = true;
          resolutionAction = 'PROVISIONED_USER';
          appliedActionsCount += 1;
        }

        discrepancies.push({
          type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.MISSING_IN_LOCAL,
          entityType: 'USER',
          externalId: extId,
          localId: null,
          identifier: idpUser.userName,
          details: { email: idpUser.email, active: idpUser.active },
          resolved,
          ...(resolutionAction ? { resolutionAction } : {}),
        });
        continue;
      }

      const localUser = await this.usersPublicService?.getProvisionedUserById?.(link.userId);
      if (!localUser) continue;

      const localEffectiveActive = Boolean(link.active && localUser.status === USER_STATUS.ACTIVE);
      if (localEffectiveActive !== idpUser.active) {
        summaryMutable.statusDrift += 1;
        let resolved = false;
        let resolutionAction: string | undefined;

        if (isApply && input.applySyncMissingAndDrifts) {
          await this.scimUsersService.patchUser(
            client,
            String(localUser.id),
            {
              schemas: [SCIM_SCHEMAS.PATCH_OP],
              Operations: [{ op: 'replace', path: 'active', value: idpUser.active }],
            },
            undefined,
            internalMeta,
          );
          resolved = true;
          resolutionAction = idpUser.active ? 'REACTIVATED_USER' : 'DEPROVISIONED_USER';
          appliedActionsCount += 1;
        }

        discrepancies.push({
          type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.STATUS_DRIFT,
          entityType: 'USER',
          externalId: extId,
          localId: localUser.id,
          identifier: idpUser.userName,
          details: { idpActive: idpUser.active, localActive: localEffectiveActive },
          resolved,
          ...(resolutionAction ? { resolutionAction } : {}),
        });
      }

      const emailDiff =
        localUser.email.trim().toLowerCase() !== idpUser.email.trim().toLowerCase();
      const nameDiff =
        Boolean(idpUser.fullName) &&
        localUser.fullName.trim() !== idpUser.fullName!.trim();

      if (emailDiff || nameDiff) {
        summaryMutable.attributeDrift += 1;
        let resolved = false;
        let resolutionAction: string | undefined;

        if (isApply && input.applySyncMissingAndDrifts) {
          await this.scimUsersService.replaceUser(
            client,
            String(localUser.id),
            {
              schemas: [SCIM_SCHEMAS.USER],
              externalId: extId,
              userName: idpUser.userName,
              active: idpUser.active,
              emails: [{ value: idpUser.email, type: 'work', primary: true }],
              name: {
                givenName: idpUser.firstName ?? localUser.firstName,
                familyName: idpUser.lastName ?? localUser.lastName,
                formatted: idpUser.fullName ?? localUser.fullName,
              },
            },
            undefined,
            internalMeta,
          );
          resolved = true;
          resolutionAction = 'UPDATED_USER_ATTRIBUTES';
          appliedActionsCount += 1;
        }

        discrepancies.push({
          type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.ATTRIBUTE_DRIFT,
          entityType: 'USER',
          externalId: extId,
          localId: localUser.id,
          identifier: idpUser.userName,
          details: {
            ...(emailDiff ? { localEmail: localUser.email, idpEmail: idpUser.email } : {}),
            ...(nameDiff ? { localFullName: localUser.fullName, idpFullName: idpUser.fullName } : {}),
          },
          resolved,
          ...(resolutionAction ? { resolutionAction } : {}),
        });
      }
    }

    // 2. Phát hiện Local active SCIM users bị thiếu ở IdP (Orphan -> cần Deprovision)
    for (const link of localLinks) {
      if (!link.active) continue;
      if (idpUserByExt.has(link.externalId)) continue;

      summaryMutable.orphanInLocal += 1;
      let resolved = false;
      let resolutionAction: string | undefined;

      if (isApply && input.applyDeprovisionOrphans) {
        await this.scimUsersService.deleteUser(client, String(link.userId), undefined, internalMeta);
        resolved = true;
        resolutionAction = 'DEPROVISIONED_ORPHAN_USER';
        appliedActionsCount += 1;
      }

      discrepancies.push({
        type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.ORPHAN_IN_LOCAL,
        entityType: 'USER',
        externalId: link.externalId,
        localId: Number(link.userId),
        identifier: link.scimUsername,
        details: { reason: 'Present as active local SCIM user but missing in IdP snapshot' },
        resolved,
        ...(resolutionAction ? { resolutionAction } : {}),
      });
    }

    // Refresh links map after user sync if APPLY created any new users
    const refreshedLinks = isApply ? await this.userLinkRepository.findByClient(client.id) : localLinks;
    const refreshedByExt = new Map(refreshedLinks.map((l) => [l.externalId, Number(l.userId)]));

    // 3. Đối soát IdP Groups -> Local SCIM Groups & Memberships
    const groupByDisplayLower = new Map(
      localGroups.map((g) => [g.displayName.trim().toLowerCase(), g]),
    );
    const idpGroupDisplayLowerSet = new Set(
      (input.idpGroups ?? []).map((g) => g.displayName.trim().toLowerCase()),
    );

    for (const idpGroup of input.idpGroups ?? []) {
      const displayKey = idpGroup.displayName.trim().toLowerCase();
      const localGrp = groupByDisplayLower.get(displayKey);
      const expectedMemberUserIds = Array.from(
        new Set(
          idpGroup.memberExternalIds
            .map((ext) => refreshedByExt.get(ext.trim()))
            .filter((uid): uid is number => Number.isInteger(uid) && (uid ?? 0) > 0),
        ),
      ).sort((a, b) => a - b);

      if (!localGrp) {
        summaryMutable.groupMissingInLocal += 1;
        let resolved = false;
        let resolutionAction: string | undefined;

        if (isApply && input.applySyncMissingAndDrifts) {
          await this.scimGroupsService.createGroup(
            client,
            {
              schemas: [SCIM_SCHEMAS.GROUP],
              ...(idpGroup.externalId ? { externalId: idpGroup.externalId } : {}),
              displayName: idpGroup.displayName,
              members: expectedMemberUserIds.map((uid) => ({ value: String(uid) })),
            },
            internalMeta,
          );
          resolved = true;
          resolutionAction = 'CREATED_SCIM_GROUP';
          appliedActionsCount += 1;
        }

        discrepancies.push({
          type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.GROUP_MISSING_IN_LOCAL,
          entityType: 'GROUP',
          externalId: idpGroup.externalId ?? null,
          localId: null,
          identifier: idpGroup.displayName,
          details: { memberCount: idpGroup.memberExternalIds.length },
          resolved,
          ...(resolutionAction ? { resolutionAction } : {}),
        });
        continue;
      }

      const currentMemberIds = (memberIdsByGroupId.get(Number(localGrp.id)) ?? []).sort(
        (a, b) => a - b,
      );
      const currentExtSet = new Set(
        currentMemberIds
          .map((uid) => linkByUserId.get(uid)?.externalId)
          .filter((ext): ext is string => Boolean(ext)),
      );
      const idpExtSet = new Set(idpGroup.memberExternalIds.map((e) => e.trim()).filter(Boolean));
      const missingMembers = [...idpExtSet].filter((e) => !currentExtSet.has(e));
      const extraMembers = [...currentExtSet].filter((e) => !idpExtSet.has(e));

      if (missingMembers.length > 0 || extraMembers.length > 0) {
        summaryMutable.membershipDrift += 1;
        let resolved = false;
        let resolutionAction: string | undefined;

        if (isApply && input.applySyncMissingAndDrifts) {
          await this.scimGroupsService.replaceGroup(
            client,
            String(localGrp.id),
            {
              schemas: [SCIM_SCHEMAS.GROUP],
              ...(idpGroup.externalId ? { externalId: idpGroup.externalId } : {}),
              displayName: idpGroup.displayName,
              members: expectedMemberUserIds.map((uid) => ({ value: String(uid) })),
            },
            undefined,
            internalMeta,
          );
          resolved = true;
          resolutionAction = 'SYNCED_GROUP_MEMBERS';
          appliedActionsCount += 1;
        }

        discrepancies.push({
          type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.MEMBERSHIP_DRIFT,
          entityType: 'GROUP',
          externalId: localGrp.externalId ?? idpGroup.externalId ?? null,
          localId: Number(localGrp.id),
          identifier: idpGroup.displayName,
          details: { missingMembers, extraMembers },
          resolved,
          ...(resolutionAction ? { resolutionAction } : {}),
        });
      }
    }

    for (const localGrp of localGroups) {
      if (!localGrp.active) continue;
      if (idpGroupDisplayLowerSet.has(localGrp.displayName.trim().toLowerCase())) continue;

      summaryMutable.groupOrphanInLocal += 1;
      let resolved = false;
      let resolutionAction: string | undefined;

      if (isApply && input.applyDeprovisionOrphans) {
        await this.scimGroupsService.deleteGroup(
          client,
          String(localGrp.id),
          undefined,
          internalMeta,
        );
        resolved = true;
        resolutionAction = 'DELETED_ORPHAN_GROUP';
        appliedActionsCount += 1;
      }

      discrepancies.push({
        type: SCIM_RECONCILIATION_DISCREPANCY_TYPE.GROUP_ORPHAN_IN_LOCAL,
        entityType: 'GROUP',
        externalId: localGrp.externalId,
        localId: Number(localGrp.id),
        identifier: localGrp.displayName,
        details: { reason: 'Present locally but missing in IdP group snapshot' },
        resolved,
        ...(resolutionAction ? { resolutionAction } : {}),
      });
    }

    const completedAt = new Date();
    const runEntity = this.reconRunRepository.create({
      clientId: client.id,
      mode,
      status: 'COMPLETED',
      idpUsersCount: input.idpUsers.length,
      localUsersCount: localLinks.length,
      idpGroupsCount: input.idpGroups?.length ?? 0,
      localGroupsCount: localGroups.length,
      discrepanciesCount: discrepancies.length,
      appliedActionsCount,
      summaryJson: JSON.stringify(summaryMutable),
      discrepanciesJson: JSON.stringify(discrepancies),
      triggeredBy: actor?.id ?? null,
      startedAt,
      completedAt,
    });
    const saved = await this.reconRunRepository.saveEntity(runEntity);
    const view = this.toView(saved);

    await this.auditLogService
      ?.record({
        actorUserId: actor?.id ?? null,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_RECONCILE,
        action: 'SCIM_RECONCILE_IDP',
        resourceType: 'scim_reconciliation_run',
        resourceId: saved.id,
        afterData: {
          clientCode: client.code,
          mode,
          discrepanciesCount: discrepancies.length,
          appliedActionsCount,
          summary: summaryMutable,
        },
      })
      .catch(() => undefined);

    await this.domainEventBus
      .publish({
        type: 'ScimReconciliationCompleted',
        dotName: SCIM_EVENTS.RECONCILIATION_COMPLETED,
        version: 1,
        sourceModule: SCIM_AUDIT_META.MODULE,
        aggregateType: 'ScimReconciliationRun',
        aggregateId: String(saved.id),
        actorId: actor?.id ?? null,
        payload: {
          runId: saved.id,
          clientId: client.id,
          mode,
          discrepanciesCount: discrepancies.length,
          appliedActionsCount,
        },
      })
      .catch(() => undefined);

    return view;
  }
}
