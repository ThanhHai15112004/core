import {
  BadRequestAppException,
  ConflictAppException,
  ExportRegistryService,
  ForbiddenAppException,
  ImportRegistryService,
  NotFoundAppException,
  ReportRegistryService,
  SearchRegistryService,
  SettingRegistryService,
  parseXlsxToMatrix,
  type ExternalSearchEngineClientContract,
  type IPdfExportAdapter,
  type SearchDocumentRecord,
} from '@packages/kernel/index.js';
import type { BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import {
  USER_GENDER,
  USER_STATUS,
  UserExportService,
  UserImportService,
  UserReportService,
  UserSearchService,
  UsersMapper,
  UsersService,
  getUserGenderName,
  getUserStatusName,
  normalizePhoneNumber,
  parseUserGender,
  parseUserStatus,
  resolveVietnameseNameParts,
  validateAndApplyUserUpdateFields,
  validateAndPrepareCreateUserContext,
} from '@modules/users/index.js';
import type { UserEntity } from '@modules/users/entities/user.entity.js';
import type { UserProfileEntity } from '@modules/users/entities/user-profile.entity.js';
import type { UserRepository } from '@modules/users/repositories/user.repository.js';
import type { UserProfileRepository } from '@modules/users/repositories/user-profile.repository.js';
import type { UserRoleRepository } from '@modules/users/repositories/user-role.repository.js';
import type { UserOrganizationUnitRepository } from '@modules/users/repositories/user-organization-unit.repository.js';
import type { UserOrganizationHistoryRepository } from '@modules/users/repositories/user-organization-history.repository.js';
import type { UserStatusHistoryRepository } from '@modules/users/repositories/user-status-history.repository.js';
import { DATA_SCOPE, type PasswordHasherService } from '@packages/security/index.js';
import type { IRolesPublicService } from '@modules/roles/contracts/index.js';
import type { IOrganizationsPublicService } from '@modules/organizations/contracts/index.js';

function createMockUserEntity(
  overrides: Partial<UserEntity> & { id: number; username: string; email: string },
): UserEntity {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    username: overrides.username,
    email: overrides.email,
    phone: overrides.phone ?? null,
    phoneHash: overrides.phoneHash ?? null,
    passwordHash: overrides.passwordHash ?? 'hashed_pwd',
    passwordHistoryHashesJson: overrides.passwordHistoryHashesJson ?? null,
    status: overrides.status ?? USER_STATUS.ACTIVE,
    emailVerifiedAt: overrides.emailVerifiedAt ?? null,
    phoneVerifiedAt: overrides.phoneVerifiedAt ?? null,
    lockedUntil: overrides.lockedUntil ?? null,
    lockReason: overrides.lockReason ?? null,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    mfaEnabled: overrides.mfaEnabled ?? false,
    primaryOrganizationUnitId: overrides.primaryOrganizationUnitId ?? null,
    managerId: overrides.managerId ?? null,
    temporaryManagerId: overrides.temporaryManagerId ?? null,
    temporaryManagerFrom: overrides.temporaryManagerFrom ?? null,
    temporaryManagerUntil: overrides.temporaryManagerUntil ?? null,
    lastLoginAt: overrides.lastLoginAt ?? null,
    passwordChangedAt: overrides.passwordChangedAt ?? now,
    archivedAt: overrides.archivedAt ?? null,
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  } as UserEntity;
}

