import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FeatureFlagRegistryService, SettingRegistryService } from '@packages/kernel/index.js';
import type { AuditLogService } from '@packages/security/index.js';
import type {
  IRolesPublicService,
  RoleSummary,
  UserRoleLinkSummary,
} from '../../../src/modules/roles/contracts/index.js';
import type { ISessionsPublicService } from '../../../src/modules/sessions/contracts/index.js';
import {
  type CreateProvisionedUserInput,
  type IUsersPublicService,
  type ProvisionedUserView,
  USER_STATUS,
  type UpdateProvisionedUserInput,
} from '../../../src/modules/users/contracts/index.js';
import { ScimClientEntity } from '../../../src/modules/identity-provisioning/entities/scim-client.entity.js';
import { ScimGroupMemberEntity } from '../../../src/modules/identity-provisioning/entities/scim-group-member.entity.js';
import { ScimGroupEntity } from '../../../src/modules/identity-provisioning/entities/scim-group.entity.js';
import { ScimReconciliationRunEntity } from '../../../src/modules/identity-provisioning/entities/scim-reconciliation-run.entity.js';
import { ScimSyncLogEntity } from '../../../src/modules/identity-provisioning/entities/scim-sync-log.entity.js';
import { ScimUserLinkEntity } from '../../../src/modules/identity-provisioning/entities/scim-user-link.entity.js';
import {
  SCIM_CLIENT_STATUS,
  SCIM_DEPROVISION_MODE,
  SCIM_FEATURE_FLAGS,
  SCIM_RECONCILIATION_DISCREPANCY_TYPE,
  SCIM_RECONCILIATION_MODE,
  SCIM_SCHEMAS,
  SCIM_SYNC_OUTCOME,
} from '../../../src/modules/identity-provisioning/enum/identity-provisioning.enum.js';
import { ScimClientAuthGuard } from '../../../src/modules/identity-provisioning/guards/scim-client-auth.guard.js';
import { ScimProtocolException } from '../../../src/modules/identity-provisioning/helpers/scim-error.helper.js';
import { hashScimToken } from '../../../src/modules/identity-provisioning/helpers/scim-security.helper.js';
import type { ScimClientRepository } from '../../../src/modules/identity-provisioning/repositories/scim-client.repository.js';
import type { ScimGroupMemberRepository } from '../../../src/modules/identity-provisioning/repositories/scim-group-member.repository.js';
import type { ScimGroupRepository } from '../../../src/modules/identity-provisioning/repositories/scim-group.repository.js';
import type { ScimReconciliationRunRepository } from '../../../src/modules/identity-provisioning/repositories/scim-reconciliation-run.repository.js';
import type { ScimSyncLogRepository } from '../../../src/modules/identity-provisioning/repositories/scim-sync-log.repository.js';
import type { ScimUserLinkRepository } from '../../../src/modules/identity-provisioning/repositories/scim-user-link.repository.js';
import { ScimClientsService } from '../../../src/modules/identity-provisioning/services/scim-clients.service.js';
import { ScimGroupRoleSyncService } from '../../../src/modules/identity-provisioning/services/scim-group-role-sync.service.js';
import { ScimGroupsService } from '../../../src/modules/identity-provisioning/services/scim-groups.service.js';
import { ScimReconciliationService } from '../../../src/modules/identity-provisioning/services/scim-reconciliation.service.js';
import { ScimSyncLogService } from '../../../src/modules/identity-provisioning/services/scim-sync-log.service.js';
import { ScimUsersService } from '../../../src/modules/identity-provisioning/services/scim-users.service.js';
import type { ScimRequestMeta } from '../../../src/modules/identity-provisioning/types/identity-provisioning.types.js';

function createMeta(method = 'POST', path = '/api/v1/scim/v2/Users'): ScimRequestMeta {
  return {
    ipAddress: '10.10.1.5',
    requestId: 'req-scim-1',
    correlationId: 'corr-scim-1',
    httpMethod: method,
    httpPath: path,
    baseUrl: 'http://localhost:3000/api/v1/scim/v2',
  };
}

