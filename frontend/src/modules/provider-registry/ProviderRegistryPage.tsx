import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  History,
  RefreshCw,
  Server,
} from 'lucide-react';
import { ProviderDashboardPanel } from './components/ProviderDashboardPanel';
import { ProviderEntriesPanel } from './components/ProviderEntriesPanel';
import { ProviderHistoryPanel } from './components/ProviderHistoryPanel';
import { ProviderUnitRoutingPanel } from './components/ProviderUnitRoutingPanel';
import { useProviderRegistry } from './hooks/useProviderRegistry';
import { ALL_PROVIDER_TYPES, PROVIDER_TYPE_LABELS } from './types/provider-registry.types';

type ProviderRegistryTab = 'dashboard' | 'providers' | 'unit-routing' | 'histories';

export const ProviderRegistryPage: React.FC = () => {
  const {
    catalog,
    dashboard,
    providers,
    unitAssignments,
    histories,
    typeFilter,
    setTypeFilter,
    historyActionFilter,
    setHistoryActionFilter,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    refreshAll,
  } = useProviderRegistry();

  const [activeTab, setActiveTab] = useState<ProviderRegistryTab>('dashboard');

  const tabs: ReadonlyArray<{
    readonly id: ProviderRegistryTab;
    readonly label: string;
    readonly icon: React.ReactNode;
  }> = [
    { id: 'dashboard', label: 'Dashboard Sức khỏe & Độ trễ', icon: <Activity size={15} /> },
    { id: 'providers', label: 'Danh sách Provider', icon: <Server size={15} /> },
    { id: 'unit-routing', label: 'Định tuyến theo Đơn vị', icon: <GitBranch size={15} /> },
    { id: 'histories', label: 'Lịch sử thay đổi (Audit)', icon: <History size={15} /> },
  ];

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
            <Server size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              10.6 Quản lý Nhà cung cấp (Provider Registry)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Email • SMS • Payment • Storage • Identity — Primary / Fallback theo Policy • Chọn theo
            Đơn vị • Health Check (Healthy/Degraded/Down) • Độ trễ &amp; Tỷ lệ lỗi • Pause runtime
            • Audit
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
            }}
          >
            <option value="">Tất cả 5 loại Provider</option>
            {ALL_PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROVIDER_TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={loading}
            onClick={() => void refreshAll()}
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
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>
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
            fontSize: 12,
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
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={16} />
          <span>{feedback}</span>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                border: active ? '1px solid #2563eb' : '1px solid var(--border-subtle)',
                background: active ? 'rgba(37,99,235,0.12)' : 'var(--bg-surface)',
                color: active ? '#2563eb' : 'inherit',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'dashboard' && (
        <ProviderDashboardPanel
          dashboard={dashboard}
          typeFilter={typeFilter}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeTab === 'providers' && (
        <ProviderEntriesPanel
          catalog={catalog}
          providers={providers}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeTab === 'unit-routing' && (
        <ProviderUnitRoutingPanel
          providers={providers}
          unitAssignments={unitAssignments}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeTab === 'histories' && (
        <ProviderHistoryPanel
          histories={histories}
          actionFilter={historyActionFilter}
          onActionFilterChange={setHistoryActionFilter}
        />
      )}
    </main>
  );
};
