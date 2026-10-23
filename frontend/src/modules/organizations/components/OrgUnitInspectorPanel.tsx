import React, { useState, useEffect } from 'react';
import { PlusCircle, Save, Trash2, GitBranch, ShieldAlert } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { ORG_UNIT_STATUS_OPTIONS, ORG_UNIT_TYPE_OPTIONS } from '../enum/organizations.enum';
import type {
  CreateOrganizationUnitPayload,
  OrganizationUnitItem,
  UpdateOrganizationUnitPayload,
} from '../types/organizations.types';

interface OrgUnitInspectorPanelProps {
  mode: 'create' | 'edit';
  selectedUnit: OrganizationUnitItem | null;
  presetParentId: number | null;
  allUnits: OrganizationUnitItem[];
  onSwitchToCreate: (parentId?: number | null) => void;
  onCreate: (payload: CreateOrganizationUnitPayload) => Promise<void>;
  onUpdate: (id: number, payload: UpdateOrganizationUnitPayload) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export const OrgUnitInspectorPanel: React.FC<OrgUnitInspectorPanelProps> = ({
  mode,
  selectedUnit,
  presetParentId,
  allUnits,
  onSwitchToCreate,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<number>(2);
  const [parentId, setParentId] = useState<string>('');
  const [status, setStatus] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (mode === 'edit' && selectedUnit) {
      setCode(selectedUnit.code);
      setName(selectedUnit.name);
      setType(selectedUnit.type);
      setParentId(selectedUnit.parentId ? String(selectedUnit.parentId) : '');
      setStatus(selectedUnit.status);
      setDescription(selectedUnit.description ?? '');
    } else {
      setCode('');
      setName('');
      setType(presetParentId ? 3 : 2);
      setParentId(presetParentId ? String(presetParentId) : '');
      setStatus(1);
      setDescription('');
    }
  }, [mode, selectedUnit, presetParentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedParentId = parentId ? Number(parentId) : null;

    if (mode === 'edit' && selectedUnit) {
      await onUpdate(selectedUnit.id, {
        name: name.trim(),
        type,
        parentId: resolvedParentId,
        status,
        description: description.trim() || null,
      });
    } else {
      await onCreate({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        parentId: resolvedParentId,
        status,
        description: description.trim() || null,
      });
    }
  };

  return (
    <div style={authStyles.cardHighlighted}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
          {mode === 'edit' && selectedUnit ? (
            <>
              <GitBranch size={18} color="var(--primary)" />
              <span>Chỉnh Sửa Đơn Vị #{selectedUnit.id}</span>
            </>
          ) : (
            <>
              <PlusCircle size={18} color="var(--secondary)" />
              <span>Tạo Mới Đơn Vị / Phòng Ban</span>
            </>
          )}
        </h3>

        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => onSwitchToCreate(null)}
            style={authStyles.btnSecondary}
          >
            + Tạo mới
          </button>
        )}
      </div>

      <p style={authStyles.sectionDesc}>
        {mode === 'edit' && selectedUnit
          ? `Đang chỉnh sửa ${selectedUnit.code}. Hệ thống tự động chặn gán đơn vị cha gây vòng lặp hoặc vượt quá độ sâu cho phép.`
          : 'Khai báo mã định danh duy nhất (Code), phân loại cấp bậc và chọn đơn vị cấp trên (Parent Unit).'}
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={authStyles.label}>Mã đơn vị (Code — Duy nhất, IN HOA)</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={mode === 'edit'}
            placeholder="VD: BRANCH_DANANG hoặc DEPT_AI"
            required
            style={{
              ...authStyles.monoInput,
              opacity: mode === 'edit' ? 0.7 : 1,
            }}
          />
        </div>

        <div>
          <label style={authStyles.label}>Tên hiển thị đơn vị / chi nhánh / phòng ban</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Chi nhánh Đà Nẵng"
            required
            style={authStyles.input}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={authStyles.label}>Phân loại cấp bậc (`unit_type`)</label>
            <select
              value={type}
              onChange={(e) => setType(Number(e.target.value))}
              style={authStyles.input}
            >
              {ORG_UNIT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Trạng thái hoạt động</label>
            <select
              value={status}
              onChange={(e) => setStatus(Number(e.target.value) as 1 | 2 | 3)}
              style={authStyles.input}
            >
              {ORG_UNIT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={authStyles.label}>Đơn vị cấp trên trực tiếp (`parentId`)</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            style={authStyles.input}
          >
            <option value="">-- Không có (Đơn vị gốc / Root Unit) --</option>
            {allUnits
              .filter((u) => (mode === 'edit' && selectedUnit ? u.id !== selectedUnit.id : true))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  #{u.id} — {u.code} ({u.name}) [{u.typeName}]
                </option>
              ))}
          </select>
        </div>

        <div>
          <label style={authStyles.label}>Mô tả chức năng / Địa chỉ</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Mô tả chức năng, nhiệm vụ hoặc địa chỉ của đơn vị..."
            style={{ ...authStyles.input, resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
          <button type="submit" style={authStyles.btnPrimary}>
            <Save size={15} />
            <span>{mode === 'edit' ? 'Lưu cập nhật đơn vị' : 'Tạo đơn vị mới'}</span>
          </button>

          {mode === 'edit' && selectedUnit && (
            <button
              type="button"
              onClick={() => void onDelete(selectedUnit.id)}
              style={authStyles.btnDanger}
            >
              <Trash2 size={14} />
              <span>Xóa mềm đơn vị</span>
            </button>
          )}
        </div>
      </form>

      {/* Ghi chú quy tắc bảo vệ toàn vẹn cây đơn vị */}
      <div
        style={{
          marginTop: '16px',
          padding: '12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-main)' }}>
          <ShieldAlert size={14} color="var(--accent)" />
          <span>Quy tắc bảo vệ toàn vẹn sơ đồ tổ chức:</span>
        </div>
        <div>• Chống vòng lặp: Không cho phép chọn đơn vị con/cháu làm đơn vị cha.</div>
        <div>• Giới hạn độ sâu: Kiểm tra động qua `organizations.hierarchy.max_depth`.</div>
        <div>• Chặn xóa an toàn: Không cho phép xóa khi còn đơn vị con hoặc nhân sự trực thuộc.</div>
      </div>
    </div>
  );
};

