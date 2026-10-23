import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Copy,
  KeyRound,
  Lock,
  Plus,
  Search,
  Shield,
  Square,
  Trash2,
  Users,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import {
  DATA_SCOPE,
  DATA_SCOPE_META,
  type DataScopeCode,
  ROLE_STATUS,
  ROLE_STATUS_LABELS,
  type RoleStatusCode,
} from '../enum/roles.enum';
import type {
  CloneRolePayload,
  CreateRolePayload,
  PermissionFunctionalGroup,
  RoleAssignedUser,
  RoleItem,
  UpdateRolePayload,
} from '../types/roles.types';

interface RolesDirectoryTabProps {
  roles: readonly RoleItem[];
  selectedRole: RoleItem | null;
  selectedRoleId: number | null;
  onSelectRole: (id: number) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: RoleStatusCode | '';
  onStatusFilterChange: (s: RoleStatusCode | '') => void;
  scopeFilter: DataScopeCode | '';
  onScopeFilterChange: (d: DataScopeCode | '') => void;
  permissionGroups: readonly PermissionFunctionalGroup[];
  assignedUsers: readonly RoleAssignedUser[];
  loadingAssignedUsers: boolean;
  submitting: boolean;
  onCreateRole: (payload: CreateRolePayload) => Promise<boolean>;
  onUpdateRole: (id: number, payload: UpdateRolePayload) => Promise<boolean>;
  onCloneRole: (sourceId: number, payload: CloneRolePayload) => Promise<boolean>;
  onDeleteRole: (role: RoleItem) => Promise<boolean>;
}

function resolveScopeBadgeStyle(tone: 'accent' | 'primary' | 'secondary' | 'neutral') {
  switch (tone) {
    case 'accent':
      return authStyles.badgeWarning;
    case 'primary':
      return authStyles.badgePrimary;
    case 'secondary':
      return authStyles.badgeSuccess;
    default:
      return {
        ...authStyles.badgePrimary,
        background: 'var(--bg-surface-elevated)',
        color: 'var(--text-secondary)',
      };
  }
}

