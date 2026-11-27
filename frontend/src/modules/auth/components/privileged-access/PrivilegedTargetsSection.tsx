import React, { useState } from 'react';
import { authStyles } from '../auth-ui.styles';
import type { PrivilegedAccessTargetInput } from '../../services/privileged-access-api-types';
import type {
  PrivilegedSensitivityLevel,
  PrivilegedTargetItem,
  PrivilegedTargetType,
  PrivilegedUserDirectoryItem,
} from '../../types/privileged-access.types';

interface Props {
  readonly busy: boolean;
  readonly targets: readonly PrivilegedTargetItem[];
  readonly standingUsers: readonly PrivilegedUserDirectoryItem[];
  readonly onUpsertTarget: (payload: PrivilegedAccessTargetInput) => Promise<void>;
  readonly onToggleTargetField: (
    target: PrivilegedTargetItem,
    patch: Partial<PrivilegedAccessTargetInput>,
  ) => Promise<void>;
}

export const PrivilegedTargetsSection: React.FC<Props> = ({
  busy,
  targets,
  standingUsers,
  onUpsertTarget,
  onToggleTargetField,
}) => {
  const [targetType, setTargetType] = useState<PrivilegedTargetType>('ROLE');
  const [targetCode, setTargetCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sensitivityLevel, setSensitivityLevel] = useState<PrivilegedSensitivityLevel>('CRITICAL');
  const [maxGrantMinutes, setMaxGrantMinutes] = useState(120);
  const [requireMfaStepUp, setRequireMfaStepUp] = useState(true);
  const [requireApproval, setRequireApproval] = useState(true);
  const [alertOnUse, setAlertOnUse] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCode.trim() || !displayName.trim()) return;
    await onUpsertTarget({
      targetType,
      targetCode: targetCode.trim(),
      displayName: displayName.trim(),
      sensitivityLevel,
      requireMfaStepUp,
      requireApproval,
      autoApproveAllowed: false,
      maxGrantMinutes,
      alertOnUse,
      reviewIntervalDays: 60,
      isEnabled: true,
    });
    setTargetCode('');
    setDisplayName('');
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Đánh dấu Vai trò / Quyền đặc biệt</h3>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '12px',
            alignItems: 'end',
          }}
        >
          <div>
            <label style={authStyles.label}>Loại mục tiêu</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as PrivilegedTargetType)}
              style={authStyles.input}
            >
              <option value="ROLE">ROLE (Vai trò)</option>
              <option value="PERMISSION">PERMISSION (Mã quyền)</option>
            </select>
          </div>
          <div>
            <label style={authStyles.label}>Mã Role / Permission</label>
            <input
              value={targetCode}
              onChange={(e) => setTargetCode(e.target.value)}
              placeholder="super_admin / roles.manage"
              style={authStyles.monoInput}
              required
            />
          </div>
          <div>
            <label style={authStyles.label}>Tên hiển thị</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Quản trị tối cao"
              style={authStyles.input}
              required
            />
          </div>
          <div>
            <label style={authStyles.label}>Mức độ nhạy cảm</label>
            <select
              value={sensitivityLevel}
              onChange={(e) => setSensitivityLevel(e.target.value as PrivilegedSensitivityLevel)}
              style={authStyles.input}
            >
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
            </select>
          </div>
          <div>
            <label style={authStyles.label}>Thời hạn JIT tối đa (phút)</label>
            <input
              type="number"
              min={5}
              max={10080}
              value={maxGrantMinutes}
              onChange={(e) => setMaxGrantMinutes(Number(e.target.value) || 120)}
              style={authStyles.input}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', paddingBottom: '6px' }}>
            <label style={{ fontSize: '12.5px', display: 'flex', gap: '5px' }}>
              <input
                type="checkbox"
                checked={requireMfaStepUp}
                onChange={(e) => setRequireMfaStepUp(e.target.checked)}
              />
              MFA Step-Up
            </label>
            <label style={{ fontSize: '12.5px', display: 'flex', gap: '5px' }}>
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
              />
              Phê duyệt
            </label>
            <label style={{ fontSize: '12.5px', display: 'flex', gap: '5px' }}>
              <input
                type="checkbox"
                checked={alertOnUse}
                onChange={(e) => setAlertOnUse(e.target.checked)}
              />
              Cảnh báo
            </label>
          </div>
          <button type="submit" disabled={busy} style={authStyles.btnPrimary}>
            Lưu đánh dấu
          </button>
        </form>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Danh mục Vai trò & Quyền đặc biệt ({targets.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px' }}>Mục tiêu</th>
                <th style={{ padding: '8px' }}>Mức độ</th>
                <th style={{ padding: '8px' }}>MFA Step-Up</th>
                <th style={{ padding: '8px' }}>Cần duyệt</th>
                <th style={{ padding: '8px' }}>Cảnh báo</th>
                <th style={{ padding: '8px' }}>Max JIT</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{t.targetCode}</strong>{' '}
                    <span style={authStyles.badgePrimary}>{t.targetType}</span>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {t.displayName}
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>{t.sensitivityLevel}</td>
                  <td style={{ padding: '8px' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void onToggleTargetField(t, { requireMfaStepUp: !t.requireMfaStepUp })
                      }
                      style={t.requireMfaStepUp ? authStyles.badgeSuccess : authStyles.badgeWarning}
                    >
                      {t.requireMfaStepUp ? 'Bắt buộc MFA' : 'Tắt'}
                    </button>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void onToggleTargetField(t, { requireApproval: !t.requireApproval })
                      }
                      style={t.requireApproval ? authStyles.badgeSuccess : authStyles.badgeWarning}
                    >
                      {t.requireApproval ? 'Có' : 'Không'}
                    </button>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onToggleTargetField(t, { alertOnUse: !t.alertOnUse })}
                      style={t.alertOnUse ? authStyles.badgeSuccess : authStyles.badgeWarning}
                    >
                      {t.alertOnUse ? 'Bật' : 'Tắt'}
                    </button>
                  </td>
                  <td style={{ padding: '8px' }}>{t.maxGrantMinutes} phút</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          Tài khoản Admin đặc biệt hiện có từ bảng `users` ({standingUsers.length})
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '8px' }}>User</th>
                <th style={{ padding: '8px' }}>Vai trò đặc biệt</th>
                <th style={{ padding: '8px' }}>Trạng thái</th>
                <th style={{ padding: '8px' }}>Break-glass</th>
              </tr>
            </thead>
            <tbody>
              {standingUsers.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>
                      #{u.id} {u.username}
                    </strong>{' '}
                    ({u.fullName})
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '8px' }}>{u.privilegedRoleCodes.join(', ')}</td>
                  <td style={{ padding: '8px' }}>{u.statusName}</td>
                  <td style={{ padding: '8px' }}>
                    {u.isLinkedBreakGlass
                      ? `${u.breakGlassCode} (${u.breakGlassStatus})`
                      : 'Chưa liên kết'}
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
