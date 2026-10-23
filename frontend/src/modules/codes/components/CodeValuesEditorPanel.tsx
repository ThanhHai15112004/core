import React, { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Edit3,
  Lock,
  Plus,
  ShieldAlert,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  authBadgeStyle,
  authBtnDangerStyle,
  authBtnPrimaryStyle,
  authBtnSecondaryStyle,
  authCardStyle,
  authInputStyle,
  authLabelStyle,
} from '../../auth/components/auth-ui.styles';
import {
  CODE_ITEM_STATUS,
  CODE_STATUS_META,
  CODES_SUGGESTED_COLORS,
} from '../enum/codes.enum';
import type {
  CodeTypeSummaryItem,
  CodeValueUsageCheckResult,
  CreateCodeValuePayload,
  ResolvedCodeValueItem,
  UpdateCodeValuePayload,
} from '../types/codes.types';

interface CodeValuesEditorPanelProps {
  selectedType: CodeTypeSummaryItem | null;
  values: ResolvedCodeValueItem[];
  includeInactive: boolean;
  onIncludeInactiveChange: (val: boolean) => void;
  loading: boolean;
  submitting: boolean;
  usageResult: CodeValueUsageCheckResult | null;
  onClearUsageResult: () => void;
  onCreateValue: (payload: CreateCodeValuePayload) => Promise<boolean>;
  onUpdateValue: (numericCode: number, payload: UpdateCodeValuePayload) => Promise<boolean>;
  onDeleteValue: (numericCode: number) => Promise<boolean>;
  onCheckUsage: (numericCode: number) => Promise<void>;
}

