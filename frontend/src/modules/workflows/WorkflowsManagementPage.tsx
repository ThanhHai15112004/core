import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Layers,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { WORKFLOWS_TAB, type WorkflowsTabId } from './enum/workflows.enum';
import { useWorkflowsManagement } from './hooks/useWorkflowsManagement';
import { WorkflowDefinitionsTab } from './components/WorkflowDefinitionsTab';
import { WorkflowInstancesTab } from './components/WorkflowInstancesTab';

export const WorkflowsManagementPage: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    definitions,
    selectedDefinition,
    setSelectedDefinitionId,
    instances,
    selectedInstance,
    loadInstanceDetail,
    lastSlaScanResult,
    refreshAll,
    handleCreateDefinition,
    handleCreateNewVersion,
    handleSaveStates,
    handleSaveTransitions,
    handleStartInstance,
    handleExecuteTransition,
    handleDecideApproval,
    handleCancelInstance,
    handleScanSlaOverdue,
  } = useWorkflowsManagement();

  const tabItems: readonly { id: WorkflowsTabId; label: string; icon: React.ReactNode }[] = [
    {
      id: WORKFLOWS_TAB.INSTANCES,
      label: `Vận hành Quy trình, Phê duyệt & Lịch sử (${instances.length})`,
      icon: <PlayCircle size={15} />,
    },
    {
      id: WORKFLOWS_TAB.DEFINITIONS,
      label: `Định nghĩa Quy trình, Trạng thái & Điều kiện (${definitions.length})`,
      icon: <Layers size={15} />,
    },
  ];

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
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
              flexShrink: 0,
            }}
          >
            <GitBranch size={24} />
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
                Quản Trị Quy Trình Xử Lý (Workflow — Mục 9.3) & Phê Duyệt Đa Cấp
              </h1>
              <span style={authStyles.badgePrimary}>State Machine & SLA</span>
              <span style={authStyles.badgeSuccess}>Scheduler Integrated</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Thiết lập quy trình có phiên bản, trạng thái (Draft, Pending, Approved, Rejected),
              điều kiện & hành động chuyển trạng thái, theo dõi lịch sử và cảnh báo quá hạn SLA.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refreshAll()}
          style={authStyles.btnSecondary}
        >
          <RefreshCw size={14} /> Làm mới
        </button>
      </section>

      {banner && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 600,
            background:
              banner.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: banner.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border: `1px solid ${
              banner.type === 'success'
                ? 'rgba(16, 185, 129, 0.35)'
                : 'rgba(239, 68, 68, 0.35)'
            }`,
            marginBottom: '16px',
          }}
        >
          {banner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {tabItems.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={isActive ? authStyles.btnPrimary : authStyles.btnSecondary}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === WORKFLOWS_TAB.INSTANCES ? (
        <WorkflowInstancesTab
          definitions={definitions}
          instances={instances}
          selectedInstance={selectedInstance}
          lastSlaScanResult={lastSlaScanResult}
          submitting={submitting}
          onSelectInstance={loadInstanceDetail}
          onStartInstance={handleStartInstance}
          onExecuteTransition={handleExecuteTransition}
          onDecideApproval={handleDecideApproval}
          onCancelInstance={handleCancelInstance}
          onScanSlaOverdue={handleScanSlaOverdue}
        />
      ) : (
        <WorkflowDefinitionsTab
          definitions={definitions}
          selectedDefinition={selectedDefinition}
          submitting={submitting}
          onSelectDefinition={setSelectedDefinitionId}
          onCreateDefinition={handleCreateDefinition}
          onCreateNewVersion={handleCreateNewVersion}
          onSaveStates={handleSaveStates}
          onSaveTransitions={handleSaveTransitions}
        />
      )}
    </main>
  );
};

