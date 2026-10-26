import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import { organizationsApi } from '../services/organizations.api';
import { ORG_UNIT_TYPE_OPTIONS, type OrgViewMode } from '../enum/organizations.enum';
import type {
  BulkImportOrganizationsPayload,
  BulkImportOrganizationsResult,
  CreateOrganizationUnitPayload,
  OrganizationManagerOption,
  OrganizationMoveImpact,
  OrganizationStats,
  OrganizationTreeNode,
  OrganizationTypeOption,
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

function triggerDownloadExportFile(file: {
  fileName: string;
  format: 'csv' | 'xlsx';
  csvContent: string;
  xlsxBase64: string;
}) {
  if (file.format === 'xlsx' && file.xlsxBase64) {
    const binary = atob(file.xlsxBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    const blob = new Blob([file.csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export function useOrganizationsManagement() {
  const [viewMode, setViewMode] = useState<OrgViewMode>('split');
  const [units, setUnits] = useState<OrganizationUnitItem[]>([]);
  const [treeNodes, setTreeNodes] = useState<OrganizationTreeNode[]>([]);
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [unitTypeOptions, setUnitTypeOptions] = useState<readonly OrganizationTypeOption[]>(
    ORG_UNIT_TYPE_OPTIONS,
  );
  const [managerOptions, setManagerOptions] = useState<readonly OrganizationManagerOption[]>([]);
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
  const [moveImpactPreview, setMoveImpactPreview] = useState<OrganizationMoveImpact | null>(null);

  // Import / Export Modal
  const [showImportExportModal, setShowImportExportModal] = useState<boolean>(false);
  const [submittingImportExport, setSubmittingImportExport] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<BulkImportOrganizationsResult | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setStatusBanner({ type, text });
  }, []);

  const loadOrganizationsData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, treeRes, statsRes, dynamicTypesRes, usersRes] = await Promise.all([
        organizationsApi.list().catch(() => []),
        organizationsApi.getTree().catch(() => null),
        organizationsApi.getStats().catch(() => null),
        fetchApi<
          Array<{
            numericCode: number;
            code: string;
            label?: string;
            name?: string;
            status?: number;
          }>
        >(API_ROUTES.CODES.VALUES('organizations.unit_type')).catch(() => null),
        fetchApi<
          | Array<{ id: number; username: string; fullName?: string; email?: string | null }>
          | {
              data?: Array<{
                id: number;
                username: string;
                fullName?: string;
                email?: string | null;
              }>;
            }
        >(API_ROUTES.USERS.LIST('limit=100')).catch(() => null),
      ]);

      if (Array.isArray(dynamicTypesRes) && dynamicTypesRes.length > 0) {
        const mappedTypes: OrganizationTypeOption[] = dynamicTypesRes
          .filter((v) => v.status === undefined || v.status === 1)
          .map((v) => ({
            code: Number(v.numericCode),
            key: v.code,
            label: `${v.label ?? v.name ?? v.code} (${v.code})`,
          }));
        if (mappedTypes.length > 0) {
          setUnitTypeOptions(mappedTypes);
        }
      }

      const rawUsers = Array.isArray(usersRes)
        ? usersRes
        : usersRes && Array.isArray(usersRes.data)
          ? usersRes.data
          : [];
      if (rawUsers.length > 0) {
        setManagerOptions(
          rawUsers.map((u) => ({
            id: Number(u.id),
            username: u.username,
            fullName: u.fullName || u.username,
            email: u.email ?? null,
          })),
        );
      }

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
        if (
          !u.code.toLowerCase().includes(q) &&
          !u.name.toLowerCase().includes(q) &&
          !(u.managerName ?? '').toLowerCase().includes(q)
        ) {
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
    setMoveImpactPreview(null);
  }, []);

  const handleOpenCreateChild = useCallback((parentUnit: OrganizationUnitItem | null) => {
    setSelectedUnitId(parentUnit?.id ?? null);
    setPresetParentId(parentUnit?.id ?? null);
    setFormMode('create');
    setMoveImpactPreview(null);
  }, []);

  const handleAssessMoveImpact = useCallback(
    async (unitId: number, newParentId: number | null) => {
      try {
        const impact = await organizationsApi.assessMoveImpact(unitId, newParentId);
        setMoveImpactPreview(impact);
        return impact;
      } catch (err) {
        setMoveImpactPreview(null);
        notify('err', err instanceof Error ? err.message : 'Lỗi kiểm tra ảnh hưởng di chuyển đơn vị');
        return null;
      }
    },
    [notify],
  );

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
        setMoveImpactPreview(null);
        await loadOrganizationsData();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Lỗi cập nhật đơn vị tổ chức');
      }
    },
    [loadOrganizationsData, notify],
  );

  const handleLockUnit = useCallback(
    async (id: number, reason?: string) => {
      try {
        const locked = await organizationsApi.lockUnit(id, reason);
        notify(
          'ok',
          `Đã khóa đơn vị ${locked.code} — ${locked.name} (không cho dùng mới nhưng giữ nguyên lịch sử).`,
        );
        await loadOrganizationsData();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể khóa đơn vị');
      }
    },
    [loadOrganizationsData, notify],
  );

  const handleUnlockUnit = useCallback(
    async (id: number, reason?: string) => {
      try {
        const unlocked = await organizationsApi.unlockUnit(id, reason);
        notify('ok', `Đã mở khóa đơn vị ${unlocked.code} — ${unlocked.name}.`);
        await loadOrganizationsData();
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Không thể mở khóa đơn vị');
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

  const handleExportUnits = useCallback(
    async (format: 'csv' | 'xlsx', mode: 'tree' | 'list') => {
      setSubmittingImportExport(true);
      try {
        const res = await organizationsApi.exportUnits({
          format,
          mode,
          search: searchQuery.trim() || undefined,
          type: typeFilter || undefined,
          status: statusFilter || undefined,
          parentId: parentFilter && parentFilter !== 'ROOT' ? parentFilter : undefined,
        });
        triggerDownloadExportFile(res);
        notify(
          'ok',
          `Đã xuất ${res.totalExported} đơn vị tổ chức ở chế độ ${res.mode === 'tree' ? 'Sơ đồ cây' : 'Danh sách'} (${res.fileName}).`,
        );
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Xuất dữ liệu tổ chức thất bại');
      } finally {
        setSubmittingImportExport(false);
      }
    },
    [notify, parentFilter, searchQuery, statusFilter, typeFilter],
  );

  const handleDownloadTemplate = useCallback(
    async (format: 'csv' | 'xlsx') => {
      setSubmittingImportExport(true);
      try {
        const res = await organizationsApi.downloadImportTemplate(format);
        triggerDownloadExportFile(res);
        notify('ok', `Đã tải file mẫu ${res.fileName}.`);
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Tải file mẫu thất bại');
      } finally {
        setSubmittingImportExport(false);
      }
    },
    [notify],
  );

  const handleBulkImportUnits = useCallback(
    async (payload: BulkImportOrganizationsPayload) => {
      setSubmittingImportExport(true);
      try {
        const res = await organizationsApi.bulkImportUnits(payload);
        setImportResult(res);
        notify(
          res.failedCount > 0 ? 'err' : 'ok',
          `Đã nhập ${res.importedCount} mới, cập nhật ${res.updatedCount} / ${res.totalRows} dòng (Bỏ qua: ${res.skippedCount}, Lỗi: ${res.failedCount}).`,
        );
        await loadOrganizationsData();
        return res;
      } catch (err) {
        notify('err', err instanceof Error ? err.message : 'Nhập cây tổ chức thất bại');
        return null;
      } finally {
        setSubmittingImportExport(false);
      }
    },
    [loadOrganizationsData, notify],
  );

  return {
    viewMode,
    setViewMode,
    units,
    filteredUnits,
    treeNodes,
    stats,
    unitTypeOptions,
    managerOptions,
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
    moveImpactPreview,
    setMoveImpactPreview,
    showImportExportModal,
    setShowImportExportModal,
    submittingImportExport,
    importResult,
    setImportResult,
    loadOrganizationsData,
    handleSelectUnitForEdit,
    handleOpenCreateChild,
    handleAssessMoveImpact,
    handleCreateUnit,
    handleUpdateUnit,
    handleLockUnit,
    handleUnlockUnit,
    handleDeleteUnit,
    handleExportUnits,
    handleDownloadTemplate,
    handleBulkImportUnits,
  };
}
