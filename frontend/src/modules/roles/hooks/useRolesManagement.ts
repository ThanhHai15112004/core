import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DATA_SCOPE,
  type DataScopeCode,
  ROLES_TAB,
  ROLE_STATUS,
  type RoleStatusCode,
  type RolesTabId,
} from '../enum/roles.enum';
import { rolesApi } from '../services/roles.api';
import type {
  AuditLogItem,
  CloneRolePayload,
  CreateRolePayload,
  CustomScopeRuleItem,
  EffectiveDataScopeOverview,
  OrphanedPermissionWarning,
  PermissionFunctionalGroup,
  RegisterCustomScopeRulePayload,
  RoleAssignedUser,
  RoleItem,
  RolePermissionMatrix,
  SecurityAlertItem,
  SecurityEventItem,
  SyncPermissionsResult,
  UpdateRolePayload,
} from '../types/roles.types';

export function useRolesManagement() {
  const [activeTab, setActiveTab] = useState<RolesTabId>(ROLES_TAB.DIRECTORY);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Roles directory state
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<RoleStatusCode | ''>('');
  const [scopeFilter, setScopeFilter] = useState<DataScopeCode | ''>('');
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<RoleAssignedUser[]>([]);
  const [loadingAssignedUsers, setLoadingAssignedUsers] = useState<boolean>(false);

  // Permissions & Matrix state
  const [permissionGroups, setPermissionGroups] = useState<PermissionFunctionalGroup[]>([]);
  const [matrix, setMatrix] = useState<RolePermissionMatrix | null>(null);
  const [orphans, setOrphans] = useState<OrphanedPermissionWarning[]>([]);
  const [lastSyncResult, setLastSyncResult] = useState<SyncPermissionsResult | null>(null);

  // Data scope state
  const [effectiveScope, setEffectiveScope] = useState<EffectiveDataScopeOverview | null>(null);
  const [customRules, setCustomRules] = useState<CustomScopeRuleItem[]>([]);

  // Audit logs & Security telemetry state
  const [auditLogs, setAuditLogs] = useState<readonly AuditLogItem[]>([]);
  const [auditMeta, setAuditMeta] = useState<{
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  }>({ page: 1, limit: 20, totalItems: 0, totalPages: 1 });
  const [auditFilter, setAuditFilter] = useState<{
    page: number;
    q: string;
    module: string;
    action: string;
  }>({ page: 1, q: '', module: '', action: '' });
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogItem | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventItem[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlertItem[]>([]);

  const showSuccess = useCallback((message: string) => {
    setBanner({ type: 'success', message });
  }, []);

  const showError = useCallback((err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : fallback;
    setBanner({ type: 'error', message: msg || fallback });
  }, []);

  const loadCoreData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, groupedRes, matrixRes, orphansRes, scopeRes, rulesRes] =
        await Promise.allSettled([
          rolesApi.listRoles(),
          rolesApi.listPermissionsGrouped(),
          rolesApi.getPermissionMatrix(),
          rolesApi.listOrphanedPermissions(),
          rolesApi.getMyEffectiveDataScope(),
          rolesApi.listCustomScopeRules(),
        ]);

      if (rolesRes.status === 'fulfilled') {
        const list = Array.isArray(rolesRes.value) ? rolesRes.value : [];
        setRoles(list);
        setSelectedRoleId((prev) => {
          if (prev && list.some((r) => r.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      }
      if (groupedRes.status === 'fulfilled' && Array.isArray(groupedRes.value)) {
        setPermissionGroups(groupedRes.value);
      }
      if (matrixRes.status === 'fulfilled' && matrixRes.value) {
        setMatrix(matrixRes.value);
      }
      if (orphansRes.status === 'fulfilled' && Array.isArray(orphansRes.value)) {
        setOrphans(orphansRes.value);
      }
      if (scopeRes.status === 'fulfilled' && scopeRes.value) {
        setEffectiveScope(scopeRes.value);
      }
      if (rulesRes.status === 'fulfilled' && Array.isArray(rulesRes.value)) {
        setCustomRules(rulesRes.value);
      }
    } catch (err) {
      showError(err, 'Không thể tải dữ liệu quản lý Vai trò & Phân quyền.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadAuditAndSecurityData = useCallback(
    async (overrideFilter?: Partial<typeof auditFilter>) => {
      const merged = { ...auditFilter, ...overrideFilter };
      try {
        const [auditRes, eventsRes, alertsRes] = await Promise.allSettled([
          rolesApi.listAuditLogs({
            page: merged.page,
            limit: 15,
            ...(merged.q.trim() ? { q: merged.q.trim() } : {}),
            ...(merged.module.trim() ? { module: merged.module.trim() } : {}),
            ...(merged.action.trim() ? { action: merged.action.trim() } : {}),
          }),
          rolesApi.listSecurityEvents({ limit: 50 }),
          rolesApi.listSecurityAlerts({ limit: 50 }),
        ]);

        if (auditRes.status === 'fulfilled' && auditRes.value) {
          const payload = auditRes.value;
          const items: readonly AuditLogItem[] = Array.isArray(payload.data) ? payload.data : [];
          setAuditLogs(items);
          if (payload.meta) {
            setAuditMeta(payload.meta);
          }
          setSelectedAuditLog((prev) => {
            if (prev && items.some((a: AuditLogItem) => a.id === prev.id)) return prev;
            return items[0] ?? null;
          });
        }
        if (eventsRes.status === 'fulfilled' && Array.isArray(eventsRes.value)) {
          setSecurityEvents(eventsRes.value);
        }
        if (alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value)) {
          setSecurityAlerts(alertsRes.value);
        }
      } catch (err) {
        showError(err, 'Không thể tải nhật ký kiểm toán & sự kiện bảo mật.');
      }
    },
    [auditFilter, showError],
  );

  useEffect(() => {
    void loadCoreData();
    void loadAuditAndSecurityData();
  }, [loadCoreData, loadAuditAndSecurityData]);

  // Load assigned users when selectedRoleId changes
  useEffect(() => {
    if (!selectedRoleId) {
      setAssignedUsers([]);
      return;
    }
    let cancelled = false;
    setLoadingAssignedUsers(true);
    rolesApi
      .listAssignedUsers(selectedRoleId)
      .then((users: RoleAssignedUser[]) => {
        if (!cancelled) {
          setAssignedUsers(Array.isArray(users) ? users : []);
        }
      })
      .catch(() => {
        if (!cancelled) setAssignedUsers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAssignedUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoleId]);

  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return roles.filter((role) => {
      if (statusFilter !== '' && role.status !== statusFilter) return false;
      if (scopeFilter !== '' && role.dataScope !== scopeFilter) return false;
      if (!q) return true;
      return (
        role.code.toLowerCase().includes(q) ||
        role.name.toLowerCase().includes(q) ||
        (role.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [roles, searchQuery, statusFilter, scopeFilter]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const stats = useMemo(() => {
    const totalRoles = roles.length;
    const systemRoles = roles.filter((r) => r.isSystem).length;
    const customRoles = totalRoles - systemRoles;
    const activeRoles = roles.filter((r) => r.status === ROLE_STATUS.ACTIVE).length;
    const totalPermissions =
      matrix?.summary.totalPermissions ??
      permissionGroups.reduce((acc, g) => acc + g.totalPermissions, 0);
    const orphanedCount = orphans.length;
    const allScopeRoles = roles.filter((r) => r.dataScope === DATA_SCOPE.ALL).length;
    return {
      totalRoles,
      systemRoles,
      customRoles,
      activeRoles,
      totalPermissions,
      orphanedCount,
      allScopeRoles,
      securityAlertsCount: securityAlerts.length,
    };
  }, [roles, matrix, permissionGroups, orphans, securityAlerts]);

  const handleCreateRole = useCallback(
    async (payload: CreateRolePayload): Promise<boolean> => {
      setSubmitting(true);
      try {
        const created = await rolesApi.createRole(payload);
        await loadCoreData();
        if (created?.id) {
          setSelectedRoleId(created.id);
        }
        showSuccess(`Đã tạo vai trò '${payload.code}' thành công.`);
        return true;
      } catch (err) {
        showError(err, 'Không thể tạo vai trò mới.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadCoreData, showError, showSuccess],
  );

  const handleUpdateRole = useCallback(
    async (id: number, payload: UpdateRolePayload): Promise<boolean> => {
      setSubmitting(true);
      try {
        await rolesApi.updateRole(id, payload);
        await loadCoreData();
        showSuccess('Đã cập nhật vai trò & quyền hạn thành công.');
        return true;
      } catch (err) {
        showError(err, 'Không thể cập nhật vai trò.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadCoreData, showError, showSuccess],
  );

  const handleCloneRole = useCallback(
    async (sourceId: number, payload: CloneRolePayload): Promise<boolean> => {
      setSubmitting(true);
      try {
        const cloned = await rolesApi.cloneRole(sourceId, payload);
        await loadCoreData();
        if (cloned?.id) {
          setSelectedRoleId(cloned.id);
        }
        showSuccess(`Đã sao chép sang vai trò mới '${payload.code}' thành công.`);
        return true;
      } catch (err) {
        showError(err, 'Không thể sao chép vai trò.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadCoreData, showError, showSuccess],
  );

  const handleDeleteRole = useCallback(
    async (role: RoleItem): Promise<boolean> => {
      setSubmitting(true);
      try {
        await rolesApi.deleteRole(role.id);
        await loadCoreData();
        showSuccess(`Đã xóa vai trò '${role.code}'.`);
        return true;
      } catch (err) {
        showError(err, `Không thể xóa vai trò '${role.code}'.`);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadCoreData, showError, showSuccess],
  );

  const handleSetRolePermissions = useCallback(
    async (roleId: number, permissions: readonly string[]): Promise<boolean> => {
      setSubmitting(true);
      try {
        await rolesApi.setRolePermissions(roleId, permissions);
        await loadCoreData();
        showSuccess('Đã lưu danh sách quyền hạn cho vai trò.');
        return true;
      } catch (err) {
        showError(err, 'Không thể cập nhật danh sách quyền hạn.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadCoreData, showError, showSuccess],
  );

  const handleSyncPermissions = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await rolesApi.syncPermissions();
      setLastSyncResult(res);
      await loadCoreData();
      showSuccess(
        `Đồng bộ Manifest hoàn tất: ${res.totalDeclared} quyền công bố (+${res.createdCount} mới, ${res.updatedCount} cập nhật, ${res.orphanedCount} mồ côi).`,
      );
    } catch (err) {
      showError(err, 'Không thể đồng bộ danh mục quyền từ module manifests.');
    } finally {
      setSubmitting(false);
    }
  }, [loadCoreData, showError, showSuccess]);

  const handleRegisterCustomScopeRule = useCallback(
    async (payload: RegisterCustomScopeRulePayload): Promise<boolean> => {
      setSubmitting(true);
      try {
        await rolesApi.registerCustomScopeRule(payload);
        const [scopeRes, rulesRes] = await Promise.all([
          rolesApi.getMyEffectiveDataScope(),
          rolesApi.listCustomScopeRules(),
        ]);
        setEffectiveScope(scopeRes);
        setCustomRules(Array.isArray(rulesRes) ? rulesRes : []);
        showSuccess(`Đã đăng ký rule phạm vi dữ liệu '${payload.code}'.`);
        return true;
      } catch (err) {
        showError(err, 'Không thể đăng ký rule phạm vi dữ liệu.');
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [showError, showSuccess],
  );

  const handleApplyAuditFilter = useCallback(
    async (next: Partial<typeof auditFilter>) => {
      const updated = { ...auditFilter, ...next };
      setAuditFilter(updated);
      await loadAuditAndSecurityData(updated);
    },
    [auditFilter, loadAuditAndSecurityData],
  );

  return {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    roles,
    filteredRoles,
    selectedRole,
    selectedRoleId,
    setSelectedRoleId,
    assignedUsers,
    loadingAssignedUsers,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter: (val: RoleStatusCode | '') => setStatusFilter(val),
    scopeFilter,
    setScopeFilter: (val: DataScopeCode | '') => setScopeFilter(val),
    permissionGroups,
    matrix,
    orphans,
    lastSyncResult,
    effectiveScope,
    customRules,
    auditLogs,
    auditMeta,
    auditFilter,
    selectedAuditLog,
    setSelectedAuditLog,
    securityEvents,
    securityAlerts,
    stats,
    refreshAll: async () => {
      await Promise.all([loadCoreData(), loadAuditAndSecurityData()]);
    },
    handleCreateRole,
    handleUpdateRole,
    handleCloneRole,
    handleDeleteRole,
    handleSetRolePermissions,
    handleSyncPermissions,
    handleRegisterCustomScopeRule,
    handleApplyAuditFilter,
  };
}
