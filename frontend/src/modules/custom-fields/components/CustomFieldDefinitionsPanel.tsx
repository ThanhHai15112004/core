import React, { useState } from 'react';
import {
  Plus,
  Lock,
  Search,
  Eye,
  ShieldAlert,
  ListOrdered,
  History,
  Save,
  AlertTriangle,
} from 'lucide-react';
import { customFieldsApi } from '../services/custom-fields.api';
import type {
  CustomFieldDataType,
  CustomFieldDefinitionItem,
  CustomFieldHistoryItem,
} from '../types/custom-fields.types';

interface CustomFieldDefinitionsPanelProps {
  entityCode: string;
  definitions: CustomFieldDefinitionItem[];
  selectedDefinition: CustomFieldDefinitionItem | null;
  onSelectDefinition: (item: CustomFieldDefinitionItem) => void;
  histories: CustomFieldHistoryItem[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const CustomFieldDefinitionsPanel: React.FC<CustomFieldDefinitionsPanelProps> = ({
  entityCode,
  definitions,
  selectedDefinition,
  onSelectDefinition,
  histories,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newDataType, setNewDataType] = useState<CustomFieldDataType>('TEXT');
  const [newIsRequired, setNewIsRequired] = useState(false);
  const [newIsIndexed, setNewIsIndexed] = useState(true);
  const [newIsSensitive, setNewIsSensitive] = useState(false);
  const [newShowInApi, setNewShowInApi] = useState(true);
  const [newViewPermission, setNewViewPermission] = useState('');
  const [newEditPermission, setNewEditPermission] = useState('');
  const [newMinLength, setNewMinLength] = useState<string>('');
  const [newMaxLength, setNewMaxLength] = useState<string>('');
  const [newMinNumber, setNewMinNumber] = useState<string>('');
  const [newMaxNumber, setNewMaxNumber] = useState<string>('');
  const [newOptionsRaw, setNewOptionsRaw] = useState('OPT_A:Lựa chọn A:1:1\nOPT_B:Lựa chọn B:2:1');

  const [attemptedDataType, setAttemptedDataType] = useState<CustomFieldDataType>('NUMBER');
  const [editOptionRows, setEditOptionRows] = useState<string>('');

  const handleOpenOptionsEditor = (def: CustomFieldDefinitionItem) => {
    onSelectDefinition(def);
    const serialized = (def.options ?? [])
      .map((o) => `${o.optionCode}:${o.label}:${o.sortOrder}:${o.status}`)
      .join('\n');
    setEditOptionRows(serialized);
  };

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    try {
      const validationRules: Record<string, unknown> = {};
      if (newDataType === 'TEXT') {
        if (newMinLength.trim() !== '') validationRules.minLength = Number(newMinLength);
        if (newMaxLength.trim() !== '') validationRules.maxLength = Number(newMaxLength);
      }
      if (newDataType === 'NUMBER') {
        if (newMinNumber.trim() !== '') validationRules.min = Number(newMinNumber);
        if (newMaxNumber.trim() !== '') validationRules.max = Number(newMaxNumber);
      }

      const options =
        newDataType === 'SELECT'
          ? newOptionsRaw
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, idx) => {
                const [val, label, sortStr, statusStr] = line.split(':');
                return {
                  value: (val ?? `OPT_${idx + 1}`).trim(),
                  label: (label ?? val ?? `Option ${idx + 1}`).trim(),
                  sortOrder: Number.isFinite(Number(sortStr)) ? Number(sortStr) : idx + 1,
                  status: Number(statusStr) === 2 ? 2 : 1,
                };
              })
          : undefined;

      const created = await customFieldsApi.createDefinition({
        entityCode,
        fieldKey: newFieldKey.trim(),
        name: newName.trim(),
        labels: { vi: newName.trim(), en: newName.trim() },
        dataType: newDataType,
        isRequired: newIsRequired,
        isIndexed: newIsIndexed,
        isSensitive: newIsSensitive,
        showInApi: newShowInApi,
        showInList: true,
        showInDetail: true,
        viewPermission: newViewPermission.trim() || null,
        editPermission: newEditPermission.trim() || null,
        validationRules,
        options,
        reason: 'Tạo trường tùy chỉnh mới từ giao diện quản trị',
      });
      onFeedback(`Đã tạo trường tùy chỉnh "${created.fieldKey}" (${created.dataType}) thành công.`);
      setShowCreateForm(false);
      setNewFieldKey('');
      setNewName('');
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Tạo trường tùy chỉnh thất bại');
    }
  };

  const handleToggleProperty = async (
    def: CustomFieldDefinitionItem,
    prop: 'isRequired' | 'isIndexed' | 'showInApi' | 'isSensitive',
  ) => {
    onError(null);
    onFeedback(null);
    try {
      await customFieldsApi.updateDefinition(def.id, {
        [prop]: !def[prop],
        reason: `Cập nhật ${prop} = ${!def[prop]} từ giao diện quản trị`,
      });
      onFeedback(`Đã cập nhật ${prop} cho trường "${def.fieldKey}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Cập nhật cấu hình trường thất bại');
    }
  };

  const handleTestBlockDataTypeChange = async (def: CustomFieldDefinitionItem) => {
    onError(null);
    onFeedback(null);
    try {
      await customFieldsApi.updateDefinition(def.id, {
        dataType: attemptedDataType,
        reason: `Thử đổi kiểu dữ liệu từ ${def.dataType} sang ${attemptedDataType}`,
      });
    } catch (err) {
      onError(
        `[Chốt chặn 9.8.8 hoạt động đúng]: Hệ thống đã từ chối đổi kiểu dữ liệu từ ${def.dataType} sang ${attemptedDataType} (${
          err instanceof Error ? err.message : 'Conflict'
        }) và ghi nhận vào lịch sử cấu hình.`,
      );
      await onRefresh();
    }
  };

  const handleSaveOptions = async (def: CustomFieldDefinitionItem) => {
    onError(null);
    onFeedback(null);
    try {
      const parsedOptions = editOptionRows
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const [optionCode, label, sortStr, statusStr] = line.split(':');
          return {
            optionCode: (optionCode ?? '').trim(),
            label: (label ?? optionCode ?? '').trim(),
            labels: { vi: (label ?? optionCode ?? '').trim(), en: (label ?? optionCode ?? '').trim() },
            sortOrder: Number.isFinite(Number(sortStr)) ? Number(sortStr) : index + 1,
            status: Number(statusStr) === 2 ? 2 : 1,
          };
        });
      await customFieldsApi.upsertOptions(def.id, {
        options: parsedOptions,
        reason: 'Cập nhật thứ tự và trạng thái danh sách lựa chọn (Mục 9.8.5)',
      });
      onFeedback(`Đã lưu ${parsedOptions.length} lựa chọn cho trường "${def.fieldKey}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Cập nhật danh sách lựa chọn thất bại');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16 }}>
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Danh sách Trường tùy chỉnh ({definitions.length})
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Đối tượng đang chọn: <code>{entityCode}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--accent-primary, #2563eb)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            {showCreateForm ? 'Đóng biểu mẫu' : 'Tạo trường tùy chỉnh'}
          </button>
        </div>

        {showCreateForm && (
          <form
            onSubmit={handleCreateField}
            style={{
              marginBottom: 16,
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-subtle, rgba(148,163,184,0.06))',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Mã trường (fieldKey) *
              </label>
              <input
                value={newFieldKey}
                onChange={(e) => setNewFieldKey(e.target.value)}
                placeholder="vd: badge_code"
                required
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Tên hiển thị *
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="vd: Mã thẻ từ nhân viên"
                required
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Kiểu dữ liệu (9.8.2)
              </label>
              <select
                value={newDataType}
                onChange={(e) => setNewDataType(e.target.value as CustomFieldDataType)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              >
                <option value="TEXT">TEXT (Chuỗi văn bản)</option>
                <option value="NUMBER">NUMBER (Số học)</option>
                <option value="DATE">DATE (Ngày tháng)</option>
                <option value="BOOLEAN">BOOLEAN (Đúng/Sai)</option>
                <option value="SELECT">SELECT (Danh sách lựa chọn)</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={newIsRequired}
                  onChange={(e) => setNewIsRequired(e.target.checked)}
                />
                Bắt buộc (9.8.3)
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={newIsIndexed}
                  onChange={(e) => setNewIsIndexed(e.target.checked)}
                />
                Đánh Index lọc (9.8.7)
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={newShowInApi}
                  onChange={(e) => setNewShowInApi(e.target.checked)}
                />
                Hiển thị API (9.8.6)
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={newIsSensitive}
                  onChange={(e) => setNewIsSensitive(e.target.checked)}
                />
                Nhạy cảm / Mã hóa (9.8.4)
              </label>
            </div>

            {newDataType === 'TEXT' && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                    Độ dài tối thiểu (minLength)
                  </label>
                  <input
                    type="number"
                    value={newMinLength}
                    onChange={(e) => setNewMinLength(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                    Độ dài tối đa (maxLength)
                  </label>
                  <input
                    type="number"
                    value={newMaxLength}
                    onChange={(e) => setNewMaxLength(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  />
                </div>
              </>
            )}

            {newDataType === 'NUMBER' && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                    Giá trị nhỏ nhất (min)
                  </label>
                  <input
                    type="number"
                    value={newMinNumber}
                    onChange={(e) => setNewMinNumber(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                    Giá trị lớn nhất (max)
                  </label>
                  <input
                    type="number"
                    value={newMaxNumber}
                    onChange={(e) => setNewMaxNumber(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  />
                </div>
              </>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                Quyền xem (viewPermission - 9.8.4)
              </label>
              <input
                value={newViewPermission}
                onChange={(e) => setNewViewPermission(e.target.value)}
                placeholder="vd: users.read"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>
                Quyền sửa (editPermission - 9.8.4)
              </label>
              <input
                value={newEditPermission}
                onChange={(e) => setNewEditPermission(e.target.value)}
                placeholder="vd: users.update"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              />
            </div>

            {newDataType === 'SELECT' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                  Danh sách lựa chọn (Mỗi dòng: <code>MÃ:Nhãn hiển thị:Thứ tự:Trạng thái(1/2)</code>)
                </label>
                <textarea
                  rows={3}
                  value={newOptionsRaw}
                  onChange={(e) => setNewOptionsRaw(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                />
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#059669',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Lưu trường tùy chỉnh
              </button>
            </div>
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {definitions.map((def) => {
            const isSelected = selectedDefinition?.fieldKey === def.fieldKey;
            return (
              <div
                key={def.fieldKey}
                onClick={() => handleOpenOptionsEditor(def)}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: isSelected
                    ? '1.5px solid var(--accent-primary, #2563eb)'
                    : '1px solid var(--border-subtle)',
                  background: isSelected
                    ? 'rgba(37, 99, 235, 0.05)'
                    : 'var(--bg-subtle, rgba(148,163,184,0.03))',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{def.name}</span>
                    <code
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(100,116,139,0.12)',
                      }}
                    >
                      {def.fieldKey}
                    </code>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: 'rgba(37,99,235,0.12)',
                        color: '#2563eb',
                      }}
                    >
                      {def.dataType}
                    </span>
                    {def.isRequired && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(220,38,38,0.12)',
                          color: '#dc2626',
                        }}
                      >
                        Bắt buộc
                      </span>
                    )}
                    {def.isIndexed && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(5,150,105,0.12)',
                          color: '#059669',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Search size={10} /> Indexed
                      </span>
                    )}
                    {def.isSensitive && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(217,119,6,0.14)',
                          color: '#d97706',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Lock size={10} /> Nhạy cảm (AES)
                      </span>
                    )}
                    {def.showInApi && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'rgba(79,70,229,0.12)',
                          color: '#4f46e5',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Eye size={10} /> API
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{def.version}</span>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <span>
                    Quyền xem: <code>{def.viewPermission ?? 'Mặc định'}</code>
                  </span>
                  <span>
                    Quyền sửa: <code>{def.editPermission ?? 'Mặc định'}</code>
                  </span>
                  <span>
                    Validation: <code>{JSON.stringify(def.validationRules ?? {})}</code>
                  </span>
                </div>

                <div
                  style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleProperty(def, 'isRequired')}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {def.isRequired ? 'Bỏ bắt buộc' : 'Đặt bắt buộc'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleProperty(def, 'isIndexed')}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {def.isIndexed ? 'Tắt Index lọc' : 'Bật Index lọc'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleProperty(def, 'showInApi')}
                    style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {def.showInApi ? 'Ẩn khỏi API' : 'Hiện trong API'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cột phải: Chi tiết trường, Danh sách lựa chọn (9.8.5), Chốt chặn đổi kiểu (9.8.8) & Lịch sử */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {selectedDefinition && (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 16,
            }}
          >
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>
              Chi tiết cấu hình: <code>{selectedDefinition.fieldKey}</code> (
              {selectedDefinition.dataType})
            </h4>

            {selectedDefinition.dataType === 'SELECT' && (
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  <ListOrdered size={14} /> Danh sách lựa chọn có thứ tự & trạng thái (Mục 9.8.5)
                </div>
                <textarea
                  rows={5}
                  value={editOptionRows}
                  onChange={(e) => setEditOptionRows(e.target.value)}
                  placeholder="MÃ:Nhãn:ThứTự:TrạngThái(1=Hoạt động, 2=Ngừng)"
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    fontFamily: 'monospace',
                    fontSize: 12,
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveOptions(selectedDefinition)}
                  style={{
                    marginTop: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Save size={13} /> Lưu danh sách lựa chọn
                </button>
              </div>
            )}

            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: 'rgba(217,119,6,0.08)',
                border: '1px solid rgba(217,119,6,0.25)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#b45309',
                  marginBottom: 6,
                }}
              >
                <ShieldAlert size={14} /> Kiểm thử chốt chặn đổi kiểu dữ liệu tùy tiện (Mục 9.8.8)
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={attemptedDataType}
                  onChange={(e) => setAttemptedDataType(e.target.value as CustomFieldDataType)}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    fontSize: 12,
                  }}
                >
                  <option value="TEXT">TEXT</option>
                  <option value="NUMBER">NUMBER</option>
                  <option value="DATE">DATE</option>
                  <option value="BOOLEAN">BOOLEAN</option>
                  <option value="SELECT">SELECT</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleTestBlockDataTypeChange(selectedDefinition)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid #d97706',
                    background: 'transparent',
                    color: '#b45309',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <AlertTriangle size={12} /> Thử đổi từ {selectedDefinition.dataType} →{' '}
                  {attemptedDataType}
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            <History size={15} /> Lịch sử thay đổi cấu hình trường (Mục 9.8.8)
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 340,
              overflowY: 'auto',
            }}
          >
            {histories.map((h) => (
              <div
                key={h.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>
                    <code>{h.fieldKey}</code> — {h.actionType}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    #{h.fieldId}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {h.reason ?? 'Cập nhật cấu hình'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
