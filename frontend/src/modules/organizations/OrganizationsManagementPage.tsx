import React from 'react';
import {
  Building2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FolderTree,
  Table2,
  Columns,
  FileSpreadsheet,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { ORG_VIEW_MODES } from './enum/organizations.enum';
import { useOrganizationsManagement } from './hooks/useOrganizationsManagement';
import { OrgStatsCards } from './components/OrgStatsCards';
import { OrgTreeExplorer } from './components/OrgTreeExplorer';
import { OrgDirectoryTable } from './components/OrgDirectoryTable';
import { OrgUnitInspectorPanel } from './components/OrgUnitInspectorPanel';
import { OrgImportExportModal } from './components/OrgImportExportModal';

export const OrganizationsManagementPage: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    units,
    filteredUnits,
    treeNodes,
    stats,
    unitTypeOptions,
    managerOptions,
    loading,
    statusBanner,
    setStatusBanner,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    parentFilter,
    setParentFilter,
    selectedUnit,
    selectedUnitId,
    formMode,
    presetParentId,
    moveImpactPreview,
    showImportExportModal,
    setShowImportExportModal,
    submittingImportExport,
    importResult,
    loadOrganizationsData,
    handleSelectUnitForEdit,
    handleOpenCreateChild,
    handleAssessMoveImpact,
    handleCreateUnit,
    handleUpdateUnit,
    handleLockUnit,
    handleUnlockUnit,
    handleDeleteUnit,
    handleExportUnits,
    handleDownloadTemplate,
    handleBulkImportUnits,
  } = useOrganizationsManagement();

  return (
    <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Hero Banner */}
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
              background: 'linear-gradient(135deg, var(--secondary), var(--primary))',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(20, 184, 166, 0.28)',
              flexShrink: 0,
            }}
          >
            <Building2 size={24} />
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
                Quản Trị Cơ Cấu Tổ Chức, Chi Nhánh & Phòng Ban
              </h1>
              <span style={authStyles.badgeSuccess}>Hierarchy Tree & Data Scope</span>
              <span style={authStyles.badgePrimary}>Hybrid Enum (unit_type)</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Quản lý cây đơn vị đa cấp (`parentId`, `path`, `managerId`), chống vòng lặp phân cấp,
              kiểm tra ảnh hưởng di chuyển đơn vị, khóa đơn vị và Import/Export sơ đồ tổ chức.
            </p>
          </div>
        </div>

        {/* View Mode Switcher + Import/Export + Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              gap: '4px',
              padding: '4px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
            }}
          >
            {ORG_VIEW_MODES.map((m) => {
              const active = viewMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setViewMode(m.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 11px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    fontSize: '12.5px',
                    fontWeight: active ? 700 : 600,
                    cursor: 'pointer',
                    background: active ? 'var(--primary)' : 'transparent',
                    color: active ? '#FFFFFF' : 'var(--text-secondary)',
                  }}
                >
                  {m.id === 'split' ? (
                    <Columns size={14} />
                  ) : m.id === 'tree' ? (
                    <FolderTree size={14} />
                  ) : (
                    <Table2 size={14} />
                  )}
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowImportExportModal(true)}
            style={authStyles.btnPrimary}
          >
            <FileSpreadsheet size={14} />
            <span>Import / Export Sơ Đồ</span>
          </button>

          <button
            type="button"
            onClick={() => void loadOrganizationsData()}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} />
            <span>{loading ? 'Đang tải...' : 'Làm mới dữ liệu'}</span>
          </button>
        </div>
      </section>

      {/* Thông báo trạng thái */}
      {statusBanner && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '18px',
            background:
              statusBanner.type === 'ok' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: statusBanner.type === 'ok' ? 'var(--status-success)' : 'var(--status-danger)',
            border: `1px solid ${
              statusBanner.type === 'ok' ? 'var(--status-success)' : 'var(--status-danger)'
            }`,
            fontSize: '13.5px',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {statusBanner.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{statusBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
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

      {/* 5 Thẻ KPI Tổng quan */}
      <OrgStatsCards stats={stats} />

      {/* Bố cục chính: Cột trái (Tree / Table) + Cột phải (Inspector Form) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.85fr) minmax(340px, 1fr)',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {(viewMode === 'split' || viewMode === 'tree') && (
            <OrgTreeExplorer
              treeNodes={treeNodes}
              selectedUnitId={selectedUnitId}
              onSelectUnit={handleSelectUnitForEdit}
              onAddChildUnit={handleOpenCreateChild}
            />
          )}

          {(viewMode === 'split' || viewMode === 'table') && (
            <OrgDirectoryTable
              units={filteredUnits}
              allUnits={units}
              unitTypeOptions={unitTypeOptions}
              selectedUnitId={selectedUnitId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              parentFilter={parentFilter}
              onParentFilterChange={setParentFilter}
              onSelectUnit={handleSelectUnitForEdit}
              onAddChildUnit={handleOpenCreateChild}
              onLockUnit={handleLockUnit}
              onUnlockUnit={handleUnlockUnit}
              onDeleteUnit={handleDeleteUnit}
            />
          )}
        </div>

        {/* Cột phải: Inspector & Tạo/Sửa đơn vị */}
        <div style={{ position: 'sticky', top: '80px' }}>
          <OrgUnitInspectorPanel
            mode={formMode}
            selectedUnit={selectedUnit}
            presetParentId={presetParentId}
            allUnits={units}
            unitTypeOptions={unitTypeOptions}
            managerOptions={managerOptions}
            moveImpactPreview={moveImpactPreview}
            onSwitchToCreate={(parentId) =>
              handleOpenCreateChild(
                parentId ? (units.find((u) => u.id === parentId) ?? null) : null,
              )
            }
            onAssessMoveImpact={handleAssessMoveImpact}
            onCreate={handleCreateUnit}
            onUpdate={handleUpdateUnit}
            onLockUnit={handleLockUnit}
            onUnlockUnit={handleUnlockUnit}
            onDelete={handleDeleteUnit}
          />
        </div>
      </div>

      {/* Modal Import / Export Sơ đồ tổ chức */}
      {showImportExportModal && (
        <OrgImportExportModal
          submitting={submittingImportExport}
          importResult={importResult}
          onClose={() => setShowImportExportModal(false)}
          onExportUnits={handleExportUnits}
          onDownloadTemplate={handleDownloadTemplate}
          onBulkImport={handleBulkImportUnits}
        />
      )}
    </main>
  );
};
