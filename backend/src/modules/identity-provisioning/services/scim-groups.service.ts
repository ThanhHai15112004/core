import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DomainEventBusService,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  SCIM_AUDIT_META,
  SCIM_CLIENT_SCOPES,
  SCIM_EVENTS,
  SCIM_SETTING_KEYS,
  SCIM_SYNC_OUTCOME,
} from '../enum/identity-provisioning.enum.js';
import type { ScimClientEntity } from '../entities/scim-client.entity.js';
import type { ScimGroupEntity } from '../entities/scim-group.entity.js';
import { ScimProtocolException } from '../helpers/scim-error.helper.js';
import { matchesScimGroupFilter, parseScimFilter } from '../helpers/scim-filter.helper.js';
import {
  applyScimGroupPatchOperations,
  buildScimGroupResource,
  buildScimListResponse,
  extractScimGroupWriteFields,
} from '../helpers/scim-mapper.helper.js';
import {
  computeScimPayloadFingerprint,
  parseScimIfMatchVersion,
} from '../helpers/scim-security.helper.js';
import { ScimGroupMemberRepository } from '../repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from '../repositories/scim-group.repository.js';
import type {
  ScimListQuery,
  ScimPatchBodyInput,
} from '../requests/identity-provisioning.requests.js';
import type {
  ScimGroupResource,
  ScimListResponse,
  ScimRequestMeta,
} from '../types/identity-provisioning.types.js';
import { ScimGroupRoleSyncService } from './scim-group-role-sync.service.js';
import { ScimSyncLogService } from './scim-sync-log.service.js';

export interface ScimGroupMutationOutcome {
  readonly resource: ScimGroupResource;
  readonly idempotencyHit: boolean;
  readonly created: boolean;
}

