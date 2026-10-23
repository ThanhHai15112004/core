import React, { useState } from 'react';
import {
  Database,
  Edit3,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Unlock,
} from 'lucide-react';
import {
  authBadgeStyle,
  authBtnPrimaryStyle,
  authBtnSecondaryStyle,
  authCardStyle,
  authInputStyle,
  authLabelStyle,
} from '../../auth/components/auth-ui.styles';
import {
  CODE_ITEM_STATUS,
  CODE_STATUS_META,
  CODES_MODULE_FILTERS,
} from '../enum/codes.enum';
import type {
  CodeTypeSummaryItem,
  CreateCodeTypePayload,
  UpdateCodeTypePayload,
} from '../types/codes.types';

interface CodeTypesCatalogSidebarProps {
  codeTypes: CodeTypeSummaryItem[];
  selectedType: CodeTypeSummaryItem | null;
  onSelectType: (type: CodeTypeSummaryItem) => void;
  moduleFilter: string;
  onModuleFilterChange: (mod: string) => void;
  searchFilter: string;
  onSearchFilterChange: (q: string) => void;
  loading: boolean;
  submitting: boolean;
  onSyncManifests: () => Promise<void>;
  onCreateCodeType: (payload: CreateCodeTypePayload) => Promise<boolean>;
  onUpdateCodeType: (typeCode: string, payload: UpdateCodeTypePayload) => Promise<boolean>;
}

