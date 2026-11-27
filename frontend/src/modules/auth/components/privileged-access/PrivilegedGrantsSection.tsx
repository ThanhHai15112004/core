import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  PrivilegedGrantItem,
  PrivilegedTargetItem,
  PrivilegedTargetType,
  PrivilegedUserDirectoryItem,
} from '../../types/privileged-access.types';

interface Props {
  readonly busy: boolean;
  readonly directoryUsers: readonly PrivilegedUserDirectoryItem[];
  readonly targets: readonly PrivilegedTargetItem[];
  readonly grants: readonly PrivilegedGrantItem[];
  readonly onRequestGrant: (payload: {
    userId?: number;
    targetType: PrivilegedTargetType;
    targetCode: string;
    reason: string;
    durationMinutes: number;
    ticketRef?: string;
  }) => Promise<void>;
  readonly onApprove: (id: number, comment?: string) => Promise<void>;
  readonly onReject: (id: number, comment?: string) => Promise<void>;
  readonly onRevoke: (id: number, comment?: string) => Promise<void>;
  readonly onSweepExpired: () => Promise<void>;
}

export const PrivilegedGrantsSection: React.FC<Props> = ({
  busy,
  directoryUsers,
  targets,
  grants,
  onRequestGrant,
  onApprove,
  onReject,
  onRevoke,
  onSweepExpired,
}) => {
  const [userId, setUserId] = useState<string>('');
  const [targetKey, setTargetKey] = useState<string>('ROLE:admin_security');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [ticketRef, setTicketRef] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    const [tType, ...rest] = targetKey.split(':');
    const tCode = rest.join(':');
    if (!tCode) return;
    await onRequestGrant({
      ...(userId ? { userId: Number(userId) } : {}),
      targetType: (tType === 'PERMISSION' ? 'PERMISSION' : 'ROLE') as PrivilegedTargetType,
      targetCode: tCode,
      reason: reason.trim(),
      durationMinutes,
      ...(ticketRef.trim() ? { ticketRef: ticketRef.trim() } : {}),
    });
    setReason('');
    setTicketRef('');
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
            marginBottom: '12px',
          }}
        >
          <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
            Xin cấp quyền đặc biệt tạm thời (JIT)
          </h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSweepExpired()}
            style={authStyles.btnSecondary}
          >
            Quét thu hồi hết hạn ngay
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '12px',
            alignItems: 'end',
          }}
        >
          <div>
            <label style={authStyles.label}>Người nhận (từ bảng `users`)</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              style={authStyles.input}
            >
              <option value="">-- Chính tài khoản đang đăng nhập --</option>
              {directoryUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  #{u.id} {u.username} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={authStyles.label}>Vai trò / Quyền đặc biệt</label>
            <select
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              style={authStyles.input}
            >
              {targets
                .filter((t) => t.isEnabled)
                .map((t) => (
                  <option
                    key={`${t.targetType}:${t.targetCode}`}
                    value={`${t.targetType}:${t.targetCode}`}
                  >
                    [{t.targetType}] {t.targetCode} (max {t.maxGrantMinutes}m)
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label style={authStyles.label}>Thời hạn (phút)</label>
            <input
              type="number"
              min={5}
              max={10080}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value) || 60)}
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Ticket / Tham chiếu</label>
            <input
              value={ticketRef}
              onChange={(e) => setTicketRef(e.target.value)}
              placeholder="INC-2026-001"
              style={authStyles.input}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={authStyles.label}>Lý do cấp quyền tạm thời</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Xử lý sự cố production hoặc kiểm tra cấu hình bảo mật..."
              style={authStyles.input}
              required
            />
          </div>
          <div>
            <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
              Gửi yêu cầu cấp quyền
            </button>
          </div>
        </form>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Danh sách Cấp quyền tạm thời ({grants.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px' }}>Mã</th>
                <th style={{ padding: '8px' }}>User</th>
                <th style={{ padding: '8px' }}>Mục tiêu</th>
                <th style={{ padding: '8px' }}>Lý do / Hạn</th>
                <th style={{ padding: '8px' }}>Trạng thái</th>
                <th style={{ padding: '8px' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{g.grantCode}</td>
                  <td style={{ padding: '8px' }}>
                    #{g.userId} {g.username ?? ''}
                  </td>
                  <td style={{ padding: '8px' }}>
                    {g.targetType}:{g.targetCode} ({g.durationMinutes}m)
                  </td>
                  <td style={{ padding: '8px' }}>
                    <div>{g.reason}</div>
                    {g.expiresAt && (
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Hết hạn: {new Date(g.expiresAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <strong>{g.statusName}</strong>
                    {g.autoRevoked ? ' (Auto)' : ''}
                  </td>
                  <td style={{ padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {g.status === 1 && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onApprove(g.id)}
                          style={authStyles.btnPrimary}
                        >
                          Duyệt
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onReject(g.id, 'Từ chối bởi Security Admin')}
                          style={authStyles.btnSecondary}
                        >
                          Từ chối
                        </button>
                      </>
                    )}
                    {g.status === 2 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRevoke(g.id, 'Thu hồi thủ công')}
                        style={authStyles.btnSecondary}
                      >
                        Thu hồi
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
