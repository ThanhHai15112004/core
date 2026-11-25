import React from 'react';
import { AlertCircle, CheckCircle2, Inbox, Play, RefreshCw, Trash2 } from 'lucide-react';
import { OutboxDetailPanel } from './components/OutboxDetailPanel';
import { OutboxEventsTable } from './components/OutboxEventsTable';
import { OutboxMetricsBar } from './components/OutboxMetricsBar';
import { useOutboxManagement } from './hooks/useOutboxManagement';

export const OutboxManagementPage: React.FC = () => {
  const {
    metrics,
    events,
    total,
    page,
    setPage,
    statusFilter,
    setStatusFilter,
    sourceModuleFilter,
    setSourceModuleFilter,
    searchFilter,
    setSearchFilter,
    selectedEvent,
    setSelectedEvent,
    detailLoading,
    loading,
    submitting,
    error,
    feedback,
    refreshAll,
    openEventDetail,
    replayEvent,
    runProcessNow,
    runCleanup,
  } = useOutboxManagement();

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
            <Inbox size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              11.2 Transactional Outbox &amp; Gửi Event an toàn
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Lưu Domain Event cùng DB transaction • Worker lease/relay ra Queue • Retry backoff có
            giới hạn • Dead Letter điều tra • Theo dõi độ trễ &amp; cảnh báo • Phát lại có quyền
            &amp; Audit • Dọn theo chính sách retention
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={submitting || loading}
            onClick={() => void runProcessNow()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(37,99,235,0.35)',
              background: 'rgba(37,99,235,0.1)',
              color: '#2563eb',
              fontSize: 12,
              fontWeight: 700,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            <Play size={14} /> Chạy Worker ngay
          </button>

          <button
            type="button"
            disabled={submitting || loading}
            onClick={() => void runCleanup()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              fontSize: 12,
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            <Trash2 size={14} /> Dọn Event quá hạn
          </button>

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

      <OutboxMetricsBar metrics={metrics} />

      <OutboxEventsTable
        events={events}
        total={total}
        page={page}
        statusFilter={statusFilter}
        sourceModuleFilter={sourceModuleFilter}
        searchFilter={searchFilter}
        loading={loading}
        selectedEventId={selectedEvent?.id ?? null}
        onPageChange={setPage}
        onStatusFilterChange={setStatusFilter}
        onSourceModuleChange={setSourceModuleFilter}
        onSearchChange={setSearchFilter}
        onSelectEvent={(id) => void openEventDetail(id)}
      />

      <OutboxDetailPanel
        event={selectedEvent}
        loading={detailLoading}
        submitting={submitting}
        onClose={() => setSelectedEvent(null)}
        onReplay={replayEvent}
      />
    </main>
  );
};