describe('Users Module — Helpers & UsersService Unit Suite', () => {
  describe('user-normalizer.helper', () => {
    it('parses Vietnamese fullName and firstName/lastName parts accurately', () => {
      const parsedFromFull = resolveVietnameseNameParts({ fullName: 'Nguyễn Văn Hải' });
      expect(parsedFromFull).toEqual({
        firstName: 'Hải',
        lastName: 'Nguyễn Văn',
        fullName: 'Nguyễn Văn Hải',
      });

      const parsedSingleWord = resolveVietnameseNameParts({ fullName: 'Admin' });
      expect(parsedSingleWord).toEqual({
        firstName: 'Admin',
        lastName: 'Admin',
        fullName: 'Admin',
      });

      const parsedFromParts = resolveVietnameseNameParts({
        firstName: 'Minh',
        lastName: 'Trần Hoàng',
      });
      expect(parsedFromParts).toEqual({
        firstName: 'Minh',
        lastName: 'Trần Hoàng',
        fullName: 'Trần Hoàng Minh',
      });
    });

    it('normalizes Vietnamese and international phone numbers consistently', () => {
      expect(normalizePhoneNumber('+84 909 123-456')).toBe('0909123456');
      expect(normalizePhoneNumber('84912345678')).toBe('0912345678');
      expect(normalizePhoneNumber('0988.111.222')).toBe('0988111222');
      expect(normalizePhoneNumber('   ')).toBeNull();
      expect(normalizePhoneNumber(null)).toBeNull();
    });

    it('resolves user status and gender codes via CodeRegistry', () => {
      expect(parseUserStatus(0)).toBe(USER_STATUS.INACTIVE);
      expect(parseUserStatus(USER_STATUS.ACTIVE)).toBe(USER_STATUS.ACTIVE);
      expect(parseUserStatus(USER_STATUS.LOCKED)).toBe(USER_STATUS.LOCKED);
      expect(getUserStatusName(USER_STATUS.ACTIVE)).toBe('ACTIVE');

      expect(parseUserGender(null)).toBeNull();
      expect(parseUserGender(USER_GENDER.MALE)).toBe(USER_GENDER.MALE);
      expect(getUserGenderName(null)).toBeNull();
      expect(typeof getUserGenderName(USER_GENDER.FEMALE)).toBe('string');
    });
  });

  describe('user-profile-hydration.helper', () => {
    it('prevents circular manager hierarchy and self-management on user update', async () => {
      const targetUser = createMockUserEntity({
        id: 10,
        username: 'manager_a',
        email: 'manager_a@example.com',
      });
      const subordinateUser = createMockUserEntity({
        id: 25,
        username: 'sub_b',
        email: 'sub_b@example.com',
        managerId: 10,
      });

      const mockUserRepo = {
        findByIdWithArchived: async (id: number) =>
          id === 25 ? subordinateUser : id === 10 ? targetUser : null,
      } as unknown as UserRepository;

      const mockPasswordHasher = {
        sha256: (v: string) => `sha_${v}`,
      } as unknown as PasswordHasherService;

      const baseProfile = {
        firstName: 'A',
        lastName: 'Manager',
        fullName: 'Manager A',
        avatarUrl: null,
        dateOfBirth: null,
        gender: null,
        identityNumber: null,
        address: null,
        city: null,
        country: null,
        bio: null,
      };

      // Cannot be own manager
      await expect(
        validateAndApplyUserUpdateFields({
          id: 10,
          user: targetUser,
          dto: { managerId: 10 },
          currentProfile: baseProfile,
          userRepository: mockUserRepo,
          passwordHasher: mockPasswordHasher,
          encryptPhone: (p) => p ?? null,
          resolveSubordinateUserIds: async () => [25],
        }),
      ).rejects.toThrow(BadRequestAppException);

      // Cannot assign subordinate #25 as manager of #10
      await expect(
        validateAndApplyUserUpdateFields({
          id: 10,
          user: targetUser,
          dto: { managerId: 25 },
          currentProfile: baseProfile,
          userRepository: mockUserRepo,
          passwordHasher: mockPasswordHasher,
          encryptPhone: (p) => p ?? null,
          resolveSubordinateUserIds: async () => [25],
        }),
      ).rejects.toThrow(BadRequestAppException);
    });

    it('detects duplicate email and auto-suffixes generated username when omitted', async () => {
      const existingUser = createMockUserEntity({
        id: 1,
        username: 'nguyen.van.a',
        email: 'taken@example.com',
      });

      const mockUserRepo = {
        findByUsername: async (u: string) => (u === 'nguyen.van.a' ? existingUser : null),
        findByEmail: async (e: string) => (e === 'taken@example.com' ? existingUser : null),
        findByPhoneHash: async () => null,
      } as unknown as UserRepository;

      const mockPasswordHasher = {
        sha256: (v: string) => `sha_${v}`,
      } as unknown as PasswordHasherService;

      const mockRolesService = {
        ensureActiveRolesExist: async () => undefined,
      } as unknown as IRolesPublicService;

      // Duplicate email rejected
      await expect(
        validateAndPrepareCreateUserContext({
          dto: {
            email: 'taken@example.com',
            fullName: 'Nguyễn Văn A',
            password: 'Password@123',
            status: USER_STATUS.ACTIVE,
            roleIds: [],
            organizationUnits: [],
          },
          userRepository: mockUserRepo,
          passwordHasher: mockPasswordHasher,
          rolesPublicService: mockRolesService,
          organizationsPublicService: null,
        }),
      ).rejects.toThrow(ConflictAppException);

      // Auto-generated username from email prefix suffixes when collision happens and username was not explicitly provided
      const prepared = await validateAndPrepareCreateUserContext({
        dto: {
          email: 'nguyen.van.a@company.vn',
          fullName: 'Nguyễn Văn A',
          password: 'Password@123',
          status: USER_STATUS.ACTIVE,
          roleIds: [],
          organizationUnits: [],
        },
        userRepository: mockUserRepo,
        passwordHasher: mockPasswordHasher,
        rolesPublicService: mockRolesService,
        organizationsPublicService: null,
      });

      expect(prepared.normalizedEmail).toBe('nguyen.van.a@company.vn');
      expect(prepared.finalUsername).toMatch(/^nguyen\.van\.a_[a-z0-9]+$/);
    });
  });

  describe('UsersService Lifecycle & Assignments', () => {
    it('creates user, transitions status (lock / unlock / archive / restore) and assigns roles & organizations', async () => {
      const usersStore = new Map<number, UserEntity>();
      const profilesStore = new Map<number, UserProfileEntity>();
      const rolesLinksStore = new Map<number, number[]>();
      const orgsLinksStore = new Map<
        number,
        Array<{ organizationUnitId: number; isPrimary: boolean; positionTitle: string | null }>
      >();
      const statusHistories: Array<{
        userId: number;
        fromStatus: number | null;
        toStatus: number;
        reason: string | null;
      }> = [];
      let nextUserId = 1;

      const mockUserRepo = {
        searchPaginated: async () => ({ items: [...usersStore.values()], total: usersStore.size }),
        findByIdWithArchived: async (id: number) => usersStore.get(Number(id)) ?? null,
        findByUsername: async (u: string) =>
          [...usersStore.values()].find((item) => item.username === u) ?? null,
        findByEmail: async (e: string) =>
          [...usersStore.values()].find((item) => item.email === e) ?? null,
        findByPhoneHash: async () => null,
        saveEntity: async (data: Partial<UserEntity>) => {
          const id = data.id ? Number(data.id) : nextUserId++;
          const existing = usersStore.get(id);
          const saved = createMockUserEntity({
            ...existing,
            ...data,
            id,
            username: data.username ?? existing?.username ?? `user_${id}`,
            email: data.email ?? existing?.email ?? `user_${id}@example.com`,
          });
          usersStore.set(id, saved);
          return saved;
        },
      } as unknown as UserRepository;

      const mockProfileRepo = {
        upsertByUserId: async (userId: number, data: Partial<UserProfileEntity>) => {
          const existing = profilesStore.get(Number(userId));
          const record = {
            id: Number(userId),
            userId: Number(userId),
            firstName: data.firstName ?? existing?.firstName ?? '',
            lastName: data.lastName ?? existing?.lastName ?? '',
            fullName: data.fullName ?? existing?.fullName ?? '',
            avatarUrl: data.avatarUrl ?? null,
            dateOfBirth: data.dateOfBirth ?? null,
            gender: data.gender ?? null,
            identityNumber: data.identityNumber ?? null,
            address: data.address ?? null,
            city: data.city ?? null,
            country: data.country ?? null,
            bio: data.bio ?? null,
            preferredLocale: data.preferredLocale ?? 'vi',
            preferredTimezone: data.preferredTimezone ?? 'Asia/Ho_Chi_Minh',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as UserProfileEntity;
          profilesStore.set(Number(userId), record);
          return record;
        },
        findByUserId: async (userId: number) => profilesStore.get(Number(userId)) ?? null,
        findByUserIds: async (userIds: readonly number[]) =>
          userIds
            .map((id) => profilesStore.get(Number(id)))
            .filter((p): p is UserProfileEntity => Boolean(p)),
      } as unknown as UserProfileRepository;

      const mockUserRoleRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.flatMap((uid) =>
            (rolesLinksStore.get(Number(uid)) ?? []).map((roleId) => ({
              userId: Number(uid),
              roleId,
            })),
          ),
        replaceUserRoles: async (userId: number, roleIds: readonly number[]) => {
          rolesLinksStore.set(Number(userId), [...roleIds]);
        },
      } as unknown as UserRoleRepository;

      const mockUserOrgRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.flatMap((uid) =>
            (orgsLinksStore.get(Number(uid)) ?? []).map((o) => ({
              userId: Number(uid),
              ...o,
            })),
          ),
        replaceUserOrganizations: async (
          userId: number,
          items: ReadonlyArray<{
            organizationUnitId: number;
            isPrimary?: boolean;
            positionTitle?: string | null;
          }>,
        ) => {
          const normalized = items.map((item, idx) => ({
            userId: Number(userId),
            organizationUnitId: Number(item.organizationUnitId),
            isPrimary: item.isPrimary ?? idx === 0,
            positionTitle: item.positionTitle ?? null,
          }));
          orgsLinksStore.set(Number(userId), normalized);
          return normalized;
        },
      } as unknown as UserOrganizationUnitRepository;

      const mockStatusHistoryRepo = {
        recordTransition: async (entry: {
          userId: number;
          fromStatus: number | null;
          toStatus: number;
          reason: string | null;
        }) => {
          statusHistories.push(entry);
        },
        findByUserId: async (userId: number) =>
          statusHistories
            .filter((h) => h.userId === Number(userId))
            .map((h, i) => ({
              id: i + 1,
              ...h,
              changedBy: 1,
              createdAt: new Date(),
            })),
      } as unknown as UserStatusHistoryRepository;

      const mockPasswordHasher = {
        hash: async (pwd: string) => `hashed:${pwd}`,
        sha256: (val: string) => `sha256:${val}`,
        generateSuggestedPassword: () => 'Suggested#2026',
      } as unknown as PasswordHasherService;

      const mockRolesService = {
        ensureActiveRolesExist: async () => undefined,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: id === 1 ? 'admin' : 'staff',
            name: id === 1 ? 'Administrator' : 'Staff Member',
            status: 1,
            dataScope: 1,
            dataScopeName: 'ALL',
            permissions: ['users.read'],
          })),
        findByCodes: async () => [],
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const mockOrgsService = {
        ensureActiveUnitsExist: async () => undefined,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: `UNIT_${id}`,
            name: `Phòng Ban ${id}`,
            type: 20,
            typeName: 'DEPARTMENT',
            status: 1,
          })),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const service = new UsersService(
        mockUserRepo,
        mockUserRoleRepo,
        mockUserOrgRepo,
        new UsersMapper(),
        mockPasswordHasher,
        mockRolesService,
        mockOrgsService,
        mockStatusHistoryRepo,
        null,
        null,
        null,
        mockProfileRepo,
      );

      // 1. Create User
      const created = await service.create(
        {
          username: 'thanh.hai',
          email: 'hai@core.vn',
          fullName: 'Lê Thanh Hải',
          phone: '+84909111222',
          password: 'Password@123',
          status: USER_STATUS.ACTIVE,
          roleIds: [1],
          organizationUnits: [
            { organizationUnitId: 10, isPrimary: true, positionTitle: 'Tech Lead' },
          ],
        },
        1,
      );

      expect(created.username).toBe('thanh.hai');
      expect(created.firstName).toBe('Hải');
      expect(created.lastName).toBe('Lê Thanh');
      expect(created.roles).toHaveLength(1);
      expect(created.organizationUnits[0]?.positionTitle).toBe('Tech Lead');

      // 2. Lock & Unlock User
      const locked = await service.lockUser(created.id, { reason: 'Security review' }, 1);
      expect(locked.status).toBe(USER_STATUS.LOCKED);
      expect(locked.lockReason).toBe('Security review');

      const unlocked = await service.unlockUser(created.id, 1);
      expect(unlocked.status).toBe(USER_STATUS.ACTIVE);
      expect(unlocked.lockReason).toBeNull();

      // 3. Archive & Restore User
      const archived = await service.archiveUser(created.id, 1);
      expect(archived.status).toBe(USER_STATUS.ARCHIVED);
      expect(archived.isArchived).toBe(true);

      const restored = await service.restoreUser(created.id, 1);
      expect(restored.status).toBe(USER_STATUS.INACTIVE);

      // 4. Status history recorded all 5 transitions
      const history = await service.getStatusHistory(created.id);
      expect(history).toHaveLength(5);
    });
  });

  describe('Phase 8 — Section 8.2: Shared Import Engine & UserImportService', () => {
    const createImportTestHarness = () => {
      const usersStore = new Map<number, UserEntity>();
      const profilesStore = new Map<number, UserProfileEntity>();
      const rolesLinksStore = new Map<number, number[]>();
      const orgsLinksStore = new Map<
        number,
        Array<{
          userId: number;
          organizationUnitId: number;
          isPrimary: boolean;
          positionTitle: string | null;
        }>
      >();
      const publishedJobs: Array<{ topic: string; payload: unknown; queue: string }> = [];
      let nextUserId = 1;

      const mockUserRepo = {
        searchPaginated: async () => ({ items: [...usersStore.values()], total: usersStore.size }),
        findByIdWithArchived: async (id: number) => usersStore.get(Number(id)) ?? null,
        findByUsername: async (u: string) =>
          [...usersStore.values()].find((item) => item.username === u) ?? null,
        findByEmail: async (e: string) =>
          [...usersStore.values()].find((item) => item.email === e) ?? null,
        findByPhoneHash: async () => null,
        saveEntity: async (data: Partial<UserEntity>) => {
          const id = data.id ? Number(data.id) : nextUserId++;
          const existing = usersStore.get(id);
          const saved = createMockUserEntity({
            ...existing,
            ...data,
            id,
            username: data.username ?? existing?.username ?? `user_${id}`,
            email: data.email ?? existing?.email ?? `user_${id}@example.com`,
          });
          usersStore.set(id, saved);
          return saved;
        },
      } as unknown as UserRepository;

      const mockProfileRepo = {
        upsertByUserId: async (userId: number, data: Partial<UserProfileEntity>) => {
          const existing = profilesStore.get(Number(userId));
          const record = {
            id: Number(userId),
            userId: Number(userId),
            firstName: data.firstName ?? existing?.firstName ?? '',
            lastName: data.lastName ?? existing?.lastName ?? '',
            fullName: data.fullName ?? existing?.fullName ?? '',
            avatarUrl: data.avatarUrl ?? null,
            dateOfBirth: data.dateOfBirth ?? null,
            gender: data.gender ?? null,
            identityNumber: data.identityNumber ?? null,
            address: data.address ?? null,
            city: data.city ?? null,
            country: data.country ?? null,
            bio: data.bio ?? null,
            preferredLocale: data.preferredLocale ?? 'vi',
            preferredTimezone: data.preferredTimezone ?? 'Asia/Ho_Chi_Minh',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as UserProfileEntity;
          profilesStore.set(Number(userId), record);
          return record;
        },
        findByUserId: async (userId: number) => profilesStore.get(Number(userId)) ?? null,
        findByUserIds: async (userIds: readonly number[]) =>
          userIds
            .map((id) => profilesStore.get(Number(id)))
            .filter((p): p is UserProfileEntity => Boolean(p)),
      } as unknown as UserProfileRepository;

      const mockUserRoleRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.flatMap((uid) =>
            (rolesLinksStore.get(Number(uid)) ?? []).map((roleId) => ({
              userId: Number(uid),
              roleId,
            })),
          ),
        replaceUserRoles: async (userId: number, roleIds: readonly number[]) => {
          rolesLinksStore.set(Number(userId), [...roleIds]);
        },
      } as unknown as UserRoleRepository;

      const mockUserOrgRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.flatMap((uid) =>
            (orgsLinksStore.get(Number(uid)) ?? []).map((o) => ({
              ...o,
              userId: Number(uid),
            })),
          ),
        replaceUserOrganizations: async (
          userId: number,
          items: ReadonlyArray<{
            organizationUnitId: number;
            isPrimary?: boolean;
            positionTitle?: string | null;
          }>,
        ) => {
          const normalized = items.map((item, idx) => ({
            userId: Number(userId),
            organizationUnitId: Number(item.organizationUnitId),
            isPrimary: item.isPrimary ?? idx === 0,
            positionTitle: item.positionTitle ?? null,
          }));
          orgsLinksStore.set(Number(userId), normalized);
          return normalized;
        },
      } as unknown as UserOrganizationUnitRepository;

      const mockPasswordHasher = {
        hash: async (pwd: string) => `hashed:${pwd}`,
        sha256: (val: string) => `sha256:${val}`,
        generateSuggestedPassword: () => 'Suggested#2026',
      } as unknown as PasswordHasherService;

      const mockRolesService = {
        ensureActiveRolesExist: async () => undefined,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: id === 1 ? 'admin' : 'staff',
            name: id === 1 ? 'Administrator' : 'Staff Member',
            status: 1,
            dataScope: 1,
            dataScopeName: 'ALL',
            permissions: ['users.read'],
          })),
        findByCodes: async (codes: readonly string[]) =>
          codes.map((c, idx) => ({
            id: c.toLowerCase() === 'admin' ? 1 : idx + 2,
            code: c.toLowerCase(),
            name: c.toUpperCase(),
            status: 1,
          })),
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const mockOrgsService = {
        ensureActiveUnitsExist: async () => undefined,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: `UNIT_${id}`,
            name: `Phòng Ban ${id}`,
            type: 20,
            typeName: 'DEPARTMENT',
            status: 1,
          })),
        findByCodes: async (codes: readonly string[]) =>
          codes.map((c, idx) => ({
            id: idx + 10,
            code: c.toUpperCase(),
            name: `Đơn vị ${c}`,
            status: 1,
          })),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const mockPublisher = {
        publish: async (topic: string, payload: unknown, queue: string) => {
          publishedJobs.push({ topic, payload, queue });
          return {
            id: `job_import_${publishedJobs.length}`,
            topic,
            payload,
            producer: 'api',
            timestamp: Date.now(),
          };
        },
      } as unknown as BaseMessagePublisherProvider;

      const mockStatusHistoryRepo = {
        recordTransition: async () => undefined,
        findByUserId: async () => [],
      } as unknown as UserStatusHistoryRepository;

      const usersService = new UsersService(
        mockUserRepo,
        mockUserRoleRepo,
        mockUserOrgRepo,
        new UsersMapper(),
        mockPasswordHasher,
        mockRolesService,
        mockOrgsService,
        mockStatusHistoryRepo,
        null,
        null,
        null,
        mockProfileRepo,
      );

      const importRegistry = new ImportRegistryService();
      const importService = new UserImportService(
        usersService,
        mockUserRepo,
        mockRolesService,
        mockOrgsService,
        undefined,
        mockPublisher,
        importRegistry,
      );
      const exportService = new UserExportService(usersService, mockUserRepo);

      return {
        usersService,
        importService,
        exportService,
        importRegistry,
        publishedJobs,
      };
    };

    it('8.2.1 & 8.2.2 — Generates Excel (.xlsx) and CSV (.csv) templates and imports both formats accurately', async () => {
      const { importService, exportService } = createImportTestHarness();

      const xlsxTemplate = exportService.exportImportTemplate('xlsx');
      expect(xlsxTemplate.fileName).toBe('mau_import_nhan_vien.xlsx');
      expect(xlsxTemplate.xlsxBase64.length).toBeGreaterThan(100);

      // Import directly from generated Excel .xlsx template
      const xlsxResult = await importService.bulkImport(
        {
          fileName: xlsxTemplate.fileName,
          xlsxBase64: xlsxTemplate.xlsxBase64,
          skipDuplicates: true,
        },
        1,
      );
      expect(xlsxResult.totalRows).toBe(3);
      expect(xlsxResult.importedCount).toBe(3);
      expect(xlsxResult.failedCount).toBe(0);

      // Import from CSV
      const csvContent = [
        'Username,Email,Họ và tên,Số điện thoại,Vai trò,Mã Đơn vị',
        'dung.pham,dung.pham@core.vn,Phạm Tiến Dũng,0905111222,staff,BRANCH_HN',
      ].join('\n');
      const csvResult = await importService.bulkImport(
        {
          fileName: 'nhan_vien_moi.csv',
          csvContent,
          skipDuplicates: true,
        },
        1,
      );
      expect(csvResult.importedCount).toBe(1);
      expect(csvResult.status).toBe('COMPLETED');
    });

    it('8.2.3 — Supports custom columnMapping to map non-standard file columns to system fields', async () => {
      const { importService, usersService } = createImportTestHarness();

      const customCsv = [
        'Nickname,WorkMail,FullDisplayName,MobilePhone',
        'khanh.hoang,khanh.hoang@core.vn,Hoàng Quốc Khánh,0912333444',
      ].join('\n');

      const result = await importService.bulkImport(
        {
          fileName: 'custom_columns.csv',
          csvContent: customCsv,
          columnMapping: {
            username: 'Nickname',
            email: 'WorkMail',
            fullName: 'FullDisplayName',
            phone: 'MobilePhone',
          },
          skipDuplicates: true,
        },
        1,
      );

      expect(result.importedCount).toBe(1);
      const importedUser = await usersService.getById(result.importedUserIds[0]!);
      expect(importedUser.username).toBe('khanh.hoang');
      expect(importedUser.email).toBe('khanh.hoang@core.vn');
      expect(importedUser.fullName).toBe('Hoàng Quốc Khánh');
    });

    it('8.2.4 & 8.2.5 — Previews import data before saving and reports detailed row & column errors (including in-file duplicates)', async () => {
      const { importService } = createImportTestHarness();

      // Seed 1 existing user in DB
      await importService.bulkImport({
        items: [
          {
            username: 'existing.user',
            email: 'existing@core.vn',
            fullName: 'Existing User',
            status: USER_STATUS.ACTIVE,
            roleCodes: [],
            organizationCodes: [],
          },
        ],
        skipDuplicates: true,
      });

      const previewCsv = [
        'Username,Email,Họ và tên',
        'valid.one,valid.one@core.vn,Người Hợp Lệ',
        'existing.user,existing@core.vn,Người Đã Tồn Tại',
        'valid.one,valid.one@core.vn,Người Trùng Trong File',
        'ab,not-an-email,Người Lỗi Dữ Liệu',
      ].join('\n');

      const preview = await importService.previewImport({
        csvContent: previewCsv,
        duplicateStrategy: 'UPDATE',
        skipDuplicates: false,
      });

      expect(preview.totalRows).toBe(4);
      expect(preview.willCreateCount).toBe(1);
      expect(preview.willUpdateCount).toBe(1);
      expect(preview.invalidRowsCount).toBe(2); // 1 in-file duplicate + 1 invalid row

      const inFileDupIssue = preview.issues.find((i) => i.code === 'DUPLICATE_IN_FILE');
      expect(inFileDupIssue).toBeDefined();
      expect(inFileDupIssue?.row).toBe(3);
      expect(inFileDupIssue?.column).toBe('Email');
      expect(inFileDupIssue?.columnLetter).toBe('B');

      const invalidEmailIssue = preview.issues.find(
        (i) => i.row === 4 && i.field === 'email' && i.code === 'VALIDATION_ERROR',
      );
      expect(invalidEmailIssue).toBeDefined();
      expect(invalidEmailIssue?.column).toBe('Email');
      expect(invalidEmailIssue?.columnLetter).toBe('B');
    });

    it('8.2.6 — Handles duplicates with all 3 strategies: SKIP, UPDATE, and REJECT', async () => {
      const { importService, usersService } = createImportTestHarness();

      // Initial import
      const initial = await importService.bulkImport({
        csvContent: [
          'Username,Email,Họ và tên,Số điện thoại',
          'trung.nguyen,trung@core.vn,Nguyễn Văn Trung,0901000111',
        ].join('\n'),
        skipDuplicates: true,
      });
      const userId = initial.importedUserIds[0]!;

      // 1. SKIP strategy
      const skipRes = await importService.bulkImport({
        csvContent: [
          'Username,Email,Họ và tên,Số điện thoại',
          'trung.nguyen,trung@core.vn,Nguyễn Văn Trung Mới,0909999888',
        ].join('\n'),
        duplicateStrategy: 'SKIP',
        skipDuplicates: true,
      });
      expect(skipRes.skippedCount).toBe(1);
      expect(skipRes.importedCount).toBe(0);

      // 2. UPDATE strategy
      const updateRes = await importService.bulkImport({
        csvContent: [
          'Username,Email,Họ và tên,Số điện thoại,Vai trò',
          'trung.nguyen,trung@core.vn,Nguyễn Thành Trung,0909999888,admin',
        ].join('\n'),
        duplicateStrategy: 'UPDATE',
        skipDuplicates: false,
      });
      expect(updateRes.updatedCount).toBe(1);
      expect(updateRes.successCount).toBe(1);
      expect(updateRes.updatedUserIds).toEqual([userId]);
      const updatedUser = await usersService.getById(userId);
      expect(updatedUser.fullName).toBe('Nguyễn Thành Trung');

      // 3. REJECT strategy
      const rejectRes = await importService.bulkImport({
        csvContent: [
          'Username,Email,Họ và tên',
          'trung.nguyen,trung@core.vn,Nguyễn Thành Trung',
        ].join('\n'),
        duplicateStrategy: 'REJECT',
        skipDuplicates: false,
      });
      expect(rejectRes.failedCount).toBe(1);
      expect(rejectRes.errors[0]?.code).toBe('DUPLICATE_IN_DB');
      expect(rejectRes.errors[0]?.field).toBe('email');
      expect(rejectRes.errors[0]?.column).toBe('Email');
    });

    it('8.2.7, 8.2.8 & 8.2.9 — Supports async Queue execution, tracks progress (success, failed, remaining) and records Import History', async () => {
      const { importService, importRegistry, publishedJobs } = createImportTestHarness();

      // Queue async import
      const queuedRes = await importService.bulkImport(
        {
          fileName: 'batch_async_users.csv',
          csvContent: [
            'Username,Email,Họ và tên',
            'async.u1,async.u1@core.vn,Async User 1',
            'async.u2,async.u2@core.vn,Async User 2',
          ].join('\n'),
          async: true,
          duplicateStrategy: 'SKIP',
          skipDuplicates: true,
        },
        99,
      );

      expect(queuedRes.status).toBe('QUEUED');
      expect(queuedRes.jobId).toBeDefined();
      expect(queuedRes.historyId).toBeDefined();
      expect(queuedRes.remainingCount).toBe(2);
      expect(publishedJobs).toHaveLength(1);
      expect(publishedJobs[0]?.topic).toBe('users.import');

      // Check initial progress snapshot (0 processed, 2 remaining)
      const initialProgress = importService.getImportJobProgress(queuedRes.jobId!);
      expect(initialProgress.status).toBe('QUEUED');
      expect(initialProgress.totalRows).toBe(2);
      expect(initialProgress.remainingRows).toBe(2);

      // Simulate worker mid-flight progress update (1 processed, 1 remaining)
      importRegistry.updateImportHistory(queuedRes.historyId!, {
        status: 'PROCESSING',
        processedRows: 1,
        createdCount: 1,
        failedCount: 0,
      });
      const midProgress = importService.getImportJobProgress(queuedRes.jobId!);
      expect(midProgress.status).toBe('PROCESSING');
      expect(midProgress.processedRows).toBe(1);
      expect(midProgress.remainingRows).toBe(1);
      expect(midProgress.successCount).toBe(1);
      expect(midProgress.percent).toBe(50);

      // Query import histories & detail by ID
      const histories = importService.listImportHistories({ actorId: 99 });
      expect(histories).toHaveLength(1);
      expect(histories[0]?.fileName).toBe('batch_async_users.csv');
      expect(histories[0]?.actorId).toBe(99);

      const historyDetail = importService.getImportHistoryById(queuedRes.historyId!);
      expect(historyDetail.id).toBe(queuedRes.historyId);
      expect(historyDetail.jobId).toBe(queuedRes.jobId);
    });

    it('8.2.6 (Batch IN Query) — Resolves existing duplicates in a single batch via findByEmails & findByUsernames without N+1 queries', async () => {
      let batchEmailsCalls = 0;
      let batchUsernamesCalls = 0;
      let singleEmailCalls = 0;
      let singleUsernameCalls = 0;

      const batchRepo = {
        findByEmails: async (emails: readonly string[]) => {
          batchEmailsCalls += 1;
          return emails.includes('dup1@core.vn')
            ? [
                createMockUserEntity({
                  id: 101,
                  username: 'dup1',
                  email: 'dup1@core.vn',
                }),
              ]
            : [];
        },
        findByUsernames: async (usernames: readonly string[]) => {
          batchUsernamesCalls += 1;
          return usernames.includes('dup2')
            ? [
                createMockUserEntity({
                  id: 102,
                  username: 'dup2',
                  email: 'dup2@core.vn',
                }),
              ]
            : [];
        },
        findByEmail: async () => {
          singleEmailCalls += 1;
          return null;
        },
        findByUsername: async () => {
          singleUsernameCalls += 1;
          return null;
        },
      } as unknown as UserRepository;

      const createdIds: number[] = [];
      const mockUsersSvc = {
        create: async () => {
          const nextId = 200 + createdIds.length + 1;
          createdIds.push(nextId);
          return { id: nextId };
        },
      } as unknown as UsersService;

      const mockRolesSvc = {
        findByCodes: async () => [],
      } as unknown as IRolesPublicService;

      const batchImportService = new UserImportService(
        mockUsersSvc,
        batchRepo,
        mockRolesSvc,
        null,
        undefined,
        null,
        new ImportRegistryService(),
      );

      const res = await batchImportService.bulkImport({
        items: [
          {
            username: 'dup1',
            email: 'dup1@core.vn',
            fullName: 'Duplicate Email User',
            status: USER_STATUS.ACTIVE,
            roleCodes: [],
            organizationCodes: [],
          },
          {
            username: 'dup2',
            email: 'unique2@core.vn',
            fullName: 'Duplicate Username User',
            status: USER_STATUS.ACTIVE,
            roleCodes: [],
            organizationCodes: [],
          },
          {
            username: 'fresh1',
            email: 'fresh1@core.vn',
            fullName: 'Fresh User 1',
            status: USER_STATUS.ACTIVE,
            roleCodes: [],
            organizationCodes: [],
          },
          {
            username: 'fresh2',
            email: 'fresh2@core.vn',
            fullName: 'Fresh User 2',
            status: USER_STATUS.ACTIVE,
            roleCodes: [],
            organizationCodes: [],
          },
        ],
        duplicateStrategy: 'SKIP',
        skipDuplicates: true,
      });

      expect(res.totalRows).toBe(4);
      expect(res.skippedCount).toBe(2);
      expect(res.importedCount).toBe(2);
      expect(batchEmailsCalls).toBe(1);
      expect(batchUsernamesCalls).toBe(1);
      expect(singleEmailCalls).toBe(0);
      expect(singleUsernameCalls).toBe(0);
    });
  });

  describe('Phase 8 — Section 8.3: Shared Export Engine & UserExportService', () => {
    const createExportTestHarness = () => {
      const usersStore = new Map<number, UserEntity>();
      const profilesStore = new Map<number, UserProfileEntity>();
      const publishedJobs: Array<{ id: string; topic: string; payload: unknown; queue: string }> =
        [];
      const dispatchedNotifications: Array<Record<string, unknown>> = [];
      const recordedAuditEvents: Array<Record<string, unknown>> = [];

      const seedUsers = [
        {
          id: 1,
          username: 'an.nguyen',
          email: 'an.nguyen@core.vn',
          phone: '0901234567',
          firstName: 'An',
          lastName: 'Nguyễn Văn',
          fullName: 'Nguyễn Văn An',
          status: USER_STATUS.ACTIVE,
          primaryOrganizationUnitId: 10,
        },
        {
          id: 2,
          username: 'binh.tran',
          email: 'binh.tran@core.vn',
          phone: '0912345678',
          firstName: 'Bình',
          lastName: 'Trần Thị',
          fullName: 'Trần Thị Bình',
          status: USER_STATUS.ACTIVE,
          primaryOrganizationUnitId: 10,
        },
        {
          id: 3,
          username: 'cuong.le',
          email: 'cuong.le@core.vn',
          phone: '0987654321',
          firstName: 'Cường',
          lastName: 'Lê Hoàng',
          fullName: 'Lê Hoàng Cường',
          status: USER_STATUS.LOCKED,
          primaryOrganizationUnitId: 20,
        },
      ];

      for (const u of seedUsers) {
        usersStore.set(
          u.id,
          createMockUserEntity({
            id: u.id,
            username: u.username,
            email: u.email,
            phone: u.phone,
            status: u.status,
            primaryOrganizationUnitId: u.primaryOrganizationUnitId,
          }),
        );
        profilesStore.set(u.id, {
          id: u.id,
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          fullName: u.fullName,
          avatarUrl: null,
          dateOfBirth: null,
          gender: USER_GENDER.MALE,
          identityNumber: null,
          address: null,
          city: null,
          country: null,
          bio: null,
          preferredLocale: 'vi',
          preferredTimezone: 'Asia/Ho_Chi_Minh',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as UserProfileEntity);
      }

      const mockUserRepo = {
        searchPaginated: async (query: {
          q?: string;
          status?: number;
          organizationUnitId?: number;
          limit?: number;
        }) => {
          let list = [...usersStore.values()];
          if (query.status !== undefined) {
            list = list.filter((u) => u.status === query.status);
          }
          if (query.organizationUnitId !== undefined) {
            list = list.filter((u) => u.primaryOrganizationUnitId === query.organizationUnitId);
          }
          if (query.q?.trim()) {
            const kw = query.q.trim().toLowerCase();
            list = list.filter(
              (u) =>
                u.username.toLowerCase().includes(kw) ||
                u.email.toLowerCase().includes(kw) ||
                (profilesStore.get(u.id)?.fullName.toLowerCase().includes(kw) ?? false),
            );
          }
          const limited = query.limit ? list.slice(0, query.limit) : list;
          return { items: limited, total: list.length };
        },
      } as unknown as UserRepository;

      const mockProfileRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds
            .map((id) => profilesStore.get(Number(id)))
            .filter((p): p is UserProfileEntity => Boolean(p)),
      } as unknown as UserProfileRepository;

      const mockUserRoleRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.map((uid) => ({ userId: Number(uid), roleId: 2 })),
      } as unknown as UserRoleRepository;

      const mockUserOrgRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.map((uid) => ({
            userId: Number(uid),
            organizationUnitId: usersStore.get(Number(uid))?.primaryOrganizationUnitId ?? 10,
            isPrimary: true,
            positionTitle: 'Chuyên viên',
          })),
      } as unknown as UserOrganizationUnitRepository;

      const mockRolesService = {
        findByIds: async () => [
          {
            id: 2,
            code: 'staff',
            name: 'Staff',
            status: 1,
            dataScope: 1,
            dataScopeName: 'ALL',
            permissions: ['users.export'],
          },
        ],
        findByCodes: async (codes: readonly string[]) =>
          codes.map((c, idx) => ({
            id: c.toLowerCase() === 'admin' ? 1 : idx + 2,
            code: c.toLowerCase(),
            name: c.toUpperCase(),
            status: 1,
            dataScope: 1,
          })),
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const mockOrgsService = {
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: `UNIT_${id}`,
            name: `Phòng Ban ${id}`,
            type: 20,
            typeName: 'DEPARTMENT',
            status: 1,
          })),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const mockPasswordHasher = {
        hash: async (pwd: string) => `hashed:${pwd}`,
        sha256: (val: string) => `sha256:${val}`,
        generateSuggestedPassword: () => 'Suggested#2026',
      } as unknown as PasswordHasherService;

      const mockStatusHistoryRepo = {
        recordTransition: async () => undefined,
        findByUserId: async () => [],
      } as unknown as UserStatusHistoryRepository;

      const usersService = new UsersService(
        mockUserRepo,
        mockUserRoleRepo,
        mockUserOrgRepo,
        new UsersMapper(),
        mockPasswordHasher,
        mockRolesService,
        mockOrgsService,
        mockStatusHistoryRepo,
        null,
        null,
        null,
        mockProfileRepo,
      );

      const mockPublisher = {
        publish: async (topic: string, payload: unknown, queue: string) => {
          const id = `job_export_${publishedJobs.length + 1}`;
          publishedJobs.push({ id, topic, payload, queue });
          return {
            id,
            topic,
            payload,
            producer: 'api',
            timestamp: Date.now(),
          };
        },
      } as unknown as BaseMessagePublisherProvider;

      const mockAuditLog = {
        record: async (entry: Record<string, unknown>) => {
          recordedAuditEvents.push(entry);
        },
      };

      const mockNotificationsService = {
        dispatch: async (input: Record<string, unknown>) => {
          dispatchedNotifications.push(input);
          return { notificationId: dispatchedNotifications.length };
        },
      };

      const settingRegistry = new SettingRegistryService();
      const exportRegistry = new ExportRegistryService();

      const exportService = new UserExportService(
        usersService,
        mockUserRepo,
        mockAuditLog as never,
        undefined,
        settingRegistry,
        mockPublisher,
        exportRegistry,
        mockNotificationsService as never,
      );

      return {
        exportService,
        settingRegistry,
        exportRegistry,
        publishedJobs,
        dispatchedNotifications,
        recordedAuditEvents,
      };
    };

    it('8.3.1 & 8.3.2 — Exports filtered user list to Excel (.xlsx) and CSV (.csv) preserving active filters', async () => {
      const { exportService } = createExportTestHarness();

      // 1. Export Excel (.xlsx) with active status & orgUnit filters
      const xlsxRes = await exportService.exportUsersCsv(
        {
          format: 'xlsx',
          status: USER_STATUS.ACTIVE,
          organizationUnitId: 10,
          q: 'an.nguyen',
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 7, roles: ['staff'], permissions: ['users.export'] },
      );

      expect(xlsxRes.format).toBe('xlsx');
      expect(xlsxRes.totalExported).toBe(1);
      expect(xlsxRes.xlsxBase64.length).toBeGreaterThan(100);
      expect(xlsxRes.filtersApplied).toEqual({
        status: USER_STATUS.ACTIVE,
        organizationUnitId: 10,
        q: 'an.nguyen',
        sortBy: 'id',
        sortOrder: 'ASC',
      });

      const parsedMatrix = parseXlsxToMatrix(xlsxRes.xlsxBase64);
      const flatText = parsedMatrix.flat().join(' ');
      expect(flatText).toContain('an.nguyen@core.vn');
      expect(flatText).not.toContain('cuong.le@core.vn');

      // 2. Export CSV (.csv) with onlyRequestedFormat=true for large datasets (skips XLSX buffer build)
      const csvRes = await exportService.exportUsersCsv(
        {
          format: 'csv',
          status: USER_STATUS.ACTIVE,
          onlyRequestedFormat: true,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 7, roles: ['staff'], permissions: ['users.export'] },
      );

      expect(csvRes.format).toBe('csv');
      expect(csvRes.totalExported).toBe(2);
      expect(csvRes.csvContent.startsWith('\uFEFF')).toBe(true);
      expect(csvRes.csvContent).toContain('an.nguyen@core.vn');
      expect(csvRes.csvContent).toContain('binh.tran@core.vn');
      expect(csvRes.xlsxBase64).toBe('');
    });

    it('8.3.3 — Supports PDF export via pluggable IPdfExportAdapter (built-in, custom adapter, and disabled state)', async () => {
      const { exportService, exportRegistry } = createExportTestHarness();

      // 1. Built-in minimal PDF adapter produces valid %PDF-1.4 document
      const builtinPdfRes = await exportService.exportUsersCsv(
        {
          format: 'pdf',
          status: USER_STATUS.ACTIVE,
          title: 'BÁO CÁO NHÂN SỰ PDF',
          onlyRequestedFormat: true,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 10, roles: ['admin'], permissions: ['users.export'] },
      );

      expect(builtinPdfRes.format).toBe('pdf');
      expect(builtinPdfRes.contentType).toBe('application/pdf');
      expect(builtinPdfRes.pdfBase64).toBeDefined();
      const rawPdfText = Buffer.from(builtinPdfRes.pdfBase64!, 'base64').toString('utf8');
      expect(rawPdfText.startsWith('%PDF-1.4')).toBe(true);
      expect(rawPdfText).toContain('an.nguyen@core.vn');

      // 2. Register a custom project PDF adapter
      const customAdapter: IPdfExportAdapter = {
        name: 'custom-project-pdf-adapter',
        buildPdfBuffer: (headers, rows, options) =>
          Buffer.from(
            `%PDF-1.4 CUSTOM title=${options?.title ?? ''} cols=${headers.length} rows=${rows.length}`,
            'utf8',
          ),
      };
      exportService.registerPdfAdapter(customAdapter);

      const customPdfRes = await exportService.exportUsersCsv(
        {
          format: 'pdf',
          title: 'Custom Adapter Report',
          onlyRequestedFormat: true,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 10, roles: ['admin'], permissions: ['users.export'] },
      );
      const customDecoded = Buffer.from(customPdfRes.pdfBase64!, 'base64').toString('utf8');
      expect(customDecoded).toContain('%PDF-1.4 CUSTOM title=Custom Adapter Report');
      expect(customDecoded).toContain('rows=3');

      // 3. Clearing PDF adapter throws BadRequestAppException when PDF is requested
      exportRegistry.clearPdfAdapter();
      await expect(
        exportService.exportUsersCsv({
          format: 'pdf',
          sortBy: 'id',
          sortOrder: 'ASC',
        }),
      ).rejects.toThrow(BadRequestAppException);
    });

    it('8.3.4 & 8.3.5 — Runs large exports via Queue (async=true) and sends completion notification with temporary download URL', async () => {
      const { exportService, publishedJobs, dispatchedNotifications } = createExportTestHarness();

      // 1. Enqueue async export so API returns immediately with status=QUEUED
      const queued = await exportService.exportUsersCsv(
        {
          format: 'xlsx',
          status: USER_STATUS.ACTIVE,
          async: true,
          notifyOnComplete: true,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 42, roles: ['staff'], permissions: ['users.export'] },
      );

      expect(queued.status).toBe('QUEUED');
      expect(queued.totalExported).toBe(0);
      expect(queued.historyId).toBeDefined();
      expect(queued.jobId).toBeDefined();
      expect(publishedJobs).toHaveLength(1);
      expect(publishedJobs[0]?.topic).toBe('users.export');
      expect((publishedJobs[0]?.payload as { executeInWorker?: boolean }).executeInWorker).toBe(
        true,
      );

      const progressQueued = exportService.getExportJobProgress(queued.jobId!);
      expect(progressQueued.status).toBe('QUEUED');

      // 2. Worker executes the queued export job
      const completed = await exportService.exportUsersCsv(
        {
          format: 'xlsx',
          status: USER_STATUS.ACTIVE,
          async: false,
          notifyOnComplete: true,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 42, roles: ['staff'], permissions: ['users.export'] },
        {
          skipQueuePublish: true,
          existingHistoryId: queued.historyId,
          jobId: queued.jobId!,
          forceNotify: true,
        },
      );

      expect(completed.status).toBe('COMPLETED');
      expect(completed.totalExported).toBe(2);
      expect(completed.downloadToken).toBeTruthy();
      expect(completed.downloadUrl).toContain(
        `/api/v1/exports/downloads/${completed.downloadToken}`,
      );
      expect(completed.expiresAt).toBeTruthy();
      expect(completed.notifiedAt).toBeTruthy();

      // 3. Notification was dispatched to actor #42 with the temporary downloadUrl
      expect(dispatchedNotifications).toHaveLength(1);
      expect(dispatchedNotifications[0]?.userId).toBe(42);
      expect(dispatchedNotifications[0]?.actionUrl).toBe(completed.downloadUrl);

      // 4. Progress snapshot is 100% COMPLETED with downloadUrl attached
      const progressDone = exportService.getExportJobProgress(queued.jobId!);
      expect(progressDone.status).toBe('COMPLETED');
      expect(progressDone.percent).toBe(100);
      expect(progressDone.downloadUrl).toBe(completed.downloadUrl);
    });

    it('8.3.6 — Limits exported record count based on both dynamic settings and actor permissions/roles', async () => {
      const { exportService, settingRegistry } = createExportTestHarness();

      // Configure default max rows = 1, privileged max rows = 3
      settingRegistry.removeDefinition('users.export.max_rows');
      settingRegistry.registerManifestSetting({
        key: 'users.export.max_rows',
        groupCode: 'users',
        module: 'users',
        name: 'Max rows',
        valueType: 'NUMBER',
        defaultValue: 1,
      });
      settingRegistry.removeDefinition('users.export.privileged_max_rows');
      settingRegistry.registerManifestSetting({
        key: 'users.export.privileged_max_rows',
        groupCode: 'users',
        module: 'users',
        name: 'Privileged max rows',
        valueType: 'NUMBER',
        defaultValue: 3,
      });

      try {
        // 1. Regular staff user is capped at max_rows = 1
        const staffRes = await exportService.exportUsersCsv(
          { format: 'csv', sortBy: 'id', sortOrder: 'ASC' },
          { id: 50, roles: ['staff'], permissions: ['users.export'] },
        );
        expect(staffRes.maxRowsApplied).toBe(1);
        expect(staffRes.totalExported).toBe(1);

        // 2. When enforceStrictLimit=true, requesting limit > maxRowsAllowed throws ForbiddenAppException
        await expect(
          exportService.exportUsersCsv(
            { format: 'csv', limit: 10, enforceStrictLimit: true, sortBy: 'id', sortOrder: 'ASC' },
            { id: 50, roles: ['staff'], permissions: ['users.export'] },
          ),
        ).rejects.toThrow(ForbiddenAppException);

        // 3. Privileged user (with users.export.unlimited permission or admin role) gets privileged_max_rows = 3
        const adminRes = await exportService.exportUsersCsv(
          { format: 'csv', sortBy: 'id', sortOrder: 'ASC' },
          { id: 1, roles: ['admin'], permissions: ['users.export', 'users.export.unlimited'] },
        );
        expect(adminRes.maxRowsApplied).toBe(3);
        expect(adminRes.totalExported).toBe(3);
      } finally {
        settingRegistry.removeDefinition('users.export.max_rows');
        settingRegistry.bootstrapFromManifests();
      }
    });

    it('8.3.7 & 8.3.8 — Records Export History (actor, filters, row count) and automatically expires temporary export files', async () => {
      const { exportService, recordedAuditEvents } = createExportTestHarness();

      const res = await exportService.exportUsersCsv(
        {
          format: 'csv',
          status: USER_STATUS.LOCKED,
          organizationUnitId: 20,
          ttlSeconds: 60,
          sortBy: 'id',
          sortOrder: 'ASC',
        },
        { id: 88, roles: ['staff'], permissions: ['users.export'] },
      );

      expect(res.totalExported).toBe(1);
      expect(res.historyId).toBeDefined();
      expect(res.downloadToken).toBeTruthy();

      // 1. Verify Export History recorded actorId, filters, and totalExported
      const histories = exportService.listExportHistories({ actorId: 88 });
      expect(histories).toHaveLength(1);
      expect(histories[0]?.actorId).toBe(88);
      expect(histories[0]?.totalExported).toBe(1);
      expect(histories[0]?.filters).toEqual({
        status: USER_STATUS.LOCKED,
        organizationUnitId: 20,
        sortBy: 'id',
        sortOrder: 'ASC',
      });

      // Verify Audit Log also recorded filters and row count
      expect(recordedAuditEvents).toHaveLength(1);
      expect(
        (recordedAuditEvents[0]?.afterData as { filters?: Record<string, unknown> }).filters,
      ).toEqual({
        status: USER_STATUS.LOCKED,
        organizationUnitId: 20,
        sortBy: 'id',
        sortOrder: 'ASC',
      });

      // 2. Download temporary export file while still valid
      const downloaded = exportService.downloadTemporaryExport(res.downloadToken!);
      expect(downloaded.fileName).toBe(res.fileName);
      expect(downloaded.csvContent).toContain('cuong.le@core.vn');

      // 3. Simulate time passing beyond expiresAt (now + 120 seconds) -> file auto-expires
      const futureDate = new Date(Date.now() + 120_000);
      expect(() => exportService.downloadTemporaryExport(res.downloadToken!, futureDate)).toThrow(
        NotFoundAppException,
      );

      // History record reflects expired state (isExpired = true, status = EXPIRED)
      const expiredHistory = exportService.getExportHistoryById(res.historyId!);
      expect(expiredHistory.isExpired).toBe(true);
      expect(expiredHistory.status).toBe('EXPIRED');
      expect(expiredHistory.downloadUrl).toBeNull();
    });
  });

  describe('Phase 8 — Section 8.4: Shared Report & Dashboard Engine & UserReportService', () => {
    const createReportTestHarness = (options?: { hasReplica?: boolean }) => {
      const sampleUsers: UserEntity[] = [
        createMockUserEntity({
          id: 1,
          username: 'an.nguyen',
          email: 'an.nguyen@core.vn',
          phone: '0901234567',
          status: USER_STATUS.ACTIVE,
          mfaEnabled: true,
          emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
          lastLoginAt: new Date('2026-02-01T08:00:00.000Z'),
          primaryOrganizationUnitId: 10,
          createdAt: new Date('2026-01-10T00:00:00.000Z'),
        }),
        createMockUserEntity({
          id: 2,
          username: 'binh.tran',
          email: 'binh.tran@core.vn',
          phone: '0912345678',
          status: USER_STATUS.INACTIVE,
          mfaEnabled: false,
          emailVerifiedAt: null,
          lastLoginAt: null,
          primaryOrganizationUnitId: 10,
          createdAt: new Date('2026-02-15T00:00:00.000Z'),
        }),
        createMockUserEntity({
          id: 3,
          username: 'cuong.le',
          email: 'cuong.le@core.vn',
          phone: '0987654321',
          status: USER_STATUS.LOCKED,
          mfaEnabled: false,
          emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
          lastLoginAt: null,
          primaryOrganizationUnitId: 20,
          createdAt: new Date('2026-03-20T00:00:00.000Z'),
        }),
      ];

      let dbQueryCalls = 0;
      const filterUsers = (filter: Record<string, unknown>) => {
        let filtered = [...sampleUsers];
        if (filter['status'] !== undefined) {
          filtered = filtered.filter((u) => u.status === filter['status']);
        }
        if (filter['organizationUnitId'] !== undefined) {
          filtered = filtered.filter(
            (u) => u.primaryOrganizationUnitId === filter['organizationUnitId'],
          );
        }
        if (filter['mfaEnabled'] !== undefined) {
          filtered = filtered.filter((u) => u.mfaEnabled === filter['mfaEnabled']);
        }
        if (typeof filter['fromDate'] === 'string') {
          const fromMs = Date.parse(filter['fromDate']);
          filtered = filtered.filter((u) => u.createdAt.getTime() >= fromMs);
        }
        if (typeof filter['toDate'] === 'string') {
          const toMs = Date.parse(filter['toDate']);
          filtered = filtered.filter((u) => u.createdAt.getTime() <= toMs);
        }
        if (typeof filter['q'] === 'string' && filter['q'].trim().length > 0) {
          const kw = filter['q'].trim().toLowerCase();
          filtered = filtered.filter(
            (u) => u.username.toLowerCase().includes(kw) || u.email.toLowerCase().includes(kw),
          );
        }
        return filtered;
      };

      const userRepository = {
        searchPaginated: async (filter: Record<string, unknown>) => {
          dbQueryCalls++;
          const filtered = filterUsers(filter);
          return { items: filtered, total: filtered.length };
        },
        searchPaginatedReadOnly: async (filter: Record<string, unknown>, preferReplica = true) => {
          dbQueryCalls++;
          const filtered = filterUsers(filter);
          const dataSourceUsed: 'REPLICA' | 'PRIMARY' =
            preferReplica && options?.hasReplica ? 'REPLICA' : 'PRIMARY';
          return { items: filtered, total: filtered.length, dataSourceUsed };
        },
      } as unknown as UserRepository;

      const userProfileRepository = {
        findByUserIds: async (ids: readonly number[]) =>
          ids.map(
            (id) =>
              ({
                userId: Number(id),
                firstName: `User${id}`,
                lastName: 'Test',
                fullName: `Test User${id}`,
              }) as UserProfileEntity,
          ),
      } as unknown as UserProfileRepository;

      const userRoleRepository = {
        findByUserIds: async (ids: readonly number[]) =>
          ids.map((uid) => ({ userId: Number(uid), roleId: 2 })),
      } as unknown as UserRoleRepository;

      const userOrgRepository = {
        findByUserIds: async (ids: readonly number[]) =>
          ids.map((uid) => ({
            userId: Number(uid),
            organizationUnitId: Number(uid) === 3 ? 20 : 10,
            isPrimary: true,
            positionTitle: 'Staff',
          })),
      } as unknown as UserOrganizationUnitRepository;

      const statusHistoryRepo = {
        recordTransition: async () => undefined,
        findByUserId: async () => [],
      } as unknown as UserStatusHistoryRepository;

      const passwordHasher = {
        hash: async (pwd: string) => `hashed:${pwd}`,
        sha256: (val: string) => `sha256:${val}`,
        generateSuggestedPassword: () => 'Suggested#2026',
      } as unknown as PasswordHasherService;

      const rolesPublicService = {
        findByIds: async () => [
          {
            id: 2,
            code: 'analyst',
            name: 'Analyst',
            status: 1,
            dataScope: 1,
            dataScopeName: 'ALL',
            permissions: ['users.report'],
          },
        ],
        findByCodes: async (codes: readonly string[]) =>
          codes.map((c, idx) => ({
            id: idx + 1,
            code: c.toLowerCase(),
            name: c.toUpperCase(),
            status: 1,
            dataScope: 1,
          })),
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const orgsPublicService = {
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id: Number(id),
            code: Number(id) === 20 ? 'OPS' : 'HQ',
            name: Number(id) === 20 ? 'Khối Vận Hành' : 'Khối Công Nghệ',
            type: 1,
            typeName: 'DIVISION',
            status: 1,
          })),
        getSubtreeUnitIds: async (unitId: number) => (unitId === 10 ? [10, 20] : [unitId]),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const usersService = new UsersService(
        userRepository,
        userRoleRepository,
        userOrgRepository,
        new UsersMapper(),
        passwordHasher,
        rolesPublicService,
        orgsPublicService,
        statusHistoryRepo,
        null,
        null,
        null,
        userProfileRepository,
      );

      const exportRegistry = new ExportRegistryService();
      const reportRegistry = new ReportRegistryService(exportRegistry);
      const settingRegistry = new SettingRegistryService();
      settingRegistry.bootstrapFromManifests();

      const publishedMessages: Array<{
        topic: string;
        payload: Record<string, unknown>;
        queueName?: string | undefined;
      }> = [];
      const messagePublisher = {
        publish: async (topic: string, payload: Record<string, unknown>, queueName?: string) => {
          publishedMessages.push({ topic, payload, queueName });
          return {
            id: `msg_rep_${publishedMessages.length}`,
            topic,
            payload,
          };
        },
      } as unknown as BaseMessagePublisherProvider;

      const dispatchedNotifications: Array<Record<string, unknown>> = [];
      const notificationsPublicService = {
        dispatch: async (dto: Record<string, unknown>) => {
          dispatchedNotifications.push(dto);
          return { notificationId: dispatchedNotifications.length, queuedDeliveries: 1 };
        },
      };

      const recordedAuditEvents: Array<Record<string, unknown>> = [];
      const auditLogService = {
        record: async (entry: Record<string, unknown>) => {
          recordedAuditEvents.push(entry);
        },
      };

      const reportService = new UserReportService(
        usersService,
        userRepository,
        reportRegistry,
        exportRegistry,
        settingRegistry,
        messagePublisher,
        auditLogService as never,
        undefined,
        notificationsPublicService as never,
        orgsPublicService,
      );

      return {
        reportService,
        reportRegistry,
        exportRegistry,
        userRepository,
        getDbQueryCalls: () => dbQueryCalls,
        publishedMessages,
        dispatchedNotifications,
        recordedAuditEvents,
      };
    };

    it('8.4.1 & 8.4.3 — Discovers module-declared reports from module.manifest.json and enforces distinct report permission (rejecting list permission users.read)', async () => {
      const { reportService, reportRegistry } = createReportTestHarness();

      // 8.4.1: Reports declared in users/module.manifest.json are registered per module
      const availableReports = reportService.listAvailableReports();
      expect(availableReports.length).toBeGreaterThanOrEqual(2);
      const codes = availableReports.map((r) => r.code);
      expect(codes).toContain('users.summary_dashboard');
      expect(codes).toContain('users.security_compliance');

      const dashboardReport = availableReports.find((r) => r.code === 'users.summary_dashboard')!;
      expect(dashboardReport.module).toBe('users');
      expect(dashboardReport.requiredPermission).toBe('users.report');
      expect(dashboardReport.supportsReadReplica).toBe(true);

      // 8.4.3a: Rejects registering a report that shares normal list permission (`users.read` or `users.list`)
      expect(() =>
        reportRegistry.registerReport({
          code: 'users.invalid_list_perm_report',
          module: 'users',
          name: 'Invalid Report Using List Permission',
          requiredPermission: 'users.read',
        }),
      ).toThrow(BadRequestAppException);

      // 8.4.3b: User who only has normal list permission (`users.read`) is denied access to run reports
      await expect(
        reportService.runReport(
          { reportCode: 'users.summary_dashboard' },
          { id: 15, roles: ['staff'], permissions: ['users.read'] },
        ),
      ).rejects.toThrow(ForbiddenAppException);

      // 8.4.3c: User with dedicated `users.report` permission can execute the report
      const allowedRes = await reportService.runReport(
        { reportCode: 'users.summary_dashboard' },
        { id: 16, roles: ['analyst'], permissions: ['users.report'] },
      );
      expect(allowedRes.status).toBe('COMPLETED');
      expect(allowedRes.requiredPermission).toBe('users.report');
    });

    it('8.4.2 — Configures and normalizes report parameters (date range, status, organization unit + sub-units, and custom filters)', async () => {
      const { reportService } = createReportTestHarness();
      const analyst = { id: 20, roles: ['analyst'], permissions: ['users.report'] };

      // 1. Filter by dateRange + status + organizationUnitId
      const filteredRes = await reportService.runReport(
        {
          reportCode: 'users.summary_dashboard',
          fromDate: '2026-01-01T00:00:00.000Z',
          toDate: '2026-02-28T23:59:59.000Z',
          status: USER_STATUS.ACTIVE,
          organizationUnitId: 10,
          filters: { mfaEnabled: true },
        },
        analyst,
      );

      expect(filteredRes.totalRecords).toBe(1);
      expect(filteredRes.parameters).toEqual({
        fromDate: '2026-01-01T00:00:00.000Z',
        toDate: '2026-02-28T23:59:59.000Z',
        statuses: [USER_STATUS.ACTIVE],
        organizationUnitId: 10,
        includeSubUnits: false,
        filters: { mfaEnabled: true },
      });
      expect(filteredRes.summary['activeCount']).toBe(1);
      expect(filteredRes.summary['mfaEnabledCount']).toBe(1);

      // 2. Include sub-units (unit 10 subtree includes [10, 20])
      const subtreeRes = await reportService.runReport(
        {
          reportCode: 'users.summary_dashboard',
          organizationUnitId: 10,
          includeSubUnits: true,
        },
        analyst,
      );
      expect(subtreeRes.totalRecords).toBe(3);

      // 3. Invalid date range (fromDate > toDate) throws BadRequestAppException
      await expect(
        reportService.runReport(
          {
            reportCode: 'users.summary_dashboard',
            fromDate: '2026-05-01T00:00:00.000Z',
            toDate: '2026-01-01T00:00:00.000Z',
          },
          analyst,
        ),
      ).rejects.toThrow(BadRequestAppException);
    });

    it('8.4.4 — Runs heavy reports via Queue (system.heavy) to avoid loading database during HTTP request', async () => {
      const { reportService, publishedMessages, getDbQueryCalls } = createReportTestHarness();
      const analyst = { id: 25, roles: ['analyst'], permissions: ['users.report'] };

      // `users.security_compliance` has `isHeavy: true` in manifest -> automatically queued to `system.heavy`
      const queuedRes = await reportService.runReport(
        {
          reportCode: 'users.security_compliance',
          organizationUnitId: 10,
          format: 'xlsx',
        },
        analyst,
      );

      expect(queuedRes.status).toBe('QUEUED');
      expect(queuedRes.executionMode).toBe('QUEUE');
      expect(queuedRes.jobId).toBe('msg_rep_1');
      // Verify DB was NOT queried during the HTTP request
      expect(getDbQueryCalls()).toBe(0);
      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]?.topic).toBe('users.report');
      expect(publishedMessages[0]?.queueName).toBe('system.heavy');
      expect(publishedMessages[0]?.payload).toMatchObject({
        operation: 'report',
        executeInWorker: true,
        reportCode: 'users.security_compliance',
        historyId: queuedRes.historyId,
      });

      // When Worker processes the queued job with `skipQueuePublish: true`, it executes the report and updates history
      const workerRes = await reportService.runReport(
        {
          reportCode: 'users.security_compliance',
          organizationUnitId: 10,
          format: 'xlsx',
          async: false,
        },
        analyst,
        {
          skipQueuePublish: true,
          existingHistoryId: queuedRes.historyId,
          jobId: queuedRes.jobId!,
          executionMode: 'QUEUE',
        },
      );

      expect(workerRes.status).toBe('COMPLETED');
      expect(workerRes.totalRecords).toBe(2);
      expect(workerRes.downloadUrl).toContain('/api/v1/reports/downloads/');
      expect(workerRes.expiresAt).toBeTruthy();
    });

    it('8.4.5 & 8.4.6 — Schedules reports (DAILY, WEEKLY, MONTHLY) and delivers via Email or Notification using temporary expiring files', async () => {
      const { reportService, dispatchedNotifications } = createReportTestHarness();
      const manager = {
        id: 30,
        email: 'manager@core.vn',
        roles: ['manager'],
        permissions: ['users.report'],
      };

      // 8.4.5: Create DAILY, WEEKLY, and MONTHLY report schedules
      const dailySchedule = reportService.createReportSchedule(
        {
          reportCode: 'users.summary_dashboard',
          name: 'Báo cáo nhân sự hàng ngày',
          frequency: 'DAILY',
          hour: 8,
          minute: 0,
          format: 'xlsx',
          channels: ['EMAIL', 'IN_APP'],
          recipientEmails: ['hr-director@core.vn'],
          recipientUserIds: [30],
          ttlSeconds: 1800,
          isActive: true,
        },
        manager,
      );
      expect(dailySchedule.frequency).toBe('DAILY');
      expect(dailySchedule.cronExpression).toBe('0 8 * * *');

      const weeklySchedule = reportService.createReportSchedule(
        {
          reportCode: 'users.summary_dashboard',
          name: 'Báo cáo nhân sự hàng tuần',
          frequency: 'WEEKLY',
          hour: 9,
          minute: 30,
          dayOfWeek: 1,
          format: 'pdf',
          channels: ['EMAIL'],
          recipientEmails: ['board@core.vn'],
          recipientUserIds: [30],
          ttlSeconds: 3600,
          isActive: true,
        },
        manager,
      );
      expect(weeklySchedule.frequency).toBe('WEEKLY');
      expect(weeklySchedule.cronExpression).toBe('30 9 * * 1');

      const monthlySchedule = reportService.createReportSchedule(
        {
          reportCode: 'users.security_compliance',
          name: 'Báo cáo tuân thủ bảo mật hàng tháng',
          frequency: 'MONTHLY',
          hour: 7,
          minute: 15,
          dayOfMonth: 1,
          format: 'csv',
          channels: ['IN_APP'],
          recipientEmails: [],
          recipientUserIds: [30],
          ttlSeconds: 3600,
          isActive: true,
        },
        manager,
      );
      expect(monthlySchedule.frequency).toBe('MONTHLY');
      expect(monthlySchedule.cronExpression).toBe('15 7 1 * *');

      expect(reportService.listReportSchedules()).toHaveLength(3);

      // 8.4.5 & 8.4.6: Trigger due schedules at a future timestamp where all 3 are due
      const futureTriggerTime = new Date(Date.now() + 35 * 24 * 3_600_000);
      const triggerRes = await reportService.triggerDueReportSchedules(futureTriggerTime);
      expect(triggerRes.triggeredCount).toBe(3);

      const firstRun = triggerRes.results[0]!;
      expect(firstRun.downloadUrl).toContain('/api/v1/reports/downloads/');
      expect(firstRun.expiresAt).toBeTruthy();
      expect(firstRun.notifiedChannels).toEqual(['EMAIL', 'IN_APP']);

      // Verify notifications were dispatched with temporary downloadUrl & expiresAt
      expect(dispatchedNotifications.length).toBeGreaterThanOrEqual(3);
      expect(dispatchedNotifications[0]?.['actionUrl']).toBe(firstRun.downloadUrl);
      expect(dispatchedNotifications[0]?.['channels']).toEqual(['EMAIL', 'IN_APP']);

      // Verify temporary report file can be downloaded before expiry and auto-expires after TTL
      const history = reportService.getReportHistoryById(firstRun.historyId);
      expect(history.downloadToken).toBeTruthy();
      const downloaded = reportService.downloadTemporaryReport(history.downloadToken!);
      expect(downloaded.fileName).toContain('.xlsx');

      const afterExpiry = new Date(Date.now() + 7_200_000);
      expect(() =>
        reportService.downloadTemporaryReport(history.downloadToken!, afterExpiry),
      ).toThrow(NotFoundAppException);
    });

    it('8.4.7, 8.4.8 & 8.4.9 — Supports Read Replica when available, caches reports by normalized parameters, and records full execution history', async () => {
      // 1. System WITH Read Replica configured -> reads from REPLICA on first run, then CACHE on second run with same parameters
      const replicaHarness = createReportTestHarness({ hasReplica: true });
      const analyst = { id: 42, roles: ['analyst'], permissions: ['users.report'] };

      const firstRun = await replicaHarness.reportService.runReport(
        {
          reportCode: 'users.summary_dashboard',
          status: USER_STATUS.ACTIVE,
          organizationUnitId: 10,
        },
        analyst,
      );

      expect(firstRun.dataSourceUsed).toBe('REPLICA');
      expect(firstRun.cacheHit).toBe(false);
      expect(firstRun.totalRecords).toBe(1);
      expect(replicaHarness.getDbQueryCalls()).toBe(1);

      // 8.4.9: Second run with identical parameters hits report cache -> does NOT query DB again
      const secondRun = await replicaHarness.reportService.runReport(
        {
          reportCode: 'users.summary_dashboard',
          status: USER_STATUS.ACTIVE,
          organizationUnitId: 10,
        },
        analyst,
      );

      expect(secondRun.dataSourceUsed).toBe('CACHE');
      expect(secondRun.cacheHit).toBe(true);
      expect(secondRun.totalRecords).toBe(1);
      expect(secondRun.cacheKey).toBe(firstRun.cacheKey);
      expect(replicaHarness.getDbQueryCalls()).toBe(1); // Still 1 DB query!

      // 2. System WITHOUT Read Replica -> safely falls back to PRIMARY
      const primaryHarness = createReportTestHarness({ hasReplica: false });
      const primaryRun = await primaryHarness.reportService.runReport(
        {
          reportCode: 'users.summary_dashboard',
          status: USER_STATUS.ACTIVE,
        },
        analyst,
      );
      expect(primaryRun.dataSourceUsed).toBe('PRIMARY');

      // 8.4.7: Verify Report Execution History recorded timestamps, actorId, parameters, dataSourceUsed, and summary result
      const histories = replicaHarness.reportService.listReportHistories({ actorId: 42 });
      expect(histories).toHaveLength(2);
      expect(histories[0]?.actorId).toBe(42);
      expect(histories[0]?.status).toBe('COMPLETED');
      expect(histories[0]?.startedAt).toBeTruthy();
      expect(histories[0]?.completedAt).toBeTruthy();
      expect(typeof histories[0]?.durationMs).toBe('number');
      expect(histories[0]?.summary).toMatchObject({
        totalUsers: 1,
        activeCount: 1,
      });
    });
  });

  describe('UserSearchService & SearchRegistryService — Section 8.5 Global Search Engine', () => {
    function createSearchTestHarness() {
      const searchRegistry = new SearchRegistryService();
      const publishedMessages: Array<{ queue: string; envelope: Record<string, unknown> }> = [];

      const messagePublisher = {
        publish: async (queue: string, envelope: Record<string, unknown>) => {
          publishedMessages.push({ queue, envelope });
        },
      } as unknown as BaseMessagePublisherProvider;

      const sampleUsers = [
        {
          id: 1,
          username: 'nguyenvanhai',
          email: 'hai.nguyen@core.vn',
          fullName: 'Nguyễn Văn Hải',
          firstName: 'Hải',
          lastName: 'Nguyễn Văn',
          employeeCode: 'EMP-2026-000101',
          phone: '0901234567',
          status: USER_STATUS.ACTIVE,
          statusName: 'Đang hoạt động',
          gender: USER_GENDER.MALE,
          genderName: 'Nam',
          avatarUrl: null,
          dateOfBirth: null,
          address: null,
          nationalId: null,
          taxCode: null,
          bio: null,
          preferredLanguage: 'vi',
          preferredTimezone: 'Asia/Ho_Chi_Minh',
          emailVerifiedAt: '2026-01-01T00:00:00.000Z',
          phoneVerifiedAt: null,
          mfaEnabled: true,
          lockedUntil: null,
          lockReason: null,
          failedLoginAttempts: 0,
          primaryOrganizationUnitId: 10,
          managerId: null,
          lastLoginAt: '2026-10-20T08:00:00.000Z',
          passwordChangedAt: '2026-01-01T00:00:00.000Z',
          roles: [{ id: 1, code: 'admin', name: 'Administrator' }],
          organizationUnits: [
            { organizationUnitId: 10, code: 'HO', name: 'Khối Công Nghệ', isPrimary: true },
          ],
          createdAt: '2026-01-10T08:00:00.000Z',
          updatedAt: '2026-10-25T10:00:00.000Z',
        },
        {
          id: 2,
          username: 'tranminhanh',
          email: 'anh.tran@core.vn',
          fullName: 'Trần Minh Ánh',
          firstName: 'Ánh',
          lastName: 'Trần Minh',
          employeeCode: 'EMP-2026-000102',
          phone: '0909888777',
          status: USER_STATUS.ACTIVE,
          statusName: 'Đang hoạt động',
          gender: USER_GENDER.FEMALE,
          genderName: 'Nữ',
          avatarUrl: null,
          dateOfBirth: null,
          address: null,
          nationalId: null,
          taxCode: null,
          bio: null,
          preferredLanguage: 'vi',
          preferredTimezone: 'Asia/Ho_Chi_Minh',
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          mfaEnabled: false,
          lockedUntil: null,
          lockReason: null,
          failedLoginAttempts: 0,
          primaryOrganizationUnitId: 20,
          managerId: 1,
          lastLoginAt: null,
          passwordChangedAt: '2026-02-01T00:00:00.000Z',
          roles: [{ id: 2, code: 'staff', name: 'Staff' }],
          organizationUnits: [
            {
              organizationUnitId: 20,
              code: 'BR_SOUTH',
              name: 'Chi nhánh Phía Nam',
              isPrimary: true,
            },
          ],
          createdAt: '2026-02-15T08:00:00.000Z',
          updatedAt: '2026-10-25T12:00:00.000Z',
        },
      ];

      const usersService = {
        findAll: async () => ({
          data: sampleUsers,
          meta: {
            page: 1,
            limit: 500,
            total: sampleUsers.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        }),
      } as unknown as UsersService;

      const organizationsPublic = {
        getDescendantIds: async (orgId: number) => (orgId === 10 ? [10, 20] : [orgId]),
      } as unknown as IOrganizationsPublicService;

      const searchService = new UserSearchService(
        usersService,
        searchRegistry,
        null,
        messagePublisher,
        organizationsPublic,
      );

      return {
        searchService,
        searchRegistry,
        publishedMessages,
      };
    }

    it('8.5.1 & 8.5.2 — Registers searchable entities per module and searches via built-in Database Search Provider without requiring external search engines', async () => {
      const { searchService, searchRegistry } = createSearchTestHarness();

      // 8.5.1: Verify module registered `users.account` searchable entity
      const entities = searchService.listSearchableEntities({ includeAllModules: true });
      const userEntity = entities.find((item) => item.code === 'users.account');
      expect(userEntity).toBeDefined();
      expect(userEntity?.module).toBe('users');
      expect(userEntity?.entityType).toBe('user');
      expect(userEntity?.requiredPermission).toBe('users.read');

      // 8.5.2: Default driver is DATABASE (no Elasticsearch / OpenSearch required)
      expect(searchRegistry.getActiveDriver()).toBe('DATABASE');

      // Search with Vietnamese diacritics-insensitive keyword ("Nguyen Van Hai" matches "Nguyễn Văn Hải")
      const searchRes = await searchService.searchUsers(
        { keyword: 'Nguyen Van Hai' },
        { id: 1, roles: ['admin'], permissions: ['users.read'] },
      );

      expect(searchRes.driverUsed).toBe('DATABASE');
      expect(searchRes.total).toBe(1);
      expect(searchRes.hits[0]?.id).toBe(1);
      expect(searchRes.hits[0]?.title).toBe('Nguyễn Văn Hải');
      expect(searchRes.hits[0]?.score).toBeGreaterThan(0);
    });

    it('8.5.3, 8.5.4 & 8.5.5 — Supports optional Elasticsearch / OpenSearch adapter, syncs index via Queue, and rebuilds full index by module or entityType', async () => {
      const { searchService, searchRegistry, publishedMessages } = createSearchTestHarness();

      // 8.5.3: Plug in an optional OpenSearch client adapter
      const externalIndexedDocs: SearchDocumentRecord[] = [];
      let externalClearCount = 0;

      const mockOpenSearchClient: ExternalSearchEngineClientContract = {
        engine: 'OPENSEARCH',
        indexPrefix: 'enterprise_core',
        isConnected: () => true,
        bulkIndex: async (_indexName, docs) => {
          externalIndexedDocs.push(...docs);
          return { indexedCount: docs.length };
        },
        deleteByQuery: async (_indexName, _filter) => {
          const deletedCount = externalIndexedDocs.length;
          externalIndexedDocs.length = 0;
          externalClearCount += 1;
          return { deletedCount };
        },
        search: async (_indexName, query) => {
          return externalIndexedDocs.filter((doc) =>
            doc.searchableText.toLowerCase().includes(query.keyword.toLowerCase()),
          );
        },
      };

      searchService.registerExternalSearchClient(mockOpenSearchClient);
      expect(searchRegistry.getActiveDriver()).toBe('OPENSEARCH');

      // 8.5.4: Enqueue index sync via Queue (`users.search_sync` on `system.heavy`)
      const queuedSync = await searchService.syncUsersToSearchIndex(
        { userIds: [1, 2], async: true },
        { id: 1, roles: ['admin'], permissions: ['users.update'] },
      );
      expect(queuedSync.status).toBe('QUEUED');
      expect(queuedSync.executionMode).toBe('QUEUE');
      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]?.envelope['topic']).toBe('users.search_sync');

      // 8.5.5: Rebuild entire index by module / entityType (`rebuildSearchIndex`)
      const rebuildHistory = await searchService.rebuildSearchIndex(
        { module: 'users', entityType: 'user', async: false },
        { id: 1, roles: ['admin'], permissions: ['users.update'] },
      );

      expect(rebuildHistory.operation).toBe('REBUILD');
      expect(rebuildHistory.status).toBe('COMPLETED');
      expect(rebuildHistory.driverUsed).toBe('OPENSEARCH');
      expect(rebuildHistory.indexedCount).toBe(2);
      expect(externalClearCount).toBeGreaterThanOrEqual(1);
      expect(externalIndexedDocs).toHaveLength(2);

      // Search using OpenSearch adapter
      const osSearchRes = await searchService.searchUsers(
        { keyword: 'EMP-2026-000102' },
        { id: 1, roles: ['admin'], permissions: ['users.read'] },
      );
      expect(osSearchRes.driverUsed).toBe('OPENSEARCH');
      expect(osSearchRes.total).toBe(1);
      expect(osSearchRes.hits[0]?.id).toBe(2);

      // Unplug external search engine -> falls back to DATABASE
      searchService.registerExternalSearchClient(null);
      expect(searchRegistry.getActiveDriver()).toBe('DATABASE');
    });

    it('8.5.6, 8.5.7 & 8.5.8 — Enforces Permissions & Data Scope (SELF, ORG_UNIT, SUBORDINATES, ALL), tracks Index Lag / stale documents, and records Zero-Result keyword statistics', async () => {
      const { searchService } = createSearchTestHarness();

      // Index documents with controlled timestamps to test Index Lag (8.5.7):
      // sourceUpdatedAt is 10 minutes after indexedAt (> 5 min staleThresholdMs => isStale = true)
      await searchService.syncUsersToSearchIndex({
        sourceUpdatedAtOverride: '2026-10-26T10:10:00.000Z',
        indexedAtOverride: '2026-10-26T10:00:00.000Z',
      });

      // 8.5.6: 1) Actor without `users.read` permission receives 0 results (never leaks unauthorized data)
      const noPermResult = await searchService.searchUsers(
        { keyword: 'core.vn' },
        { id: 2, roles: ['guest'], permissions: ['profile.view'] },
      );
      expect(noPermResult.total).toBe(0);

      // 8.5.6: 2) Actor with SELF Data Scope only sees their own record (id = 2)
      const selfScopeActor = {
        id: 2,
        roles: ['staff'],
        permissions: ['users.read'],
        organizationUnitId: 20,
        dataScopes: [DATA_SCOPE.SELF],
      };
      const selfResult = await searchService.searchUsers({ keyword: 'core.vn' }, selfScopeActor);
      expect(selfResult.total).toBe(1);
      expect(selfResult.hits[0]?.id).toBe(2);

      // 8.5.6: 3) Actor with ORG_UNIT Data Scope in orgUnit 10 only sees users in orgUnit 10 (id = 1)
      const orgScopeActor = {
        id: 1,
        roles: ['manager'],
        permissions: ['users.read'],
        organizationUnitId: 10,
        dataScopes: [DATA_SCOPE.ORG_UNIT],
      };
      const orgResult = await searchService.searchUsers({ keyword: 'core.vn' }, orgScopeActor);
      expect(orgResult.total).toBe(1);
      expect(orgResult.hits[0]?.id).toBe(1);

      // 8.5.6: 4) Actor with SUBORDINATES Data Scope in orgUnit 10 sees both orgUnit 10 and descendant orgUnit 20 (ids 1 & 2)
      const subScopeActor = {
        id: 1,
        roles: ['director'],
        permissions: ['users.read'],
        organizationUnitId: 10,
        dataScopes: [DATA_SCOPE.SUBORDINATES],
      };
      const subResult = await searchService.searchUsers({ keyword: 'core.vn' }, subScopeActor);
      expect(subResult.total).toBe(2);

      // 8.5.7: Verify Index Lag tracking (`indexLagMs = 600_000` > `300_000` => `isStale = true`)
      expect(subResult.staleHitCount).toBe(2);
      expect(subResult.maxIndexLagMs).toBe(600_000);
      expect(subResult.hits[0]?.isStale).toBe(true);

      const lagReport = searchService.getSearchIndexLagReport({ staleOnly: true });
      expect(lagReport.totalIndexedDocuments).toBe(2);
      expect(lagReport.staleDocumentCount).toBe(2);
      expect(lagReport.maxLagMs).toBe(600_000);
      expect(lagReport.items).toHaveLength(2);

      // 8.5.8: Search for non-existent keywords and verify Zero-Result Keyword Statistics
      await searchService.searchUsers(
        { keyword: 'Chuyên gia AI Quantum' },
        { id: 1, roles: ['admin'], permissions: ['users.read'] },
      );
      await searchService.searchUsers(
        { keyword: 'chuyen gia ai quantum' },
        { id: 1, roles: ['admin'], permissions: ['users.read'] },
      );
      await searchService.searchUsers(
        { keyword: 'Kỹ sư Blockchain' },
        { id: 1, roles: ['admin'], permissions: ['users.read'] },
      );

      const zeroStats = searchService.listZeroResultKeywords({ module: 'users' });
      const topZero = zeroStats.find((item) => item.normalizedKeyword === 'chuyen gia ai quantum');
      expect(topZero).toBeDefined();
      expect(topZero?.searchCount).toBe(2);
      expect(topZero?.sampleKeyword).toBe('Chuyên gia AI Quantum');
      expect(topZero?.modules).toContain('users');
      expect(topZero?.lastActorId).toBe(1);
    });

    it('8.5.5 (Multi-Page Rebuild) — Loads all user pages (> 500 users) when rebuilding Search Index without 500-item truncation', async () => {
      const searchRegistry = new SearchRegistryService();
      const totalUsers = 620;
      const allMockUsers = Array.from({ length: totalUsers }, (_, idx) => ({
        id: idx + 1,
        username: `user_${idx + 1}`,
        email: `user_${idx + 1}@core.vn`,
        fullName: `Nhân sự Thứ ${idx + 1}`,
        firstName: `${idx + 1}`,
        lastName: 'Nhân sự',
        phone: null,
        avatarUrl: null,
        profile: {
          firstName: `${idx + 1}`,
          lastName: 'Nhân sự',
          fullName: `Nhân sự Thứ ${idx + 1}`,
          avatarUrl: null,
          dateOfBirth: null,
          gender: null,
          identityNumber: null,
          address: null,
          city: null,
          country: null,
          bio: null,
        },
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE' as const,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        lockedUntil: null,
        lockReason: null,
        failedLoginAttempts: 0,
        mfaEnabled: false,
        primaryOrganizationUnitId: 10,
        roles: [{ roleId: 1, code: 'staff', name: 'Staff' }],
        organizationUnits: [
          {
            organizationUnitId: 10,
            code: 'HO',
            name: 'Hội sở',
            isPrimary: true,
            positionTitle: null,
          },
        ],
        lastLoginAt: null,
        passwordChangedAt: null,
        archivedAt: null,
        isArchived: false,
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }));

      const pagesRequested: number[] = [];
      const paginatedUsersService = {
        listPaginated: async (query: { page?: number; limit?: number }) => {
          const page = query.page ?? 1;
          const limit = query.limit ?? 500;
          pagesRequested.push(page);
          const offset = (page - 1) * limit;
          const slice = allMockUsers.slice(offset, offset + limit);
          return {
            data: slice,
            meta: {
              page,
              limit,
              total: totalUsers,
              totalPages: Math.ceil(totalUsers / limit),
              hasNextPage: offset + slice.length < totalUsers,
              hasPreviousPage: page > 1,
            },
          };
        },
      } as unknown as UsersService;

      const multiPageSearchService = new UserSearchService(
        paginatedUsersService,
        searchRegistry,
        null,
        null,
        null,
      );

      const rebuildHistory = await multiPageSearchService.rebuildSearchIndex({
        module: 'users',
        entityType: 'user',
        async: false,
      });

      expect(pagesRequested).toEqual([1, 2]);
      expect(rebuildHistory.status).toBe('COMPLETED');
      expect(rebuildHistory.indexedCount).toBe(620);
      expect(searchRegistry.getIndexedDocumentCount({ module: 'users' })).toBe(620);
    });
  });

  describe('Phase 9 — Section 9.2: Thành viên, chức vụ và người quản lý (9.2.1 – 9.2.7)', () => {
    it('9.2.1, 9.2.2, 9.2.3 & 9.2.6 — Assigns multiple units with start/end dates, positionTitle independent of roles, and records membership transfer history (ASSIGN, UPDATE, TRANSFER, END)', async () => {
      const usersStore = new Map<number, UserEntity>();
      const profilesStore = new Map<number, UserProfileEntity>();
      const orgsLinksStore = new Map<
        number,
        Array<{
          userId: number;
          organizationUnitId: number;
          isPrimary: boolean;
          positionTitle: string | null;
          startDate: Date | null;
          endDate: Date | null;
        }>
      >();
      const orgHistoriesStore: Array<{
        id: number;
        userId: number;
        organizationUnitId: number;
        fromOrganizationUnitId: number | null;
        actionType: 'ASSIGN' | 'UPDATE' | 'TRANSFER' | 'END';
        isPrimary: boolean;
        positionTitle: string | null;
        startDate: Date | null;
        endDate: Date | null;
        reason: string | null;
        changedBy: number | null;
        createdAt: Date;
      }> = [];
      let nextUserId = 1;
      let nextHistId = 1;

      const mockUserRepo = {
        findByIdWithArchived: async (id: number) => usersStore.get(Number(id)) ?? null,
        findByUsername: async () => null,
        findByEmail: async () => null,
        findByPhoneHash: async () => null,
        saveEntity: async (data: Partial<UserEntity>) => {
          const id = data.id ? Number(data.id) : nextUserId++;
          const existing = usersStore.get(id);
          const saved = createMockUserEntity({
            ...existing,
            ...data,
            id,
            username: data.username ?? existing?.username ?? `user_${id}`,
            email: data.email ?? existing?.email ?? `user_${id}@example.com`,
          });
          usersStore.set(id, saved);
          return saved;
        },
      } as unknown as UserRepository;

      const mockProfileRepo = {
        upsertByUserId: async (userId: number, data: Partial<UserProfileEntity>) => {
          const record = {
            id: Number(userId),
            userId: Number(userId),
            firstName: data.firstName ?? 'Hải',
            lastName: data.lastName ?? 'Nguyễn',
            fullName: data.fullName ?? 'Nguyễn Hải',
            avatarUrl: null,
            dateOfBirth: null,
            gender: null,
            identityNumber: null,
            address: null,
            city: null,
            country: null,
            bio: null,
            preferredLocale: 'vi',
            preferredTimezone: 'Asia/Ho_Chi_Minh',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as UserProfileEntity;
          profilesStore.set(Number(userId), record);
          return record;
        },
        findByUserIds: async (userIds: readonly number[]) =>
          userIds
            .map((id) => profilesStore.get(Number(id)))
            .filter((p): p is UserProfileEntity => Boolean(p)),
      } as unknown as UserProfileRepository;

      const mockUserRoleRepo = {
        findByUserIds: async () => [],
        replaceUserRoles: async () => undefined,
      } as unknown as UserRoleRepository;

      const mockUserOrgRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.flatMap((uid) => orgsLinksStore.get(Number(uid)) ?? []),
        replaceUserOrganizations: async (
          userId: number,
          items: ReadonlyArray<{
            organizationUnitId: number;
            isPrimary?: boolean;
            positionTitle?: string | null;
            startDate?: Date | string | null;
            endDate?: Date | string | null;
          }>,
        ) => {
          const normalized = items.map((item, idx) => ({
            userId: Number(userId),
            organizationUnitId: Number(item.organizationUnitId),
            isPrimary: item.isPrimary ?? idx === 0,
            positionTitle: item.positionTitle ?? null,
            startDate: item.startDate ? new Date(item.startDate) : new Date('2026-01-01T00:00:00Z'),
            endDate: item.endDate ? new Date(item.endDate) : null,
          }));
          orgsLinksStore.set(Number(userId), normalized);
          return normalized;
        },
      } as unknown as UserOrganizationUnitRepository;

      const mockOrgHistoryRepo = {
        recordHistories: async (entries: ReadonlyArray<Record<string, unknown>>) => {
          for (const entry of entries) {
            orgHistoriesStore.push({
              id: nextHistId++,
              userId: Number(entry.userId),
              organizationUnitId: Number(entry.organizationUnitId),
              fromOrganizationUnitId:
                entry.fromOrganizationUnitId !== null && entry.fromOrganizationUnitId !== undefined
                  ? Number(entry.fromOrganizationUnitId)
                  : null,
              actionType: entry.actionType as 'ASSIGN' | 'UPDATE' | 'TRANSFER' | 'END',
              isPrimary: Boolean(entry.isPrimary),
              positionTitle: (entry.positionTitle as string | null) ?? null,
              startDate: (entry.startDate as Date | null) ?? null,
              endDate: (entry.endDate as Date | null) ?? null,
              reason: (entry.reason as string | null) ?? null,
              changedBy: (entry.changedBy as number | null) ?? null,
              createdAt: new Date(),
            });
          }
          return [];
        },
        findByUserId: async (userId: number) =>
          orgHistoriesStore.filter((h) => h.userId === Number(userId)),
      } as unknown as UserOrganizationHistoryRepository;

      const mockStatusHistoryRepo = {
        recordTransition: async () => undefined,
        findByUserId: async () => [],
      } as unknown as UserStatusHistoryRepository;

      const mockPasswordHasher = {
        hash: async (pwd: string) => `hashed:${pwd}`,
        sha256: (val: string) => `sha256:${val}`,
      } as unknown as PasswordHasherService;

      const mockRolesService = {
        ensureActiveRolesExist: async () => undefined,
        findByIds: async () => [],
        findByCodes: async () => [],
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const mockOrgsService = {
        ensureActiveUnitsExist: async () => undefined,
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({
            id,
            code: `UNIT_${id}`,
            name: `Đơn vị ${id}`,
            type: 20,
            typeName: 'DEPARTMENT',
            status: 1,
          })),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const service = new UsersService(
        mockUserRepo,
        mockUserRoleRepo,
        mockUserOrgRepo,
        new UsersMapper(),
        mockPasswordHasher,
        mockRolesService,
        mockOrgsService,
        mockStatusHistoryRepo,
        null,
        null,
        null,
        mockProfileRepo,
        null,
        null,
        null,
        mockOrgHistoryRepo,
      );

      // Rejects invalid membership period (startDate > endDate)
      await expect(
        service.create({
          username: 'invalid.period',
          email: 'invalid.period@core.vn',
          fullName: 'Invalid Period User',
          password: 'Password@123',
          status: USER_STATUS.ACTIVE,
          roleIds: [],
          organizationUnits: [
            {
              organizationUnitId: 10,
              isPrimary: true,
              positionTitle: 'Trưởng phòng',
              startDate: '2026-12-31',
              endDate: '2026-01-01',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestAppException);

      // 1. Create user with 2 units (1 primary, 1 secondary) and start/end dates
      const user = await service.create(
        {
          username: 'member.transfer',
          email: 'member.transfer@core.vn',
          fullName: 'Trần Minh Quân',
          password: 'Password@123',
          status: USER_STATUS.ACTIVE,
          roleIds: [],
          organizationUnits: [
            {
              organizationUnitId: 10,
              isPrimary: true,
              positionTitle: 'Trưởng nhóm',
              startDate: '2026-01-01',
              endDate: null,
            },
            {
              organizationUnitId: 20,
              isPrimary: false,
              positionTitle: 'Chuyên viên',
              startDate: '2026-02-01',
              endDate: '2026-12-31',
            },
          ],
        },
        1,
      );

      expect(user.primaryOrganizationUnitId).toBe(10);
      expect(user.organizationUnits).toHaveLength(2);
      expect(user.organizationUnits[0]?.positionTitle).toBe('Trưởng nhóm');
      expect(user.organizationUnits[0]?.startDate).toContain('2026-01-01');
      expect(user.organizationUnits[1]?.endDate).toContain('2026-12-31');

      // 2. Transfer user from primary unit 10 to new primary unit 30, while updating unit 20
      const transferred = await service.assignOrganizations(
        user.id,
        {
          organizationUnits: [
            {
              organizationUnitId: 30,
              isPrimary: true,
              positionTitle: 'Trưởng phòng',
              startDate: '2026-06-01',
              endDate: null,
            },
            {
              organizationUnitId: 20,
              isPrimary: false,
              positionTitle: 'Trưởng nhóm',
              startDate: '2026-02-01',
              endDate: '2026-12-31',
            },
          ],
          reason: 'Quyết định điều chuyển sang Đơn vị 30',
        },
        1,
      );

      expect(transferred.primaryOrganizationUnitId).toBe(30);
      const history = await service.getOrganizationHistory(user.id);
      // Initial 2 ASSIGN + 1 TRANSFER (10 -> 30) + 1 UPDATE (20 position changed) + 1 END (unit 10 ended)
      expect(
        history.some(
          (h) =>
            h.actionType === 'TRANSFER' &&
            h.fromOrganizationUnitId === 10 &&
            h.organizationUnitId === 30,
        ),
      ).toBe(true);
      expect(history.some((h) => h.actionType === 'END' && h.organizationUnitId === 10)).toBe(true);
      expect(
        history.some(
          (h) =>
            h.actionType === 'UPDATE' &&
            h.organizationUnitId === 20 &&
            h.positionTitle === 'Trưởng nhóm',
        ),
      ).toBe(true);
    });

    it('9.2.4, 9.2.5 & 9.2.7 — Supports direct & temporary manager with expiration, subordinates lookup (DIRECT, TEMPORARY, INDIRECT), DataScope SUBORDINATES, and Approval Chain', async () => {
      const now = Date.now();
      const futureIso = new Date(now + 7 * 86400_000).toISOString();
      const pastIso = new Date(now - 7 * 86400_000).toISOString();

      // Hierarchy:
      // User #1 (Director)
      //   └── Direct manager of User #2 (Dept Head)
      //   └── Active Temporary manager of User #4 (Specialist, whose direct manager is #5)
      // User #2 (Dept Head)
      //   └── Direct manager of User #3 (Team Lead)
      const usersStore = new Map<number, UserEntity>([
        [
          1,
          createMockUserEntity({
            id: 1,
            username: 'director',
            email: 'director@core.vn',
            primaryOrganizationUnitId: 10,
          }),
        ],
        [
          2,
          createMockUserEntity({
            id: 2,
            username: 'dept.head',
            email: 'dept.head@core.vn',
            primaryOrganizationUnitId: 20,
            managerId: 1,
          }),
        ],
        [
          3,
          createMockUserEntity({
            id: 3,
            username: 'team.lead',
            email: 'team.lead@core.vn',
            primaryOrganizationUnitId: 20,
            managerId: 2,
          }),
        ],
        [
          4,
          createMockUserEntity({
            id: 4,
            username: 'specialist.temp',
            email: 'specialist.temp@core.vn',
            primaryOrganizationUnitId: 30,
            managerId: 5,
            temporaryManagerId: 1,
            temporaryManagerFrom: new Date(pastIso),
            temporaryManagerUntil: new Date(futureIso),
          }),
        ],
        [
          5,
          createMockUserEntity({
            id: 5,
            username: 'other.mgr',
            email: 'other.mgr@core.vn',
            primaryOrganizationUnitId: 30,
          }),
        ],
      ]);

      const mockUserRepo = {
        findByIdWithArchived: async (id: number) => usersStore.get(Number(id)) ?? null,
        findSubordinateRelations: async (
          managerId: number,
          options?: { directOnly?: boolean; includeTemporary?: boolean },
        ) => {
          const directOnly = options?.directOnly ?? false;
          const includeTemporary = options?.includeTemporary ?? true;
          const visited = new Set<number>([Number(managerId)]);
          const results: Array<{
            userId: number;
            relationType: 'DIRECT' | 'TEMPORARY' | 'INDIRECT';
            level: number;
          }> = [];
          let frontier = [Number(managerId)];
          let level = 1;

          while (frontier.length > 0 && level <= 5) {
            const nextFrontier: number[] = [];
            for (const u of usersStore.values()) {
              if (visited.has(u.id)) continue;
              const isDirect = u.managerId !== null && frontier.includes(Number(u.managerId));
              const isTemp =
                includeTemporary &&
                u.temporaryManagerId !== null &&
                frontier.includes(Number(u.temporaryManagerId)) &&
                Boolean(u.temporaryManagerUntil && u.temporaryManagerUntil.getTime() >= Date.now());
              if (!isDirect && !isTemp) continue;
              visited.add(u.id);
              nextFrontier.push(u.id);
              results.push({
                userId: u.id,
                relationType: level === 1 ? (isDirect ? 'DIRECT' : 'TEMPORARY') : 'INDIRECT',
                level,
              });
            }
            if (directOnly) break;
            frontier = nextFrontier;
            level += 1;
          }
          return results;
        },
        findSubordinateUserIds: async (
          managerId: number,
          options?: { directOnly?: boolean; includeTemporary?: boolean },
        ) => {
          const rels = await mockUserRepo.findSubordinateRelations(managerId, options);
          return rels.map((r) => r.userId);
        },
        saveEntity: async (u: UserEntity) => {
          usersStore.set(u.id, u);
          return u;
        },
      } as unknown as UserRepository;

      const mockProfileRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.map(
            (id) =>
              ({
                id,
                userId: id,
                firstName: `U${id}`,
                lastName: 'User',
                fullName: `User #${id}`,
              }) as UserProfileEntity,
          ),
      } as unknown as UserProfileRepository;

      const mockUserRoleRepo = {
        findByUserIds: async () => [],
      } as unknown as UserRoleRepository;

      const mockUserOrgRepo = {
        findByUserIds: async (userIds: readonly number[]) =>
          userIds.map((uid) => ({
            userId: uid,
            organizationUnitId: usersStore.get(uid)?.primaryOrganizationUnitId ?? 10,
            isPrimary: true,
            positionTitle: uid === 1 ? 'Giám đốc' : uid === 2 ? 'Trưởng phòng' : 'Chuyên viên',
            startDate: new Date('2026-01-01T00:00:00Z'),
            endDate: null,
          })),
      } as unknown as UserOrganizationUnitRepository;

      const mockPasswordHasher = {
        sha256: (v: string) => `sha_${v}`,
      } as unknown as PasswordHasherService;

      const mockRolesService = {
        findByIds: async () => [],
        findByCodes: async () => [
          { id: 2, code: 'manager', status: 1, dataScope: DATA_SCOPE.SUBORDINATES },
        ],
        registerRoleUserCountDelegate: () => undefined,
        registerRoleUsersListDelegate: () => undefined,
      } as unknown as IRolesPublicService;

      const mockOrgsService = {
        findByIds: async (ids: readonly number[]) =>
          ids.map((id) => ({ id, code: `U_${id}`, name: `Đơn vị ${id}`, type: 20, status: 1 })),
        registerUnitUsageCountDelegate: () => undefined,
      } as unknown as IOrganizationsPublicService;

      const service = new UsersService(
        mockUserRepo,
        mockUserRoleRepo,
        mockUserOrgRepo,
        new UsersMapper(),
        mockPasswordHasher,
        mockRolesService,
        mockOrgsService,
        null,
        null,
        null,
        null,
        mockProfileRepo,
      );

      // 1. Subordinates overview for User #1 includes #2 (DIRECT), #4 (TEMPORARY), and #3 (INDIRECT)
      const overview = await service.getSubordinatesOverview(1);
      expect(overview.directCount).toBe(1);
      expect(overview.temporaryCount).toBe(1);
      expect(overview.indirectCount).toBe(1);
      expect(overview.totalSubordinates).toBe(3);
      expect(overview.subordinates.map((s) => `${s.id}:${s.relationType}:${s.level}`)).toEqual([
        '2:DIRECT:1',
        '4:TEMPORARY:1',
        '3:INDIRECT:2',
      ]);

      // 2. Approval chain for User #4 uses active Temporary Manager (#1) instead of #5
      const chainFor4 = await service.resolveApproverChain(4);
      expect(chainFor4).toHaveLength(1);
      expect(chainFor4[0]?.userId).toBe(1);
      expect(chainFor4[0]?.sourceType).toBe('TEMPORARY_MANAGER');

      // 3. Approval chain for User #3 goes #2 (Step 1) -> #1 (Step 2)
      const chainFor3 = await service.resolveApproverChain(3);
      expect(chainFor3.map((a) => `${a.step}:${a.userId}:${a.sourceType}`)).toEqual([
        '1:2:DIRECT_MANAGER',
        '2:1:DIRECT_MANAGER',
      ]);

      // 4. DataScope SUBORDINATES for User #1 allows access to temporary subordinate #4
      const user4Resp = await service.getById(4);
      expect(user4Resp.effectiveManagerId).toBe(1);
      await expect(
        service.assertCanAccessUserRecord(user4Resp, {
          id: 1,
          username: 'director',
          roles: ['manager'],
          permissions: ['users.read'],
          dataScope: DATA_SCOPE.SUBORDINATES,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
