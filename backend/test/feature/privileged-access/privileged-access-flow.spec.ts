import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  IPermissionsPublicService,
  PermissionItemSummary,
} from '../../../src/modules/permissions/contracts/index.js';
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
} from '../../../src/modules/users/contracts/index.js';
import { PrivilegedAccessGrantEntity } from '../../../src/modules/privileged-access/entities/privileged-access-grant.entity.js';
import { PrivilegedAccessReviewItemEntity } from '../../../src/modules/privileged-access/entities/privileged-access-review-item.entity.js';
import { PrivilegedAccessReviewEntity } from '../../../src/modules/privileged-access/entities/privileged-access-review.entity.js';
import { PrivilegedAccessTargetEntity } from '../../../src/modules/privileged-access/entities/privileged-access-target.entity.js';
import { PrivilegedBreakGlassAccountEntity } from '../../../src/modules/privileged-access/entities/privileged-break-glass-account.entity.js';
import { PrivilegedUsageAlertEntity } from '../../../src/modules/privileged-access/entities/privileged-usage-alert.entity.js';
import {
  ACCESS_REVIEW_DECISION,
  ACCESS_REVIEW_STATUS,
  BREAK_GLASS_STATUS,
  PRIVILEGED_GRANT_STATUS,
  PRIVILEGED_REVIEW_SOURCE,
  PRIVILEGED_TARGET_TYPE,
} from '../../../src/modules/privileged-access/enum/privileged-access.enum.js';
import { PrivilegedAccessService } from '../../../src/modules/privileged-access/services/privileged-access.service.js';
import { PrivilegedAlertsService } from '../../../src/modules/privileged-access/services/privileged-alerts.service.js';
import { PrivilegedBreakGlassService } from '../../../src/modules/privileged-access/services/privileged-break-glass.service.js';
import { PrivilegedGrantsService } from '../../../src/modules/privileged-access/services/privileged-grants.service.js';
import { PrivilegedReviewsService } from '../../../src/modules/privileged-access/services/privileged-reviews.service.js';
import { PrivilegedTargetsService } from '../../../src/modules/privileged-access/services/privileged-targets.service.js';