export const CodeTypesCatalogSidebar: React.FC<CodeTypesCatalogSidebarProps> = ({
  codeTypes,
  selectedType,
  onSelectType,
  moduleFilter,
  onModuleFilterChange,
  searchFilter,
  onSearchFilterChange,
  loading,
  submitting,
  onSyncManifests,
  onCreateCodeType,
  onUpdateCodeType,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingType, setEditingType] = useState<CodeTypeSummaryItem | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newModule, setNewModule] = useState('common');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAllowCustom, setNewAllowCustom] = useState(true);

  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAllowCustom, setEditAllowCustom] = useState(true);
  const [editStatus, setEditStatus] = useState<number>(CODE_ITEM_STATUS.ACTIVE);

  const openEditModal = (item: CodeTypeSummaryItem) => {
    setEditingType(item);
    setEditName(item.name);
    setEditDesc(item.description ?? '');
    setEditAllowCustom(item.allowCustomValues);
    setEditStatus(item.status);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    const ok = await onCreateCodeType({
      code: newCode.trim(),
      module: newModule.trim() || 'common',
      name: newName.trim(),
      description: newDesc.trim() || null,
      allowCustomValues: newAllowCustom,
      status: CODE_ITEM_STATUS.ACTIVE,
    });
    if (ok) {
      setNewCode('');
      setNewName('');
      setNewDesc('');
      setShowCreateForm(false);
    }
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType || !editName.trim()) return;
    const ok = await onUpdateCodeType(editingType.code, {
      name: editName.trim(),
      description: editDesc.trim() || null,
      allowCustomValues: editAllowCustom,
      status: editStatus,
    });
    if (ok) {
      setEditingType(null);
    }
  };

  return (
    <div style={{ ...authCardStyle, padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database size={18} color="var(--primary)" />
          <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 800, color: 'var(--text-main)' }}>
            Nhóm Danh Mục ({codeTypes.length})
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            style={{ ...authBtnSecondaryStyle, padding: '6px 10px', fontSize: '12px' }}
            onClick={() => void onSyncManifests()}
            disabled={submitting}
            title="Đồng bộ từ module.manifest.json"
          >
            <RefreshCw size={13} />
            <span>Sync Manifest</span>
          </button>
          <button
            type="button"
            style={{ ...authBtnPrimaryStyle, padding: '6px 10px', fontSize: '12px' }}
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus size={13} />
            <span>Tạo nhóm</span>
          </button>
        </div>
      </div>

      {/* Bộ lọc Module & Tìm kiếm */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <select
          value={moduleFilter}
          onChange={(e) => onModuleFilterChange(e.target.value)}
          style={{ ...authInputStyle, padding: '8px 10px', fontSize: '13px' }}
        >
          {CODES_MODULE_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

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
            placeholder="Tìm mã hoặc tên nhóm danh mục..."
            value={searchFilter}
            onChange={(e) => onSearchFilterChange(e.target.value)}
            style={{ ...authInputStyle, padding: '8px 10px 8px 32px', fontSize: '13px' }}
          />
        </div>
      </div>

      {/* Form Tạo Nhóm Danh Mục Mới */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleSubmitCreate(e)}
          style={{
            padding: '14px',
            borderRadius: '10px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
            + Tạo Nhóm Danh Mục Mới (code_types)
          </div>
          <div>
            <label style={authLabelStyle}>Module sở hữu</label>
            <input
              type="text"
              value={newModule}
              onChange={(e) => setNewModule(e.target.value)}
              placeholder="common, crm, lms..."
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={authLabelStyle}>Mã nhóm (code) *</label>
            <input
              type="text"
              required
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="VD: crm.customer_tier"
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={authLabelStyle}>Tên hiển thị *</label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="VD: Phân hạng khách hàng"
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={authLabelStyle}>Mô tả</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Mô tả ý nghĩa nhóm danh mục"
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={newAllowCustom}
              onChange={(e) => setNewAllowCustom(e.target.checked)}
            />
            <span>Cho phép thêm giá trị tùy chỉnh (allowCustomValues)</span>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              style={{ ...authBtnSecondaryStyle, padding: '6px 12px', fontSize: '12px' }}
              onClick={() => setShowCreateForm(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ ...authBtnPrimaryStyle, padding: '6px 12px', fontSize: '12px' }}
            >
              Lưu nhóm mã
            </button>
          </div>
        </form>
      )}

      {/* Form Sửa Nhóm Danh Mục */}
      {editingType && (
        <form
          onSubmit={(e) => void handleSubmitEdit(e)}
          style={{
            padding: '14px',
            borderRadius: '10px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--primary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)' }}>
            Cập nhật Nhóm: {editingType.code}
          </div>
          <div>
            <label style={authLabelStyle}>Tên hiển thị *</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <div>
            <label style={authLabelStyle}>Mô tả</label>
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={editAllowCustom}
              onChange={(e) => setEditAllowCustom(e.target.checked)}
            />
            <span>Cho phép thêm giá trị tùy chỉnh</span>
          </label>
          {!editingType.isSystem && (
            <div>
              <label style={authLabelStyle}>Trạng thái</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(Number(e.target.value))}
                style={{ ...authInputStyle, padding: '7px 10px', fontSize: '12.5px' }}
              >
                <option value={CODE_ITEM_STATUS.ACTIVE}>Hoạt động (ACTIVE)</option>
                <option value={CODE_ITEM_STATUS.INACTIVE}>Ngừng dùng (INACTIVE)</option>
              </select>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              style={{ ...authBtnSecondaryStyle, padding: '6px 12px', fontSize: '12px' }}
              onClick={() => setEditingType(null)}
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{ ...authBtnPrimaryStyle, padding: '6px 12px', fontSize: '12px' }}
            >
              Cập nhật
            </button>
          </div>
        </form>
      )}

      {/* Danh sách Nhóm Danh Mục */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '560px',
          overflowY: 'auto',
          paddingRight: '4px',
        }}
      >
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Đang tải danh mục hệ thống...
          </div>
        ) : codeTypes.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Không tìm thấy nhóm danh mục phù hợp.
          </div>
        ) : (
          codeTypes.map((item) => {
            const isSelected = selectedType?.code === item.code;
            const statusInfo = CODE_STATUS_META[item.status] ?? CODE_STATUS_META[CODE_ITEM_STATUS.ACTIVE];
            return (
              <div
                key={item.code}
                onClick={() => onSelectType(item)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: isSelected
                    ? '1.5px solid var(--primary)'
                    : '1px solid var(--border-color)',
                  background: isSelected ? 'var(--primary-light)' : 'var(--bg-surface)',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-main)' }}>
                    {item.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        ...authBadgeStyle( 'var(--primary)', 'var(--bg-surface-elevated)'),
                        fontSize: '11px',
                      }}
                    >
                      {item.totalValues} mục
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(item);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '2px',
                      }}
                      title="Sửa nhóm danh mục"
                    >
                      <Edit3 size={13} />
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 600 }}>
                  {item.code}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                  <span style={authBadgeStyle('var(--secondary)', 'rgba(20, 184, 166, 0.12)')}>
                    {item.module}
                  </span>
                  {item.isSystem ? (
                    <span style={authBadgeStyle('#64748B', 'rgba(100, 116, 139, 0.14)')}>
                      <Lock size={10} /> System
                    </span>
                  ) : (
                    <span style={authBadgeStyle('#2563EB', 'rgba(37, 99, 235, 0.12)')}>
                      <Unlock size={10} /> Custom
                    </span>
                  )}
                  <span style={authBadgeStyle(statusInfo.color, statusInfo.bg)}>
                    {item.status === CODE_ITEM_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

