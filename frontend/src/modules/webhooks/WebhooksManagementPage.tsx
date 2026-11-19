import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Inbox,
  RefreshCw,
  Server,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { InboundWebhookEventsPanel } from './components/InboundWebhookEventsPanel';
import { InboundWebhookProvidersPanel } from './components/InboundWebhookProvidersPanel';
import { WebhookDeliveriesPanel } from './components/WebhookDeliveriesPanel';
import { WebhookEndpointsPanel } from './components/WebhookEndpointsPanel';
import { useInboundWebhooks } from './hooks/useInboundWebhooks';
import { useWebhooksManagement } from './hooks/useWebhooksManagement';

type WebhooksTabKey =
  | 'endpoints'
  | 'deliveries'
  | 'inbound-providers'
  | 'inbound-events';

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
    loading: outboundLoading,
    detailLoading: outboundDetailLoading,
    error,
    setError,
    feedback,
    setFeedback,
    loadDeliveryDetail,
    refreshAll: refreshOutbound,
  } = useWebhooksManagement();

  const {
    providers: inboundProviders,
    events: inboundEvents,
    selectedEvent: selectedInboundEvent,
    eventProviderFilter,
    setEventProviderFilter,
    eventStatusFilter,
    setEventStatusFilter,
    eventTypeFilter,
    setEventTypeFilter,
    eventSearchFilter,
    setEventSearchFilter,
    revealedSecret: revealedInboundSecret,
    setRevealedSecret: setRevealedInboundSecret,
    loading: inboundLoading,
    detailLoading: inboundDetailLoading,
    loadEventDetail: loadInboundEventDetail,
    refreshInbound,
  } = useInboundWebhooks({ onError: setError });

  const [activeSubTab, setActiveSubTab] = useState<WebhooksTabKey>('endpoints');
  const loading = outboundLoading || inboundLoading;

  const refreshAll = async () => {
    await Promise.all([refreshOutbound(), refreshInbound()]);
  };

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
              10.2 Outbound &amp; 10.3 Inbound Webhooks
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Outbound: Đăng ký Endpoint, ký HMAC-SHA256, retry &amp; chống SSRF • Inbound: Tiếp
            nhận theo Provider, xác minh chữ ký/timestamp, Idempotency, redact đối soát &amp; Queue
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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
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
          <Server size={14} /> Outbound Endpoints ({endpoints.length})
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
          <History size={14} /> Outbound Deliveries ({deliveries.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('inbound-providers')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'inbound-providers' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'inbound-providers' ? '#fff' : 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <ShieldCheck size={14} /> Inbound Providers ({inboundProviders.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('inbound-events')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'inbound-events' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'inbound-events' ? '#fff' : 'inherit',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Inbox size={14} /> Inbound Events ({inboundEvents.length})
        </button>
      </div>

      {activeSubTab === 'endpoints' && (
        <WebhookEndpointsPanel
          endpoints={endpoints}
          eventsCatalog={eventsCatalog}
          revealedSecret={revealedSecret}
          onClearRevealedSecret={() => setRevealedSecret(null)}
          onRevealSecret={(data) => setRevealedSecret(data)}
          onRefresh={refreshOutbound}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeSubTab === 'deliveries' && (
        <WebhookDeliveriesPanel
          endpoints={endpoints}
          deliveries={deliveries}
          selectedDelivery={selectedDelivery}
          detailLoading={outboundDetailLoading}
          endpointFilter={deliveryEndpointFilter}
          statusFilter={deliveryStatusFilter}
          eventFilter={deliveryEventFilter}
          onEndpointFilterChange={setDeliveryEndpointFilter}
          onStatusFilterChange={setDeliveryStatusFilter}
          onEventFilterChange={setDeliveryEventFilter}
          onSelectDelivery={loadDeliveryDetail}
          onRefresh={refreshOutbound}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeSubTab === 'inbound-providers' && (
        <InboundWebhookProvidersPanel
          providers={inboundProviders}
          revealedSecret={revealedInboundSecret}
          onClearRevealedSecret={() => setRevealedInboundSecret(null)}
          onRevealSecret={(data) => setRevealedInboundSecret(data)}
          onRefresh={refreshInbound}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}

      {activeSubTab === 'inbound-events' && (
        <InboundWebhookEventsPanel
          providers={inboundProviders}
          events={inboundEvents}
          selectedEvent={selectedInboundEvent}
          detailLoading={inboundDetailLoading}
          providerFilter={eventProviderFilter}
          statusFilter={eventStatusFilter}
          eventTypeFilter={eventTypeFilter}
          searchFilter={eventSearchFilter}
          onProviderFilterChange={setEventProviderFilter}
          onStatusFilterChange={setEventStatusFilter}
          onEventTypeFilterChange={setEventTypeFilter}
          onSearchFilterChange={setEventSearchFilter}
          onSelectEvent={loadInboundEventDetail}
          onRefresh={refreshInbound}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}
    </main>
  );
};
