import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DomainEventBusService,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  type ISessionsPublicService,
  SESSIONS_PUBLIC_SERVICE,
} from '@modules/sessions/contracts/index.js';
import {
  type IUsersPublicService,
  type ProvisionedUserView,
  USER_STATUS,
  USERS_PUBLIC_SERVICE,
} from '@modules/users/contracts/index.js';
import {
  SCIM_AUDIT_META,
  SCIM_CLIENT_SCOPES,
  SCIM_DEPROVISION_MODE,
  SCIM_EVENTS,
  SCIM_SETTING_KEYS,
  SCIM_SYNC_OUTCOME,
} from '../enum/identity-provisioning.enum.js';
import type { ScimClientEntity } from '../entities/scim-client.entity.js';
import type { ScimGroupEntity } from '../entities/scim-group.entity.js';
import type { ScimUserLinkEntity } from '../entities/scim-user-link.entity.js';
import { ScimProtocolException } from '../helpers/scim-error.helper.js';
import { matchesScimUserFilter, parseScimFilter } from '../helpers/scim-filter.helper.js';
import {
  buildScimListResponse,
  buildScimUserResource,
  extractScimUserWriteFields,
  applyScimUserPatchOperations,
} from '../helpers/scim-mapper.helper.js';
import {
  computeScimPayloadFingerprint,
  parseScimIfMatchVersion,
} from '../helpers/scim-security.helper.js';
import { ScimGroupMemberRepository } from '../repositories/scim-group-member.repository.js';
import { ScimGroupRepository } from '../repositories/scim-group.repository.js';
import { ScimUserLinkRepository } from '../repositories/scim-user-link.repository.js';
import type {
  ScimListQuery,
  ScimPatchBodyInput,
} from '../requests/identity-provisioning.requests.js';
import type {
  ScimListResponse,
  ScimRequestMeta,
  ScimUserResource,
} from '../types/identity-provisioning.types.js';
import { ScimGroupRoleSyncService } from './scim-group-role-sync.service.js';
import { ScimSyncLogService } from './scim-sync-log.service.js';

export interface ScimUserMutationOutcome {
  readonly resource: ScimUserResource;
  readonly idempotencyHit: boolean;
  readonly created: boolean;
}

function splitFallbackNameParts(fullName: string, username: string): {
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
} {
  const cleanFull = fullName.trim() || username;
  const parts = cleanFull.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return {
      firstName: parts[0] ?? username,
      lastName: parts[0] ?? username,
      fullName: cleanFull,
    };
  }
  const lastName = parts[parts.length - 1] ?? username;
  const firstName = parts.slice(0, -1).join(' ');
  return { firstName, lastName, fullName: cleanFull };
}

function generateProvisioningPassword(): string {
  return `Scim!${randomBytes(20).toString('base64url')}1aA`;
}