export const CodeValuesEditorPanel: React.FC<CodeValuesEditorPanelProps> = ({
  selectedType,
  values,
  includeInactive,
  onIncludeInactiveChange,
  loading,
  submitting,
  usageResult,
  onClearUsageResult,
  onCreateValue,
  onUpdateValue,
  onDeleteValue,
  onCheckUsage,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingItem, setEditingItem] = useState<ResolvedCodeValueItem | null>(null);

  // Create state
  const [code, setCode] = useState('');
  const [numericCode, setNumericCode] = useState('');
  const [behaviorCode, setBehaviorCode] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [aliasesInput, setAliasesInput] = useState('');
  const [color, setColor] = useState<string>('#2563EB');
  const [sortOrder, setSortOrder] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Edit state
  const [editCode, setEditCode] = useState('');
  const [editBehavior, setEditBehavior] = useState('');
  const [editNameVi, setEditNameVi] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editAliases, setEditAliases] = useState('');
  const [editColor, setEditColor] = useState('#2563EB');
  const [editSortOrder, setEditSortOrder] = useState('1');
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editStatus, setEditStatus] = useState<number>(CODE_ITEM_STATUS.ACTIVE);

  const openEditItem = (item: ResolvedCodeValueItem) => {
    setEditingItem(item);
    setEditCode(item.code);
    setEditBehavior(item.behaviorCode ?? '');
    setEditNameVi(item.labels?.vi || item.name);
    setEditNameEn(item.labels?.en || '');
    setEditAliases(item.aliases.join(', '));
    setEditColor(item.color || '#2563EB');
    setEditSortOrder(String(item.sortOrder));
    setEditIsDefault(item.isDefault);
    setEditStatus(item.status);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !nameVi.trim()) return;
    const aliases = aliasesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ok = await onCreateValue({
      code: code.trim().toUpperCase(),
      numericCode: numericCode ? Number(numericCode) : undefined,
      behaviorCode: behaviorCode.trim() ? behaviorCode.trim().toUpperCase() : null,
      name: nameVi.trim(),
      labels: {
        vi: nameVi.trim(),
        ...(nameEn.trim() ? { en: nameEn.trim() } : {}),
      },
      aliases,
      color: color || null,
      sortOrder: sortOrder ? Number(sortOrder) : undefined,
      isDefault,
      status: CODE_ITEM_STATUS.ACTIVE,
    });
    if (ok) {
      setCode('');
      setNumericCode('');
      setBehaviorCode('');
      setNameVi('');
      setNameEn('');
      setAliasesInput('');
      setIsDefault(false);
      setShowCreateForm(false);
    }
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editNameVi.trim()) return;
    const aliases = editAliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ok = await onUpdateValue(editingItem.numericCode, {
      ...(!editingItem.isSystem ? { code: editCode.trim().toUpperCase() } : {}),
      ...(!editingItem.isSystem
        ? { behaviorCode: editBehavior.trim() ? editBehavior.trim().toUpperCase() : null }
        : {}),
      name: editNameVi.trim(),
      labels: {
        vi: editNameVi.trim(),
        ...(editNameEn.trim() ? { en: editNameEn.trim() } : {}),
      },
      aliases,
      color: editColor || null,
      sortOrder: Number(editSortOrder) || editingItem.sortOrder,
      isDefault: editIsDefault,
      status: editStatus,
    });
    if (ok) {
      setEditingItem(null);
    }
  };

  if (!selectedType) {
    return (
      <div style={{ ...authCardStyle, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Chọn một Nhóm Danh Mục ở cột bên trái để xem và quản trị các giá trị Hybrid Enum.
      </div>
    );
  }

  return (
    <div style={{ ...authCardStyle, display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Header của nhóm danh mục đang chọn */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '14px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
              {selectedType.name}
            </h2>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: 'var(--primary-light)',
                color: 'var(--primary)',
              }}
            >
              {selectedType.code}
            </span>
            <span style={authBadgeStyle('var(--secondary)', 'rgba(20, 184, 166, 0.14)')}>
              Module: {selectedType.module}
            </span>
          </div>
          {selectedType.description && (
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {selectedType.description}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => onIncludeInactiveChange(e.target.checked)}
            />
            <span>Hiển thị cả mục ngừng dùng</span>
          </label>

          {selectedType.allowCustomValues && (
            <button
              type="button"
              style={authBtnPrimaryStyle}
              onClick={() => {
                setShowCreateForm((v) => !v);
                setEditingItem(null);
              }}
            >
              <Plus size={15} />
              <span>Thêm Giá Trị Mã</span>
            </button>
          )}
        </div>
      </div>

      {/* Kết quả kiểm tra mức độ sử dụng (Usage Check Banner) */}
      {usageResult && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '10px',
            background: usageResult.inUse ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            border: `1px solid ${usageResult.inUse ? '#F59E0B' : '#10B981'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {usageResult.inUse ? (
              <ShieldAlert size={18} color="#F59E0B" />
            ) : (
              <CheckCircle2 size={18} color="#10B981" />
            )}
            <div style={{ fontSize: '13px', color: 'var(--text-main)' }}>
              <strong>
                Kiểm tra tham chiếu [{usageResult.code} / #{usageResult.numericCode}]:
              </strong>{' '}
              {usageResult.inUse
                ? `Đang được sử dụng bởi ${usageResult.totalUsageCount} bản ghi nghiệp vụ (${usageResult.details.map((d) => `${d.module}.${d.entity}: ${d.count}`).join(', ')}) — Hệ thống tự động chặn xóa hoặc đổi mã.`
                : 'Chưa có bản ghi nghiệp vụ nào tham chiếu — Có thể sửa mã hoặc xóa an toàn.'}
            </div>
          </div>
          <button
            type="button"
            style={{ ...authBtnSecondaryStyle, padding: '4px 10px', fontSize: '12px' }}
            onClick={onClearUsageResult}
          >
            Đóng
          </button>
        </div>
      )}

      {/* Form Thêm Giá Trị Mới */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleSubmitCreate(e)}
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>
            + Thêm Giá Trị Danh Mục Động vào nhóm {selectedType.code}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label style={authLabelStyle}>Mã định danh (code) *</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: VIP_GOLD"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Mã số (numericCode - tự tăng nếu trống)</label>
              <input
                type="number"
                min={1}
                value={numericCode}
                onChange={(e) => setNumericCode(e.target.value)}
                placeholder="Tự động cấp"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Mã hành vi (behaviorCode)</label>
              <input
                type="text"
                value={behaviorCode}
                onChange={(e) => setBehaviorCode(e.target.value)}
                placeholder="VD: ACTIVE / LOCKED"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Thứ tự hiển thị (sortOrder)</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="Mặc định theo mã số"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Nhãn Tiếng Việt (labels.vi) *</label>
              <input
                type="text"
                required
                value={nameVi}
                onChange={(e) => setNameVi(e.target.value)}
                placeholder="VD: Hạng Vàng VIP"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Nhãn Tiếng Anh (labels.en)</label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="VD: VIP Gold Tier"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Từ đồng nghĩa (aliases - cách nhau dấu phẩy)</label>
              <input
                type="text"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder="vang, gold, vip1"
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Màu sắc Badge</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                {CODES_SUGGESTED_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColor(hex)}
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: hex,
                      border: color === hex ? '2.5px solid var(--text-main)' : '1px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              <span>Đặt làm giá trị mặc định (isDefault)</span>
            </label>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                style={authBtnSecondaryStyle}
                onClick={() => setShowCreateForm(false)}
              >
                Hủy
              </button>
              <button type="submit" disabled={submitting} style={authBtnPrimaryStyle}>
                Tạo Giá Trị Mã
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Form Chỉnh sửa Giá Trị */}
      {editingItem && (
        <form
          onSubmit={(e) => void handleSubmitEdit(e)}
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: 'var(--bg-surface-elevated)',
            border: '1.5px solid var(--primary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>
            Chỉnh sửa Giá Trị #{editingItem.numericCode} ({editingItem.code})
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <label style={authLabelStyle}>Mã định danh (code)</label>
              <input
                type="text"
                disabled={editingItem.isSystem}
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                style={{ ...authInputStyle, opacity: editingItem.isSystem ? 0.65 : 1 }}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Mã hành vi (behaviorCode)</label>
              <input
                type="text"
                disabled={editingItem.isSystem}
                value={editBehavior}
                onChange={(e) => setEditBehavior(e.target.value)}
                style={{ ...authInputStyle, opacity: editingItem.isSystem ? 0.65 : 1 }}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Nhãn Tiếng Việt (labels.vi) *</label>
              <input
                type="text"
                required
                value={editNameVi}
                onChange={(e) => setEditNameVi(e.target.value)}
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Nhãn Tiếng Anh (labels.en)</label>
              <input
                type="text"
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Từ đồng nghĩa (aliases)</label>
              <input
                type="text"
                value={editAliases}
                onChange={(e) => setEditAliases(e.target.value)}
                style={authInputStyle}
              />
            </div>
            <div>
              <label style={authLabelStyle}>Thứ tự hiển thị (sortOrder)</label>
              <input
                type="number"
                value={editSortOrder}
                onChange={(e) => setEditSortOrder(e.target.value)}
                style={authInputStyle}
              />
            </div>
            {!editingItem.isSystem && (
              <div>
                <label style={authLabelStyle}>Trạng thái</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(Number(e.target.value))}
                  style={authInputStyle}
                >
                  <option value={CODE_ITEM_STATUS.ACTIVE}>Hoạt động (ACTIVE)</option>
                  <option value={CODE_ITEM_STATUS.INACTIVE}>Ngừng dùng (INACTIVE)</option>
                </select>
              </div>
            )}
            <div>
              <label style={authLabelStyle}>Màu sắc Badge</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                {CODES_SUGGESTED_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setEditColor(hex)}
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: hex,
                      border: editColor === hex ? '2.5px solid var(--text-main)' : '1px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editIsDefault}
                onChange={(e) => setEditIsDefault(e.target.checked)}
              />
              <span>Đặt làm mặc định (isDefault)</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                style={authBtnSecondaryStyle}
                onClick={() => setEditingItem(null)}
              >
                Đóng
              </button>
              <button type="submit" disabled={submitting} style={authBtnPrimaryStyle}>
                Lưu Thay Đổi
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Bảng Danh Sách Giá Trị Danh Mục (Hybrid Enum Table) */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--border-color)',
                textAlign: 'left',
                color: 'var(--text-secondary)',
                background: 'var(--bg-surface-elevated)',
              }}
            >
              <th style={{ padding: '11px 12px' }}>Mã Số</th>
              <th style={{ padding: '11px 12px' }}>Code & Behavior</th>
              <th style={{ padding: '11px 12px' }}>Nhãn Đa Ngôn Ngữ (VI / EN)</th>
              <th style={{ padding: '11px 12px' }}>Aliases</th>
              <th style={{ padding: '11px 12px' }}>Thứ Tự</th>
              <th style={{ padding: '11px 12px' }}>Nguồn & Trạng Thái</th>
              <th style={{ padding: '11px 12px', textAlign: 'right' }}>Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Đang tải danh sách giá trị...
                </td>
              </tr>
            ) : values.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Nhóm danh mục này chưa có giá trị nào.
                </td>
              </tr>
            ) : (
              values.map((val) => {
                const statusInfo =
                  CODE_STATUS_META[val.status] ?? CODE_STATUS_META[CODE_ITEM_STATUS.ACTIVE];
                return (
                  <tr
                    key={val.numericCode}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <td style={{ padding: '12px', fontWeight: 800, fontFamily: 'monospace', color: 'var(--primary)' }}>
                      #{val.numericCode}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: val.color || 'var(--primary)',
                            display: 'inline-block',
                          }}
                        />
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-main)' }}>
                          {val.code}
                        </span>
                        {val.isDefault && (
                          <span style={authBadgeStyle('#2563EB', 'rgba(37, 99, 235, 0.14)')}>
                            Default
                          </span>
                        )}
                      </div>
                      {val.behaviorCode && val.behaviorCode !== val.code && (
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Behavior: <code>{val.behaviorCode}</code>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        🇻🇳 {val.labels?.vi || val.name}
                      </div>
                      {val.labels?.en && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          🇬🇧 {val.labels.en}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {val.aliases.length > 0 ? (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {val.aliases.map((al) => (
                            <span
                              key={al}
                              style={{
                                fontSize: '11px',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                background: 'var(--bg-surface-elevated)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              <Tag size={10} style={{ marginRight: '3px' }} />
                              {al}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {val.sortOrder}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {val.isSystem ? (
                          <span style={authBadgeStyle('#64748B', 'rgba(100, 116, 139, 0.14)')}>
                            <Lock size={11} /> Neo Hệ Thống
                          </span>
                        ) : (
                          <span style={authBadgeStyle('#14B8A6', 'rgba(20, 184, 166, 0.14)')}>
                            Tùy chỉnh
                          </span>
                        )}
                        <span style={authBadgeStyle(statusInfo.color, statusInfo.bg)}>
                          {val.status === CODE_ITEM_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => void onCheckUsage(val.numericCode)}
                          style={{ ...authBtnSecondaryStyle, padding: '5px 9px', fontSize: '11.5px' }}
                          title="Kiểm tra số bản ghi đang tham chiếu mã này"
                        >
                          <Activity size={13} />
                          <span>Usage</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditItem(val)}
                          style={{ ...authBtnSecondaryStyle, padding: '5px 9px', fontSize: '11.5px' }}
                        >
                          <Edit3 size={13} />
                          <span>Sửa</span>
                        </button>
                        {!val.isSystem && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void onDeleteValue(val.numericCode)}
                            style={{ ...authBtnDangerStyle, padding: '5px 9px', fontSize: '11.5px' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

