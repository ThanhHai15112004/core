import React, { useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { USER_STATUS, USER_STATUS_META } from '../enum/users.enum';
import type {
  ListUsersFilter,
  OrganizationOptionSummary,
  RoleOptionSummary,
  UserItem,
  UsersPaginationMeta,
} from '../types/users.types';

interface UsersDirectoryTableProps {
  readonly users: readonly UserItem[];
  readonly selectedUserId: number | null;
  readonly onSelectUser: (id: number) => void;
  readonly onOpenCreateMode: () => void;
  readonly onOpenSecurityTab: (userId: number) => void;
  readonly filter: ListUsersFilter;
  readonly onApplyFilter: (patch: Partial<ListUsersFilter>) => Promise<void>;
  readonly pagination: UsersPaginationMeta;
  readonly roleOptions: readonly RoleOptionSummary[];
  readonly organizationOptions: readonly OrganizationOptionSummary[];
  readonly loading: boolean;
}

export const UsersDirectoryTable: React.FC<UsersDirectoryTableProps> = ({
  users,
  selectedUserId,
  onSelectUser,
  onOpenCreateMode,
  onOpenSecurityTab,
  filter,
  onApplyFilter,
  pagination,
  roleOptions,
  organizationOptions,
  loading,
}) => {
  const [keyword, setKeyword] = useState(filter.q ?? '');

  const resolveStatusBadgeStyle = (status: number): React.CSSProperties => {
    const tone = USER_STATUS_META[status]?.badgeTone ?? 'primary';
    if (tone === 'success') return authStyles.badgeSuccess;
    if (tone === 'warning') return authStyles.badgeWarning;
    if (tone === 'danger') return authStyles.badgeDanger;
    return authStyles.badgePrimary;
  };

  const getInitials = (fullName: string, username: string) => {
    const parts = (fullName || username).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
    }
    return (parts[0]?.slice(0, 2) || 'US').toUpperCase();
  };

  return (
    <div style={authStyles.card}>
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        <div>
          <h3 style={authStyles.sectionTitle}>Danh bạ Nhân sự & Bộ lọc Đa chiều</h3>
          <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
            Tra cứu theo họ tên, username, email, SĐT; lọc theo Vai trò RBAC, Đơn vị tổ chức và trạng thái vòng đời.
          </p>
        </div>

        <button type="button" onClick={onOpenCreateMode} style={authStyles.btnPrimary}>
          <Plus size={15} />
          Tạo nhân sự mới
        </button>
      </div>

      {/* Multi-Filter Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr repeat(4, minmax(135px, 1fr)) auto',
          gap: '10px',
          alignItems: 'end',
          marginBottom: '16px',
          padding: '12px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div>
          <label style={authStyles.label}>Từ khóa (Tên / Username / Email / SĐT)</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void onApplyFilter({ q: keyword.trim(), page: 1 });
                }
              }}
              placeholder="Nhập tên, email hoặc số điện thoại..."
              style={authStyles.input}
            />
            <button
              type="button"
              onClick={() => void onApplyFilter({ q: keyword.trim(), page: 1 })}
              style={authStyles.btnSecondary}
              title="Tìm kiếm"
            >
              <Search size={14} />
            </button>
          </div>
        </div>

        <div>
          <label style={authStyles.label}>Trạng thái</label>
          <select
            value={filter.status ?? ''}
            onChange={(e) =>
              void onApplyFilter({
                status: e.target.value ? Number(e.target.value) : '',
                page: 1,
              })
            }
            style={authStyles.input}
          >
            <option value="">Tất cả trạng thái</option>
            <option value={USER_STATUS.ACTIVE}>1 — ACTIVE</option>
            <option value={USER_STATUS.INACTIVE}>2 — INACTIVE</option>
            <option value={USER_STATUS.LOCKED}>3 — LOCKED</option>
            <option value={USER_STATUS.ARCHIVED}>4 — ARCHIVED</option>
          </select>
        </div>

        <div>
          <label style={authStyles.label}>Vai trò (Role)</label>
          <select
            value={filter.roleId ?? ''}
            onChange={(e) =>
              void onApplyFilter({
                roleId: e.target.value ? Number(e.target.value) : '',
                page: 1,
              })
            }
            style={authStyles.input}
          >
            <option value="">Tất cả vai trò</option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={authStyles.label}>Đơn vị (Org Unit)</label>
          <select
            value={filter.organizationUnitId ?? ''}
            onChange={(e) =>
              void onApplyFilter({
                organizationUnitId: e.target.value ? Number(e.target.value) : '',
                page: 1,
              })
            }
            style={authStyles.input}
          >
            <option value="">Tất cả đơn vị</option>
            {organizationOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={authStyles.label}>Bảo mật MFA</label>
          <select
            value={filter.mfaEnabled ?? ''}
            onChange={(e) =>
              void onApplyFilter({
                mfaEnabled: e.target.value as '' | 'true' | 'false',
                page: 1,
              })
            }
            style={authStyles.input}
          >
            <option value="">Tất cả</option>
            <option value="true">Đã bật MFA</option>
            <option value="false">Chưa bật MFA</option>
          </select>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            paddingBottom: '8px',
          }}
        >
          <input
            type="checkbox"
            checked={Boolean(filter.includeArchived)}
            onChange={(e) =>
              void onApplyFilter({ includeArchived: e.target.checked, page: 1 })
            }
          />
          Gồm lưu trữ
        </label>
      </div>

      {/* Directory Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={authStyles.tableHeaderCell}>Nhân sự</th>
              <th style={authStyles.tableHeaderCell}>Liên hệ & Locale</th>
              <th style={authStyles.tableHeaderCell}>Đơn vị công tác</th>
              <th style={authStyles.tableHeaderCell}>Vai trò RBAC</th>
              <th style={authStyles.tableHeaderCell}>Trạng thái & MFA</th>
              <th style={authStyles.tableHeaderCell}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...authStyles.tableCell,
                    textAlign: 'center',
                    padding: '28px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {loading
                    ? 'Đang tải danh sách nhân sự...'
                    : 'Không tìm thấy nhân sự nào khớp với bộ lọc hiện tại.'}
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelected = user.id === selectedUserId;
                const primaryOrg =
                  user.organizationUnits.find((o) => o.isPrimary) ?? user.organizationUnits[0];

                return (
                  <tr
                    key={user.id}
                    onClick={() => onSelectUser(user.id)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-light-blue)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: isSelected
                              ? 'var(--primary)'
                              : 'var(--bg-surface-elevated)',
                            color: isSelected ? '#FFFFFF' : 'var(--primary)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 800,
                            fontSize: '12.5px',
                            flexShrink: 0,
                          }}
                        >
                          {getInitials(user.fullName, user.username)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {user.fullName}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            <code>@{user.username}</code> · ID #{user.id}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td style={authStyles.tableCell}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{user.email}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {user.phone || 'Chưa cập nhật SĐT'} ·{' '}
                        {(user.preferredLocale ?? 'vi').toUpperCase()}
                      </div>
                    </td>

                    <td style={authStyles.tableCell}>
                      {primaryOrg ? (
                        <div>
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontWeight: 600,
                              fontSize: '12.5px',
                            }}
                          >
                            <Building2 size={13} color="var(--secondary)" />
                            <span>
                              {primaryOrg.name || `Đơn vị #${primaryOrg.organizationUnitId}`}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            {primaryOrg.positionTitle || 'Nhân viên'}
                            {user.organizationUnits.length > 1
                              ? ` (+${user.organizationUnits.length - 1} đơn vị kiêm nhiệm)`
                              : ''}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Chưa phân công đơn vị
                        </span>
                      )}
                    </td>

                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {user.roles.length === 0 ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Mặc định (user)
                          </span>
                        ) : (
                          user.roles.map((r) => (
                            <span key={r.roleId} style={authStyles.badgePrimary}>
                              <KeyRound size={11} />
                              {r.code}
                            </span>
                          ))
                        )}
                      </div>
                    </td>

                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>
                          <span style={resolveStatusBadgeStyle(user.status)}>
                            {user.status === USER_STATUS.LOCKED ? (
                              <Lock size={11} />
                            ) : (
                              <UserCheck size={11} />
                            )}
                            {user.statusName}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {user.mfaEnabled ? (
                            <span style={authStyles.badgeSuccess}>
                              <ShieldCheck size={11} /> MFA Bật
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              MFA Tắt
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSecurityTab(user.id);
                        }}
                        style={{
                          ...authStyles.btnSecondary,
                          padding: '5px 10px',
                          fontSize: '12px',
                        }}
                      >
                        Vòng đời & Bảo mật
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '14px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '12.5px',
          color: 'var(--text-secondary)',
        }}
      >
        <div>
          Hiển thị <strong>{users.length}</strong> / tổng số{' '}
          <strong>{pagination.totalItems}</strong> nhân sự (Trang {pagination.page}/
          {Math.max(1, pagination.totalPages)})
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            disabled={pagination.page <= 1 || loading}
            onClick={() => void onApplyFilter({ page: Math.max(1, pagination.page - 1) })}
            style={authStyles.btnSecondary}
          >
            <ChevronLeft size={14} /> Trang trước
          </button>
          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages || loading}
            onClick={() => void onApplyFilter({ page: pagination.page + 1 })}
            style={authStyles.btnSecondary}
          >
            Trang sau <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