@Injectable()
export class ScimUsersService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly domainEventBus: DomainEventBusService;

  constructor(
    private readonly userLinkRepository: ScimUserLinkRepository,
    private readonly groupRepository: ScimGroupRepository,
    private readonly groupMemberRepository: ScimGroupMemberRepository,
    private readonly roleSyncService: ScimGroupRoleSyncService,
    private readonly syncLogService: ScimSyncLogService,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService?: IUsersPublicService,
    @Optional()
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsPublicService?: ISessionsPublicService,
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

  private assertUsersPort(): IUsersPublicService {
    if (!this.usersPublicService) {
      throw new ScimProtocolException(500, 'Users public service is unavailable');
    }
    return this.usersPublicService;
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

  private async loadUserGroups(
    clientId: number,
    userId: number,
  ): Promise<ScimGroupEntity[]> {
    const memberships = await this.groupMemberRepository.findByClientAndUserId(clientId, userId);
    if (memberships.length === 0) return [];
    const groupIdSet = new Set(memberships.map((m) => Number(m.scimGroupId)));
    const allGroups = await this.groupRepository.findByClient(clientId);
    return allGroups.filter((g) => groupIdSet.has(Number(g.id)));
  }

  public async listUsers(
    client: ScimClientEntity,
    query: ScimListQuery,
    meta: ScimRequestMeta,
  ): Promise<ScimListResponse<ScimUserResource>> {
    const startedAt = Date.now();
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_READ);
      const usersPort = this.assertUsersPort();
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

      const links = await this.userLinkRepository.findByClient(client.id);
      const resources: ScimUserResource[] = [];

      for (const link of links) {
        const user = await usersPort.getProvisionedUserById?.(link.userId);
        if (!user) continue;
        const groups = await this.loadUserGroups(client.id, link.userId);
        const res = buildScimUserResource({
          link,
          user,
          groups,
          baseUrl: meta.baseUrl,
        });
        if (matchesScimUserFilter(res, clauses)) {
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
        resourceType: 'User',
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
      await this.recordErrorLog(client.id, 'LIST', 'User', null, null, meta, error, startedAt);
      throw error;
    }
  }

  public async getUser(
    client: ScimClientEntity,
    rawId: string,
    meta: ScimRequestMeta,
  ): Promise<ScimUserResource> {
    const startedAt = Date.now();
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_READ);
      const userId = Number(rawId);
      if (!Number.isInteger(userId) || userId < 1) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }

      const link = await this.userLinkRepository.findByClientAndUserId(client.id, userId);
      const usersPort = this.assertUsersPort();
      const user = link ? await usersPort.getProvisionedUserById?.(userId) : null;

      if (!link || !user) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }

      const groups = await this.loadUserGroups(client.id, userId);
      const resource = buildScimUserResource({
        link,
        user,
        groups,
        baseUrl: meta.baseUrl,
      });

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'GET',
        resourceType: 'User',
        resourceId: String(userId),
        externalId: link.externalId,
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        httpStatus: 200,
        outcome: SCIM_SYNC_OUTCOME.SUCCESS,
        ipAddress: meta.ipAddress,
        durationMs: Date.now() - startedAt,
      });

      return resource;
    } catch (error) {
      await this.recordErrorLog(client.id, 'GET', 'User', rawId, null, meta, error, startedAt);
      throw error;
    }
  }

  public async createUser(
    client: ScimClientEntity,
    rawBody: unknown,
    meta: ScimRequestMeta,
  ): Promise<ScimUserMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_WRITE);
      const usersPort = this.assertUsersPort();
      const extracted = extractScimUserWriteFields(rawBody);
      const userName = extracted.userName ?? extracted.email;
      const email = extracted.email ?? (userName?.includes('@') ? userName.toLowerCase() : undefined);

      if (!userName || !email) {
        throw new ScimProtocolException(
          400,
          'SCIM User requires userName and a valid email address',
          'invalidValue',
        );
      }

      const externalId = (extracted.externalId ?? userName).trim();
      externalIdForLog = externalId;
      const desiredActive = extracted.active ?? true;
      const nameParts = splitFallbackNameParts(
        extracted.fullName ??
          `${extracted.firstName ?? ''} ${extracted.lastName ?? ''}`.trim(),
        userName,
      );
      const firstName = extracted.firstName ?? nameParts.firstName;
      const lastName = extracted.lastName ?? nameParts.lastName;
      const fullName = extracted.fullName ?? nameParts.fullName;

      const canonicalPayload = {
        externalId,
        userName,
        email,
        phone: extracted.phone ?? null,
        firstName,
        lastName,
        fullName,
        active: desiredActive,
      };
      const payloadFingerprint = computeScimPayloadFingerprint(canonicalPayload);

      const existingByExternal = await this.userLinkRepository.findByClientAndExternalId(
        client.id,
        externalId,
      );
      if (existingByExternal) {
        if (existingByExternal.payloadFingerprint === payloadFingerprint) {
          const existingUser = await usersPort.getProvisionedUserById?.(existingByExternal.userId);
          if (existingUser) {
            const groups = await this.loadUserGroups(client.id, existingUser.id);
            const resource = buildScimUserResource({
              link: existingByExternal,
              user: existingUser,
              groups,
              baseUrl: meta.baseUrl,
            });
            await this.syncLogService.record({
              clientId: client.id,
              requestId: meta.requestId,
              correlationId: meta.correlationId,
              operation: 'CREATE',
              resourceType: 'User',
              resourceId: String(existingUser.id),
              externalId,
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
        }
        throw new ScimProtocolException(
          409,
          `External ID '${externalId}' already exists with different attributes`,
          'uniqueness',
          'SCIM_EXTERNAL_ID_CONFLICT',
        );
      }

      let localUser =
        (await usersPort.findProvisionedUserByIdentifier?.(email)) ??
        (await usersPort.findProvisionedUserByIdentifier?.(userName)) ??
        null;

      if (localUser) {
        const existingLinkForUser = await this.userLinkRepository.findByClientAndUserId(
          client.id,
          localUser.id,
        );
        if (existingLinkForUser && existingLinkForUser.externalId !== externalId) {
          throw new ScimProtocolException(
            409,
            `User '${userName}' is already linked to a different SCIM externalId`,
            'uniqueness',
            'SCIM_USER_ALREADY_LINKED',
          );
        }
        localUser =
          (await usersPort.updateProvisionedUser?.(localUser.id, {
            email,
            phone: extracted.phone ?? localUser.phone,
            firstName,
            lastName,
            fullName,
          })) ?? localUser;
      } else {
        localUser =
          (await usersPort.createProvisionedUser?.({
            username: userName,
            email,
            phone: extracted.phone ?? null,
            password: generateProvisioningPassword(),
            firstName,
            lastName,
            fullName,
            status: desiredActive ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE,
          })) ?? null;
      }

      if (!localUser) {
        throw new ScimProtocolException(500, 'Failed to provision local user');
      }

      const now = new Date();
      let link = this.userLinkRepository.create({
        clientId: client.id,
        userId: localUser.id,
        externalId,
        scimUsername: userName,
        scimVersion: 1,
        payloadFingerprint,
        active: desiredActive,
        rawAttributesJson: JSON.stringify(canonicalPayload),
        lastSyncedAt: now,
        deprovisionedAt: desiredActive ? null : now,
        deprovisionReason: desiredActive ? null : 'SCIM_PROVISIONED_INACTIVE',
      });
      link = await this.userLinkRepository.saveEntity(link);

      if (!desiredActive) {
        localUser = await this.applyDeprovisionToUser(
          client,
          localUser.id,
          'SCIM_PROVISIONED_INACTIVE',
          meta.ipAddress,
        );
      } else {
        await this.roleSyncService.syncUserRolesFromClientGroups(
          client,
          localUser.id,
          meta.ipAddress,
        );
      }

      const groups = await this.loadUserGroups(client.id, localUser.id);
      const resource = buildScimUserResource({
        link,
        user: localUser,
        groups,
        baseUrl: meta.baseUrl,
      });

      await this.auditLogService
        ?.record({
          actorUserId: localUser.id,
          module: SCIM_AUDIT_META.MODULE,
          feature: SCIM_AUDIT_META.FEATURE_USER,
          action: 'SCIM_CREATE_USER',
          resourceType: 'user',
          resourceId: localUser.id,
          ipAddress: meta.ipAddress,
          afterData: { clientCode: client.code, externalId, userName, active: desiredActive },
        })
        .catch(() => undefined);

      await this.publishScimEvent(
        SCIM_EVENTS.USER_PROVISIONED,
        'ScimUserProvisioned',
        'User',
        localUser.id,
        { clientId: client.id, clientCode: client.code, userId: localUser.id, externalId },
      );

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'CREATE',
        resourceType: 'User',
        resourceId: String(localUser.id),
        externalId,
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
        'User',
        null,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async replaceUser(
    client: ScimClientEntity,
    rawId: string,
    rawBody: unknown,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<ScimUserMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_WRITE);
      const usersPort = this.assertUsersPort();
      const userId = Number(rawId);
      if (!Number.isInteger(userId) || userId < 1) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }

      const link = await this.userLinkRepository.findByClientAndUserId(client.id, userId);
      const currentUser = link ? await usersPort.getProvisionedUserById?.(userId) : null;
      if (!link || !currentUser) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = link.externalId;

      this.assertIfMatchVersion(client, link.scimVersion, rawIfMatch);

      const extracted = extractScimUserWriteFields(rawBody);
      const nextExternalId = (extracted.externalId ?? link.externalId).trim();
      const nextUserName = extracted.userName ?? currentUser.username;
      const nextEmail = extracted.email ?? currentUser.email;
      const nextPhone = extracted.phone !== undefined ? extracted.phone : currentUser.phone;
      const nextFirstName = extracted.firstName ?? currentUser.firstName;
      const nextLastName = extracted.lastName ?? currentUser.lastName;
      const nextFullName =
        extracted.fullName ?? `${nextFirstName} ${nextLastName}`.trim() ?? currentUser.fullName;
      const nextActive = extracted.active ?? link.active;

      return await this.commitUserMutation({
        client,
        link,
        currentUser,
        operation: 'REPLACE',
        nextState: {
          externalId: nextExternalId,
          userName: nextUserName,
          email: nextEmail,
          phone: nextPhone,
          firstName: nextFirstName,
          lastName: nextLastName,
          fullName: nextFullName,
          active: nextActive,
        },
        meta,
        startedAt,
      });
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'REPLACE',
        'User',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async patchUser(
    client: ScimClientEntity,
    rawId: string,
    patchBody: ScimPatchBodyInput,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<ScimUserMutationOutcome> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_WRITE);
      const usersPort = this.assertUsersPort();
      const userId = Number(rawId);
      if (!Number.isInteger(userId) || userId < 1) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }

      const link = await this.userLinkRepository.findByClientAndUserId(client.id, userId);
      const currentUser = link ? await usersPort.getProvisionedUserById?.(userId) : null;
      if (!link || !currentUser) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = link.externalId;

      this.assertIfMatchVersion(client, link.scimVersion, rawIfMatch);

      const patched = applyScimUserPatchOperations(
        {
          externalId: link.externalId,
          userName: currentUser.username,
          email: currentUser.email,
          phone: currentUser.phone,
          firstName: currentUser.firstName,
          lastName: currentUser.lastName,
          fullName: currentUser.fullName,
          active: Boolean(link.active && currentUser.status === USER_STATUS.ACTIVE),
        },
        patchBody.Operations,
      );

      return await this.commitUserMutation({
        client,
        link,
        currentUser,
        operation: 'PATCH',
        nextState: {
          externalId: patched.externalId ?? link.externalId,
          userName: patched.userName ?? currentUser.username,
          email: patched.email ?? currentUser.email,
          phone: patched.phone !== undefined ? patched.phone : currentUser.phone,
          firstName: patched.firstName ?? currentUser.firstName,
          lastName: patched.lastName ?? currentUser.lastName,
          fullName: patched.fullName ?? currentUser.fullName,
          active: patched.active ?? link.active,
        },
        meta,
        startedAt,
      });
    } catch (error) {
      await this.recordErrorLog(
        client.id,
        'PATCH',
        'User',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async deleteUser(
    client: ScimClientEntity,
    rawId: string,
    rawIfMatch: string | string[] | null | undefined,
    meta: ScimRequestMeta,
  ): Promise<void> {
    const startedAt = Date.now();
    let externalIdForLog: string | null = null;
    try {
      this.assertScope(client, SCIM_CLIENT_SCOPES.USERS_WRITE);
      const userId = Number(rawId);
      if (!Number.isInteger(userId) || userId < 1) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }

      const link = await this.userLinkRepository.findByClientAndUserId(client.id, userId);
      if (!link) {
        throw new ScimProtocolException(404, `SCIM User '${rawId}' not found`, 'noTarget');
      }
      externalIdForLog = link.externalId;

      this.assertIfMatchVersion(client, link.scimVersion, rawIfMatch);

      await this.applyDeprovisionToUser(client, userId, 'SCIM_USER_DELETED', meta.ipAddress);
      await this.groupMemberRepository.removeUserFromClientGroups(client.id, userId);
      await this.roleSyncService.syncUserRolesFromClientGroups(client, userId, meta.ipAddress);

      link.active = false;
      link.scimVersion += 1;
      link.deprovisionedAt = new Date();
      link.deprovisionReason = 'SCIM_USER_DELETED';
      link.lastSyncedAt = new Date();
      await this.userLinkRepository.saveEntity(link);

      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation: 'DELETE',
        resourceType: 'User',
        resourceId: String(userId),
        externalId: link.externalId,
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
        'User',
        rawId,
        externalIdForLog,
        meta,
        error,
        startedAt,
      );
      throw error;
    }
  }

  public async applyDeprovisionToUser(
    client: ScimClientEntity,
    userId: number,
    reason: string,
    ipAddress?: string | null,
  ): Promise<ProvisionedUserView> {
    const usersPort = this.assertUsersPort();
    let updatedUser: ProvisionedUserView | undefined;

    if (client.deprovisionMode === SCIM_DEPROVISION_MODE.DEACTIVATE_AND_REVOKE) {
      updatedUser = await usersPort.deactivateProvisionedUser?.(userId, reason);
    } else {
      updatedUser = await usersPort.lockProvisionedUser?.(userId, reason);
    }

    const revokedSessionsCount =
      (await this.sessionsPublicService?.revokeAllUserSessions(userId, reason, undefined, {
        ipAddress: ipAddress ?? null,
      })) ?? 0;

    await this.auditLogService
      ?.record({
        actorUserId: userId,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_USER,
        action: 'SCIM_DEPROVISION_USER',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: ipAddress ?? null,
        afterData: {
          clientCode: client.code,
          deprovisionMode: client.deprovisionMode,
          reason,
          revokedSessionsCount,
        },
      })
      .catch(() => undefined);

    await this.publishScimEvent(
      SCIM_EVENTS.USER_DEPROVISIONED,
      'ScimUserDeprovisioned',
      'User',
      userId,
      {
        clientId: client.id,
        clientCode: client.code,
        userId,
        deprovisionMode: client.deprovisionMode,
        revokedSessionsCount,
        reason,
      },
    );

    if (!updatedUser) {
      const fallback = await usersPort.getProvisionedUserById?.(userId);
      if (!fallback) {
        throw new ScimProtocolException(404, `User #${userId} not found`, 'noTarget');
      }
      return fallback;
    }
    return updatedUser;
  }

  private async commitUserMutation(params: {
    readonly client: ScimClientEntity;
    readonly link: ScimUserLinkEntity;
    readonly currentUser: ProvisionedUserView;
    readonly operation: 'REPLACE' | 'PATCH';
    readonly nextState: {
      readonly externalId: string;
      readonly userName: string;
      readonly email: string;
      readonly phone: string | null;
      readonly firstName: string;
      readonly lastName: string;
      readonly fullName: string;
      readonly active: boolean;
    };
    readonly meta: ScimRequestMeta;
    readonly startedAt: number;
  }): Promise<ScimUserMutationOutcome> {
    const { client, link, currentUser, operation, nextState, meta, startedAt } = params;
    const usersPort = this.assertUsersPort();

    if (nextState.externalId !== link.externalId) {
      const conflicting = await this.userLinkRepository.findByClientAndExternalId(
        client.id,
        nextState.externalId,
      );
      if (conflicting && conflicting.id !== link.id) {
        throw new ScimProtocolException(
          409,
          `External ID '${nextState.externalId}' belongs to another user`,
          'uniqueness',
          'SCIM_EXTERNAL_ID_CONFLICT',
        );
      }
    }

    const nextFingerprint = computeScimPayloadFingerprint(nextState);
    const localCurrentlyActive = currentUser.status === USER_STATUS.ACTIVE;
    if (
      nextFingerprint === link.payloadFingerprint &&
      nextState.active === link.active &&
      nextState.active === localCurrentlyActive
    ) {
      const groups = await this.loadUserGroups(client.id, currentUser.id);
      const resource = buildScimUserResource({
        link,
        user: currentUser,
        groups,
        baseUrl: meta.baseUrl,
      });
      await this.syncLogService.record({
        clientId: client.id,
        requestId: meta.requestId,
        correlationId: meta.correlationId,
        operation,
        resourceType: 'User',
        resourceId: String(currentUser.id),
        externalId: link.externalId,
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

    let updatedUser =
      (await usersPort.updateProvisionedUser?.(currentUser.id, {
        email: nextState.email,
        phone: nextState.phone,
        firstName: nextState.firstName,
        lastName: nextState.lastName,
        fullName: nextState.fullName,
      })) ?? currentUser;

    if (!nextState.active && (link.active || updatedUser.status === USER_STATUS.ACTIVE)) {
      updatedUser = await this.applyDeprovisionToUser(
        client,
        currentUser.id,
        'SCIM_USER_DEACTIVATED',
        meta.ipAddress,
      );
      link.deprovisionedAt = new Date();
      link.deprovisionReason = 'SCIM_USER_DEACTIVATED';
    } else if (nextState.active && (!link.active || updatedUser.status !== USER_STATUS.ACTIVE)) {
      if (updatedUser.status === USER_STATUS.LOCKED) {
        updatedUser = (await usersPort.unlockProvisionedUser?.(currentUser.id)) ?? updatedUser;
      } else if (updatedUser.status !== USER_STATUS.ACTIVE) {
        updatedUser = (await usersPort.activateProvisionedUser?.(currentUser.id)) ?? updatedUser;
      }
      link.deprovisionedAt = null;
      link.deprovisionReason = null;
    }

    link.externalId = nextState.externalId;
    link.scimUsername = nextState.userName;
    link.active = nextState.active;
    link.scimVersion += 1;
    link.payloadFingerprint = nextFingerprint;
    link.rawAttributesJson = JSON.stringify(nextState);
    link.lastSyncedAt = new Date();
    const savedLink = await this.userLinkRepository.saveEntity(link);

    const groups = await this.loadUserGroups(client.id, updatedUser.id);
    const resource = buildScimUserResource({
      link: savedLink,
      user: updatedUser,
      groups,
      baseUrl: meta.baseUrl,
    });

    await this.publishScimEvent(
      SCIM_EVENTS.USER_UPDATED,
      'ScimUserUpdated',
      'User',
      updatedUser.id,
      {
        clientId: client.id,
        clientCode: client.code,
        userId: updatedUser.id,
        externalId: savedLink.externalId,
        active: savedLink.active,
      },
    );

    await this.syncLogService.record({
      clientId: client.id,
      requestId: meta.requestId,
      correlationId: meta.correlationId,
      operation,
      resourceType: 'User',
      resourceId: String(updatedUser.id),
      externalId: savedLink.externalId,
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

  private async publishScimEvent(
    dotName: string,
    type: string,
    aggregateType: string,
    aggregateId: number | string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.domainEventBus
      .publish({
        type,
        dotName,
        version: 1,
        sourceModule: SCIM_AUDIT_META.MODULE,
        aggregateType,
        aggregateId: String(aggregateId),
        actorId: null,
        payload,
      })
      .catch(() => undefined);
  }

  private async recordErrorLog(
    clientId: number,
    operation: string,
    resourceType: string,
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
      resourceType,
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
