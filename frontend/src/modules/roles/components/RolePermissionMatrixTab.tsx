import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Grid,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type {
  OrphanedPermissionWarning,
  RolePermissionMatrix,
  SyncPermissionsResult,
} from '../types/roles.types';

interface RolePermissionMatrixTabProps {
  matrix: RolePermissionMatrix | null;
  orphans: readonly OrphanedPermissionWarning[];
  lastSyncResult: SyncPermissionsResult | null;
  submitting: boolean;
  onSyncPermissions: () => Promise<void>;
  onSaveRolePermissions: (roleId: number, permissions: readonly string[]) => Promise<boolean>;
}

export const RolePermissionMatrixTab: React.FC<RolePermissionMatrixTabProps> = ({
  matrix,
  orphans,
  lastSyncResult,
  submitting,
  onSyncPermissions,
  onSaveRolePermissions,
}) => {
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyOrphans, setOnlyOrphans] = useState<boolean>(false);

  // Local overrides map: roleId -> Set<permissionCode>
  const [dirtyRoleMap, setDirtyRoleMap] = useState<Record<number, Set<string>>>({});

  const getRolePermSet = (roleId: number, roleCode: string): Set<string> => {
    if (dirtyRoleMap[roleId]) {
      return dirtyRoleMap[roleId]!;
    }
    const granted = new Set<string>();
    if (matrix) {
      for (const row of matrix.rows) {
        if (row.roleGrants[roleCode]) {
          granted.add(row.code);
        }
      }
    }
    return granted;
  };

  const toggleMatrixCell = (roleId: number, roleCode: string, permCode: string) => {
    const current = new Set(getRolePermSet(roleId, roleCode));
    if (current.has(permCode)) {
      current.delete(permCode);
    } else {
      current.add(permCode);
    }
    setDirtyRoleMap((prev) => ({
      ...prev,
      [roleId]: current,
    }));
  };

  const saveSingleRoleColumn = async (roleId: number) => {
    const dirtySet = dirtyRoleMap[roleId];
    if (!dirtySet) return;
    const ok = await onSaveRolePermissions(roleId, [...dirtySet]);
    if (ok) {
      setDirtyRoleMap((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
    }
  };

  const filteredRows = useMemo(() => {
    if (!matrix) return [];
    const q = searchQuery.trim().toLowerCase();
    return matrix.rows.filter((row) => {
      if (moduleFilter && row.module !== moduleFilter) return false;
      if (onlyOrphans && !row.isOrphaned) return false;
      if (!q) return true;
      return (
        row.code.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.featureGroup.toLowerCase().includes(q)
      );
    });
  }, [matrix, moduleFilter, searchQuery, onlyOrphans]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Toolbar & Sync Manifest Card */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '14px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              <Grid size={17} color="var(--primary)" />
              Ma trận Vai trò × Quyền hạn Toàn hệ thống
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Rà soát tập trung, tích chọn trực tiếp trên ma trận và đồng bộ idempotent từ{' '}
              <code>module.manifest.json</code>
            </p>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void onSyncPermissions()}
            style={authStyles.btnPrimary}
          >
            <RefreshCw size={14} />
            {submitting ? 'Đang đồng bộ...' : 'Đồng bộ Quyền từ Manifest'}
          </button>
        </div>

        {lastSyncResult && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--status-success-bg)',
              color: 'var(--status-success)',
              fontSize: '13px',
              marginBottom: '12px',
            }}
          >
            Đã đồng bộ từ <strong>{lastSyncResult.syncedModules.join(', ')}</strong>: Tổng công bố{' '}
            <strong>{lastSyncResult.totalDeclared}</strong> quyền (Tạo mới:{' '}
            <strong>{lastSyncResult.createdCount}</strong>, Cập nhật:{' '}
            <strong>{lastSyncResult.updatedCount}</strong>, Giữ nguyên:{' '}
            <strong>{lastSyncResult.unchangedCount}</strong>, Quyền mồ côi:{' '}
            <strong>{lastSyncResult.orphanedCount}</strong>).
          </div>
        )}

        {/* Filter Controls */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 220px auto',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Tìm theo mã quyền, tên quyền hoặc nhóm chức năng..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...authStyles.input, paddingLeft: '30px' }}
            />
          </div>

          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            style={authStyles.input}
          >
            <option value="">Tất cả Module ({matrix?.modules.length ?? 0})</option>
            {(matrix?.modules ?? []).map((mod) => (
              <option key={mod} value={mod}>
                Module: {mod}
              </option>
            ))}
          </select>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '9px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface-elevated)',
            }}
          >
            <input
              type="checkbox"
              checked={onlyOrphans}
              onChange={(e) => setOnlyOrphans(e.target.checked)}
            />
            Chỉ hiện quyền mồ côi ({orphans.length})
          </label>
        </div>
      </div>

      {/* Orphaned Permissions Warning Banner */}
      {orphans.length > 0 && (
        <div
          style={{
            ...authStyles.card,
            borderColor: 'rgba(245, 158, 11, 0.45)',
            background: 'var(--status-warning-bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <AlertTriangle size={16} color="var(--status-warning)" />
            <strong style={{ fontSize: '13.5px', color: 'var(--text-main)' }}>
              Cảnh báo Quyền mồ côi ({orphans.length} quyền không còn khai báo trong module.manifest.json)
            </strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {orphans.map((o) => (
              <span key={o.id} style={authStyles.badgeWarning} title={o.warningMessage}>
                {o.code} ({o.assignedRoles.length} vai trò đang gán)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Matrix Table */}
      <div style={authStyles.card}>
        {!matrix || filteredRows.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Không có dòng quyền hạn nào khớp với điều kiện lọc hiện tại.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: '620px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...authStyles.tableHeaderCell, minWidth: '250px' }}>
                    Quyền hạn (Permission)
                  </th>
                  <th style={{ ...authStyles.tableHeaderCell, minWidth: '130px' }}>
                    Module / Nhóm
                  </th>
                  {matrix.roles.map((role) => {
                    const isDirty = Boolean(dirtyRoleMap[role.id]);
                    return (
                      <th
                        key={role.id}
                        style={{
                          ...authStyles.tableHeaderCell,
                          textAlign: 'center',
                          minWidth: '125px',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                          {role.name}
                        </div>
                        <div
                          style={{
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            textTransform: 'none',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {role.code}
                        </div>
                        {isDirty && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void saveSingleRoleColumn(role.id)}
                            style={{
                              ...authStyles.btnPrimary,
                              padding: '4px 8px',
                              fontSize: '11px',
                              marginTop: '4px',
                            }}
                          >
                            <Save size={11} /> Lưu cột
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.permissionId}>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12.5px',
                          }}
                        >
                          {row.code}
                        </span>
                        {row.isOrphaned && (
                          <span style={authStyles.badgeWarning}>ORPHAN</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {row.name}
                      </div>
                    </td>

                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{row.module}</span>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--text-muted)',
                          marginTop: '3px',
                        }}
                      >
                        {row.featureGroup}
                      </div>
                    </td>

                    {matrix.roles.map((role) => {
                      const permSet = getRolePermSet(role.id, role.code);
                      const granted = permSet.has(row.code);
                      return (
                        <td
                          key={role.id}
                          style={{ ...authStyles.tableCell, textAlign: 'center' }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleMatrixCell(role.id, role.code, row.code)}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              border: granted
                                ? '1px solid var(--primary)'
                                : '1px solid var(--border-strong)',
                              background: granted
                                ? 'var(--primary)'
                                : 'var(--bg-surface-elevated)',
                              color: granted ? '#ffffff' : 'transparent',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            title={`${granted ? 'Thu hồi' : 'Cấp'} quyền '${row.code}' cho vai trò '${role.code}'`}
                          >
                            <Check size={14} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