function createPamTestHarness() {
  let nextId = 100;
  const targets: PrivilegedAccessTargetEntity[] = [];
  const grants: PrivilegedAccessGrantEntity[] = [];
  const breakGlasses: PrivilegedBreakGlassAccountEntity[] = [];
  const alerts: PrivilegedUsageAlertEntity[] = [];
  const reviews: PrivilegedAccessReviewEntity[] = [];
  const reviewItems: PrivilegedAccessReviewItemEntity[] = [];

  const rolesCatalog: RoleSummary[] = [
    {
      id: 1,
      code: 'super_admin',
      name: 'Super Admin',
      isSystem: true,
      dataScope: 1,
      dataScopeName: 'ALL',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [1],
      permissions: ['*'],
    },
    {
      id: 3,
      code: 'admin_security',
      name: 'Security Admin',
      isSystem: true,
      dataScope: 1,
      dataScopeName: 'ALL',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [2],
      permissions: [
        'privileged-access.read',
        'privileged-access.manage',
        'privileged-access.approve',
      ],
    },
    {
      id: 6,
      code: 'admin_ops',
      name: 'Ops Admin',
      isSystem: true,
      dataScope: 1,
      dataScopeName: 'ALL',
      status: 1,
      statusName: 'ACTIVE',
      permissionIds: [3],
      permissions: ['users.read'],
    },
  ];

  const permsCatalog: PermissionItemSummary[] = [
    {
      id: 1,
      code: 'privileged-access.manage',
      name: 'PAM Manage',
      module: 'privileged-access',
      status: 1,
    },
    {
      id: 2,
      code: 'privileged-access.break_glass.manage',
      name: 'Break-glass Manage',
      module: 'privileged-access',
      status: 1,
    },
  ];

  // Seed existing special admin users simulating records already in `users` table
  const usersStore = new Map<number, ProvisionedUserView>([
    [
      1,
      {
        id: 1,
        username: 'superadmin',
        email: 'superadmin@gmail.com',
        phone: null,
        firstName: 'Sơn',
        lastName: 'Nguyễn',
        fullName: 'Nguyễn Thái Sơn',
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
        roles: [{ roleId: 1, code: 'super_admin', name: 'Super Admin' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    [
      3,
      {
        id: 3,
        username: 'admin_security',
        email: 'admin.security@gmail.com',
        phone: null,
        firstName: 'Nam',
        lastName: 'Lê',
        fullName: 'Lê Hoàng Nam',
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
        roles: [{ roleId: 3, code: 'admin_security', name: 'Security Admin' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    [
      99,
      {
        id: 99,
        username: 'custom_special_admin',
        email: 'custom.admin@company.local',
        phone: null,
        firstName: 'Custom',
        lastName: 'Admin',
        fullName: 'Custom Special Admin',
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
        roles: [{ roleId: 1, code: 'super_admin', name: 'Super Admin' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  ]);

  const userRolesMap = new Map<number, number[]>([
    [1, [1]],
    [3, [3]],
    [99, [1]],
    [50, [6]],
  ]);
  usersStore.set(50, {
    id: 50,
    username: 'ops_engineer',
    email: 'ops.eng@company.local',
    phone: null,
    firstName: 'Ops',
    lastName: 'Engineer',
    fullName: 'Ops Engineer',
    status: USER_STATUS.ACTIVE,
    statusName: 'ACTIVE',
    lockedUntil: null,
    lockReason: null,
    roles: [{ roleId: 6, code: 'admin_ops', name: 'Ops Admin' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const revokedSessionsForUsers: Array<{ userId: number; reason: string }> = [];
  const dispatchedNotifications: Array<Record<string, unknown>> = [];
  const ingestedIncidents: Array<Record<string, unknown>> = [];

  const syncUserRolesView = (userId: number) => {
    const u = usersStore.get(userId);
    if (!u) return;
    const roleIds = userRolesMap.get(userId) ?? [];
    const mapped = rolesCatalog
      .filter((r) => roleIds.includes(r.id))
      .map((r) => ({ roleId: r.id, code: r.code, name: r.name }));
    usersStore.set(userId, { ...u, roles: mapped });
  };

  const rolesService: IRolesPublicService = {
    findByIds: async (ids) => rolesCatalog.filter((r) => ids.includes(r.id)),
    findByCodes: async (codes) => rolesCatalog.filter((r) => codes.includes(r.code)),
    resolvePermissionsByRoleIds: async (ids) => [
      ...new Set(rolesCatalog.filter((r) => ids.includes(r.id)).flatMap((r) => r.permissions)),
    ],
    ensureActiveRolesExist: async (ids) => rolesCatalog.filter((r) => ids.includes(r.id)),
    findUserRoleLinksByUserIds: async (userIds) => {
      const links: UserRoleLinkSummary[] = [];
      for (const uid of userIds) {
        for (const rid of userRolesMap.get(uid) ?? []) {
          links.push({ userId: uid, roleId: rid });
        }
      }
      return links;
    },
    findUserIdsByRoleIds: async (roleIds) => {
      const result: number[] = [];
      for (const [uid, rids] of userRolesMap.entries()) {
        if (rids.some((r) => roleIds.includes(r))) result.push(uid);
      }
      return result;
    },
    replaceUserRoles: async (userId, roleIds) => {
      userRolesMap.set(userId, [...roleIds]);
      syncUserRolesView(userId);
      return roleIds.map((roleId) => ({ userId, roleId }));
    },
  };

  const permissionsService = {
    findByCodes: async (codes: readonly string[]) =>
      permsCatalog.filter((p) => codes.includes(p.code)),
  } as unknown as IPermissionsPublicService;

  const usersService: IUsersPublicService = {
    findAuthUserByIdentifier: async () => null,
    findAuthUserById: async (userId) => {
      const u = usersStore.get(userId);
      if (!u) return null;
      return {
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        fullName: u.fullName,
        phone: null,
        status: u.status,
        statusName: u.statusName,
        lockedUntil: null,
        mfaEnabled: true,
        primaryOrganizationUnitId: 1,
        organizationUnitIds: [1],
        roles: u.roles.map((r) => r.code),
        permissions: [],
      };
    },
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
    getUserPreferences: async () => {
      throw new Error('unused');
    },
    updateUserPreferences: async () => {
      throw new Error('unused');
    },
    getProvisionedUserById: async (uid) => usersStore.get(uid) ?? null,
    findProvisionedUserByIdentifier: async (ident) => {
      for (const u of usersStore.values()) {
        if (u.username === ident || u.email === ident) return u;
      }
      return null;
    },
    listProvisionedUsers: async (q) => {
      const items = [...usersStore.values()].filter((u) => {
        if (!q.q) return true;
        const term = q.q.toLowerCase();
        return u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
      });
      return { items, total: items.length };
    },
    createProvisionedUser: async (input: CreateProvisionedUserInput) => {
      const id = ++nextId;
      const created: ProvisionedUserView = {
        id,
        username: input.username,
        email: input.email,
        phone: null,
        firstName: input.firstName,
        lastName: input.lastName,
        fullName: input.fullName ?? `${input.firstName} ${input.lastName}`,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        lockReason: null,
        roles: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      usersStore.set(id, created);
      userRolesMap.set(id, []);
      return created;
    },
    lockProvisionedUser: async (uid, reason) => {
      const u = usersStore.get(uid)!;
      const locked = {
        ...u,
        status: USER_STATUS.LOCKED,
        statusName: 'LOCKED' as const,
        lockReason: reason,
      };
      usersStore.set(uid, locked);
      return locked;
    },
    unlockProvisionedUser: async (uid) => {
      const u = usersStore.get(uid)!;
      const active = {
        ...u,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE' as const,
        lockReason: null,
      };
      usersStore.set(uid, active);
      return active;
    },
  };

  const sessionsService = {
    revokeAllUserSessions: async (userId: number, reason = '') => {
      revokedSessionsForUsers.push({ userId, reason });
      return 1;
    },
  } as unknown as ISessionsPublicService;

  const targetRepo = {
    create: (d: Partial<PrivilegedAccessTargetEntity>) =>
      Object.assign(new PrivilegedAccessTargetEntity(), d),
    saveEntity: async (e: PrivilegedAccessTargetEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        targets.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    softDeleteEntity: async (e: PrivilegedAccessTargetEntity) => {
      e.deletedAt = new Date();
      return e;
    },
    findById: async (id: number) => targets.find((t) => t.id === id && !t.deletedAt) ?? null,
    findByTypeAndCode: async (tt: string, tc: string) =>
      targets.find((t) => t.targetType === tt && t.targetCode === tc && !t.deletedAt) ?? null,
    findAllEnabled: async () => targets.filter((t) => t.isEnabled && !t.deletedAt),
    findAll: async () => targets.filter((t) => !t.deletedAt),
    paginateFiltered: async () =>
      createPaginatedResult(
        targets.filter((t) => !t.deletedAt),
        targets.length,
        1,
        50,
      ),
  };

  const grantRepo = {
    create: (d: Partial<PrivilegedAccessGrantEntity>) =>
      Object.assign(new PrivilegedAccessGrantEntity(), d),
    saveEntity: async (e: PrivilegedAccessGrantEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        grants.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    findById: async (id: number) => grants.find((g) => g.id === id) ?? null,
    findActiveForUser: async (userId: number, now = new Date()) =>
      grants.filter(
        (g) =>
          g.userId === userId &&
          g.status === PRIVILEGED_GRANT_STATUS.ACTIVE &&
          (!g.startsAt || g.startsAt <= now) &&
          g.expiresAt !== null &&
          g.expiresAt > now,
      ),
    findAllActive: async (now = new Date()) =>
      grants.filter(
        (g) =>
          g.status === PRIVILEGED_GRANT_STATUS.ACTIVE && g.expiresAt !== null && g.expiresAt > now,
      ),
    findExpiredActive: async (now = new Date()) =>
      grants.filter(
        (g) =>
          g.status === PRIVILEGED_GRANT_STATUS.ACTIVE && g.expiresAt !== null && g.expiresAt <= now,
      ),
    countByStatus: async (status: number) => grants.filter((g) => g.status === status).length,
    paginateFiltered: async () => createPaginatedResult(grants, grants.length, 1, 20),
  };

  const breakGlassRepo = {
    create: (d: Partial<PrivilegedBreakGlassAccountEntity>) =>
      Object.assign(new PrivilegedBreakGlassAccountEntity(), d),
    saveEntity: async (e: PrivilegedBreakGlassAccountEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        breakGlasses.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    findById: async (id: number) => breakGlasses.find((b) => b.id === id) ?? null,
    findByCode: async (code: string) => breakGlasses.find((b) => b.code === code) ?? null,
    findByUserId: async (uid: number) => breakGlasses.find((b) => b.userId === uid) ?? null,
    findAll: async () => [...breakGlasses],
    findExpiredActive: async (now = new Date()) =>
      breakGlasses.filter(
        (b) => b.status === BREAK_GLASS_STATUS.ACTIVE && b.expiresAt !== null && b.expiresAt <= now,
      ),
    paginateFiltered: async () => createPaginatedResult(breakGlasses, breakGlasses.length, 1, 50),
  };

  const alertRepo = {
    create: (d: Partial<PrivilegedUsageAlertEntity>) =>
      Object.assign(new PrivilegedUsageAlertEntity(), d),
    saveEntity: async (e: PrivilegedUsageAlertEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        alerts.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    findById: async (id: number) => alerts.find((a) => a.id === id) ?? null,
    countUnacknowledged: async () => alerts.filter((a) => !a.acknowledgedAt).length,
    paginateFiltered: async () => createPaginatedResult(alerts, alerts.length, 1, 20),
  };

  const reviewRepo = {
    create: (d: Partial<PrivilegedAccessReviewEntity>) =>
      Object.assign(new PrivilegedAccessReviewEntity(), d),
    saveEntity: async (e: PrivilegedAccessReviewEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        reviews.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    findById: async (id: number) => reviews.find((r) => r.id === id) ?? null,
    countOpen: async () => reviews.filter((r) => r.status === ACCESS_REVIEW_STATUS.OPEN).length,
    findLatest: async () => reviews[reviews.length - 1] ?? null,
    paginateFiltered: async () => createPaginatedResult(reviews, reviews.length, 1, 20),
  };

  const reviewItemRepo = {
    create: (d: Partial<PrivilegedAccessReviewItemEntity>) =>
      Object.assign(new PrivilegedAccessReviewItemEntity(), d),
    saveEntity: async (e: PrivilegedAccessReviewItemEntity) => {
      if (!e.id) {
        e.id = ++nextId;
        e.createdAt = new Date();
        reviewItems.push(e);
      }
      e.updatedAt = new Date();
      return e;
    },
    saveMany: async (items: PrivilegedAccessReviewItemEntity[]) => {
      for (const item of items) {
        item.id = ++nextId;
        item.createdAt = new Date();
        item.updatedAt = new Date();
        reviewItems.push(item);
      }
      return items;
    },
    findByReviewId: async (reviewId: number) => reviewItems.filter((i) => i.reviewId === reviewId),
    findByIdAndReviewId: async (itemId: number, reviewId: number) =>
      reviewItems.find((i) => i.id === itemId && i.reviewId === reviewId) ?? null,
  };

  const settingRegistry = new SettingRegistryService();
  const featureFlagRegistry = new FeatureFlagRegistryService();
  featureFlagRegistry.setInstalledModules(['privileged-access', 'users', 'roles', 'auth']);
  const domainEventBus = new DomainEventBusService();

  const alertsService = new PrivilegedAlertsService(
    alertRepo as never,
    {
      dispatch: async (input: Record<string, unknown>) => {
        dispatchedNotifications.push(input);
        return { id: dispatchedNotifications.length };
      },
    } as never,
    {
      ingestAlert: async (input: Record<string, unknown>) => {
        ingestedIncidents.push(input);
        return { incident: { id: ingestedIncidents.length }, deduplicated: false };
      },
    } as never,
    undefined,
    settingRegistry,
    featureFlagRegistry,
  );

  const targetsService = new PrivilegedTargetsService(
    targetRepo as never,
    breakGlassRepo as never,
    rolesService,
    permissionsService,
    usersService,
    undefined,
    domainEventBus,
  );

  const grantsService = new PrivilegedGrantsService(
    grantRepo as never,
    targetsService,
    alertsService,
    usersService,
    rolesService,
    sessionsService,
    undefined,
    domainEventBus,
    settingRegistry,
    featureFlagRegistry,
  );

  const breakGlassService = new PrivilegedBreakGlassService(
    breakGlassRepo as never,
    alertsService,
    usersService,
    rolesService,
    sessionsService,
    undefined,
    domainEventBus,
    settingRegistry,
    featureFlagRegistry,
  );

  const reviewsService = new PrivilegedReviewsService(
    reviewRepo as never,
    reviewItemRepo as never,
    grantRepo as never,
    breakGlassRepo as never,
    targetsService,
    grantsService,
    breakGlassService,
    alertsService,
    usersService,
    rolesService,
    sessionsService,
    undefined,
    domainEventBus,
    settingRegistry,
    featureFlagRegistry,
  );

  const pamService = new PrivilegedAccessService(
    targetsService,
    grantsService,
    breakGlassService,
    alertsService,
    reviewsService,
    targetRepo as never,
    grantRepo as never,
    breakGlassRepo as never,
    reviewRepo as never,
    settingRegistry,
    featureFlagRegistry,
  );

  return {
    pamService,
    targetsService,
    grantsService,
    breakGlassService,
    alertsService,
    reviewsService,
    usersStore,
    userRolesMap,
    grants,
    breakGlasses,
    alerts,
    dispatchedNotifications,
    ingestedIncidents,
    revokedSessionsForUsers,
  };
}

describe('Privileged Access Management (Section 14.4) End-to-End Flows', () => {
  const superAdminActor: UserIdentity = {
    id: 1,
    username: 'superadmin',
    roles: ['super_admin'],
    permissions: ['*'],
  };
  const securityAdminActor: UserIdentity = {
    id: 3,
    username: 'admin_security',
    roles: ['admin_security'],
    permissions: [
      'privileged-access.read',
      'privileged-access.manage',
      'privileged-access.approve',
    ],
  };
  const opsEngineerActor: UserIdentity = {
    id: 50,
    username: 'ops_engineer',
    roles: ['admin_ops'],
    permissions: ['privileged-access.request'],
  };

  let h: ReturnType<typeof createPamTestHarness>;

  beforeEach(async () => {
    h = createPamTestHarness();
    await h.pamService.upsertTarget(
      {
        targetType: PRIVILEGED_TARGET_TYPE.ROLE,
        targetCode: 'super_admin',
        displayName: 'Super Admin',
        sensitivityLevel: 'CRITICAL',
        requireMfaStepUp: true,
        requireApproval: true,
        autoApproveAllowed: false,
        maxGrantMinutes: 120,
        alertOnUse: true,
        reviewIntervalDays: 30,
        isEnabled: true,
      },
      superAdminActor,
    );
    await h.pamService.upsertTarget(
      {
        targetType: PRIVILEGED_TARGET_TYPE.ROLE,
        targetCode: 'admin_security',
        displayName: 'Security Admin',
        sensitivityLevel: 'CRITICAL',
        requireMfaStepUp: true,
        requireApproval: true,
        autoApproveAllowed: false,
        maxGrantMinutes: 180,
        alertOnUse: true,
        reviewIntervalDays: 60,
        isEnabled: true,
      },
      superAdminActor,
    );
  });

  it('discovers existing special admin users from users table and links directory', async () => {
    const standing = await h.pamService.listStandingPrivilegedUsers();
    expect(standing.map((u) => u.username)).toEqual([
      'superadmin',
      'admin_security',
      'custom_special_admin',
    ]);

    const dir = await h.pamService.listExistingUsersDirectory({ privilegedOnly: true });
    expect(dir.meta.total).toBe(3);
    expect(dir.data[2]?.privilegedRoleCodes).toContain('super_admin');
  });

  it('handles JIT temporary grant request, blocks self-approval, approves, resolves, and auto-expires', async () => {
    const requested = await h.pamService.requestGrant(
      {
        userId: 50,
        targetType: PRIVILEGED_TARGET_TYPE.ROLE,
        targetCode: 'admin_security',
        reason: 'Investigate production security incident #42',
        durationMinutes: 60,
        ticketRef: 'SEC-42',
      },
      opsEngineerActor,
    );
    expect(requested.status).toBe(PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL);

    // Self-approval must be forbidden
    await expect(
      h.pamService.approveGrant(requested.id, { comment: 'Self approve' }, opsEngineerActor),
    ).rejects.toThrow(ForbiddenAppException);

    // Security admin approves
    const approved = await h.pamService.approveGrant(
      requested.id,
      { comment: 'Approved for 60m' },
      securityAdminActor,
    );
    expect(approved.status).toBe(PRIVILEGED_GRANT_STATUS.ACTIVE);
    expect(approved.expiresAt).not.toBeNull();

    // Immediately active in runtime grant resolver
    const activeResolved = await h.grantsService.resolveActiveGrantsForUser(50);
    expect(activeResolved.roleCodes).toContain('admin_security');

    // Simulate expiration past expiresAt
    const future = new Date(new Date(approved.expiresAt!).getTime() + 60_000);
    const sweep = await h.pamService.sweepExpiredAccess(future);
    expect(sweep.expiredGrantsCount).toBe(1);
    expect(sweep.expiredGrantIds).toContain(requested.id);

    const updatedGrant = h.grants.find((g) => g.id === requested.id)!;
    expect(updatedGrant.status).toBe(PRIVILEGED_GRANT_STATUS.EXPIRED);
    expect(updatedGrant.autoRevoked).toBe(true);
  });

  it('links existing admin user as break-glass in SEALED state, enforces login gate, activates with critical alert, and auto-seals on expiry', async () => {
    // Link existing special admin user #99 as sealed break-glass account
    const linked = await h.pamService.createBreakGlassAccount(
      {
        mode: 'LINK_EXISTING',
        existingUserId: 99,
        code: 'bg-existing-99',
        label: 'Emergency Admin #99',
        roleCode: 'super_admin',
        requireMfa: true,
        maxActivationMinutes: 60,
        alertRecipients: ['ciso@company.local'],
        sealImmediately: true,
      },
      superAdminActor,
    );
    expect(linked.status).toBe(BREAK_GLASS_STATUS.SEALED);
    expect(h.usersStore.get(99)?.status).toBe(USER_STATUS.LOCKED);

    // Login denied while sealed
    await expect(h.breakGlassService.assertCanLogin(99)).rejects.toThrow(ForbiddenAppException);

    // Activate emergency window
    const activated = await h.pamService.activateBreakGlass(
      linked.id,
      { reason: 'DR failover primary IdP unreachable', durationMinutes: 30, ticketRef: 'DR-99' },
      securityAdminActor,
    );
    expect(activated.status).toBe(BREAK_GLASS_STATUS.ACTIVE);
    expect(h.usersStore.get(99)?.status).toBe(USER_STATUS.ACTIVE);

    // Login check passes with mandatory MFA and logs CRITICAL alert + incident on login
    const gate = await h.breakGlassService.assertCanLogin(99);
    expect(gate.isBreakGlass).toBe(true);
    expect(gate.requireMfa).toBe(true);
    await h.breakGlassService.onLoginSucceeded(99, { ...gate, ipAddress: '10.0.0.8' });
    expect(h.ingestedIncidents.length).toBeGreaterThanOrEqual(2);
    expect(
      h.alerts.some((a) => a.eventType === 'BREAK_GLASS_LOGIN' && a.severity === 'CRITICAL'),
    ).toBe(true);

    // Auto-seal after emergency window expires
    const afterExpiry = new Date(new Date(activated.expiresAt!).getTime() + 60_000);
    const sweep = await h.pamService.sweepExpiredAccess(afterExpiry);
    expect(sweep.autoSealedBreakGlassCount).toBe(1);
    expect(h.usersStore.get(99)?.status).toBe(USER_STATUS.LOCKED);
    expect(h.revokedSessionsForUsers.some((s) => s.userId === 99)).toBe(true);
  });

  it('runs periodic access review capturing standing admins and enforces KEEP / REVOKE decisions', async () => {
    const campaign = await h.pamService.createReviewCampaign(
      { title: 'Q4 Privileged Access Review', dueDays: 14 },
      securityAdminActor,
    );
    expect(campaign.status).toBe(ACCESS_REVIEW_STATUS.OPEN);
    expect(campaign.totalItems).toBe(3);

    const customItem = campaign.items.find(
      (i) => i.userId === 99 && i.grantSource === PRIVILEGED_REVIEW_SOURCE.STANDING_ROLE,
    )!;
    expect(customItem).toBeDefined();

    // Revoke custom_special_admin's super_admin role
    const afterRevoke = await h.pamService.decideReviewItem(
      campaign.id,
      customItem.id,
      { decision: 'REVOKE', note: 'No longer requires standing super_admin' },
      securityAdminActor,
    );
    expect(afterRevoke.revokedItems).toBe(1);
    expect(h.userRolesMap.get(99)).toEqual([]);
    expect(h.revokedSessionsForUsers.some((s) => s.userId === 99)).toBe(true);

    // Keep the remaining items -> campaign auto-completes
    let latest = afterRevoke;
    for (const item of afterRevoke.items) {
      if (item.decision === ACCESS_REVIEW_DECISION.PENDING) {
        latest = await h.pamService.decideReviewItem(
          campaign.id,
          item.id,
          { decision: 'KEEP', note: 'Verified' },
          securityAdminActor,
        );
      }
    }
    expect(latest.status).toBe(ACCESS_REVIEW_STATUS.COMPLETED);
    expect(latest.keptItems).toBe(2);
    expect(latest.revokedItems).toBe(1);
  });
});
