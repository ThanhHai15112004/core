import React, { useCallback, useEffect, useState } from 'react';
import { Filter, Save, CheckCircle2 } from 'lucide-react';
import { customFieldsApi } from '../services/custom-fields.api';
import type {
  CustomFieldDefinitionItem,
  CustomFieldFilterOperator,
  FilterRecordsByCustomFieldsResult,
  RecordCustomFieldsPayload,
} from '../types/custom-fields.types';

interface CustomFieldValuesAndFilterSandboxProps {
  entityCode: string;
  definitions: CustomFieldDefinitionItem[];
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const CustomFieldValuesAndFilterSandbox: React.FC<
  CustomFieldValuesAndFilterSandboxProps
> = ({ entityCode, definitions, onError, onFeedback }) => {
  const [recordId, setRecordId] = useState<string>('1');
  const [recordPayload, setRecordPayload] = useState<RecordCustomFieldsPayload | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});

  const [filterFieldKey, setFilterFieldKey] = useState<string>('');
  const [filterOperator, setFilterOperator] = useState<CustomFieldFilterOperator>('eq');
  const [filterValue, setFilterValue] = useState<string>('');
  const [filterResult, setFilterResult] = useState<FilterRecordsByCustomFieldsResult | null>(null);

  const loadRecordValues = useCallback(async () => {
    if (!entityCode || !recordId.trim()) return;
    try {
      const res = await customFieldsApi.getRecordValues(
        entityCode,
        recordId.trim(),
        'mode=detail',
      );
      setRecordPayload(res);
      setDraftValues(res.values ?? {});
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tải giá trị trường tùy chỉnh');
    }
  }, [entityCode, recordId, onError]);

  useEffect(() => {
    void loadRecordValues();
  }, [loadRecordValues]);

  useEffect(() => {
    if (definitions.length > 0 && !definitions.some((d) => d.fieldKey === filterFieldKey)) {
      setFilterFieldKey(definitions[0].fieldKey);
    }
  }, [definitions, filterFieldKey]);

  const handleSaveRecordValues = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    try {
      const updated = await customFieldsApi.setRecordValues(
        entityCode,
        recordId.trim(),
        draftValues,
      );
      setRecordPayload(updated);
      setDraftValues(updated.values ?? {});
      onFeedback(
        `Đã kiểm tra validation & lưu giá trị trường tùy chỉnh cho bản ghi ${entityCode}#${recordId}.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Lưu giá trị trường tùy chỉnh thất bại');
    }
  };

  const handleRunFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    setFilterResult(null);
    try {
      const def = definitions.find((d) => d.fieldKey === filterFieldKey);
      let coercedValue: unknown = filterValue;
      if (def?.dataType === 'NUMBER' && filterValue.trim() !== '') {
        coercedValue = Number(filterValue);
      } else if (def?.dataType === 'BOOLEAN') {
        coercedValue = filterValue.toLowerCase() === 'true' || filterValue === '1';
      }

      const res = await customFieldsApi.filterRecords({
        entityCode,
        filters: [
          {
            fieldKey: filterFieldKey,
            operator: filterOperator,
            value: coercedValue,
          },
        ],
      });
      setFilterResult(res);
      onFeedback(
        `Đã lọc theo trường Indexed "${filterFieldKey}": Tìm thấy ${res.totalMatched} bản ghi khớp.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Lọc theo trường tùy chỉnh bị từ chối');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* Khối 1: Đọc & Lưu giá trị trường tùy chỉnh theo bản ghi (Mục 9.8.3, 9.8.4, 9.8.5, 9.8.6) */}
      <form
        onSubmit={handleSaveRecordValues}
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
              Giá trị Trường tùy chỉnh theo Bản ghi (9.8.3 – 9.8.6)
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Kiểm tra bắt buộc, validation, quyền xem/sửa từng trường và hiển thị trong API
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>ID bản ghi:</span>
            <input
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              style={{
                width: 70,
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {definitions.map((def) => {
            const currentVal = draftValues[def.fieldKey];
            const activeOptions = (def.options ?? []).filter((o) => o.status === 1);
            return (
              <div
                key={def.fieldKey}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <strong>
                    {def.name} (<code>{def.fieldKey}</code>)
                    {def.isRequired ? ' *' : ''}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{def.dataType}</span>
                </div>

                {def.dataType === 'SELECT' ? (
                  <select
                    value={String(currentVal ?? '')}
                    onChange={(e) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [def.fieldKey]: e.target.value || null,
                      }))
                    }
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  >
                    <option value="">-- Chọn giá trị (chỉ hiện lựa chọn đang ACTIVE) --</option>
                    {activeOptions.map((opt) => (
                      <option key={opt.optionCode} value={opt.optionCode}>
                        {opt.label} ({opt.optionCode})
                      </option>
                    ))}
                  </select>
                ) : def.dataType === 'BOOLEAN' ? (
                  <select
                    value={currentVal === undefined || currentVal === null ? '' : String(currentVal)}
                    onChange={(e) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [def.fieldKey]:
                          e.target.value === '' ? null : e.target.value === 'true',
                      }))
                    }
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  >
                    <option value="">-- Chưa đặt --</option>
                    <option value="true">True (Có)</option>
                    <option value="false">False (Không)</option>
                  </select>
                ) : (
                  <input
                    type={
                      def.dataType === 'NUMBER'
                        ? 'number'
                        : def.dataType === 'DATE'
                          ? 'date'
                          : 'text'
                    }
                    value={currentVal === undefined || currentVal === null ? '' : String(currentVal)}
                    onChange={(e) =>
                      setDraftValues((prev) => ({
                        ...prev,
                        [def.fieldKey]:
                          e.target.value === ''
                            ? null
                            : def.dataType === 'NUMBER'
                              ? Number(e.target.value)
                              : e.target.value,
                      }))
                    }
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Số trường hiển thị trong API response: {Object.keys(recordPayload?.values ?? {}).length}
          </span>
          <button
            type="submit"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Save size={14} /> Lưu giá trị bản ghi #{recordId}
          </button>
        </div>
      </form>

      {/* Khối 2: Bộ lọc trường tùy chỉnh có đánh Index (Mục 9.8.7) */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
          Bộ lọc Trường tùy chỉnh theo Index (Mục 9.8.7)
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Chỉ các trường có <code>isIndexed = true</code> mới được phép lọc. Thử lọc trường không đánh
          index (ví dụ: <code>tax_id_number</code>) để kiểm tra chốt chặn.
        </p>

        <form
          onSubmit={handleRunFilter}
          style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr auto', gap: 8 }}
        >
          <select
            value={filterFieldKey}
            onChange={(e) => setFilterFieldKey(e.target.value)}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
            }}
          >
            {definitions.map((d) => (
              <option key={d.fieldKey} value={d.fieldKey}>
                {d.fieldKey} ({d.isIndexed ? 'INDEXED' : 'NO-INDEX'})
              </option>
            ))}
          </select>

          <select
            value={filterOperator}
            onChange={(e) => setFilterOperator(e.target.value as CustomFieldFilterOperator)}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
            }}
          >
            <option value="eq">= (Bằng)</option>
            <option value="ne">!= (Khác)</option>
            <option value="contains">Contains (Chứa)</option>
            <option value="gte">&gt;= (Lớn hơn/bằng)</option>
            <option value="lte">&lt;= (Nhỏ hơn/bằng)</option>
          </select>

          <input
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            placeholder="Giá trị lọc (vd: L5, TIER_1...)"
            required
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
            }}
          />

          <button
            type="submit"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: '#059669',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Filter size={13} /> Lọc
          </button>
        </form>

        {filterResult && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 8,
              background: 'rgba(5,150,105,0.08)',
              border: '1px solid rgba(5,150,105,0.25)',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#059669' }}>
              <CheckCircle2 size={15} /> Kết quả lọc trên <code>{filterResult.entityCode}</code>:
            </div>
            <div style={{ marginTop: 6 }}>
              Tổng số bản ghi khớp: <strong>{filterResult.totalMatched}</strong> — Danh sách ID:{' '}
              <code>
                {filterResult.matchedRecordIds.length > 0
                  ? filterResult.matchedRecordIds.join(', ')
                  : '(Không có bản ghi khớp)'}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
