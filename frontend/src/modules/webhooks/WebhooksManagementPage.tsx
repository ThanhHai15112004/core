import React, { useState } from 'react';
import {
  Webhook,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Server,
  History,
} from 'lucide-react';
import { WebhookDeliveriesPanel } from './components/WebhookDeliveriesPanel';
import { WebhookEndpointsPanel } from './components/WebhookEndpointsPanel';
import { useWebhooksManagement } from './hooks/useWebhooksManagement';

export const WebhooksManagementPage: React.FC = () => {
  const {
    eventsCatalog,
    endpoints,
    deliveries,
    selectedDelivery,
    deliveryEndpointFilter,
    setDeliveryEndpointFilter,
    deliveryStatusFilter,
    setDeliveryStatusFilter,
    deliveryEventFilter,
    setDeliveryEventFilter,
    revealedSecret,
    setRevealedSecret,
    loading,
    detailLoading,
    error,
    setError,
    feedback,
    setFeedback,
    loadDeliveryDetail,
    refreshAll,
  } = useWebhooksManagement();

  const [activeSubTab, setActiveSubTab] = useState<'endpoints' | 'deliveries'>('endpoints');

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
            <Webhook size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              10.2 — Webhook gửi ra ngoài (Outbound Webhooks)
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Đăng ký Endpoint &amp; sự kiện • Ký HMAC-SHA256 • Gửi qua Queue &amp; Exponential Backoff •
            Lịch sử Attempts &amp; Replay có Audit • Tự khóa Endpoint lỗi &amp; Chống SSRF
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

      {/* Sub-Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('endpoints')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'endpoints' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'endpoints' ? '#fff' : 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Server size={14} /> Webhook Endpoints ({endpoints.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('deliveries')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'deliveries' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'deliveries' ? '#fff' : 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <History size={14} /> Lịch sử gửi &amp; Replay ({deliveries.length})
        </button>
      </div>

      {activeSubTab === 'endpoints' ? (
        <WebhookEndpointsPanel
          endpoints={endpoints}
          eventsCatalog={eventsCatalog}
          revealedSecret={revealedSecret}
          onClearRevealedSecret={() => setRevealedSecret(null)}
          onRevealSecret={(data) => setRevealedSecret(data)}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      ) : (
        <WebhookDeliveriesPanel
          endpoints={endpoints}
          deliveries={deliveries}
          selectedDelivery={selectedDelivery}
          detailLoading={detailLoading}
          endpointFilter={deliveryEndpointFilter}
          statusFilter={deliveryStatusFilter}
          eventFilter={deliveryEventFilter}
          onEndpointFilterChange={setDeliveryEndpointFilter}
          onStatusFilterChange={setDeliveryStatusFilter}
          onEventFilterChange={setDeliveryEventFilter}
          onSelectDelivery={loadDeliveryDetail}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}
    </main>
  );
};
