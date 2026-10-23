import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Lock,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { CODE_ITEM_STATUS } from './enum/codes.enum';
import { useCodesManagement } from './hooks/useCodesManagement';
import { CodeTypesCatalogSidebar } from './components/CodeTypesCatalogSidebar';
import { CodeValuesEditorPanel } from './components/CodeValuesEditorPanel';
import { CodesBulkImportExportModal } from './components/CodesBulkImportExportModal';

export const CodesManagementPage: React.FC = () => {
  const {
    codeTypes,
    selectedType,
    setSelectedType,
    codeValues,
    moduleFilter,
    setModuleFilter,
    searchFilter,
    setSearchFilter,
    includeInactive,
    setIncludeInactive,
    loadingTypes,
    loadingValues,
    submitting,
    feedback,
    clearFeedback,
    usageResult,
    clearUsageResult,
    importResult,
    clearImportResult,
    loadCodeTypes,
    handleSyncManifests,
    handleCreateCodeType,
    handleUpdateCodeType,
    handleCreateCodeValue,
    handleUpdateCodeValue,
    handleDeleteCodeValue,
    handleCheckUsage,
    handleExportCodes,
    handleDownloadTemplate,
    handleBulkImport,
  } = useCodesManagement();

  const [showImportExportModal, setShowImportExportModal] = useState(false);

  const stats = useMemo(() => {
    const totalTypes = codeTypes.length;
    const systemTypes = codeTypes.filter((t) => t.isSystem).length;
    const customTypes = totalTypes - systemTypes;
    const totalValuesAcrossTypes = codeTypes.reduce((acc, t) => acc + (t.totalValues || 0), 0);
    const activeValuesInSelected = codeValues.filter(
      (v) => v.status === CODE_ITEM_STATUS.ACTIVE,
    ).length;

    return {
      totalTypes,
      systemTypes,
      customTypes,
      totalValuesAcrossTypes,
      activeValuesInSelected,
    };
  }, [codeTypes, codeValues]);

  return (
    <main style={{ maxWidth: '1420px', margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Hero Header Banner */}
      <section
        style={{
          background:
            'linear-gradient(135deg, var(--bg-light-blue) 0%, var(--bg-surface-elevated) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '22px 26px',
          marginBottom: '20px',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '13px',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
              flexShrink: 0,
            }}
          >
            <BookOpen size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  margin: 0,
                  color: 'var(--text-main)',
                  letterSpacing: '-0.02em',
                }}
              >
                Quản Trị Danh Mục Động & Hybrid Enum Toàn Hệ Thống
              </h1>
              <span style={authStyles.badgePrimary}>CodeRegistryService</span>
              <span style={authStyles.badgeSuccess}>In-Memory Cache + Multi-Locale</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Quản lý tập trung bảng <code>code_types</code> & <code>code_values</code>: bất biến mã
              số <code>numericCode</code> và <code>behaviorCode</code> hệ thống, cho phép tùy biến
              nhãn đa ngôn ngữ (<code>vi</code> / <code>en</code>), màu sắc, bí danh (aliases) và
              kiểm tra mức độ sử dụng trước khi xóa.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              clearImportResult();
              setShowImportExportModal(true);
            }}
            style={authStyles.btnSecondary}
          >
            <FileSpreadsheet size={15} />
            <span>Nhập / Xuất CSV & XLSX</span>
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSyncManifests()}
            style={authStyles.btnTeal}
          >
            <RefreshCw size={15} />
            <span>Đồng bộ từ Manifest</span>
          </button>

          <button
            type="button"
            disabled={loadingTypes}
            onClick={() => void loadCodeTypes()}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} />
            <span>Làm mới</span>
          </button>
        </div>
      </section>

      {/* KPI Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Tổng Nhóm Danh Mục (code_types)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {stats.totalTypes}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgePrimary}>
              <Lock size={11} /> {stats.systemTypes} System
            </span>
            <span style={authStyles.badgeSuccess}>{stats.customTypes} Custom</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Tổng Giá Trị Mã (code_values)
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--primary)',
              margin: '6px 0',
            }}
          >
            {stats.totalValuesAcrossTypes}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeSuccess}>In-Memory O(1) Lookup</span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Nhóm Đang Chọn
          </div>
          <div
            style={{
              fontSize: '17px',
              fontWeight: 800,
              color: 'var(--secondary)',
              margin: '8px 0 6px',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedType ? selectedType.code : 'Chưa chọn'}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgePrimary}>
              <Database size={11} /> Module: {selectedType?.module ?? '—'}
            </span>
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
            Giá Trị Hoạt Động Trong Nhóm
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-main)',
              margin: '6px 0',
            }}
          >
            {stats.activeValuesInSelected} / {codeValues.length}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={authStyles.badgeSuccess}>
              <Tag size={11} /> Đa ngôn ngữ vi / en
            </span>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '16px',
            background:
              feedback.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: feedback.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border:
              feedback.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.35)'
                : '1px solid rgba(239, 68, 68, 0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={clearFeedback}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Split Workspace: Left Sidebar (Code Types) + Right Panel (Code Values Editor) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '380px 1fr',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        <CodeTypesCatalogSidebar
          codeTypes={codeTypes}
          selectedType={selectedType}
          onSelectType={setSelectedType}
          moduleFilter={moduleFilter}
          onModuleFilterChange={setModuleFilter}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
          loading={loadingTypes}
          submitting={submitting}
          onSyncManifests={handleSyncManifests}
          onCreateCodeType={handleCreateCodeType}
          onUpdateCodeType={handleUpdateCodeType}
        />

        <CodeValuesEditorPanel
          selectedType={selectedType}
          values={codeValues}
          includeInactive={includeInactive}
          onIncludeInactiveChange={setIncludeInactive}
          loading={loadingValues}
          submitting={submitting}
          usageResult={usageResult}
          onClearUsageResult={clearUsageResult}
          onCreateValue={handleCreateCodeValue}
          onUpdateValue={handleUpdateCodeValue}
          onDeleteValue={handleDeleteCodeValue}
          onCheckUsage={handleCheckUsage}
        />
      </div>

      {/* Modal Nhập / Xuất Hàng Loạt */}
      {showImportExportModal && (
        <CodesBulkImportExportModal
          selectedType={selectedType}
          submitting={submitting}
          importResult={importResult}
          onClose={() => setShowImportExportModal(false)}
          onExportCodes={handleExportCodes}
          onDownloadTemplate={handleDownloadTemplate}
          onBulkImport={handleBulkImport}
        />
      )}
    </main>
  );
};