@Injectable()
export class ScimGroupsService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly domainEventBus: DomainEventBusService;

  constructor(
    private readonly groupRepository: ScimGroupRepository,
    private readonly memberRepository: ScimGroupMemberRepository,
    private readonly roleSyncService: ScimGroupRoleSyncService,
    private readonly syncLogService: ScimSyncLogService,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() domainEventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.domainEventBus = domainEventBus ?? defaultDomainEventBus;
  }

  private assertScope(client: ScimClientEntity, requiredScope: string): void {
    const scopes = safeJsonParseStringArray(client.scopesJson);
    if (scopes.length === 0 || scopes.includes('*') || scopes.includes(requiredScope)) {
      return;
    }
    throw new ScimProtocolException(
      403,
      `SCIM Client lacks required scope '${requiredScope}'`,
      undefined,
      'SCIM_SCOPE_DENIED',
    );
  }

  private isIfMatchRequired(client: ScimClientEntity): boolean {
    return (
      Boolean(client.requireIfMatch) ||
      this.settingRegistry.getBoolean(SCIM_SETTING_KEYS.REQUIRE_IF_MATCH_ON_WRITE, undefined, false)
    );
  }

  private assertIfMatchVersion(
    client: ScimClientEntity,
    currentVersion: number,
    rawIfMatch?: string | string[] | null,
  ): void {
    const parsed = parseScimIfMatchVersion(rawIfMatch);
    if (parsed === null) {
      if (this.isIfMatchRequired(client)) {
        throw new ScimProtocolException(
          428,
          'If-Match header is required by SCIM concurrency policy',
          'invalidVers',
          'SCIM_IF_MATCH_REQUIRED',
        );
      }
      return;
    }
    if (parsed === '*') return;
    if (parsed === 'INVALID' || parsed !== currentVersion) {
      throw new ScimProtocolException(
        412,
        `ETag / If-Match mismatch: expected version ${currentVersion}`,
        'invalidVers',
        'SCIM_VERSION_MISMATCH',
      );
    }
  }

  private async hydrateMembersForGroup(
    groupId: number,
  ): Promise<Array<{ readonly userId: number; readonly display?: string | undefined }>> {
    const members = await this.memberRepository.findByGroupId(groupId);
    const result: Array<{ readonly userId: number; readonly display?: string | undefined }> = [];
    for (const member of members) {
      const user = await this.usersPublicService?.getProvisionedUserById?.(member.userId);
      result.push({
        userId: Number(member.userId),
        ...(user?.fullName ? { display: user.fullName } : {}),
      });
    }
    return result;
  }

  private async filterValidMemberIds(memberUserIds: readonly number[]): Promise<number[]> {
    const unique = Array.from(
      new Set(memberUserIds.filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (!this.usersPublicService || unique.length === 0) {
      return unique.sort((a, b) => a - b);
    }
    const valid: number[] = [];
    for (const userId of unique) {
      const user = await this.usersPublicService.getProvisionedUserById?.(userId);
      if (user) valid.push(userId);
    }
    return valid.sort((a, b) => a - b);
  }

  private async syncRolesForUsers(
    client: ScimClientEntity,
    userIds: readonly number[],
    ipAddress?: string | null,
  ): Promise<void> {
    const unique = Array.from(new Set(userIds));
    for (const userId of unique) {
      await this.roleSyncService.syncUserRolesFromClientGroups(client, userId, ipAddress);
    }
  }

  public async listGroups(
    client: ScimClientEntity,
    query: ScimListQuery,
    meta: ScimRequestMeta,
  ): Promise<ScimListResponse<ScimGroupResource>> {
    const startedAt = Date.now();
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_READ);
      const clauses = parseScimFilter(query.filter);

      const maxPageSize = Math.max(
        10,
        Math.min(
          500,
          this.settingRegistry.getNumber(SCIM_SETTING_KEYS.MAX_PAGE_SIZE, undefined, 100) || 100,
        ),
      );
      const startIndex = Math.max(1, query.startIndex ?? 1);
      const count = Math.max(0, Math.min(maxPageSize, query.count ?? maxPageSize));

      const groups = await this.groupRepository.findByClient(client.id);
      const resources: ScimGroupResource[] = [];
      for (const group of groups) {
        const members = await this.hydrateMembersForGroup(group.id);
        const res = buildScimGroupResource({ group, members, baseUrl: meta.baseUrl });
        if (matchesScimGroupFilter(res, clauses)) {
          resources.push(res);
        }
      }

      const sliceStart = startIndex - 1;
      const pageItems = count === 0 ? [] : resources.slice(sliceStart, sliceStart + count);
      const result = buildScimListResponse(
        pageItems,
        resources.length,
        startIndex,
        pageItems.length,
      );

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'LIST',
        resourceType: 'Group',
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 200,
        outcome: SCIM_SYNC_OUTCOME.SUCCESS,
        requestSummary: { filter: query.filter ?? null, startIndex, count },
        responseSummary: { totalResults: resources.length, itemsPerPage: pageItems.length },
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      await this.recordErrorLog(client.id, 'LIST', null, null, meta, error, startedAt);
      throw error;
    }
  }

  public async getGroup(
    client: ScimClientEntity,
    rawId: string,
    meta: ScimRequestMeta,
  ): Promise<ScimGroupResource> {
    const startedAt = Date.now();
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_READ);
      const groupId = Number(rawId);
      if (!Number.isInteger(groupId) || groupId < 1) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }

      const group = await this.groupRepository.findByClientAndId(client.id, groupId);
      if (!group) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }

      const members = await this.hydrateMembersForGroup(group.id);
      const resource = buildScimGroupResource({ group, members, baseUrl: meta.baseUrl });

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'GET',
        resourceType: 'Group',
        resourceId: String(group.id),
        externalId: group.externalId,
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 200,
        outcome: SCIM_SYNC_OUTCOME.SUCCESS,
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });

      return resource;
    } catch (error) {
      await this.recordErrorLog(client.id, 'GET', rawId, null, meta, error, startedAt);
      throw error;
    }
  }

  public async createGroup(
    client: ScimClientEntity,
    rawBody: unknown,
    meta: ScimRequestMeta,
  ): Promise<ScimGroupMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_WRITE);
      const extracted = extractScimGroupWriteFields(rawBody);
      if (!extracted.displayName) {
        throw new ScimProtocolException(400, 'SCIM Group requires displayName', 'invalidValue');
      }

      const externalId = extracted.externalId?.trim() ?? null;
      externalIdForLog = externalId;
      const memberUserIds = await this.filterValidMemberIds(extracted.memberUserIds);
      const canonicalPayload = {
        externalId,
        displayName: extracted.displayName,
        memberUserIds,
      };
      const payloadFingerprint = computeScimPayloadFingerprint(canonicalPayload);

      const existingByExternal = externalId
        ? await this.groupRepository.findByClientAndExternalId(client.id, externalId)
        : null;
      const existingByDisplay = await this.groupRepository.findByClientAndDisplayName(
        client.id,
        extracted.displayName,
      );
      const existing = existingByExternal ?? existingByDisplay;

      if (existing) {
        if (existing.payloadFingerprint === payloadFingerprint) {
          const members = await this.hydrateMembersForGroup(existing.id);
          const resource = buildScimGroupResource({
            group: existing,
            members,
            baseUrl: meta.baseUrl,
          });
          await this.syncLogService.record({
            clientId: client.id,
            requestId: meta.requestId,
            correlationId: meta.correlationId,
            operation: 'CREATE',
            resourceType: 'Group',
            resourceId: String(existing.id),
            externalId: existing.externalId,
            httpMethod: meta.httpMethod,
            httpPath: meta.httpPath,
            httpStatus: 200,
            outcome: SCIM_SYNC_OUTCOME.NOOP_DUPLICATE,
            idempotencyHit: true,
            requestSummary: canonicalPayload,
            responseSummary: { id: resource.id, version: resource.meta.version },
            ipAddress: meta.ipAddress,
            durationMs: Date.now() - startedAt,
          });
          return { resource, idempotencyHit: true, created: false };
        }
        throw new ScimProtocolException(
          409,
          `SCIM Group '${extracted.displayName}' already exists with different payload`,
          'uniqueness',
          'SCIM_GROUP_CONFLICT',
        );
      }

      const mappedRoles = this.roleSyncService.resolveMappedRolesForGroupName(
        client,
        extracted.displayName,
      );
      let group = this.groupRepository.create({
        clientId: client.id,
        externalId,
        displayName: extracted.displayName,
        mappedRoleCode: mappedRoles[0] ?? null,
        scimVersion: 1,
        payloadFingerprint,
        active: true,
        lastSyncedAt: new Date(),
      });
      group = await this.groupRepository.saveEntity(group);

      await this.memberRepository.replaceGroupMembers(client.id, group.id, memberUserIds);
      await this.syncRolesForUsers(client, memberUserIds, meta.ipAddress);

      const members = await this.hydrateMembersForGroup(group.id);
      const resource = buildScimGroupResource({ group, members, baseUrl: meta.baseUrl });

      await this.publishGroupSyncedEvent(client, group, memberUserIds);
      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'CREATE',
        resourceType: 'Group',
        resourceId: String(group.id),
        externalId: group.externalId,
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 201,
        outcome: SCIM_SYNC_OUTCOME.SUCCESS,
        requestSummary: canonicalPayload,
        responseSummary: { id: resource.id, version: resource.meta.version },
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });

      return { resource, idempotencyHit: false, created: true };
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'CREATE',
        null,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async replaceGroup(
    client: ScimClientEntity,
    rawId: string,
    rawBody: unknown,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<ScimGroupMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_WRITE);
      const groupId = Number(rawId);
      if (!Number.isInteger(groupId) || groupId < 1) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      const group = await this.groupRepository.findByClientAndId(client.id, groupId);
      if (!group) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = group.externalId;

      this.assertIfMatchVersion(client, group.scimVersion, rawIfMatch);

      const extracted = extractScimGroupWriteFields(rawBody);
      const nextDisplayName = extracted.displayName ?? group.displayName;
      const nextExternalId =
        extracted.externalId !== undefined ? extracted.externalId : group.externalId;
      const nextMemberUserIds = await this.filterValidMemberIds(extracted.memberUserIds);

      return await this.commitGroupMutation({
        client,
        group,
        operation: 'REPLACE',
        nextState: {
          externalId: nextExternalId ?? null,
          displayName: nextDisplayName,
          memberUserIds: nextMemberUserIds,
        },
        meta,
        startedAt,
      });
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'REPLACE',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async patchGroup(
    client: ScimClientEntity,
    rawId: string,
    patchBody: ScimPatchBodyInput,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<ScimGroupMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_WRITE);
      const groupId = Number(rawId);
      if (!Number.isInteger(groupId) || groupId < 1) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      const group = await this.groupRepository.findByClientAndId(client.id, groupId);
      if (!group) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = group.externalId;

      this.assertIfMatchVersion(client, group.scimVersion, rawIfMatch);

      const existingMembers = await this.memberRepository.findByGroupId(group.id);
      const currentMemberIds = existingMembers.map((m) => Number(m.userId));
      const patched = applyScimGroupPatchOperations(
        {
          externalId: group.externalId,
          displayName: group.displayName,
          memberUserIds: currentMemberIds,
        },
        patchBody.Operations,
      );
      const validMembers = await this.filterValidMemberIds(patched.memberUserIds);

      return await this.commitGroupMutation({
        client,
        group,
        operation: 'PATCH',
        nextState: {
          externalId: patched.externalId,
          displayName: patched.displayName,
          memberUserIds: validMembers,
        },
        meta,
        startedAt,
      });
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'PATCH',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async deleteGroup(
    client: ScimClientEntity,
    rawId: string,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<void> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.GROUPS_WRITE);
      const groupId = Number(rawId);
      if (!Number.isInteger(groupId) || groupId < 1) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      const group = await this.groupRepository.findByClientAndId(client.id, groupId);
      if (!group) {
        throw new ScimProtocolException(404, `SCIM Group '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = group.externalId;

      this.assertIfMatchVersion(client, group.scimVersion, rawIfMatch);

      const existingMembers = await this.memberRepository.findByGroupId(group.id);
      const affectedUserIds = existingMembers.map((m) => Number(m.userId));
      await this.memberRepository.deleteByGroupId(group.id);
      await this.groupRepository.softDeleteEntity(group);
      await this.syncRolesForUsers(client, affectedUserIds, meta.ipAddress);

      await this.auditLogService
        ?.record({
          actorUserId: null,
          module: SCIM_AUDIT_META.MODULE,
          feature: SCIM_AUDIT_META.FEATURE_GROUP,
          action: 'SCIM_DELETE_GROUP',
          resourceType: 'scim_group',
          resourceId: groupId,
          ipAddress: meta.ipAddress,
          afterData: { clientCode: client.code, displayName: group.displayName },
        })
        .catch(() => undefined);

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'DELETE',
        resourceType: 'Group',
        resourceId: String(groupId),
        externalId: group.externalId,
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 204,
        outcome: SCIM_SYNC_OUTCOME.SUCCESS,
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'DELETE',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  private async commitGroupMutation(params: {
    readonly client: ScimClientEntity;
    readonly group: ScimGroupEntity;
    readonly operation: 'REPLACE' | 'PATCH';
    readonly nextState: {
      readonly externalId: string | null;
      readonly displayName: string;
      readonly memberUserIds: readonly number[];
    };
    readonly meta: ScimRequestMeta;
    readonly startedAt: number;
  }): Promise<ScimGroupMutationOutcome> {
    const { client, group, operation, nextState, meta, startedAt } = params;

    if (nextState.displayName !== group.displayName) {
      const clash = await this.groupRepository.findByClientAndDisplayName(
        client.id,
        nextState.displayName,
      );
      if (clash && clash.id !== group.id) {
        throw new ScimProtocolException(
          409,
          `SCIM Group '${nextState.displayName}' already exists`,
          'uniqueness',
          'SCIM_GROUP_CONFLICT',
        );
      }
    }

    const nextFingerprint = computeScimPayloadFingerprint(nextState);
    if (nextFingerprint === group.payloadFingerprint) {
      const members = await this.hydrateMembersForGroup(group.id);
      const resource = buildScimGroupResource({ group, members, baseUrl: meta.baseUrl });
      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation,
        resourceType: 'Group',
        resourceId: String(group.id),
        externalId: group.externalId,
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 200,
        outcome: SCIM_SYNC_OUTCOME.NOOP_DUPLICATE,
        idempotencyHit: true,
        requestSummary: nextState,
        responseSummary: { id: resource.id, version: resource.meta.version },
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });
      return { resource, idempotencyHit: true, created: false };
    }

    const prevMembers = await this.memberRepository.findByGroupId(group.id);
    const affectedUserIds = Array.from(
      new Set([...prevMembers.map((m) => Number(m.userId)), ...nextState.memberUserIds]),
    );

    const mappedRoles = this.roleSyncService.resolveMappedRolesForGroupName(
      client,
      nextState.displayName,
    );
    group.externalId = nextState.externalId;
    group.displayName = nextState.displayName;
    group.mappedRoleCode = mappedRoles[0] ?? null;
    group.scimVersion += 1;
    group.payloadFingerprint = nextFingerprint;
    group.lastSyncedAt = new Date();
    const savedGroup = await this.groupRepository.saveEntity(group);

    await this.memberRepository.replaceGroupMembers(
      client.id,
      savedGroup.id,
      nextState.memberUserIds,
    );
    await this.syncRolesForUsers(client, affectedUserIds, meta.ipAddress);

    const members = await this.hydrateMembersForGroup(savedGroup.id);
    const resource = buildScimGroupResource({ group: savedGroup, members, baseUrl: meta.baseUrl });

    await this.publishGroupSyncedEvent(client, savedGroup, nextState.memberUserIds);
    await this.syncLogService.record({
      clientId: client.id,
      requestId: meta.requestId,
      correlationId: meta.correlationId,
      operation,
      resourceType: 'Group',
      resourceId: String(savedGroup.id),
      externalId: savedGroup.externalId,
      httpMethod: meta.httpMethod,
      httpPath: meta.httpPath,
      httpStatus: 200,
      outcome: SCIM_SYNC_OUTCOME.SUCCESS,
      requestSummary: nextState,
      responseSummary: { id: resource.id, version: resource.meta.version },
      ipAddress: meta.ipAddress,
      durationMs: Date.now() - startedAt,
    });

    return { resource, idempotencyHit: false, created: false };
  }

  private async publishGroupSyncedEvent(
    client: ScimClientEntity,
    group: ScimGroupEntity,
    memberUserIds: readonly number[],
  ): Promise<void> {
    await this.domainEventBus
      .publish({
        type: 'ScimGroupSynced',
        dotName: SCIM_EVENTS.GROUP_SYNCED,
        version: 1,
        sourceModule: SCIM_AUDIT_META.MODULE,
        aggregateType: 'ScimGroup',
        aggregateId: String(group.id),
        actorId: null,
        payload: {
          clientId: client.id,
          clientCode: client.code,
          groupId: group.id,
          displayName: group.displayName,
          memberCount: memberUserIds.length,
        },
      })
      .catch(() => undefined);
  }

  private async recordErrorLog(
    clientId: number,
    operation: string,
    resourceId: string | null,
    externalId: string | null,
    meta: ScimRequestMeta,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    const status = error instanceof ScimProtocolException ? error.httpStatus : 500;
    const isConflict = status === 409 || status === 412;
    await this.syncLogService.record({
      clientId,
      requestId: meta.requestId,
      correlationId: meta.correlationId,
      operation,
      resourceType: 'Group',
      resourceId,
      externalId,
      httpMethod: meta.httpMethod,
      httpPath: meta.httpPath,
      httpStatus: status,
      outcome: isConflict ? SCIM_SYNC_OUTCOME.CONFLICT : SCIM_SYNC_OUTCOME.FAILED,
      errorCode: error instanceof ScimProtocolException ? error.errorCode : 'SCIM_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
      ipAddress: meta.ipAddress,
      durationMs: Date.now() - startedAt,
    });
  }
}