function createHarness() {
  let nextClientId = 1;
  let nextUserId = 100;
  let nextLinkId = 1;
  let nextGroupId = 1;
  let nextMemberId = 1;
  let nextLogId = 1;
  let nextReconId = 1;

  const clients: ScimClientEntity[] = [];
  const links: ScimUserLinkEntity[] = [];
  const groups: ScimGroupEntity[] = [];
  const members: ScimGroupMemberEntity[] = [];
  const syncLogs: ScimSyncLogEntity[] = [];
  const reconRuns: ScimReconciliationRunEntity[] = [];

  const usersStore = new Map<number, ProvisionedUserView>();
  const userRolesStore = new Map<number, number[]>();
  const rolesCatalog: RoleSummary[] = [
    {
      id: 1,
      code: 'SUPER_ADMIN',
      name: 'Super Admin',
      isSystem: true,
      dataScope: 1,
      dataScopeName: 'ALL',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: [],
    },
    {
      id: 2,
      code: 'STAFF',
      name: 'Staff',
      isSystem: true,
      dataScope: 4,
      dataScopeName: 'SELF',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: [],
    },
    {
      id: 3,
      code: 'USER',
      name: 'User',
      isSystem: true,
      dataScope: 4,
      dataScopeName: 'SELF',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: [],
    },
    {
      id: 4,
      code: 'LOCAL_CUSTOM',
      name: 'Local Custom',
      isSystem: false,
      dataScope: 4,
      dataScopeName: 'SELF',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [],
      permissions: [],
    },
  ];

  const clientRepository = {
    create: (data: Partial<ScimClientEntity>) => Object.assign(new ScimClientEntity(), data),
    saveEntity: async (entity: ScimClientEntity) => {
      if (!entity.id) {
        entity.id = nextClientId++;
        entity.createdAt = new Date();
      }
      entity.updatedAt = new Date();
      const idx = clients.findIndex((c) => c.id === entity.id);
      if (idx >= 0) clients[idx] = entity;
      else clients.push(entity);
      return entity;
    },
    findById: async (id: number) => clients.find((c) => c.id === id && !c.deletedAt) ?? null,
    findByCode: async (code: string) =>
      clients.find((c) => c.code === code.trim().toLowerCase() && !c.deletedAt) ?? null,
    findByTokenHash: async (hash: string) =>
      clients.find((c) => c.tokenHash === hash && !c.deletedAt) ?? null,
    listAll: async () => clients.filter((c) => !c.deletedAt),
    updateLastUsed: async (id: number, ip: string | null) => {
      const found = clients.find((c) => c.id === id);
      if (found) {
        found.lastUsedAt = new Date();
        found.lastUsedIp = ip;
      }
    },
    softDeleteEntity: async (entity: ScimClientEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
  } as unknown as ScimClientRepository;

  const userLinkRepository = {
    create: (data: Partial<ScimUserLinkEntity>) => Object.assign(new ScimUserLinkEntity(), data),
    saveEntity: async (entity: ScimUserLinkEntity) => {
      if (!entity.id) {
        entity.id = nextLinkId++;
        entity.createdAt = new Date();
      }
      entity.updatedAt = new Date();
      const idx = links.findIndex((l) => l.id === entity.id);
      if (idx >= 0) links[idx] = entity;
      else links.push(entity);
      return entity;
    },
    findByClientAndExternalId: async (clientId: number, externalId: string) =>
      links.find((l) => l.clientId === clientId && l.externalId === externalId) ?? null,
    findByClientAndUserId: async (clientId: number, userId: number) =>
      links.find((l) => l.clientId === clientId && l.userId === userId) ?? null,
    findByClient: async (clientId: number) => links.filter((l) => l.clientId === clientId),
  } as unknown as ScimUserLinkRepository;

  const groupRepository = {
    create: (data: Partial<ScimGroupEntity>) => Object.assign(new ScimGroupEntity(), data),
    saveEntity: async (entity: ScimGroupEntity) => {
      if (!entity.id) {
        entity.id = nextGroupId++;
        entity.createdAt = new Date();
      }
      entity.updatedAt = new Date();
      const idx = groups.findIndex((g) => g.id === entity.id);
      if (idx >= 0) groups[idx] = entity;
      else groups.push(entity);
      return entity;
    },
    findByClientAndId: async (clientId: number, groupId: number) =>
      groups.find((g) => g.clientId === clientId && g.id === groupId && !g.deletedAt) ?? null,
    findByClientAndExternalId: async (clientId: number, externalId: string) =>
      groups.find((g) => g.clientId === clientId && g.externalId === externalId && !g.deletedAt) ??
      null,
    findByClientAndDisplayName: async (clientId: number, displayName: string) =>
      groups.find(
        (g) => g.clientId === clientId && g.displayName === displayName.trim() && !g.deletedAt,
      ) ?? null,
    findByClient: async (clientId: number) =>
      groups.filter((g) => g.clientId === clientId && !g.deletedAt),
    softDeleteEntity: async (entity: ScimGroupEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
  } as unknown as ScimGroupRepository;

  const groupMemberRepository = {
    findByGroupId: async (groupId: number) => members.filter((m) => m.scimGroupId === groupId),
    findByClientAndUserId: async (clientId: number, userId: number) =>
      members.filter((m) => m.clientId === clientId && m.userId === userId),
    findByClient: async (clientId: number) => members.filter((m) => m.clientId === clientId),
    replaceGroupMembers: async (clientId: number, groupId: number, userIds: readonly number[]) => {
      for (let i = members.length - 1; i >= 0; i--) {
        if (members[i]?.scimGroupId === groupId) members.splice(i, 1);
      }
      const unique = Array.from(new Set(userIds)).sort((a, b) => a - b);
      for (const uid of unique) {
        const entity = new ScimGroupMemberEntity();
        entity.id = nextMemberId++;
        entity.clientId = clientId;
        entity.scimGroupId = groupId;
        entity.userId = uid;
        members.push(entity);
      }
      return unique;
    },
    removeUserFromClientGroups: async (clientId: number, userId: number) => {
      const affected: number[] = [];
      for (let i = members.length - 1; i >= 0; i--) {
        const item = members[i];
        if (item && item.clientId === clientId && item.userId === userId) {
          affected.push(item.scimGroupId);
          members.splice(i, 1);
        }
      }
      return affected;
    },
    deleteByGroupId: async (groupId: number) => {
      for (let i = members.length - 1; i >= 0; i--) {
        if (members[i]?.scimGroupId === groupId) members.splice(i, 1);
      }
    },
  } as unknown as ScimGroupMemberRepository;

  const syncLogRepository = {
    create: (data: Partial<ScimSyncLogEntity>) => Object.assign(new ScimSyncLogEntity(), data),
    saveEntity: async (entity: ScimSyncLogEntity) => {
      entity.id = nextLogId++;
      entity.createdAt = new Date();
      syncLogs.push(entity);
      return entity;
    },
  } as unknown as ScimSyncLogRepository;

  const reconRunRepository = {
    create: (data: Partial<ScimReconciliationRunEntity>) =>
      Object.assign(new ScimReconciliationRunEntity(), data),
    saveEntity: async (entity: ScimReconciliationRunEntity) => {
      entity.id = nextReconId++;
      entity.createdAt = new Date();
      reconRuns.push(entity);
      return entity;
    },
    findById: async (id: number) => reconRuns.find((r) => r.id === id) ?? null,
  } as unknown as ScimReconciliationRunRepository;

  const usersPublicService: IUsersPublicService = {
    findAuthUserByIdentifier: async () => null,
    findAuthUserById: async () => null,
    registerSelfUser: async () => {
      throw new Error('unused');
    },
    markEmailVerified: async () => undefined,
    markPhoneVerified: async () => undefined,
    recordLoginSuccess: async () => undefined,
    recordLoginFailure: async () => ({ failedAttempts: 0, locked: false, lockedUntil: null }),
    autoUnlockExpiredLock: async () => undefined,
    updatePasswordHash: async () => undefined,
    setMfaEnabled: async () => undefined,
    getUserPreferences: async () => ({
      userId: 1,
      preferredLocale: 'vi',
      preferredTimezone: 'Asia/Ho_Chi_Minh',
      updatedAt: new Date().toISOString(),
    }),
    updateUserPreferences: async () => ({
      userId: 1,
      preferredLocale: 'vi',
      preferredTimezone: 'Asia/Ho_Chi_Minh',
      updatedAt: new Date().toISOString(),
    }),
    getProvisionedUserById: async (userId: number) => usersStore.get(userId) ?? null,
    findProvisionedUserByIdentifier: async (identifier: string) => {
      const needle = identifier.trim().toLowerCase();
      for (const user of usersStore.values()) {
        if (user.email.toLowerCase() === needle || user.username.toLowerCase() === needle) {
          return user;
        }
      }
      return null;
    },
    createProvisionedUser: async (input: CreateProvisionedUserInput) => {
      const id = nextUserId++;
      const now = new Date().toISOString();
      const user: ProvisionedUserView = {
        id,
        username: input.username,
        email: input.email,
        phone: input.phone ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        fullName: input.fullName ?? `${input.firstName} ${input.lastName}`.trim(),
        status: input.status ?? USER_STATUS.ACTIVE,
        statusName: input.status === USER_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
        roles: [],
        createdAt: now,
        updatedAt: now,
      };
      usersStore.set(id, user);
      return user;
    },
    updateProvisionedUser: async (userId: number, input: UpdateProvisionedUserInput) => {
      const existing = usersStore.get(userId);
      if (!existing) throw new Error('User not found');
      const updated: ProvisionedUserView = {
        ...existing,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(userId, updated);
      return updated;
    },
    lockProvisionedUser: async (userId: number, reason: string) => {
      const existing = usersStore.get(userId);
      if (!existing) throw new Error('User not found');
      const updated: ProvisionedUserView = {
        ...existing,
        status: USER_STATUS.LOCKED,
        statusName: 'LOCKED',
        lockReason: reason,
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(userId, updated);
      return updated;
    },
    unlockProvisionedUser: async (userId: number) => {
      const existing = usersStore.get(userId);
      if (!existing) throw new Error('User not found');
      const updated: ProvisionedUserView = {
        ...existing,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockReason: null,
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(userId, updated);
      return updated;
    },
    deactivateProvisionedUser: async (userId: number, reason?: string | null) => {
      const existing = usersStore.get(userId);
      if (!existing) throw new Error('User not found');
      const updated: ProvisionedUserView = {
        ...existing,
        status: USER_STATUS.INACTIVE,
        statusName: 'INACTIVE',
        lockReason: reason ?? null,
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(userId, updated);
      return updated;
    },
    activateProvisionedUser: async (userId: number) => {
      const existing = usersStore.get(userId);
      if (!existing) throw new Error('User not found');
      const updated: ProvisionedUserView = {
        ...existing,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockReason: null,
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(userId, updated);
      return updated;
    },
  };

  const rolesPublicService: IRolesPublicService = {
    findByIds: async (ids) => rolesCatalog.filter((r) => ids.includes(r.id)),
    findByCodes: async (codes) => {
      const set = new Set(codes.map((c) => c.toUpperCase()));
      return rolesCatalog.filter((r) => set.has(r.code.toUpperCase()));
    },
    resolvePermissionsByRoleIds: async () => [],
    ensureActiveRolesExist: async (ids) => rolesCatalog.filter((r) => ids.includes(r.id)),
    findUserRoleLinksByUserIds: async (userIds) => {
      const result: UserRoleLinkSummary[] = [];
      for (const uid of userIds) {
        for (const rid of userRolesStore.get(uid) ?? []) {
          result.push({ userId: uid, roleId: rid });
        }
      }
      return result;
    },
    replaceUserRoles: async (userId, roleIds) => {
      userRolesStore.set(userId, [...roleIds]);
      return roleIds.map((roleId) => ({ userId, roleId }));
    },
  };

  const revokeAllUserSessionsMock = jest.fn(async () => 3);
  const sessionsPublicService = {
    revokeAllUserSessions: revokeAllUserSessionsMock,
  } as unknown as ISessionsPublicService;

  const auditRecordMock = jest.fn(async () => undefined);
  const auditLogService = { record: auditRecordMock } as unknown as AuditLogService;

  const settingRegistry = new SettingRegistryService();
  const featureFlagRegistry = new FeatureFlagRegistryService();
  featureFlagRegistry.setInstalledModules(['identity-provisioning']);
  featureFlagRegistry.registerManifestFlags([
    {
      key: SCIM_FEATURE_FLAGS.SCIM_V2,
      module: 'identity-provisioning',
      name: 'SCIM 2.0',
      description: 'SCIM 2.0 test flag',
      isEnabled: true,
      rolloutPercentage: 100,
    },
  ]);

  const syncLogService = new ScimSyncLogService(syncLogRepository);
  const clientsService = new ScimClientsService(clientRepository, auditLogService, settingRegistry);
  const roleSyncService = new ScimGroupRoleSyncService(
    groupRepository,
    groupMemberRepository,
    rolesPublicService,
    auditLogService,
  );
  const scimUsersService = new ScimUsersService(
    userLinkRepository,
    groupRepository,
    groupMemberRepository,
    roleSyncService,
    syncLogService,
    usersPublicService,
    sessionsPublicService,
    auditLogService,
    settingRegistry,
  );
  const scimGroupsService = new ScimGroupsService(
    groupRepository,
    groupMemberRepository,
    roleSyncService,
    syncLogService,
    usersPublicService,
    auditLogService,
    settingRegistry,
  );
  const reconciliationService = new ScimReconciliationService(
    clientsService,
    userLinkRepository,
    groupRepository,
    groupMemberRepository,
    reconRunRepository,
    scimUsersService,
    scimGroupsService,
    usersPublicService,
    auditLogService,
  );
  const authGuard = new ScimClientAuthGuard(
    clientRepository,
    syncLogService,
    undefined,
    featureFlagRegistry,
  );

  return {
    clients,
    links,
    groups,
    syncLogs,
    reconRuns,
    usersStore,
    userRolesStore,
    featureFlagRegistry,
    authGuard,
    clientsService,
    scimUsersService,
    scimGroupsService,
    reconciliationService,
    revokeAllUserSessionsMock,
    auditRecordMock,
  };
}

function makeExecutionContext(
  headers: Record<string, string>,
  ip = '10.10.1.5',
): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = {
    headers,
    ip,
    method: 'GET',
    url: '/api/v1/scim/v2/Users',
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('SCIM 2.0 Provisioning End-to-End Flows', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    h = createHarness();
  });

  it('authenticates SCIM client via dedicated token + IP allowlist and rejects invalid token/IP/flag', async () => {
    const created = await h.clientsService.createClient({
      code: 'okta-corp',
      name: 'Okta Corp',
      allowedIps: ['10.10.1.0/24'],
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      deprovisionMode: SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
      allowedRoleCodes: ['STAFF', 'USER'],
      groupRoleMappings: { Engineering: ['STAFF', 'SUPER_ADMIN'] },
      deniedRoleCodes: [],
      defaultRoleCodes: [],
      requireIfMatch: false,
      status: SCIM_CLIENT_STATUS.ACTIVE,
    });

    expect(created.plainToken.startsWith('scim_')).toBe(true);
    expect(h.clients[0]?.tokenHash).toBe(hashScimToken(created.plainToken));

    // Valid token + allowed IP
    const ok = makeExecutionContext(
      { authorization: `Bearer ${created.plainToken}` },
      '::ffff:10.10.1.25',
    );
    await expect(h.authGuard.canActivate(ok.ctx)).resolves.toBe(true);
    expect((ok.req['scimClient'] as ScimClientEntity).code).toBe('okta-corp');

    // Disallowed IP -> 403 + sync log recorded
    const badIp = makeExecutionContext(
      { authorization: `Bearer ${created.plainToken}` },
      '203.0.113.9',
    );
    await expect(h.authGuard.canActivate(badIp.ctx)).rejects.toThrow(ScimProtocolException);
    expect(h.syncLogs[h.syncLogs.length - 1]?.errorCode).toBe('SCIM_IP_NOT_ALLOWED');

    // Invalid token -> 401 + sync log recorded
    const badTok = makeExecutionContext({ authorization: 'Bearer scim_wrong' }, '10.10.1.25');
    await expect(h.authGuard.canActivate(badTok.ctx)).rejects.toThrow(ScimProtocolException);
    expect(h.syncLogs[h.syncLogs.length - 1]?.errorCode).toBe('SCIM_INVALID_TOKEN');

    // Feature flag disabled -> 403
    const existingFlag = h.featureFlagRegistry.getDefinition(SCIM_FEATURE_FLAGS.SCIM_V2);
    if (existingFlag) {
      h.featureFlagRegistry.upsertDefinition({ ...existingFlag, isEnabled: false });
    }
    await expect(h.authGuard.canActivate(ok.ctx)).rejects.toThrow(ScimProtocolException);
    expect(h.syncLogs[h.syncLogs.length - 1]?.errorCode).toBe('SCIM_FEATURE_DISABLED');
  });

  it('provisions user, enforces External ID idempotency & ETag If-Match, and locks + revokes sessions on deprovision', async () => {
    const { client } = await h.clientsService.createClient({
      code: 'entra-id',
      name: 'Microsoft Entra ID',
      allowedIps: [],
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      deprovisionMode: SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
      allowedRoleCodes: ['STAFF'],
      deniedRoleCodes: [],
      defaultRoleCodes: [],
      groupRoleMappings: {},
      requireIfMatch: false,
      status: SCIM_CLIENT_STATUS.ACTIVE,
    });
    const clientEntity = await h.clientsService.getClientEntityOrThrow(client.id);

    const payload = {
      schemas: [SCIM_SCHEMAS.USER],
      externalId: 'entra-user-001',
      userName: 'alice.scim@acme.test',
      active: true,
      name: { givenName: 'Alice', familyName: 'Nguyen', formatted: 'Alice Nguyen' },
      emails: [{ value: 'alice.scim@acme.test', type: 'work', primary: true }],
    };

    const first = await h.scimUsersService.createUser(clientEntity, payload, createMeta());
    expect(first.created).toBe(true);
    expect(first.idempotencyHit).toBe(false);
    expect(first.resource.meta.version).toBe('W/"1"');
    const userId = Number(first.resource.id);

    // Duplicate exact POST -> NOOP_DUPLICATE (idempotent, no second user)
    const dup = await h.scimUsersService.createUser(clientEntity, payload, createMeta());
    expect(dup.created).toBe(false);
    expect(dup.idempotencyHit).toBe(true);
    expect(dup.resource.id).toBe(first.resource.id);
    expect(h.usersStore.size).toBe(1);
    expect(h.syncLogs[h.syncLogs.length - 1]?.outcome).toBe(SCIM_SYNC_OUTCOME.NOOP_DUPLICATE);

    // Same externalId with different payload -> 409 uniqueness
    await expect(
      h.scimUsersService.createUser(
        clientEntity,
        { ...payload, displayName: 'Alice Changed' },
        createMeta(),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, scimType: 'uniqueness' });

    // Stale If-Match -> 412 Precondition Failed
    await expect(
      h.scimUsersService.patchUser(
        clientEntity,
        String(userId),
        {
          schemas: [SCIM_SCHEMAS.PATCH_OP],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Alice v2' }],
        },
        'W/"99"',
        createMeta('PATCH'),
      ),
    ).rejects.toMatchObject({ httpStatus: 412, scimType: 'invalidVers' });

    // Matching If-Match -> updates & bumps version to W/"2"
    const updated = await h.scimUsersService.patchUser(
      clientEntity,
      String(userId),
      {
        schemas: [SCIM_SCHEMAS.PATCH_OP],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Alice v2' }],
      },
      'W/"1"',
      createMeta('PATCH'),
    );
    expect(updated.resource.displayName).toBe('Alice v2');
    expect(updated.resource.meta.version).toBe('W/"2"');

    // Deprovision via PATCH active=false -> locks user and revokes all sessions
    const deprov = await h.scimUsersService.patchUser(
      clientEntity,
      String(userId),
      {
        schemas: [SCIM_SCHEMAS.PATCH_OP],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
      'W/"2"',
      createMeta('PATCH'),
    );
    expect(deprov.resource.active).toBe(false);
    expect(h.usersStore.get(userId)?.status).toBe(USER_STATUS.LOCKED);
    expect(h.revokeAllUserSessionsMock).toHaveBeenCalledWith(
      userId,
      'SCIM_USER_DEACTIVATED',
      undefined,
      expect.anything(),
    );

    // Reactivate via PATCH active=true -> unlocks user
    const reactivated = await h.scimUsersService.patchUser(
      clientEntity,
      String(userId),
      {
        schemas: [SCIM_SCHEMAS.PATCH_OP],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      },
      'W/"3"',
      createMeta('PATCH'),
    );
    expect(reactivated.resource.active).toBe(true);
    expect(h.usersStore.get(userId)?.status).toBe(USER_STATUS.ACTIVE);

    // DELETE User -> locks account, revokes sessions, marks link inactive
    await h.scimUsersService.deleteUser(
      clientEntity,
      String(userId),
      'W/"4"',
      createMeta('DELETE'),
    );
    expect(h.usersStore.get(userId)?.status).toBe(USER_STATUS.LOCKED);
    expect(h.links[0]?.active).toBe(false);
  });

  it('syncs SCIM Groups and members to allowlisted Roles while blocking SUPER_ADMIN and preserving unmanaged roles', async () => {
    const { client } = await h.clientsService.createClient({
      code: 'okta-roles',
      name: 'Okta Role Sync',
      allowedIps: [],
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      deprovisionMode: SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
      allowedRoleCodes: ['STAFF'],
      deniedRoleCodes: [],
      defaultRoleCodes: [],
      groupRoleMappings: {
        Engineering: ['STAFF', 'SUPER_ADMIN'],
      },
      requireIfMatch: false,
      status: SCIM_CLIENT_STATUS.ACTIVE,
    });
    const clientEntity = await h.clientsService.getClientEntityOrThrow(client.id);

    const u1 = await h.scimUsersService.createUser(
      clientEntity,
      {
        externalId: 'u-1',
        userName: 'eng1@acme.test',
        emails: [{ value: 'eng1@acme.test', primary: true }],
        name: { givenName: 'Eng', familyName: 'One' },
      },
      createMeta(),
    );
    const userId = Number(u1.resource.id);
    // Assign unmanaged local role #4 (LOCAL_CUSTOM) before SCIM group sync
    h.userRolesStore.set(userId, [4]);

    const grp = await h.scimGroupsService.createGroup(
      clientEntity,
      {
        schemas: [SCIM_SCHEMAS.GROUP],
        externalId: 'grp-eng',
        displayName: 'Engineering',
        members: [{ value: String(userId) }],
      },
      createMeta('POST', '/api/v1/scim/v2/Groups'),
    );
    expect(grp.created).toBe(true);
    // Role #2 (STAFF) applied, Role #1 (SUPER_ADMIN) blocked, Role #4 (LOCAL_CUSTOM) preserved
    expect(h.userRolesStore.get(userId)?.sort((a, b) => a - b)).toEqual([2, 4]);

    // Remove member via RFC 7644 selector PATCH
    const patched = await h.scimGroupsService.patchGroup(
      clientEntity,
      grp.resource.id,
      {
        schemas: [SCIM_SCHEMAS.PATCH_OP],
        Operations: [{ op: 'remove', path: `members[value eq "${userId}"]` }],
      },
      'W/"1"',
      createMeta('PATCH', `/api/v1/scim/v2/Groups/${grp.resource.id}`),
    );
    expect(patched.resource.members).toHaveLength(0);
    // STAFF removed, LOCAL_CUSTOM still preserved
    expect(h.userRolesStore.get(userId)).toEqual([4]);
  });

  it('reconciles local directory against IdP snapshot in DRY_RUN and APPLY modes', async () => {
    const { client } = await h.clientsService.createClient({
      code: 'recon-idp',
      name: 'Recon IdP',
      allowedIps: [],
      scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
      deprovisionMode: SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
      allowedRoleCodes: ['STAFF'],
      deniedRoleCodes: [],
      defaultRoleCodes: [],
      groupRoleMappings: { Engineering: ['STAFF'] },
      requireIfMatch: false,
      status: SCIM_CLIENT_STATUS.ACTIVE,
    });
    const clientEntity = await h.clientsService.getClientEntityOrThrow(client.id);

    // Local has user A (orphan) and user B (will have email drift)
    const userA = await h.scimUsersService.createUser(
      clientEntity,
      {
        externalId: 'ext-orphan',
        userName: 'orphan@acme.test',
        emails: [{ value: 'orphan@acme.test', primary: true }],
        name: { givenName: 'Orphan', familyName: 'User' },
      },
      createMeta(),
    );
    const userB = await h.scimUsersService.createUser(
      clientEntity,
      {
        externalId: 'ext-keep',
        userName: 'keep@acme.test',
        emails: [{ value: 'old@acme.test', primary: true }],
        name: { givenName: 'Keep', familyName: 'User' },
      },
      createMeta(),
    );

    const snapshot = {
      idpUsers: [
        {
          externalId: 'ext-keep',
          userName: 'keep@acme.test',
          email: 'new@acme.test',
          firstName: 'Keep',
          lastName: 'User',
          fullName: 'Keep User',
          active: true,
        },
        {
          externalId: 'ext-new',
          userName: 'newcomer@acme.test',
          email: 'newcomer@acme.test',
          firstName: 'New',
          lastName: 'Comer',
          fullName: 'New Comer',
          active: true,
        },
      ],
      idpGroups: [
        {
          externalId: 'grp-new',
          displayName: 'Engineering',
          memberExternalIds: ['ext-new'],
        },
      ],
    };

    const dryRun = await h.reconciliationService.reconcileWithIdp(client.id, {
      mode: SCIM_RECONCILIATION_MODE.DRY_RUN,
      applyDeprovisionOrphans: true,
      applySyncMissingAndDrifts: true,
      ...snapshot,
    });

    expect(dryRun.discrepanciesCount).toBe(4);
    expect(dryRun.appliedActionsCount).toBe(0);
    expect(dryRun.discrepancies.map((d) => d.type)).toEqual(
      expect.arrayContaining([
        SCIM_RECONCILIATION_DISCREPANCY_TYPE.MISSING_IN_LOCAL,
        SCIM_RECONCILIATION_DISCREPANCY_TYPE.ATTRIBUTE_DRIFT,
        SCIM_RECONCILIATION_DISCREPANCY_TYPE.ORPHAN_IN_LOCAL,
        SCIM_RECONCILIATION_DISCREPANCY_TYPE.GROUP_MISSING_IN_LOCAL,
      ]),
    );
    // Dry run did not mutate local user A
    expect(h.usersStore.get(Number(userA.resource.id))?.status).toBe(USER_STATUS.ACTIVE);

    // Apply mode resolves all 4 discrepancies
    const applied = await h.reconciliationService.reconcileWithIdp(client.id, {
      mode: SCIM_RECONCILIATION_MODE.APPLY,
      applyDeprovisionOrphans: true,
      applySyncMissingAndDrifts: true,
      ...snapshot,
    });

    expect(applied.appliedActionsCount).toBe(4);
    expect(h.usersStore.get(Number(userA.resource.id))?.status).toBe(USER_STATUS.LOCKED);
    expect(h.usersStore.get(Number(userB.resource.id))?.email).toBe('new@acme.test');
    expect(h.groups.some((g) => g.displayName === 'Engineering')).toBe(true);
  });
});
