import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type {
  BreakGlassAccountItem,
  PrivilegedUserDirectoryItem,
} from '../../types/privileged-access.types';

interface Props {
  readonly busy: boolean;
  readonly directoryUsers: readonly PrivilegedUserDirectoryItem[];
  readonly accounts: readonly BreakGlassAccountItem[];
  readonly onCreate: (payload: {
    mode: 'LINK_EXISTING' | 'CREATE_NEW';
    existingUserId?: number;
    username?: string;
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    code: string;
    label: string;
    roleCode: string;
    maxActivationMinutes: number;
    requireMfa: boolean;
    sealImmediately: boolean;
  }) => Promise<void>;
  readonly onActivate: (
    id: number,
    payload: { reason: string; durationMinutes: number; ticketRef?: string },
  ) => Promise<void>;
  readonly onSeal: (id: number, reason?: string) => Promise<void>;
}

export const PrivilegedBreakGlassSection: React.FC<Props> = ({
  busy,
  directoryUsers,
  accounts,
  onCreate,
  onActivate,
  onSeal,
}) => {
  const [mode, setMode] = useState<'LINK_EXISTING' | 'CREATE_NEW'>('LINK_EXISTING');
  const [existingUserId, setExistingUserId] = useState<string>('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [roleCode, setRoleCode] = useState('super_admin');
  const [maxMinutes, setMaxMinutes] = useState(60);
  const [sealImmediately, setSealImmediately] = useState(true);
  const [activateReasons, setActivateReasons] = useState<Record<number, string>>({});

  const availableUsersToLink = directoryUsers.filter((u) => !u.isLinkedBreakGlass);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !label.trim()) return;
    await onCreate({
      mode,
      ...(mode === 'LINK_EXISTING' && existingUserId
        ? { existingUserId: Number(existingUserId) }
        : {}),
      ...(mode === 'CREATE_NEW'
        ? {
            username: username.trim(),
            email: email.trim(),
            password,
            firstName: 'Break',
            lastName: 'Glass',
          }
        : {}),
      code: code.trim(),
      label: label.trim(),
      roleCode: roleCode.trim() || 'super_admin',
      maxActivationMinutes: maxMinutes,
      requireMfa: true,
      sealImmediately,
    });
    setCode('');
    setLabel('');
    setPassword('');
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Đăng ký / Liên kết Tài khoản Khẩn Cấp Break-glass
        </h3>
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
            <label style={authStyles.label}>Chế độ thiết lập</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'LINK_EXISTING' | 'CREATE_NEW')}
              style={authStyles.input}
            >
              <option value="LINK_EXISTING">Liên kết User Admin sẵn có từ bảng `users`</option>
              <option value="CREATE_NEW">Tạo mới tài khoản Break-glass chuyên dụng</option>
            </select>
          </div>

          {mode === 'LINK_EXISTING' ? (
            <div>
              <label style={authStyles.label}>Chọn User Admin sẵn có</label>
              <select
                value={existingUserId}
                onChange={(e) => setExistingUserId(e.target.value)}
                style={authStyles.input}
                required
              >
                <option value="">-- Chọn user trong bảng users --</option>
                {availableUsersToLink.map((u) => (
                  <option key={u.id} value={u.id}>
                    #{u.id} {u.username} ({u.roles.map((r) => r.code).join(', ') || 'no-role'})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label style={authStyles.label}>Username mới</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="breakglass_sec_01"
                  style={authStyles.input}
                  required
                />
              </div>
              <div>
                <label style={authStyles.label}>Email mới</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="breakglass.sec01@company.com"
                  style={authStyles.input}
                  required
                />
              </div>
              <div>
                <label style={authStyles.label}>Mật khẩu mạnh (&gt;=12 ký tự)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={authStyles.input}
                  required
                />
              </div>
            </>
          )}

          <div>
            <label style={authStyles.label}>Mã Break-glass</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="bg-primary-01"
              style={authStyles.monoInput}
              required
            />
          </div>
          <div>
            <label style={authStyles.label}>Nhãn mô tả</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Tài khoản khẩn cấp DR"
              style={authStyles.input}
              required
            />
          </div>
          <div>
            <label style={authStyles.label}>Vai trò gán</label>
            <input
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Mở tối đa (phút)</label>
            <input
              type="number"
              min={5}
              max={480}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(Number(e.target.value) || 60)}
              style={authStyles.input}
            />
          </div>
          <label style={{ fontSize: '12.5px', display: 'flex', gap: '6px', paddingBottom: '6px' }}>
            <input
              type="checkbox"
              checked={sealImmediately}
              onChange={(e) => setSealImmediately(e.target.checked)}
            />
            Niêm phong ngay (Khóa đăng nhập thường)
          </label>
          <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
            Lưu Break-glass
          </button>
        </form>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Danh sách Tài khoản Break-glass ({accounts.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px' }}>Mã / Nhãn</th>
                <th style={{ padding: '8px' }}>User liên kết</th>
                <th style={{ padding: '8px' }}>Trạng thái</th>
                <th style={{ padding: '8px' }}>Kích hoạt / Niêm phong</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((bg) => (
                <tr key={bg.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{bg.code}</strong> ({bg.roleCode})
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{bg.label}</div>
                  </td>
                  <td style={{ padding: '8px' }}>
                    #{bg.userId} {bg.username ?? ''} ({bg.email ?? ''})
                  </td>
                  <td style={{ padding: '8px' }}>
                    <strong>{bg.statusName}</strong>
                    {bg.expiresAt && (
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Hết hạn: {new Date(bg.expiresAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {bg.status !== 2 ? (
                        <>
                          <input
                            value={activateReasons[bg.id] ?? ''}
                            onChange={(e) =>
                              setActivateReasons((prev) => ({ ...prev, [bg.id]: e.target.value }))
                            }
                            placeholder="Lý do mở khẩn cấp..."
                            style={{ ...authStyles.input, width: '180px' }}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onActivate(bg.id, {
                                reason: activateReasons[bg.id]?.trim() || 'Emergency incident access',
                                durationMinutes: Math.min(30, bg.maxActivationMinutes),
                              })
                            }
                            style={authStyles.btnPrimary}
                          >
                            Kích hoạt 30p
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onSeal(bg.id, 'Đã xử lý xong sự cố')}
                          style={authStyles.btnSecondary}
                        >
                          Niêm phong lại
                        </button>
                      )}
                    </div>
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
