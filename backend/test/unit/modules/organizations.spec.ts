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

describe('Organizations Module Unit Tests', () => {
  const sampleUnits: OrganizationUnitResponse[] = [
    {
      id: 1,
      code: 'HQ_VN',
      name: 'Trụ sở chính Việt Nam',
      type: ORG_UNIT_TYPE.HEADQUARTERS,
      typeName: 'HEADQUARTERS',
      parentId: null,
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
          status: u.status,
          description: u.description,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      const mockRepo = {
        findFiltered: async (q: { parentId?: number }) => {
          const all = [...store.values()].filter((x) => !x.deletedAt);
          if (q?.parentId !== undefined) {
            return all.filter((x) => x.parentId === q.parentId);
          }
          return all;
        },
        findById: async (id: number) => store.get(Number(id)) ?? null,
        findByCode: async (code: string) =>
          [...store.values()].find((x) => x.code === code.toUpperCase()) ?? null,
        findByIds: async (ids: readonly number[]) =>
          [...store.values()].filter((x) => ids.includes(Number(x.id))),
        findByCodes: async (codes: readonly string[]) =>
          [...store.values()].filter((x) => codes.includes(x.code)),
        saveEntity: async (data: Partial<OrganizationUnitEntity>) => {
          const id = data.id ? Number(data.id) : store.size + 1;
          const entity: OrganizationUnitEntity = {
            id,
            code: data.code ?? `UNIT_${id}`,
            name: data.name ?? `Unit ${id}`,
            type: data.type ?? 2,
            parentId: data.parentId ?? null,
            status: data.status ?? 1,
            description: data.description ?? null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
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
      return { service, store };
    };

    it('returns tree and stats from service', async () => {
      const { service } = createInMemoryService();
      const tree = await service.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0]?.descendantCount).toBe(3);

      const stats = await service.getStats();
      expect(stats.totalUnits).toBe(4);
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
