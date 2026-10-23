import React, { useState } from 'react';
import {
  Edit3,
  History,
  KeyRound,
  Layers,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { authBadgeStyle, authStyles } from '../../auth/components/auth-ui.styles';
import {
  SETTING_ENVIRONMENT_OPTIONS,
  SETTING_VALUE_TYPE,
  SETTING_VALUE_TYPE_OPTIONS,
} from '../enum/settings.enum';
import type {
  SettingGroupSummary,
  SettingHistoryRecord,
  SystemSettingSummary,
} from '../types/settings.types';

interface SystemSettingsTabProps {
  groups: SettingGroupSummary[];
  selectedGroupCode: string;
  onSelectGroupCode: (code: string) => void;
  settings: SystemSettingSummary[];
  environment: string;
  onEnvironmentChange: (env: string) => void;
  orgUnitId: string;
  onOrgUnitIdChange: (unitId: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  history: SettingHistoryRecord[];
  loading: boolean;
  submitting: boolean;
  onUpdateSettingValue: (
    key: string,
    payload: {
      value: unknown;
      environment?: string;
      organizationUnitId?: number | null;
      reason?: string | null;
    },
  ) => Promise<boolean>;
  onRemoveScopeOverride: (
    key: string,
    params: { environment?: string; organizationUnitId?: number; reason?: string },
  ) => Promise<boolean>;
  onCreateSetting: (payload: {
    key: string;
    groupCode: string;
    module?: string;
    namespace?: string;
    name: string;
    description?: string | null;
    valueType: number;
    defaultValue: unknown;
    isSensitive?: boolean;
    allowUnitOverride?: boolean;
  }) => Promise<boolean>;
}

export const SystemSettingsTab: React.FC<SystemSettingsTabProps> = ({
  groups,
  selectedGroupCode,
  onSelectGroupCode,
  settings,
  environment,
  onEnvironmentChange,
  orgUnitId,
  onOrgUnitIdChange,
  search,
  onSearchChange,
  history,
  loading,
  submitting,
  onUpdateSettingValue,
  onRemoveScopeOverride,
  onCreateSetting,
}) => {
  const [editingSetting, setEditingSetting] = useState<SystemSettingSummary | null>(null);
  const [editValueText, setEditValueText] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  // Create form state
  const [newKey, setNewKey] = useState('');
  const [newGroupCode, setNewGroupCode] = useState('system');
  const [newModule, setNewModule] = useState('settings');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newValueType, setNewValueType] = useState<number>(SETTING_VALUE_TYPE.TEXT);
  const [newDefaultValue, setNewDefaultValue] = useState('');
  const [newIsSensitive, setNewIsSensitive] = useState(false);
  const [newAllowUnitOverride, setNewAllowUnitOverride] = useState(true);

  const openEditSetting = (item: SystemSettingSummary) => {
    setEditingSetting(item);
    if (item.isSensitive) {
      setEditValueText('');
    } else if (item.valueType === SETTING_VALUE_TYPE.JSON) {
      setEditValueText(
        typeof item.value === 'string' ? item.value : JSON.stringify(item.value ?? {}, null, 2),
      );
    } else {
      setEditValueText(item.value !== undefined && item.value !== null ? String(item.value) : '');
    }
    setEditReason('');
  };

  const parseTypedValue = (raw: string, valueType: number): unknown => {
    if (valueType === SETTING_VALUE_TYPE.NUMBER) {
      return Number(raw);
    }
    if (valueType === SETTING_VALUE_TYPE.BOOLEAN) {
      return raw === 'true' || raw === '1';
    }
    if (valueType === SETTING_VALUE_TYPE.JSON) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  const handleSaveSettingValue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSetting) return;
    const parsedVal = parseTypedValue(editValueText, editingSetting.valueType);
    const parsedUnitId = orgUnitId ? Number(orgUnitId) : null;
    const ok = await onUpdateSettingValue(editingSetting.key, {
      value: parsedVal,
      environment: environment || undefined,
      organizationUnitId: parsedUnitId && !Number.isNaN(parsedUnitId) ? parsedUnitId : null,
      reason: editReason.trim() || null,
    });
    if (ok) {
      setEditingSetting(null);
    }
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onCreateSetting({
      key: newKey.trim(),
      groupCode: newGroupCode.trim() || 'system',
      module: newModule.trim() || 'settings',
      name: newName.trim(),
      description: newDesc.trim() || null,
      valueType: newValueType,
      defaultValue: parseTypedValue(newDefaultValue, newValueType),
      isSensitive: newIsSensitive,
      allowUnitOverride: newAllowUnitOverride,
    });
    if (ok) {
      setShowCreateForm(false);
      setNewKey('');
      setNewName('');
      setNewDesc('');
      setNewDefaultValue('');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: '18px', alignItems: 'start' }}>
      {/* Left Sidebar: Setting Groups */}
      <div style={{ ...authStyles.card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--text-main)' }}>
            Nhóm Cấu Hình ({groups.length})
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            style={{ ...authStyles.btnPrimary, padding: '6px 10px', fontSize: '12px' }}
          >
            <Plus size={13} />
            <span>Thêm khóa</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onSelectGroupCode('')}
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            textAlign: 'left',
            cursor: 'pointer',
            border:
              selectedGroupCode === ''
                ? '1.5px solid var(--primary)'
                : '1px solid var(--border-color)',
            background: selectedGroupCode === '' ? 'var(--primary-light)' : 'var(--bg-surface)',
            color: 'var(--text-main)',
            fontWeight: 700,
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Tất cả nhóm cấu hình</span>
          <span style={authStyles.badgePrimary}>{settings.length}</span>
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {groups.map((grp) => {
            const active = selectedGroupCode === grp.code;
            return (
              <div
                key={grp.code}
                onClick={() => onSelectGroupCode(grp.code)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: active ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                  background: active ? 'var(--primary-light)' : 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>
                    {grp.name}
                  </span>
                  <span style={authBadgeStyle('var(--primary)', 'var(--bg-surface-elevated)')}>
                    {grp.settingCount}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                  {grp.code} · {grp.module}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Panel: Scope Context Bar + Settings Table + History */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 5-Layer Scope Resolution Filter Bar */}
        <div style={authStyles.cardHighlighted}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={authStyles.sectionTitle}>
              <Layers size={17} color="var(--primary)" />
              <span>Bộ Phân Giải Cấu Hình 5 Tầng (Unit+Env → Unit → Env → Global → Manifest Default)</span>
            </div>
            <span style={authStyles.badgeSuccess}>
              <ShieldCheck size={12} /> AES-256-GCM Secret Masking
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 1.2fr', gap: '12px' }}>
            <div>
              <label style={authStyles.label}>Môi trường phân giải (Environment Scope)</label>
              <select
                value={environment}
                onChange={(e) => onEnvironmentChange(e.target.value)}
                style={authStyles.input}
              >
                {SETTING_ENVIRONMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={authStyles.label}>Mã ID Đơn vị ghi đè (Organization Unit ID)</label>
              <input
                type="number"
                min={1}
                placeholder="Để trống = Toàn hệ thống"
                value={orgUnitId}
                onChange={(e) => onOrgUnitIdChange(e.target.value)}
                style={authStyles.input}
              />
            </div>

            <div>
              <label style={authStyles.label}>Tìm kiếm khóa / tên cấu hình</label>
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
                  placeholder="VD: pagination, smtp, security..."
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  style={{ ...authStyles.input, paddingLeft: '32px' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Create New Setting Form */}
        {showCreateForm && (
          <form onSubmit={(e) => void handleSubmitCreate(e)} style={authStyles.card}>
            <div style={authStyles.sectionTitle}>+ Tạo Định Nghĩa Cấu Hình Động Mới (system_settings)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' }}>
              <div>
                <label style={authStyles.label}>Khóa cấu hình (key) *</label>
                <input
                  type="text"
                  required
                  placeholder="VD: system.pagination.max_limit"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Nhóm cấu hình (groupCode) *</label>
                <input
                  type="text"
                  required
                  value={newGroupCode}
                  onChange={(e) => setNewGroupCode(e.target.value)}
                  style={authStyles.input}
                />
              </div>
              <div>
                <label style={authStyles.label}>Module sở hữu</label>
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
                <label style={authStyles.label}>Kiểu dữ liệu (valueType)</label>
                <select
                  value={newValueType}
                  onChange={(e) => setNewValueType(Number(e.target.value))}
                  style={authStyles.input}
                >
                  {SETTING_VALUE_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={authStyles.label}>Giá trị mặc định (defaultValue) *</label>
                <input
                  type="text"
                  required
                  value={newDefaultValue}
                  onChange={(e) => setNewDefaultValue(e.target.value)}
                  style={authStyles.input}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newIsSensitive}
                  onChange={(e) => setNewIsSensitive(e.target.checked)}
                />
                <span>Mã hóa nhạy cảm AES-256-GCM (isSensitive)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newAllowUnitOverride}
                  onChange={(e) => setNewAllowUnitOverride(e.target.checked)}
                />
                <span>Cho phép ghi đè theo Đơn vị (allowUnitOverride)</span>
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => setShowCreateForm(false)} style={authStyles.btnSecondary}>
                  Hủy
                </button>
                <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
                  <Save size={14} /> Lưu cấu hình
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Modal / Inline Drawer Edit Setting Value */}
        {editingSetting && (
          <form onSubmit={(e) => void handleSaveSettingValue(e)} style={authStyles.cardHighlighted}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--primary)' }}>
                Cập nhật giá trị khóa: <code>{editingSetting.key}</code> ({editingSetting.valueTypeName})
              </div>
              <span style={authStyles.badgePrimary}>
                Phạm vi lưu: {environment ? `ENV=${environment}` : 'GLOBAL'}{' '}
                {orgUnitId ? `/ UNIT=#${orgUnitId}` : ''}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
              <div>
                <label style={authStyles.label}>
                  Giá trị mới ({editingSetting.valueTypeName}){' '}
                  {editingSetting.isSensitive && '— Sẽ được mã hóa AES-256-GCM'}
                </label>
                {editingSetting.valueType === SETTING_VALUE_TYPE.BOOLEAN ? (
                  <select
                    value={editValueText}
                    onChange={(e) => setEditValueText(e.target.value)}
                    style={authStyles.input}
                  >
                    <option value="true">true (Bật)</option>
                    <option value="false">false (Tắt)</option>
                  </select>
                ) : editingSetting.valueType === SETTING_VALUE_TYPE.JSON ? (
                  <textarea
                    rows={3}
                    value={editValueText}
                    onChange={(e) => setEditValueText(e.target.value)}
                    style={authStyles.monoInput}
                  />
                ) : (
                  <input
                    type={editingSetting.isSensitive ? 'password' : 'text'}
                    required
                    value={editValueText}
                    onChange={(e) => setEditValueText(e.target.value)}
                    placeholder={
                      editingSetting.isSensitive ? 'Nhập chuỗi bí mật mới...' : 'Nhập giá trị...'
                    }
                    style={authStyles.monoInput}
                  />
                )}
              </div>

              <div>
                <label style={authStyles.label}>Lý do thay đổi (Audit Reason)</label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="VD: Điều chỉnh giới hạn phân trang vận hành"
                  style={authStyles.input}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setEditingSetting(null)}
                    style={authStyles.btnSecondary}
                  >
                    Đóng
                  </button>
                  <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
                    <Save size={14} /> Lưu giá trị
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Settings List Table */}
        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>
            Danh mục Tham số Vận hành ({settings.length} khóa cấu hình)
          </div>
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Khóa & Mô tả</th>
                  <th style={authStyles.tableHeaderCell}>Kiểu / Bảo mật</th>
                  <th style={authStyles.tableHeaderCell}>Giá trị Hiệu lực</th>
                  <th style={authStyles.tableHeaderCell}>Nguồn Phân giải</th>
                  <th style={authStyles.tableHeaderCell}>Ghi đè (Scopes)</th>
                  <th style={authStyles.tableHeaderCell}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', padding: '24px' }}>
                      Đang tải cấu hình hệ thống...
                    </td>
                  </tr>
                ) : settings.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', padding: '24px' }}>
                      Không có cấu hình nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  settings.map((item) => (
                    <tr key={item.key}>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{item.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                          {item.key}
                        </div>
                        {item.description && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {item.description}
                          </div>
                        )}
                      </td>
                      <td style={authStyles.tableCell}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          <span style={authStyles.badgePrimary}>{item.valueTypeName}</span>
                          {item.isSensitive && (
                            <span style={authStyles.badgeWarning}>
                              <KeyRound size={11} /> AES-256 Secret
                            </span>
                          )}
                          {item.isSystem && (
                            <span style={authBadgeStyle('#64748B', 'rgba(100,116,139,0.14)')}>
                              <Lock size={10} /> System
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <code
                          style={{
                            ...authStyles.codeBox,
                            display: 'inline-block',
                            padding: '5px 9px',
                            fontWeight: 700,
                            color: item.isSensitive ? 'var(--accent)' : 'var(--primary)',
                          }}
                        >
                          {typeof item.value === 'object'
                            ? JSON.stringify(item.value)
                            : String(item.value ?? '')}
                        </code>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Mặc định: <code>{JSON.stringify(item.defaultValue)}</code>
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgeSuccess}>{item.resolvedSource}</span>
                      </td>
                      <td style={authStyles.tableCell}>
                        {item.scopeOverrides.length === 0 ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Không có</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {item.scopeOverrides.map((sc) => (
                              <div
                                key={sc.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '11.5px',
                                }}
                              >
                                <span style={authStyles.badgePrimary}>{sc.scopeKey}</span>
                                <button
                                  type="button"
                                  title="Xóa ghi đè phạm vi này"
                                  onClick={() =>
                                    void onRemoveScopeOverride(item.key, {
                                      environment: sc.environment !== 'global' ? sc.environment : undefined,
                                      organizationUnitId: sc.organizationUnitId ?? undefined,
                                    })
                                  }
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--status-danger)',
                                    cursor: 'pointer',
                                    padding: '2px',
                                  }}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={authStyles.tableCell}>
                        <button
                          type="button"
                          onClick={() => openEditSetting(item)}
                          style={{ ...authStyles.btnSecondary, padding: '6px 10px', fontSize: '12px' }}
                        >
                          <Edit3 size={13} /> Sửa giá trị
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Setting Change History */}
        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>
            <History size={16} color="var(--secondary)" />
            <span>Nhật ký Thay đổi Cấu hình Gần đây (system_setting_histories)</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Thời gian</th>
                  <th style={authStyles.tableHeaderCell}>Khóa cấu hình</th>
                  <th style={authStyles.tableHeaderCell}>Phạm vi</th>
                  <th style={authStyles.tableHeaderCell}>Giá trị cũ → Mới</th>
                  <th style={authStyles.tableHeaderCell}>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((h) => (
                  <tr key={h.id}>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(h.createdAt).toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {h.settingKey}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>
                        {h.environment}
                        {h.organizationUnitId ? ` / Unit #${h.organizationUnitId}` : ''}
                      </span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {JSON.stringify(h.oldValue)} → <strong>{JSON.stringify(h.newValue)}</strong>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>{h.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

