import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { IdempotencyDetailPanel } from './components/IdempotencyDetailPanel';
import { IdempotencyMetricsBar } from './components/IdempotencyMetricsBar';
import { IdempotencyRecordsTable } from './components/IdempotencyRecordsTable';
import { useIdempotencyManagement } from './hooks/useIdempotencyManagement';

export const IdempotencyManagementPage: React.FC = () => {
  const {
    metrics,
    records,
    total,
    page,
    setPage,
    windowHours,
    setWindowHours,
    scopeFilter,
    setScopeFilter,
    statusFilter,
    setStatusFilter,
    onlyDuplicates,
    setOnlyDuplicates,
    onlyConflicts,
    setOnlyConflicts,
    searchFilter,
    setSearchFilter,
    selectedRecord,
    setSelectedRecord,
    detailLoading,
    loading,
    submitting,
    error,
    feedback,
    refreshAll,
    openRecordDetail,
    revokeRecord,
    runPurgeExpired,
  } = useIdempotencyManagement();

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
            <ShieldCheck size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              11.3 Chống xử lý trùng (Idempotency)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            API Idempotency-Key • Khóa nghiệp vụ Job • Khử trùng Webhook Event ID • Event Inbox •
            Kiểm tra sai lệch payload (409) • TTL theo từng luồng • Theo dõi tỷ lệ trùng &amp; phát
            hiện client gửi lặp
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'inherit',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <option value={1}>Cửa sổ: 1 giờ</option>
            <option value={6}>Cửa sổ: 6 giờ</option>
            <option value={24}>Cửa sổ: 24 giờ</option>
            <option value={168}>Cửa sổ: 7 ngày</option>
          </select>

          <button
            type="button"
            disabled={submitting || loading}
            onClick={() => void runPurgeExpired()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'inherit',
              fontSize: 12,
              fontWeight: 600,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            <Trash2 size={14} /> Dọn khóa hết hạn
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
              color: 'inherit',
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

      <IdempotencyMetricsBar metrics={metrics} />

      <IdempotencyRecordsTable
        records={records}
        total={total}
        page={page}
        scopeFilter={scopeFilter}
        statusFilter={statusFilter}
        onlyDuplicates={onlyDuplicates}
        onlyConflicts={onlyConflicts}
        searchFilter={searchFilter}
        loading={loading}
        selectedRecordId={selectedRecord?.id ?? null}
        onPageChange={setPage}
        onScopeFilterChange={setScopeFilter}
        onStatusFilterChange={setStatusFilter}
        onOnlyDuplicatesChange={setOnlyDuplicates}
        onOnlyConflictsChange={setOnlyConflicts}
        onSearchChange={setSearchFilter}
        onSelectRecord={(id) => void openRecordDetail(id)}
      />

      <IdempotencyDetailPanel
        record={selectedRecord}
        loading={detailLoading}
        submitting={submitting}
        onClose={() => setSelectedRecord(null)}
        onRevoke={revokeRecord}
      />
    </main>
  );
};