export const RolesDirectoryTab: React.FC<RolesDirectoryTabProps> = ({
  roles,
  selectedRole,
  selectedRoleId,
  onSelectRole,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  scopeFilter,
  onScopeFilterChange,
  permissionGroups,
  assignedUsers,
  loadingAssignedUsers,
  submitting,
  onCreateRole,
  onUpdateRole,
  onCloneRole,
  onDeleteRole,
}) => {
  const [mode, setMode] = useState<'inspect' | 'create' | 'clone'>('inspect');
  const [code, setCode] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [dataScope, setDataScope] = useState<DataScopeCode>(DATA_SCOPE.SELF);
  const [status, setStatus] = useState<RoleStatusCode>(ROLE_STATUS.ACTIVE);
  const [selectedPermCodes, setSelectedPermCodes] = useState<Set<string>>(new Set());
  const [permFilter, setPermFilter] = useState<string>('');

  useEffect(() => {
    if (mode === 'inspect' && selectedRole) {
      setCode(selectedRole.code);
      setName(selectedRole.name);
      setDescription(selectedRole.description ?? '');
      setDataScope(selectedRole.dataScope);
      setStatus(selectedRole.status);
      setSelectedPermCodes(new Set(selectedRole.permissions));
    }
  }, [mode, selectedRole]);

  const startCreateMode = () => {
    setMode('create');
    setCode('');
    setName('');
    setDescription('');
    setDataScope(DATA_SCOPE.SELF);
    setStatus(ROLE_STATUS.ACTIVE);
    setSelectedPermCodes(new Set());
  };

  const startCloneMode = () => {
    if (!selectedRole) return;
    setMode('clone');
    setCode(`${selectedRole.code}_copy`);
    setName(`${selectedRole.name} (Bản sao)`);
    setDescription(
      selectedRole.description
        ? `${selectedRole.description} (Sao chép từ ${selectedRole.code})`
        : `Sao chép từ vai trò ${selectedRole.code}`,
    );
    setDataScope(selectedRole.dataScope);
    setStatus(ROLE_STATUS.ACTIVE);
    setSelectedPermCodes(new Set(selectedRole.permissions));
  };

  const filteredPermissionGroups = useMemo(() => {
    const q = permFilter.trim().toLowerCase();
    if (!q) return permissionGroups;
    return permissionGroups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter(
          (p) =>
            p.code.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q) ||
            group.moduleDisplayName.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [permissionGroups, permFilter]);

  const togglePermCode = (permCode: string) => {
    setSelectedPermCodes((prev) => {
      const next = new Set(prev);
      if (next.has(permCode)) {
        next.delete(permCode);
      } else {
        next.add(permCode);
      }
      return next;
    });
  };

  const toggleGroupPerms = (group: PermissionFunctionalGroup) => {
    const groupCodes = group.permissions.map((p) => p.code);
    const allSelected = groupCodes.every((c) => selectedPermCodes.has(c));
    setSelectedPermCodes((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const c of groupCodes) next.delete(c);
      } else {
        for (const c of groupCodes) next.add(c);
      }
      return next;
    });
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      const ok = await onCreateRole({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        dataScope,
        status,
        permissions: [...selectedPermCodes],
      });
      if (ok) setMode('inspect');
      return;
    }

    if (mode === 'clone' && selectedRole) {
      const ok = await onCloneRole(selectedRole.id, {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
        dataScope,
        status,
      });
      if (ok) setMode('inspect');
      return;
    }

    if (mode === 'inspect' && selectedRole) {
      await onUpdateRole(selectedRole.id, {
        name: name.trim(),
        description: description.trim() || null,
        dataScope,
        status,
        permissions: [...selectedPermCodes],
      });
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: '18px' }}>
      {/* Left Column: Role List & Filters */}
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
              <Shield size={17} color="var(--primary)" />
              Danh mục Vai trò ({roles.length})
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Chọn vai trò để cấu hình quyền hạn, phạm vi dữ liệu hoặc sao chép nhanh
            </p>
          </div>
          <button type="button" onClick={startCreateMode} style={authStyles.btnPrimary}>
            <Plus size={14} />
            Tạo vai trò
          </button>
        </div>

        {/* Filter Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 135px 155px',
            gap: '8px',
            marginBottom: '14px',
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
              placeholder="Tìm mã hoặc tên vai trò..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ ...authStyles.input, paddingLeft: '30px' }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) =>
              onStatusFilterChange(
                e.target.value === '' ? '' : (Number(e.target.value) as RoleStatusCode),
              )
            }
            style={authStyles.input}
          >
            <option value="">Tất cả trạng thái</option>
            <option value={ROLE_STATUS.ACTIVE}>Đang hoạt động</option>
            <option value={ROLE_STATUS.INACTIVE}>Ngừng hoạt động</option>
          </select>

          <select
            value={scopeFilter}
            onChange={(e) =>
              onScopeFilterChange(
                e.target.value === '' ? '' : (Number(e.target.value) as DataScopeCode),
              )
            }
            style={authStyles.input}
          >
            <option value="">Tất cả Data Scope</option>
            <option value={DATA_SCOPE.ALL}>ALL (Toàn hệ thống)</option>
            <option value={DATA_SCOPE.ORG_UNIT}>ORG_UNIT (Đơn vị)</option>
            <option value={DATA_SCOPE.SUBORDINATES}>SUBORDINATES (Cấp dưới)</option>
            <option value={DATA_SCOPE.SELF}>SELF (Cá nhân)</option>
          </select>
        </div>

        {/* Role List Table */}
        <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Vai trò</th>
                <th style={authStyles.tableHeaderCell}>Data Scope</th>
                <th style={authStyles.tableHeaderCell}>Quyền / Users</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      ...authStyles.tableCell,
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      padding: '28px',
                    }}
                  >
                    Không tìm thấy vai trò phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                roles.map((role) => {
                  const isSelected = mode === 'inspect' && role.id === selectedRoleId;
                  const scopeInfo =
                    DATA_SCOPE_META[role.dataScope] ?? DATA_SCOPE_META[DATA_SCOPE.SELF];
                  return (
                    <tr
                      key={role.id}
                      onClick={() => {
                        setMode('inspect');
                        onSelectRole(role.id);
                      }}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'var(--primary-light)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={authStyles.tableCell}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {role.name}
                          </span>
                          {role.isSystem ? (
                            <span style={authStyles.badgePrimary}>
                              <Lock size={10} /> SYSTEM
                            </span>
                          ) : (
                            <span
                              style={{
                                ...authStyles.badgePrimary,
                                background: 'var(--bg-surface-elevated)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              CUSTOM
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                            marginTop: '2px',
                          }}
                        >
                          {role.code}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={resolveScopeBadgeStyle(scopeInfo.tone)}>
                          {scopeInfo.shortLabel}
                        </span>
                      </td>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          {role.permissions.length} quyền
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {role.userCount} người dùng
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span
                          style={
                            role.status === ROLE_STATUS.ACTIVE
                              ? authStyles.badgeSuccess
                              : authStyles.badgeDanger
                          }
                        >
                          {ROLE_STATUS_LABELS[role.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Column: Role Inspector / Create / Clone Form + Grouped Permissions + Assigned Users */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                <KeyRound size={17} color="var(--primary)" />
                {mode === 'create'
                  ? 'Tạo Vai trò Mới'
                  : mode === 'clone'
                    ? `Sao chép từ vai trò '${selectedRole?.code ?? ''}'`
                    : selectedRole
                      ? `Chi tiết Vai trò: ${selectedRole.name}`
                      : 'Chọn một vai trò'}
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                {mode === 'create'
                  ? 'Khai báo mã vai trò, cấp độ phạm vi dữ liệu và chọn quyền hạn theo nhóm chức năng'
                  : mode === 'clone'
                    ? 'Tạo nhanh vai trò mới kế thừa toàn bộ quyền hạn và phạm vi dữ liệu của vai trò gốc'
                    : selectedRole?.isSystem
                      ? 'Vai trò hệ thống (System Role) được bảo vệ: Không thể xóa hoặc ngừng kích hoạt'
                      : 'Chỉnh sửa thông tin, phạm vi dữ liệu và phân quyền chi tiết cho vai trò'}
              </p>
            </div>

            {mode === 'inspect' && selectedRole && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={startCloneMode}
                  style={authStyles.btnSecondary}
                  title="Sao chép vai trò này sang vai trò mới"
                >
                  <Copy size={13} />
                  Sao chép
                </button>
                {!selectedRole.isSystem && (
                  <button
                    type="button"
                    disabled={submitting || selectedRole.userCount > 0}
                    onClick={() => void onDeleteRole(selectedRole)}
                    style={{
                      ...authStyles.btnDanger,
                      opacity: selectedRole.userCount > 0 ? 0.5 : 1,
                    }}
                    title={
                      selectedRole.userCount > 0
                        ? `Không thể xóa khi đang có ${selectedRole.userCount} người dùng giữ vai trò này`
                        : 'Xóa mềm vai trò tùy chỉnh'
                    }
                  >
                    <Trash2 size={13} />
                    Xóa
                  </button>
                )}
              </div>
            )}

            {mode !== 'inspect' && (
              <button
                type="button"
                onClick={() => setMode('inspect')}
                style={authStyles.btnSecondary}
              >
                Hủy
              </button>
            )}
          </div>

          <form onSubmit={(e) => void handleSubmitForm(e)}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div>
                <label style={authStyles.label}>Mã vai trò (Code)</label>
                <input
                  type="text"
                  required
                  disabled={mode === 'inspect'}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="vd: branch_manager, auditor_lead"
                  style={{
                    ...authStyles.monoInput,
                    opacity: mode === 'inspect' ? 0.7 : 1,
                  }}
                />
              </div>

              <div>
                <label style={authStyles.label}>Tên hiển thị vai trò</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="vd: Trưởng chi nhánh"
                  style={authStyles.input}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <div>
                <label style={authStyles.label}>Phạm vi dữ liệu (Data Scope)</label>
                <select
                  value={dataScope}
                  onChange={(e) => setDataScope(Number(e.target.value) as DataScopeCode)}
                  style={authStyles.input}
                >
                  {Object.values(DATA_SCOPE_META).map((meta) => (
                    <option key={meta.code} value={meta.code}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={authStyles.label}>Trạng thái kích hoạt</label>
                <select
                  value={status}
                  disabled={mode === 'inspect' && Boolean(selectedRole?.isSystem)}
                  onChange={(e) => setStatus(Number(e.target.value) as RoleStatusCode)}
                  style={authStyles.input}
                >
                  <option value={ROLE_STATUS.ACTIVE}>Đang hoạt động (ACTIVE)</option>
                  <option value={ROLE_STATUS.INACTIVE}>Ngừng hoạt động (INACTIVE)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={authStyles.label}>Mô tả trách nhiệm</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả mục đích và phạm vi trách nhiệm của vai trò..."
                style={authStyles.input}
              />
            </div>

            {/* Grouped Permissions Selector (shown in create & inspect modes) */}
            {mode !== 'clone' && (
              <div style={{ marginTop: '14px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span style={authStyles.label}>
                    Phân quyền theo Nhóm chức năng ({selectedPermCodes.size} quyền đã chọn)
                  </span>
                  <input
                    type="text"
                    placeholder="Lọc nhanh mã quyền hoặc module..."
                    value={permFilter}
                    onChange={(e) => setPermFilter(e.target.value)}
                    style={{ ...authStyles.input, width: '240px', padding: '6px 10px' }}
                  />
                </div>

                <div
                  style={{
                    maxHeight: '290px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px',
                    background: 'var(--bg-surface-elevated)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  {filteredPermissionGroups.map((group) => {
                    const groupKey = `${group.module}::${group.featureGroup}`;
                    const selectedInGroup = group.permissions.filter((p) =>
                      selectedPermCodes.has(p.code),
                    ).length;
                    const allSelected =
                      group.permissions.length > 0 &&
                      selectedInGroup === group.permissions.length;

                    return (
                      <div
                        key={groupKey}
                        style={{
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={authStyles.badgePrimary}>{group.module}</span>
                            <span style={{ fontWeight: 700, fontSize: '13px' }}>
                              {group.featureGroup}
                            </span>
                            <span
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              ({selectedInGroup}/{group.permissions.length})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleGroupPerms(group)}
                            style={{
                              ...authStyles.btnSecondary,
                              padding: '4px 8px',
                              fontSize: '11.5px',
                            }}
                          >
                            {allSelected ? (
                              <>
                                <CheckSquare size={12} /> Bỏ chọn nhóm
                              </>
                            ) : (
                              <>
                                <Square size={12} /> Chọn cả nhóm
                              </>
                            )}
                          </button>
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                            gap: '6px',
                          }}
                        >
                          {group.permissions.map((perm) => {
                            const checked = selectedPermCodes.has(perm.code);
                            return (
                              <label
                                key={perm.code}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '6px',
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  fontSize: '12.5px',
                                  border: checked
                                    ? '1px solid var(--primary)'
                                    : '1px solid var(--border-color)',
                                  background: checked
                                    ? 'var(--primary-light)'
                                    : 'transparent',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePermCode(perm.code)}
                                  style={{ marginTop: '2px' }}
                                />
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      fontFamily: 'var(--font-mono)',
                                      color: 'var(--text-main)',
                                    }}
                                  >
                                    {perm.code}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '11.5px',
                                      color: 'var(--text-muted)',
                                    }}
                                  >
                                    {perm.name}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '14px',
              }}
            >
              <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
                {submitting
                  ? 'Đang xử lý...'
                  : mode === 'create'
                    ? 'Tạo Vai trò & Phân quyền'
                    : mode === 'clone'
                      ? 'Xác nhận Sao chép Vai trò'
                      : 'Lưu Thay đổi Vai trò'}
              </button>
            </div>
          </form>
        </div>

        {/* Assigned Users Card */}
        {mode === 'inspect' && selectedRole && (
          <div style={authStyles.card}>
            <div style={{ marginBottom: '12px' }}>
              <h3 style={authStyles.sectionTitle}>
                <Users size={17} color="var(--secondary)" />
                Người dùng đang giữ vai trò `{selectedRole.code}` ({assignedUsers.length})
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Kiểm tra danh sách nhân sự chịu ảnh hưởng trước khi thay đổi quyền hạn hoặc xóa vai trò
              </p>
            </div>

            {loadingAssignedUsers ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Đang tải danh sách người dùng...
              </div>
            ) : assignedUsers.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Chưa có người dùng nào được gán vai trò này.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={authStyles.tableHeaderCell}>Tài khoản</th>
                      <th style={authStyles.tableHeaderCell}>Họ tên</th>
                      <th style={authStyles.tableHeaderCell}>Đơn vị chính</th>
                      <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                      <th style={authStyles.tableHeaderCell}>Ngày gán</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedUsers.map((u) => (
                      <tr key={u.id}>
                        <td style={authStyles.tableCell}>
                          <div style={{ fontWeight: 600 }}>{u.username}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {u.email}
                          </div>
                        </td>
                        <td style={authStyles.tableCell}>{u.fullName}</td>
                        <td style={authStyles.tableCell}>
                          {u.primaryOrganizationUnitId ? `#${u.primaryOrganizationUnitId}` : '—'}
                        </td>
                        <td style={authStyles.tableCell}>
                          <span
                            style={
                              u.status === 1
                                ? authStyles.badgeSuccess
                                : authStyles.badgeWarning
                            }
                          >
                            {u.statusName}
                          </span>
                        </td>
                        <td style={authStyles.tableCell}>
                          {new Date(u.assignedAt).toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

