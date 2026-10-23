import React, { useState } from 'react';
import {
  Edit3,
  FlaskConical,
  History,
  Percent,
  Play,
  Plus,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type {
  FeatureFlagEvaluationResult,
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
} from '../types/settings.types';

interface FeatureFlagsTabProps {
  flags: FeatureFlagSummary[];
  search: string;
  onSearchChange: (q: string) => void;
  evalResults: FeatureFlagEvaluationResult[];
  history: FeatureFlagHistoryRecord[];
  loading: boolean;
  submitting: boolean;
  onToggleFlag: (key: string, isEnabled: boolean, reason?: string) => Promise<void>;
  onUpdateFlag: (
    key: string,
    payload: {
      name?: string;
      description?: string;
      isEnabled?: boolean;
      rolloutPercentage?: number;
      targetUserIds?: string[];
      targetRoles?: string[];
      targetOrganizationUnitIds?: string[];
      startsAt?: string | null;
      endsAt?: string | null;
      reason?: string | null;
    },
  ) => Promise<boolean>;
  onCreateFlag: (payload: {
    key: string;
    module?: string;
    name: string;
    description: string;
    isEnabled?: boolean;
    rolloutPercentage?: number;
    targetRoles?: string[];
  }) => Promise<boolean>;
  onEvaluateFlags: (params: {
    key?: string;
    userId?: string;
    roles?: string;
    organizationUnitId?: string;
  }) => Promise<void>;
}

export const FeatureFlagsTab: React.FC<FeatureFlagsTabProps> = ({
  flags,
  search,
  onSearchChange,
  evalResults,
  history,
  loading,
  submitting,
  onToggleFlag,
  onUpdateFlag,
  onCreateFlag,
  onEvaluateFlags,
}) => {
  const [editingFlag, setEditingFlag] = useState<FeatureFlagSummary | null>(null);
  const [rollout, setRollout] = useState<number>(100);
  const [targetUsersCsv, setTargetUsersCsv] = useState<string>('');
  const [targetRolesCsv, setTargetRolesCsv] = useState<string>('');
  const [targetUnitsCsv, setTargetUnitsCsv] = useState<string>('');
  const [startsAt, setStartsAt] = useState<string>('');
  const [endsAt, setEndsAt] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');

  // Simulator state
  const [simUserId, setSimUserId] = useState<string>('1');
  const [simRoles, setSimRoles] = useState<string>('SUPER_ADMIN');
  const [simOrgUnitId, setSimOrgUnitId] = useState<string>('1');

  // Create state
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [newKey, setNewKey] = useState<string>('');
  const [newModule, setNewModule] = useState<string>('settings');
  const [newName, setNewName] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newRollout, setNewRollout] = useState<number>(100);

  const openEdit = (flag: FeatureFlagSummary) => {
    setEditingFlag(flag);
    setRollout(flag.rolloutPercentage);
    setTargetUsersCsv(flag.targetUserIds.join(', '));
    setTargetRolesCsv(flag.targetRoles.join(', '));
    setTargetUnitsCsv(flag.targetOrganizationUnitIds.join(', '));
    setStartsAt(flag.startsAt ?? '');
    setEndsAt(flag.endsAt ?? '');
    setEditReason('');
  };

  const splitCsv = (raw: string): string[] =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSaveTargeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFlag) return;
    const ok = await onUpdateFlag(editingFlag.key, {
      rolloutPercentage: rollout,
      targetUserIds: splitCsv(targetUsersCsv),
      targetRoles: splitCsv(targetRolesCsv),
      targetOrganizationUnitIds: splitCsv(targetUnitsCsv),
      startsAt: startsAt.trim() || null,
      endsAt: endsAt.trim() || null,
      reason: editReason.trim() || null,
    });
    if (ok) {
      setEditingFlag(null);
    }
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onCreateFlag({
      key: newKey.trim(),
      module: newModule.trim() || 'settings',
      name: newName.trim(),
      description: newDesc.trim(),
      isEnabled: true,
      rolloutPercentage: newRollout,
    });
    if (ok) {
      setShowCreate(false);
      setNewKey('');
      setNewName('');
      setNewDesc('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Context Evaluation Simulator */}
      <div style={authStyles.cardHighlighted}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={authStyles.sectionTitle}>
            <FlaskConical size={17} color="var(--primary)" />
            <span>Bộ Mô Phỏng Đánh Giá Feature Flag (User / Role / OrgUnit / Murmur-SHA256 Rollout %)</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            style={authStyles.btnPrimary}
          >
            <Plus size={14} /> Tạo Feature Flag
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
          <div>
            <label style={authStyles.label}>User ID giả lập</label>
            <input
              type="text"
              value={simUserId}
              onChange={(e) => setSimUserId(e.target.value)}
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Danh sách Vai trò (phân cách dấu phẩy)</label>
            <input
              type="text"
              value={simRoles}
              onChange={(e) => setSimRoles(e.target.value)}
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Organization Unit ID</label>
            <input
              type="text"
              value={simOrgUnitId}
              onChange={(e) => setSimOrgUnitId(e.target.value)}
              style={authStyles.input}
            />
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              void onEvaluateFlags({
                userId: simUserId.trim() || undefined,
                roles: simRoles.trim() || undefined,
                organizationUnitId: simOrgUnitId.trim() || undefined,
              })
            }
            style={authStyles.btnTeal}
          >
            <Play size={14} /> Đánh giá hiệu lực
          </button>
        </div>

        {evalResults.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {evalResults.map((r) => (
              <div
                key={r.key}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <code>{r.key}</code>
                <span style={r.isEnabled ? authStyles.badgeSuccess : authStyles.badgeDanger}>
                  {r.isEnabled ? 'ON' : 'OFF'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>({r.matchedRule})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Form */}
      {showCreate && (
        <form onSubmit={(e) => void handleSubmitCreate(e)} style={authStyles.card}>
          <div style={authStyles.sectionTitle}>+ Tạo Feature Flag Mới</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1fr 0.6fr', gap: '12px', marginTop: '10px' }}>
            <div>
              <label style={authStyles.label}>Khóa Flag (&lt;module&gt;.&lt;feature&gt;) *</label>
              <input
                type="text"
                required
                placeholder="VD: lms.ai_tutor_beta"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Module</label>
              <input
                type="text"
                value={newModule}
                onChange={(e) => setNewModule(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tên hiển thị *</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Rollout (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={newRollout}
                onChange={(e) => setNewRollout(Number(e.target.value))}
                style={authStyles.input}
              />
            </div>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input
              type="text"
              required
              placeholder="Mô tả chi tiết mục đích sử dụng của Feature Flag..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{ ...authStyles.input, flex: 1 }}
            />
            <button type="button" onClick={() => setShowCreate(false)} style={authStyles.btnSecondary}>
              Hủy
            </button>
            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Save size={14} /> Tạo Flag
            </button>
          </div>
        </form>
      )}

      {/* Targeting Editor Drawer */}
      {editingFlag && (
        <form onSubmit={(e) => void handleSaveTargeting(e)} style={authStyles.cardHighlighted}>
          <div style={authStyles.sectionTitle}>
            Cấu hình Quy tắc Nhắm mục tiêu (Targeting & Rollout): <code>{editingFlag.key}</code>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={authStyles.label}>Tỷ lệ Rollout (0% - 100%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={rollout}
                onChange={(e) => setRollout(Number(e.target.value))}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Target Roles (phân cách phẩy)</label>
              <input
                type="text"
                placeholder="VD: SUPER_ADMIN, TEACHER"
                value={targetRolesCsv}
                onChange={(e) => setTargetRolesCsv(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Target User IDs (phân cách phẩy)</label>
              <input
                type="text"
                placeholder="VD: 1, 15, 42"
                value={targetUsersCsv}
                onChange={(e) => setTargetUsersCsv(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Target Org Unit IDs</label>
              <input
                type="text"
                placeholder="VD: 1, 2"
                value={targetUnitsCsv}
                onChange={(e) => setTargetUnitsCsv(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Bắt đầu hiệu lực (ISO / để trống)</label>
              <input
                type="text"
                placeholder="2026-01-01T00:00:00Z"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Kết thúc hiệu lực (ISO / để trống)</label>
              <input
                type="text"
                placeholder="2026-12-31T23:59:59Z"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', gap: '12px' }}>
            <input
              type="text"
              placeholder="Lý do cập nhật quy tắc targeting..."
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              style={{ ...authStyles.input, maxWidth: '420px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setEditingFlag(null)} style={authStyles.btnSecondary}>
                Đóng
              </button>
              <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
                <Save size={14} /> Lưu quy tắc
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Feature Flags Table */}
      <div style={authStyles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={authStyles.sectionTitle}>Danh sách Feature Flags ({flags.length})</div>
          <div style={{ position: 'relative', width: '300px' }}>
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
              placeholder="Tìm mã hoặc tên Feature Flag..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ ...authStyles.input, paddingLeft: '32px' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Khóa & Mô tả</th>
                <th style={authStyles.tableHeaderCell}>Module</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                <th style={authStyles.tableHeaderCell}>Rollout %</th>
                <th style={authStyles.tableHeaderCell}>Đối tượng nhắm mục tiêu</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', padding: '24px' }}>
                    Đang tải Feature Flags...
                  </td>
                </tr>
              ) : (
                flags.map((f) => (
                  <tr key={f.key}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{f.name}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                        {f.key}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{f.description}</div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={f.isModuleInstalled ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                        {f.module} {f.isModuleInstalled ? '✓' : '(Chưa cài)'}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        disabled={submitting || !f.isModuleInstalled}
                        onClick={() => void onToggleFlag(f.key, !f.isEnabled)}
                        style={{
                          ...authStyles.btnSecondary,
                          padding: '5px 10px',
                          borderColor: f.isEnabled ? 'var(--secondary)' : 'var(--border-strong)',
                          color: f.isEnabled ? 'var(--secondary)' : 'var(--text-muted)',
                        }}
                      >
                        {f.isEnabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                        <span>{f.isEnabled ? 'ENABLED' : 'DISABLED'}</span>
                      </button>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>
                        <Percent size={11} /> {f.rolloutPercentage}%
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', fontSize: '11.5px' }}>
                        {f.targetRoles.length > 0 && (
                          <span style={authStyles.badgePrimary}>Roles: {f.targetRoles.join(', ')}</span>
                        )}
                        {f.targetUserIds.length > 0 && (
                          <span style={authStyles.badgeSuccess}>Users: {f.targetUserIds.length}</span>
                        )}
                        {f.targetOrganizationUnitIds.length > 0 && (
                          <span style={authStyles.badgeWarning}>
                            Units: {f.targetOrganizationUnitIds.length}
                          </span>
                        )}
                        {f.targetRoles.length === 0 &&
                          f.targetUserIds.length === 0 &&
                          f.targetOrganizationUnitIds.length === 0 && (
                            <span style={{ color: 'var(--text-muted)' }}>Toàn bộ người dùng</span>
                          )}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        onClick={() => openEdit(f)}
                        style={{ ...authStyles.btnSecondary, padding: '6px 10px', fontSize: '12px' }}
                      >
                        <Edit3 size={13} /> Targeting
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* History */}
      <div style={authStyles.card}>
        <div style={authStyles.sectionTitle}>
          <History size={16} color="var(--secondary)" />
          <span>Nhật ký Thay đổi Feature Flags (feature_flag_histories)</span>
        </div>
        <div style={{ overflowX: 'auto', marginTop: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Thời gian</th>
                <th style={authStyles.tableHeaderCell}>Flag Key</th>
                <th style={authStyles.tableHeaderCell}>Hành động</th>
                <th style={authStyles.tableHeaderCell}>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 8).map((h) => (
                <tr key={h.id}>
                  <td style={{ ...authStyles.tableCell, fontSize: '12px', color: 'var(--text-muted)' }}>
                    {new Date(h.createdAt).toLocaleString('vi-VN')}
                  </td>
                  <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {h.flagKey}
                  </td>
                  <td style={authStyles.tableCell}>
                    <span style={authStyles.badgePrimary}>{h.action}</span>
                  </td>
                  <td style={authStyles.tableCell}>{h.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

