import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Scale } from 'lucide-react';
import { DataRepairPanel } from './components/DataRepairPanel';
import { ReconciliationDiscrepanciesPanel } from './components/ReconciliationDiscrepanciesPanel';
import { ReconciliationJobsPanel } from './components/ReconciliationJobsPanel';
import {
  useReconciliationManagement,
  type ReconciliationActiveTab,
} from './hooks/useReconciliationManagement';

const TABS: ReadonlyArray<{ readonly id: ReconciliationActiveTab; readonly label: string }> = [
  { id: 'jobs', label: 'Jobs & Phiên đối soát' },
  { id: 'discrepancies', label: 'Báo cáo sai lệch' },
  { id: 'repairs', label: 'Sửa dữ liệu & Phê duyệt' },
];

export const ReconciliationManagementPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    catalog,
    jobs,
    runs,
    report,
    discrepancies,
    repairs,
    selectedRepair,
    selectedDiscrepancyForRepair,
    setSelectedDiscrepancyForRepair,
    lastPreview,
    typeFilter,
    setTypeFilter,
    severityFilter,
    setSeverityFilter,
    statusFilter,
    setStatusFilter,
    searchFilter,
    setSearchFilter,
    loading,
    submitting,
    error,
    feedback,
    refreshAll,
    createJob,
    triggerManualRun,
    assignDiscrepancy,
    updateDiscrepancyStatus,
    exportCsv,
    previewRepair,
    proposeRepair,
    openRepairDetail,
    approveRepair,
    rejectRepair,
    applyRepair,
    proposeCompensation,
    startRepairFromDiscrepancy,
  } = useReconciliationManagement();

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 48px' }}>
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
            <Scale size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              11.5 Đối soát và Sửa dữ liệu (Reconciliation &amp; Data Repair)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Job đối soát định kỳ &amp; thủ công có quyền/audit • Phân loại Thiếu / Trùng / Sai trạng
            thái / Sai số tiền • Báo cáo mức độ &amp; người phụ trách • Công cụ sửa dữ liệu Dry-Run •
            Phê duyệt Maker-Checker tách người đề xuất &amp; duyệt • Lưu Trước/Sau &amp; Hành động bù
            giữ nguyên lịch sử
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refreshAll()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-subtle, rgba(37,99,235,0.08))',
            color: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(220,38,38,0.09)',
            border: '1px solid rgba(220,38,38,0.3)',
            color: '#dc2626',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(22,163,74,0.09)',
            border: '1px solid rgba(22,163,74,0.3)',
            color: '#15803d',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={16} />
          <span>{feedback}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '9px 14px',
                borderRadius: 9,
                border: active ? '1px solid #2563eb' : '1px solid var(--border-subtle)',
                background: active ? '#2563eb' : 'var(--bg-surface)',
                color: active ? '#fff' : 'inherit',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'jobs' && (
        <ReconciliationJobsPanel
          adapters={catalog.adapters}
          jobs={jobs}
          runs={runs}
          submitting={submitting}
          onCreateJob={createJob}
          onTriggerRun={triggerManualRun}
        />
      )}

      {activeTab === 'discrepancies' && (
        <ReconciliationDiscrepanciesPanel
          report={report}
          discrepancies={discrepancies}
          typeFilter={typeFilter}
          severityFilter={severityFilter}
          statusFilter={statusFilter}
          searchFilter={searchFilter}
          submitting={submitting}
          onTypeFilterChange={setTypeFilter}
          onSeverityFilterChange={setSeverityFilter}
          onStatusFilterChange={setStatusFilter}
          onSearchFilterChange={setSearchFilter}
          onExportCsv={exportCsv}
          onAssign={assignDiscrepancy}
          onUpdateStatus={updateDiscrepancyStatus}
          onStartRepair={startRepairFromDiscrepancy}
        />
      )}

      {activeTab === 'repairs' && (
        <DataRepairPanel
          handlers={catalog.repairHandlers}
          repairs={repairs}
          selectedRepair={selectedRepair}
          selectedDiscrepancy={selectedDiscrepancyForRepair}
          lastPreview={lastPreview}
          submitting={submitting}
          onClearDiscrepancy={() => setSelectedDiscrepancyForRepair(null)}
          onPreview={previewRepair}
          onPropose={proposeRepair}
          onSelectRepair={openRepairDetail}
          onApprove={approveRepair}
          onReject={rejectRepair}
          onApply={applyRepair}
          onProposeCompensation={proposeCompensation}
        />
      )}
    </main>
  );
};
