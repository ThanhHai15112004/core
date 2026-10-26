import {
  buildOrganizationTree,
  calculateAncestorCount,
  calculateSubtreeDepthBelow,
  collectDescendantUnitIds,
  computeOrganizationStats,
  ensureHierarchyDepthAllowed,
  ORG_UNIT_STATUS,
  ORG_UNIT_TYPE,
  OrganizationsMapper,
  OrganizationsService,
  type OrganizationUnitResponse,
} from '../../../src/modules/organizations/index.js';
import type { OrganizationUnitEntity } from '../../../src/modules/organizations/entities/organization-unit.entity.js';

describe('Organizations Module Unit Tests (Section 9.1)', () => {
  const sampleUnits: OrganizationUnitResponse[] = [
    {
      id: 1,
      code: 'HQ_VN',
      name: 'Trụ sở chính Việt Nam',
      type: ORG_UNIT_TYPE.HEADQUARTERS,
      typeName: 'HEADQUARTERS',
      parentId: null,
      managerId: 1,
      managerName: 'Nguyễn Thái Sơn',
      status: ORG_UNIT_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      description: 'Trụ sở trung tâm',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      code: 'BRANCH_HCM',
      name: 'Chi nhánh TP.HCM',
      type: ORG_UNIT_TYPE.BRANCH,
      typeName: 'BRANCH',
      parentId: 1,
      managerId: 9,
      managerName: 'Đỗ Khánh Linh',
      status: ORG_UNIT_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      description: 'Chi nhánh phía Nam',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 3,
      code: 'DEPT_ENG',
      name: 'Khối Kỹ thuật',
      type: ORG_UNIT_TYPE.DEPARTMENT,
      typeName: 'DEPARTMENT',
      parentId: 2,
      managerId: 10,
      managerName: 'Ngô Quang Huy',
      status: ORG_UNIT_STATUS.ACTIVE,
      statusName: 'ACTIVE',
      description: 'Phòng kỹ thuật',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 4,
      code: 'TEAM_CORE',
      name: 'Nhóm Core Platform',
      type: ORG_UNIT_TYPE.TEAM,
      typeName: 'TEAM',
      parentId: 3,
      managerId: null,
      managerName: null,
      status: ORG_UNIT_STATUS.INACTIVE,
      statusName: 'INACTIVE',
      description: 'Đội phát triển lõi',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  describe('organization-hierarchy.helper', () => {
    it('calculates ancestor count, subtree depth, and enforces max hierarchy depth', () => {
      expect(calculateAncestorCount(sampleUnits, 1)).toBe(1);
      expect(calculateAncestorCount(sampleUnits, 3)).toBe(3);
      expect(calculateSubtreeDepthBelow(sampleUnits, 1)).toBe(3);
      expect(calculateSubtreeDepthBelow(sampleUnits, 4)).toBe(0);

      expect(() =>
        ensureHierarchyDepthAllowed({
          allUnits: sampleUnits,
          parentId: 3,
          subtreeDepthBelowNode: 0,
          maxDepth: 3,
        }),
      ).toThrow();
    });

    it('collects descendant unit IDs respecting includeInactive flag', () => {
      expect(collectDescendantUnitIds(sampleUnits, [2], true)).toEqual([2, 3, 4]);
      expect(collectDescendantUnitIds(sampleUnits, [2], false)).toEqual([2, 3]);
    });

    it('builds hierarchical tree with depth, path, childrenCount, and descendantCount', () => {
      const tree = buildOrganizationTree(sampleUnits);
      expect(tree).toHaveLength(1);
      const root = tree[0]!;
      expect(root.code).toBe('HQ_VN');
      expect(root.depth).toBe(1);
      expect(root.path).toBe('/HQ_VN');
      expect(root.childrenCount).toBe(1);
      expect(root.descendantCount).toBe(3);
      expect(root.children[0]?.children[0]?.path).toBe('/HQ_VN/BRANCH_HCM/DEPT_ENG');
    });

    it('computes accurate organization statistics', () => {
      const stats = computeOrganizationStats(sampleUnits, 10);
      expect(stats.totalUnits).toBe(4);
      expect(stats.activeUnits).toBe(3);
      expect(stats.inactiveUnits).toBe(1);
      expect(stats.rootUnits).toBe(1);
      expect(stats.maxDepthObserved).toBe(4);
      expect(stats.byType).toEqual({
        headquarters: 1,
        branch: 1,
        department: 1,
        team: 1,
        custom: 0,
      });
    });
  });

  describe('OrganizationsService', () => {
    const createInMemoryService = () => {
      const store = new Map<number, OrganizationUnitEntity>();
      const now = new Date('2026-01-01T00:00:00.000Z');
      for (const u of sampleUnits) {
        store.set(u.id, {
          id: u.id,
          code: u.code,
          name: u.name,
          type: u.type,
          parentId: u.parentId,
          managerId: u.managerId,
          status: u.status,
          description: u.description,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as OrganizationUnitEntity);
      }

      const mockRepo = {
        findFiltered: async (q: { parentId?: number; managerId?: number; status?: number }) => {
          let all = [...store.values()].filter((x) => !x.deletedAt);
          if (q?.parentId !== undefined) {
            all = all.filter((x) => x.parentId === q.parentId);
          }
          if (q?.managerId !== undefined) {
            all = all.filter((x) => x.managerId === q.managerId);
          }
          if (q?.status !== undefined) {
            all = all.filter((x) => x.status === q.status);
          }
          return all;
        },
        findById: async (id: number) => store.get(Number(id)) ?? null,
        findByCode: async (code: string) =>
          [...store.values()].find((x) => !x.deletedAt && x.code === code.toUpperCase()) ?? null,
        findByIds: async (ids: readonly number[]) =>
          [...store.values()].filter((x) => !x.deletedAt && ids.includes(Number(x.id))),
        findByCodes: async (codes: readonly string[]) =>
          [...store.values()].filter((x) => !x.deletedAt && codes.includes(x.code)),
        saveEntity: async (data: Partial<OrganizationUnitEntity>) => {
          const id = data.id ? Number(data.id) : store.size + 1;
          const entity = {
            id,
            code: data.code ?? `UNIT_${id}`,
            name: data.name ?? `Unit ${id}`,
            type: data.type ?? 2,
            parentId: data.parentId ?? null,
            managerId: data.managerId ?? null,
            status: data.status ?? 1,
            description: data.description ?? null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          } as OrganizationUnitEntity;
          store.set(id, entity);
          return entity;
        },
        repository: {
          softDelete: async (id: number) => {
            const found = store.get(Number(id));
            if (found) found.deletedAt = new Date();
          },
        },
      };

      const service = new OrganizationsService(
        mockRepo as unknown as ConstructorParameters<typeof OrganizationsService>[0],
        new OrganizationsMapper(),
      );
      service.registerUnitManagerResolverDelegate(async ({ userIds, identifiers }) => {
        const users = [
          {
            id: 1,
            username: 'superadmin',
            fullName: 'Nguyễn Thái Sơn',
            email: 'superadmin@gmail.com',
            status: 1,
          },
          {
            id: 9,
            username: 'director_hcm',
            fullName: 'Đỗ Khánh Linh',
            email: 'director.hcm@gmail.com',
            status: 1,
          },
          {
            id: 10,
            username: 'manager_eng',
            fullName: 'Ngô Quang Huy',
            email: 'manager.eng@gmail.com',
            status: 1,
          },
        ];
        return users.filter(
          (u) =>
            (userIds && userIds.includes(u.id)) ||
            (identifiers &&
              identifiers.some(
                (ident) =>
                  ident.toLowerCase() === u.username.toLowerCase() ||
                  ident.toLowerCase() === u.email.toLowerCase(),
              )),
        );
      });
      return { service, store };
    };

    it('returns tree, stats, and hydrated manager names from service', async () => {
      const { service } = createInMemoryService();
      const tree = await service.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0]?.descendantCount).toBe(3);
      expect(tree[0]?.managerName).toBe('Nguyễn Thái Sơn');

      const stats = await service.getStats();
      expect(stats.totalUnits).toBe(4);
    });

    it('updates unit code, name, status, and managerId while preventing duplicate codes', async () => {
      const { service } = createInMemoryService();

      const updated = await service.update(3, {
        code: 'dept_engineering_hcm',
        name: 'Khối Kỹ thuật TP.HCM',
        managerId: 9,
      });
      expect(updated.code).toBe('DEPT_ENGINEERING_HCM');
      expect(updated.name).toBe('Khối Kỹ thuật TP.HCM');
      expect(updated.managerId).toBe(9);
      expect(updated.managerName).toBe('Đỗ Khánh Linh');

      // Duplicate code with unit #1 (HQ_VN) must be rejected
      await expect(service.update(3, { code: 'HQ_VN' })).rejects.toThrow();

      // Non-existent managerId must be rejected
      await expect(service.update(3, { managerId: 999 })).rejects.toThrow();
    });

    it('assesses move impact and moves unit in hierarchy while blocking circular or locked parents', async () => {
      const { service } = createInMemoryService();
      service.registerUnitUsageCountDelegate(async (unitId) => (unitId === 3 ? 5 : 2));

      // Moving #3 (DEPT_ENG, which has child #4 TEAM_CORE) directly under #1 (HQ_VN)
      const impact = await service.assessMoveImpact(3, 1);
      expect(impact.oldPath).toBe('/HQ_VN/BRANCH_HCM/DEPT_ENG');
      expect(impact.newPath).toBe('/HQ_VN/DEPT_ENG');
      expect(impact.oldDepth).toBe(3);
      expect(impact.newDepth).toBe(2);
      expect(impact.affectedUnitIds).toEqual([3, 4]);
      expect(impact.affectedUserCount).toBe(7);
      expect(impact.requiresPermissionScopeRefresh).toBe(true);

      const moved = await service.moveUnit(3, { newParentId: 1, reason: 'Restructure under HQ' });
      expect(moved.unit.parentId).toBe(1);
      expect(moved.impact.newPath).toBe('/HQ_VN/DEPT_ENG');
    });

    it('locks and unlocks unit and prevents adding/moving children under a locked unit', async () => {
      const { service } = createInMemoryService();

      // Unit #4 is INACTIVE (locked): cannot create a child under #4
      await expect(
        service.create({
          code: 'SUB_TEAM_1',
          name: 'Tổ con 1',
          parentId: 4,
        }),
      ).rejects.toThrow();

      // Lock unit #2 (BRANCH_HCM)
      const locked = await service.lockUnit(2, { reason: 'Temporary branch suspension' });
      expect(locked.status).toBe(ORG_UNIT_STATUS.INACTIVE);

      // Cannot move #3 under locked unit #2
      await expect(service.moveUnit(3, { newParentId: 2 })).rejects.toThrow();

      // Unlock unit #2 -> now moving #3 under #2 succeeds
      const unlocked = await service.unlockUnit(2);
      expect(unlocked.status).toBe(ORG_UNIT_STATUS.ACTIVE);
    });

    it('imports organization tree from CSV with topological parent sorting, duplicate check, and cycle detection', async () => {
      const { service } = createInMemoryService();

      // Note: Child DEPT_AI_DN appears BEFORE its parent BRANCH_DANANG in CSV!
      const csvContent = [
        'Mã đơn vị,Tên đơn vị,Loại đơn vị,Mã đơn vị cấp trên,Người phụ trách,Trạng thái,Mô tả',
        'DEPT_AI_DN,Phòng AI Đà Nẵng,DEPARTMENT,BRANCH_DANANG,manager_eng,ACTIVE,Phòng AI',
        'BRANCH_DANANG,Chi nhánh Đà Nẵng,BRANCH,HQ_VN,director_hcm,ACTIVE,Chi nhánh Miền Trung',
        'HQ_VN,Trụ sở trùng mã,HEADQUARTERS,,,ACTIVE,Bỏ qua dòng trùng',
        'ORPHAN_UNIT,Đơn vị cha không tồn tại,DEPARTMENT,UNKNOWN_PARENT,,ACTIVE,Lỗi cha',
        'CYCLE_A,Đơn vị vòng lặp A,DEPARTMENT,CYCLE_B,,ACTIVE,Vòng lặp',
        'CYCLE_B,Đơn vị vòng lặp B,DEPARTMENT,CYCLE_A,,ACTIVE,Vòng lặp',
      ].join('\n');

      const importRes = await service.bulkImportUnits({
        csvContent,
        skipDuplicates: true,
        updateExisting: false,
      });

      expect(importRes.totalRows).toBe(6);
      expect(importRes.importedCount).toBe(2);
      expect(importRes.importedCodes).toEqual(['BRANCH_DANANG', 'DEPT_AI_DN']);
      expect(importRes.skippedCount).toBe(1); // HQ_VN skipped
      expect(importRes.failedCount).toBe(3); // ORPHAN_UNIT, CYCLE_A, CYCLE_B
    });

    it('exports organization units in both tree and list modes (CSV and XLSX)', async () => {
      const { service } = createInMemoryService();

      const treeExport = await service.exportUnits({ format: 'xlsx', mode: 'tree' });
      expect(treeExport.mode).toBe('tree');
      expect(treeExport.format).toBe('xlsx');
      expect(treeExport.totalExported).toBe(4);
      expect(treeExport.csvContent).toContain('└── Nhóm Core Platform (TEAM_CORE)');
      expect(treeExport.xlsxBase64.length).toBeGreaterThan(100);

      const listExport = await service.exportUnits({ format: 'csv', mode: 'list' });
      expect(listExport.mode).toBe('list');
      expect(listExport.format).toBe('csv');
      expect(listExport.totalExported).toBe(4);

      const template = service.exportImportTemplate('xlsx');
      expect(template.fileName).toBe('mau_import_cay_to_chuc.xlsx');
      expect(template.totalExported).toBe(4);
    });

    it('prevents circular parent hierarchy on update and blocks deletion when children or users exist', async () => {
      const { service } = createInMemoryService();

      // Cannot set parent of #1 (HQ_VN) to its own descendant #3 (DEPT_ENG)
      await expect(service.update(1, { parentId: 3 })).rejects.toThrow();

      // Cannot delete #1 because it has active child #2
      await expect(service.remove(1)).rejects.toThrow();

      // Register user usage count delegate and block deleting leaf #4 when users are assigned
      service.registerUnitUsageCountDelegate(async (unitId) => (unitId === 4 ? 2 : 0));
      await expect(service.remove(4)).rejects.toThrow();

      // When 0 users are assigned to leaf #4, soft-delete succeeds
      service.registerUnitUsageCountDelegate(async () => 0);
      const removed = await service.remove(4);
      expect(removed).toEqual({ deleted: true, id: 4 });
    });
  });
});
