import React, { useState } from 'react';
import {
  SlidersHorizontal,
  RefreshCw,
  Database,
  CheckCircle2,
  AlertCircle,
  Layers,
  Filter,
} from 'lucide-react';
import { useCustomFieldsManagement } from './hooks/useCustomFieldsManagement';
import { CustomFieldDefinitionsPanel } from './components/CustomFieldDefinitionsPanel';
import { CustomFieldValuesAndFilterSandbox } from './components/CustomFieldValuesAndFilterSandbox';

export const CustomFieldsManagementPage: React.FC = () => {
  const {
    entities,
    selectedEntityCode,
    setSelectedEntityCode,
    definitions,
    selectedDefinition,
    setSelectedDefinition,
    histories,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    refresh,
  } = useCustomFieldsManagement();

  const [activeSubTab, setActiveSubTab] = useState<'definitions' | 'sandbox'>('definitions');

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 48px' }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
          padding: 18,
          borderRadius: 14,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SlidersHorizontal size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              9.8 — Trường tùy chỉnh &amp; Metadata (Custom Fields &amp; Metadata)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Đăng ký đối tượng mở rộng từ Manifest (9.8.1) • 5 kiểu dữ liệu TEXT/NUMBER/DATE/BOOLEAN/SELECT
            (9.8.2) • Bắt buộc &amp; Validation (9.8.3) • Phân quyền xem/sửa &amp; mã hóa nhạy cảm
            (9.8.4) • Danh sách lựa chọn có thứ tự/trạng thái (9.8.5) • Hiển thị API (9.8.6) • Lọc theo
            Index (9.8.7) • Lịch sử cấu hình &amp; Chặn đổi kiểu dữ liệu tùy tiện (9.8.8)
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-subtle, rgba(37,99,235,0.08))',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} /> Làm mới cấu hình &amp; dữ liệu
          </button>
        </div>
      </div>

      {/* Thông báo lỗi / thành công */}
      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(220,38,38,0.09)',
            border: '1px solid rgba(220,38,38,0.3)',
            color: '#dc2626',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(5,150,105,0.09)',
            border: '1px solid rgba(5,150,105,0.3)',
            color: '#059669',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={15} />
          <span>{feedback}</span>
        </div>
      )}

      {/* Danh sách loại đối tượng được phép mở rộng (Mục 9.8.1) */}
      <div
        style={{
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {entities.map((ent) => {
          const isSelected = ent.code === selectedEntityCode;
          return (
            <div
              key={ent.code}
              onClick={() => setSelectedEntityCode(ent.code)}
              style={{
                padding: 14,
                borderRadius: 12,
                border: isSelected
                  ? '2px solid var(--accent-primary, #2563eb)'
                  : '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Database size={16} color="#2563eb" />
                  <strong style={{ fontSize: 13 }}>{ent.name}</strong>
                </div>
                <code style={{ fontSize: 11 }}>{ent.code}</code>
              </div>
              <p style={{ margin: '6px 0 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                {ent.description ?? `Module: ${ent.module}`}
              </p>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>
                  Trường hoạt động: <strong>{ent.activeFieldsCount}</strong>/{ent.totalFieldsCount}
                </span>
                <span>
                  Đã đánh Index: <strong>{ent.indexedFieldsCount}</strong>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sub-navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('definitions')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'definitions' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'definitions' ? '#fff' : 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Layers size={14} /> Cấu hình Trường, Danh sách lựa chọn &amp; Lịch sử (9.8.1 – 9.8.5, 9.8.8)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('sandbox')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'sandbox' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'sandbox' ? '#fff' : 'var(--text-primary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Filter size={14} /> Lưu Giá trị Bản ghi, Hiển thị API &amp; Lọc theo Index (9.8.3 – 9.8.7)
        </button>
      </div>

      {activeSubTab === 'definitions' ? (
        <CustomFieldDefinitionsPanel
          entityCode={selectedEntityCode}
          definitions={definitions}
          selectedDefinition={selectedDefinition}
          onSelectDefinition={setSelectedDefinition}
          histories={histories}
          onRefresh={refresh}
          onError={setError}
          onFeedback={setFeedback}
        />
      ) : (
        <CustomFieldValuesAndFilterSandbox
          entityCode={selectedEntityCode}
          definitions={definitions}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}
    </main>
  );
};
