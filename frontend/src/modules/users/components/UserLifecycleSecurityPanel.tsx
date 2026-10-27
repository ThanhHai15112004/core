import React, { useState } from 'react';
import {
  Archive,
  CheckCircle2,
  History,
  KeyRound,
  Lock,
  LogOut,
  RotateCcw,
  ShieldAlert,
  Unlock,
  UserCheck,
  UserX,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { USER_STATUS } from '../enum/users.enum';
import type {
  AdminResetMfaResult,
  AdminResetPasswordResult,
  UserItem,
  UserLoginHistoryItem,
  UserOrganizationHistoryItem,
  UserStatusHistoryItem,
  UserSubordinatesOverview,
} from '../types/users.types';
import { UserMembershipAndSubordinatesPanel } from './UserMembershipAndSubordinatesPanel';

interface UserLifecycleSecurityPanelProps {
  readonly users: readonly UserItem[];
  readonly selectedUser: UserItem | null;
  readonly onSelectUser: (id: number) => void;
  readonly statusHistory: readonly UserStatusHistoryItem[];
  readonly organizationHistory: readonly UserOrganizationHistoryItem[];
  readonly subordinatesOverview: UserSubordinatesOverview | null;
  readonly loginHistory: readonly UserLoginHistoryItem[];
  readonly loadingHistory: boolean;
  readonly submitting: boolean;
  readonly lastPasswordResetResult: AdminResetPasswordResult | null;
  readonly lastMfaResetResult: AdminResetMfaResult | null;
  readonly onLifecycleAction: (
    id: number,
    action: 'lock' | 'unlock' | 'deactivate' | 'activate' | 'archive' | 'restore',
    options?: { reason?: string; lockedUntil?: string | null },
  ) => Promise<boolean>;
  readonly onResetPassword: (
    id: number,
    payload: { newPassword?: string; useSuggestedPassword?: boolean; revokeSessions?: boolean },
  ) => Promise<AdminResetPasswordResult | null>;
  readonly onResetMfa: (
    id: number,
    payload: { reason: string; verificationReference?: string; revokeSessions?: boolean },
  ) => Promise<AdminResetMfaResult | null>;
  readonly onRevokeSessions: (id: number, reason?: string) => Promise<boolean>;
}

export const UserLifecycleSecurityPanel: React.FC<UserLifecycleSecurityPanelProps> = ({
  users,
  selectedUser,
  onSelectUser,
  statusHistory,
  organizationHistory,
  subordinatesOverview,
  loginHistory,
  loadingHistory,
  submitting,
  lastPasswordResetResult,
  lastMfaResetResult,
  onLifecycleAction,
  onResetPassword,
  onResetMfa,
  onRevokeSessions,
}) => {
  const [lockReason, setLockReason] = useState('Vi phạm chính sách bảo mật hoặc nghi ngờ xâm nhập');
  const [lockedUntil, setLockedUntil] = useState('');

  const [useSuggestedPassword, setUseSuggestedPassword] = useState(true);
  const [customNewPassword, setCustomNewPassword] = useState('');
  const [revokeOnPwdReset, setRevokeOnPwdReset] = useState(true);

  const [mfaResetReason, setMfaResetReason] = useState(
    'Nhân sự mất thiết bị xác thực, đã xác minh danh tính qua IT Helpdesk',
  );
  const [mfaVerificationRef, setMfaVerificationRef] = useState('TICKET-IAM-2026');
  const [revokeSessionsReason, setRevokeSessionsReason] = useState(
    'Thu hồi khẩn cấp toàn bộ phiên theo yêu cầu bảo mật',
  );

  if (!selectedUser) {
    return (
      <div style={authStyles.card}>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          Vui lòng chọn một nhân sự từ danh sách để thực hiện thao tác vòng đời và bảo mật.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Target User Selector */}
      <div
        style={{
          ...authStyles.cardHighlighted,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
            NHÂN SỰ ĐANG ĐIỀU KHIỂN VÒNG ĐỜI & BẢO MẬT
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
            {selectedUser.fullName} (<code>@{selectedUser.username}</code> · #{selectedUser.id})
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Email: <strong>{selectedUser.email}</strong> · Trạng thái hiện tại:{' '}
            <span style={authStyles.badgePrimary}>{selectedUser.statusName}</span> · Đăng nhập sai:{' '}
            <strong>{selectedUser.failedLoginAttempts}</strong> lần
          </div>
        </div>

        <div style={{ minWidth: '260px' }}>
          <label style={authStyles.label}>Chuyển nhanh nhân sự khác</label>
          <select
            value={selectedUser.id}
            onChange={(e) => onSelectUser(Number(e.target.value))}
            style={authStyles.input}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                #{u.id} — {u.fullName} (@{u.username}) [{u.statusName}]
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3-Column Action Grid: Lifecycle / Password Reset / Controlled MFA & Sessions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Column 1: Account Lifecycle State Machine */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <Lock size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Chuyển đổi Vòng đời Tài khoản
          </h3>
          <p style={authStyles.sectionDesc}>
            Quản lý trạng thái <code>ACTIVE (1) / INACTIVE (2) / LOCKED (3) / ARCHIVED (4)</code> kèm ghi nhận vào bảng <code>user_status_histories</code>.
          </p>

          <div style={{ marginBottom: '10px' }}>
            <label style={authStyles.label}>Lý do khóa tài khoản (Lock Reason)</label>
            <input
              type="text"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              style={authStyles.input}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={authStyles.label}>Thời hạn khóa đến (Tùy chọn — Để trống là khóa vô thời hạn)</label>
            <input
              type="datetime-local"
              value={lockedUntil}
              onChange={(e) => setLockedUntil(e.target.value)}
              style={authStyles.input}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void onLifecycleAction(selectedUser.id, 'lock', {
                  reason: lockReason,
                  lockedUntil: lockedUntil ? new Date(lockedUntil).toISOString() : null,
                })
              }
              style={authStyles.btnDanger}
            >
              <Lock size={14} /> Khóa (Lock)
            </button>

            <button
              type="button"
              disabled={submitting || selectedUser.status !== USER_STATUS.LOCKED}
              onClick={() => void onLifecycleAction(selectedUser.id, 'unlock')}
              style={authStyles.btnTeal}
            >
              <Unlock size={14} /> Mở khóa (Unlock)
            </button>

            <button
              type="button"
              disabled={submitting || selectedUser.status === USER_STATUS.ACTIVE}
              onClick={() => void onLifecycleAction(selectedUser.id, 'activate')}
              style={authStyles.btnPrimary}
            >
              <UserCheck size={14} /> Kích hoạt (Activate)
            </button>

            <button
              type="button"
              disabled={submitting || selectedUser.status === USER_STATUS.INACTIVE}
              onClick={() => void onLifecycleAction(selectedUser.id, 'deactivate')}
              style={authStyles.btnAccent}
            >
              <UserX size={14} /> Vô hiệu hóa (Deactivate)
            </button>

            {!selectedUser.isArchived && selectedUser.status !== USER_STATUS.ARCHIVED ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onLifecycleAction(selectedUser.id, 'archive')}
                style={authStyles.btnSecondary}
              >
                <Archive size={14} /> Lưu trữ (Archive)
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onLifecycleAction(selectedUser.id, 'restore')}
                style={authStyles.btnTeal}
              >
                <RotateCcw size={14} /> Khôi phục (Restore)
              </button>
            )}
          </div>
        </div>

        {/* Column 2: Admin Password Reset */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <KeyRound size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Đặt lại Mật khẩu Quản trị (Admin Reset)
          </h3>
          <p style={authStyles.sectionDesc}>
            Hỗ trợ tự sinh mật khẩu mạnh ngẫu nhiên hoặc đặt mật khẩu chỉ định và tự động thu hồi phiên.
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              fontWeight: 600,
              marginBottom: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={useSuggestedPassword}
              onChange={(e) => setUseSuggestedPassword(e.target.checked)}
            />
            Tự động sinh mật khẩu mạnh (Recommended)
          </label>

          {!useSuggestedPassword && (
            <div style={{ marginBottom: '10px' }}>
              <label style={authStyles.label}>Mật khẩu mới chỉ định</label>
              <input
                type="text"
                value={customNewPassword}
                onChange={(e) => setCustomNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu tối thiểu 8 ký tự..."
                style={authStyles.monoInput}
              />
            </div>
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12.5px',
              fontWeight: 600,
              marginBottom: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={revokeOnPwdReset}
              onChange={(e) => setRevokeOnPwdReset(e.target.checked)}
            />
            Thu hồi toàn bộ phiên đăng nhập ngay sau khi đổi
          </label>

          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              void onResetPassword(selectedUser.id, {
                useSuggestedPassword,
                ...(useSuggestedPassword ? {} : { newPassword: customNewPassword }),
                revokeSessions: revokeOnPwdReset,
              })
            }
            style={authStyles.btnPrimary}
          >
            <KeyRound size={14} /> Thực thi Đặt lại Mật khẩu
          </button>

          {lastPasswordResetResult && lastPasswordResetResult.userId === selectedUser.id && (
            <div style={{ ...authStyles.codeBox, marginTop: '12px' }}>
              <div>
                <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Đã đặt lại mật khẩu thành công (Thu hồi {lastPasswordResetResult.revokedSessionsCount} phiên)
              </div>
              {lastPasswordResetResult.generatedPassword && (
                <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 800 }}>
                  Mật khẩu tạm thời: <code>{lastPasswordResetResult.generatedPassword}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Column 3: Controlled MFA Reset & Emergency Session Revocation */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <ShieldAlert size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Reset MFA Có Kiểm Soát & Thu Hồi Phiên
          </h3>
          <p style={authStyles.sectionDesc}>
            Dành cho nhân sự mất thiết bị Authenticator/OTP đã xác minh danh tính, hoặc thu hồi khẩn cấp phiên.
          </p>

          <div style={{ marginBottom: '8px' }}>
            <label style={authStyles.label}>Lý do xác minh Reset MFA *</label>
            <input
              type="text"
              value={mfaResetReason}
              onChange={(e) => setMfaResetReason(e.target.value)}
              style={authStyles.input}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={authStyles.label}>Mã phiếu / Tham chiếu xác minh (Ticket Ref)</label>
            <input
              type="text"
              value={mfaVerificationRef}
              onChange={(e) => setMfaVerificationRef(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void onResetMfa(selectedUser.id, {
                  reason: mfaResetReason,
                  verificationReference: mfaVerificationRef,
                  revokeSessions: true,
                })
              }
              style={authStyles.btnAccent}
            >
              <ShieldAlert size={14} /> Reset MFA Có Kiểm Soát
            </button>
          </div>

          {lastMfaResetResult && lastMfaResetResult.userId === selectedUser.id && (
            <div style={{ ...authStyles.codeBox, marginBottom: '12px' }}>
              Đã gỡ MFA lúc {new Date(lastMfaResetResult.resetAt).toLocaleString()} · Ref:{' '}
              {lastMfaResetResult.verificationReference || 'N/A'}
            </div>
          )}

          <div
            style={{
              paddingTop: '12px',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <label style={authStyles.label}>Lý do thu hồi toàn bộ phiên đăng nhập</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={revokeSessionsReason}
                onChange={(e) => setRevokeSessionsReason(e.target.value)}
                style={authStyles.input}
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onRevokeSessions(selectedUser.id, revokeSessionsReason)}
                style={authStyles.btnDanger}
              >
                <LogOut size={14} /> Thu hồi Phiên
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 9.2: Organization Membership History & Subordinates / Approval Chain */}
      <UserMembershipAndSubordinatesPanel
        organizationHistory={organizationHistory}
        subordinatesOverview={subordinatesOverview}
        loadingHistory={loadingHistory}
      />

      {/* 2-Column History Tables: Status Transition History & Login History */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Status History Table */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <History size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Lịch sử Chuyển đổi Trạng thái ({statusHistory.length})
          </h3>
          <p style={authStyles.sectionDesc}>
            Nhật ký bất biến từ bảng <code>user_status_histories</code>.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Thời gian</th>
                  <th style={authStyles.tableHeaderCell}>Chuyển trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>Lý do</th>
                  <th style={authStyles.tableHeaderCell}>Actor</th>
                </tr>
              </thead>
              <tbody>
                {statusHistory.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        ...authStyles.tableCell,
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {loadingHistory
                        ? 'Đang tải lịch sử trạng thái...'
                        : 'Chưa có bản ghi chuyển trạng thái.'}
                    </td>
                  </tr>
                ) : (
                  statusHistory.map((item) => (
                    <tr key={item.id}>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>
                          {item.fromStatusName ?? 'INIT'} → {item.toStatusName}
                        </span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12.5px' }}>
                        {item.reason || '—'}
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {item.changedBy ? `User #${item.changedBy}` : 'System'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Login History Table */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <History size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Lịch sử Đăng nhập & Phiên xác thực ({loginHistory.length})
          </h3>
          <p style={authStyles.sectionDesc}>
            Tra cứu lịch sử đăng nhập theo thời gian, địa chỉ IP và thiết bị từ <code>auth_login_histories</code>.
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Thời gian</th>
                  <th style={authStyles.tableHeaderCell}>Sự kiện & Kết quả</th>
                  <th style={authStyles.tableHeaderCell}>IP & Thiết bị</th>
                  <th style={authStyles.tableHeaderCell}>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        ...authStyles.tableCell,
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {loadingHistory
                        ? 'Đang tải lịch sử đăng nhập...'
                        : 'Chưa có lịch sử đăng nhập cho nhân sự này.'}
                    </td>
                  </tr>
                ) : (
                  loginHistory.map((log) => (
                    <tr key={log.id}>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td style={authStyles.tableCell}>
                        <span
                          style={
                            log.statusName === 'SUCCESS'
                              ? authStyles.badgeSuccess
                              : authStyles.badgeDanger
                          }
                        >
                          {log.eventTypeName} ({log.statusName})
                        </span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        <div>{log.ipAddress || 'N/A'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                          {log.deviceName || log.userAgent || 'Unknown Device'}
                        </div>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {log.reason || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

