import { useState, useEffect, useCallback, useMemo } from 'react';
import { organizationsApi } from '../services/organizations.api';
import type { OrgViewMode } from '../enum/organizations.enum';
import type {
  CreateOrganizationUnitPayload,
  OrganizationStats,
  OrganizationTreeNode,
  OrganizationUnitItem,
  UpdateOrganizationUnitPayload,
} from '../types/organizations.types';

function buildClientSideTree(units: readonly OrganizationUnitItem[]): OrganizationTreeNode[] {
  const unitById = new Map<number, OrganizationUnitItem>();
  const childrenMap = new Map<number | null, OrganizationUnitItem[]>();
  for (const u of units) unitById.set(u.id, u);
  for (const u of units) {
    const parentId =
      u.parentId !== null && unitById.has(u.parentId) && u.parentId !== u.id ? u.parentId : null;
    const list = childrenMap.get(parentId) ?? [];
    list.push(u);
    childrenMap.set(parentId, list);
  }
  const visited = new Set<number>();
  const buildNode = (
    unit: OrganizationUnitItem,
    depth: number,
    ancestorsPath: string,
  ): OrganizationTreeNode => {
    visited.add(unit.id);
    const path = `${ancestorsPath}/${unit.code}`;
    const rawChildren = childrenMap.get(unit.id) ?? [];
    const children: OrganizationTreeNode[] = [];
    let descendantCount = 0;
    for (const child of rawChildren) {
      if (visited.has(child.id)) continue;
      const built = buildNode(child, depth + 1, path);
      children.push(built);
      descendantCount += 1 + built.descendantCount;
    }
    return {
      ...unit,
      depth,
      path,
      childrenCount: children.length,
      descendantCount,
      children,
    };
  };
  return (childrenMap.get(null) ?? []).map((r) => buildNode(r, 1, ''));
}

export function useOrganizationsManagement() {
  const [viewMode, setViewMode] = useState<OrgViewMode>('split');
  const [units, setUnits] = useState<OrganizationUnitItem[]>([]);
  const [treeNodes, setTreeNodes] = useState<OrganizationTreeNode[]>([]);
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [parentFilter, setParentFilter] = useState<string>('');

  // Inspector selection & mode
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [presetParentId, setPresetParentId] = useState<number | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
  }, []);

  const loadOrganizationsData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, treeRes, statsRes] = await Promise.all([
        organizationsApi.list().catch(() => []),
        organizationsApi.getTree().catch(() => null),
        organizationsApi.getStats().catch(() => null),
      ]);

      const safeList = Array.isArray(listRes) ? listRes : [];
      setUnits(safeList);
      setTreeNodes(
        Array.isArray(treeRes) && treeRes.length > 0 ? treeRes : buildClientSideTree(safeList),
      );
      if (statsRes) {
        setStats(statsRes);
      } else {
        const builtTree = buildClientSideTree(safeList);
        setStats({
          totalUnits: safeList.length,
          activeUnits: safeList.filter((u) => u.status === 1).length,
          inactiveUnits: safeList.filter((u) => u.status === 2).length,
          archivedUnits: safeList.filter((u) => u.status === 3).length,
          rootUnits: builtTree.length,
          maxDepthObserved: safeList.length > 0 ? 3 : 0,
          maxDepthAllowed: 10,
          byType: {
            headquarters: safeList.filter((u) => u.type === 1).length,
            branch: safeList.filter((u) => u.type === 2).length,
            department: safeList.filter((u) => u.type === 3).length,
            team: safeList.filter((u) => u.type === 4).length,
            custom: safeList.filter((u) => u.type > 4).length,
          },
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganizationsData();
  }, [loadOrganizationsData]);

  const filteredUnits = useMemo(() => {
    return units.filter((u) => {
      if (typeFilter && String(u.type) !== typeFilter) return false;
      if (statusFilter && String(u.status) !== statusFilter) return false;
      if (parentFilter) {
        if (parentFilter === 'ROOT' && u.parentId !== null) return false;
        if (parentFilter !== 'ROOT' && String(u.parentId ?? '') !== parentFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!u.code.toLowerCase().includes(q) && !u.name.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [units, typeFilter, statusFilter, parentFilter, searchQuery]);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId],
  );

  const handleSelectUnitForEdit = useCallback((unit: OrganizationUnitItem) => {
    setSelectedUnitId(unit.id);
    setFormMode('edit');
  }, []);

  const handleOpenCreateChild = useCallback((parentUnit: OrganizationUnitItem | null) => {
    setSelectedUnitId(parentUnit?.id ?? null);
    setPresetParentId(parentUnit?.id ?? null);
    setFormMode('create');
  }, []);

  const handleCreateUnit = useCallback(
    async (payload: CreateOrganizationUnitPayload) => {
      try {
        const created = await organizationsApi.create(payload);
        notify('ok', `Đã tạo đơn vị ${created.code} — ${created.name} (#${created.id}).`);
        await loadOrganizationsData();
        setSelectedUnitId(created.id);
        setFormMode('edit');
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi tạo đơn vị tổ chức');
      }
    },
    [loadOrganizationsData, notify],
  );

  const handleUpdateUnit = useCallback(
    async (id: number, payload: UpdateOrganizationUnitPayload) => {
      try {
        const updated = await organizationsApi.update(id, payload);
        notify('ok', `Đã cập nhật đơn vị ${updated.code} — ${updated.name}.`);
        await loadOrganizationsData();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi cập nhật đơn vị tổ chức');
      }
    },
    [loadOrganizationsData, notify],
  );

  const handleDeleteUnit = useCallback(
    async (id: number) => {
      try {
        await organizationsApi.remove(id);
        notify('ok', `Đã xóa mềm đơn vị #${id} thành công.`);
        if (selectedUnitId === id) {
          setSelectedUnitId(null);
          setFormMode('create');
        }
        await loadOrganizationsData();
      } catch (err) {
        notify(
          'err',
          err instanceof Error
            ? err.message
            : 'Không thể xóa đơn vị (có thể đang còn đơn vị con hoặc nhân sự trực thuộc)',
        );
      }
    },
    [loadOrganizationsData, notify, selectedUnitId],
  );

  return {
    viewMode,
    setViewMode,
    units,
    filteredUnits,
    treeNodes,
    stats,
    loading,
    statusBanner,
    setStatusBanner,
    notify,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    parentFilter,
    setParentFilter,
    selectedUnit,
    selectedUnitId,
    formMode,
    setFormMode,
    presetParentId,
    setPresetParentId,
    loadOrganizationsData,
    handleSelectUnitForEdit,
    handleOpenCreateChild,
    handleCreateUnit,
    handleUpdateUnit,
    handleDeleteUnit,
  };
}

