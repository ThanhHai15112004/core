import React, { useState } from 'react';
import { Clock, Eye, RotateCcw } from 'lucide-react';
import { inboundWebhooksApi } from '../services/inbound-webhooks.api';
import type {
  InboundWebhookEventItem,
  InboundWebhookProviderItem,
} from '../types/inbound-webhooks.types';

interface InboundWebhookEventsPanelProps {
  providers: readonly InboundWebhookProviderItem[];
  events: readonly InboundWebhookEventItem[];
  selectedEvent: InboundWebhookEventItem | null;
  detailLoading: boolean;
  providerFilter: string;
  statusFilter: string;
  eventTypeFilter: string;
  searchFilter: string;
  onProviderFilterChange: (v: string) => void;
  onStatusFilterChange: (v: string) => void;
  onEventTypeFilterChange: (v: string) => void;
  onSearchFilterChange: (v: string) => void;
  onSelectEvent: (eventId: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const InboundWebhookEventsPanel: React.FC<InboundWebhookEventsPanelProps> = ({
  providers,
  events,
  selectedEvent,
  detailLoading,
  providerFilter,
  statusFilter,
  eventTypeFilter,
  searchFilter,
  onProviderFilterChange,
  onStatusFilterChange,
  onEventTypeFilterChange,
  onSearchFilterChange,
  onSelectEvent,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [reprocessTargetId, setReprocessTargetId] = useState<number | null>(null);
  const [reprocessReason, setReprocessReason] = useState('');
  const [reprocessing, setReprocessing] = useState(false);

  const handleConfirmReprocess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reprocessTargetId) return;
    onError(null);
    onFeedback(null);
    setReprocessing(true);
    try {
      const updated = await inboundWebhooksApi.reprocessEvent(
        reprocessTargetId,
        reprocessReason.trim() || null,
      );
      onFeedback(`Đã đưa sự kiện Inbound #${updated.id} vào Queue để xử lý lại.`);
      setReprocessTargetId(null);
      setReprocessReason('');
      await onRefresh();
      await onSelectEvent(updated.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xử lý lại sự kiện Inbound');
    } finally {
      setReprocessing(false);
    }
  };

  const renderEventStatus = (statusName: InboundWebhookEventItem['statusName']) => {
    const map: Record<InboundWebhookEventItem['statusName'], { bg: string; color: string }> = {
      QUEUED: { bg: 'rgba(37,99,235,0.12)', color: '#2563eb' },
      PROCESSING: { bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
      PROCESSED: { bg: 'rgba(5,150,105,0.12)', color: '#059669' },
      FAILED: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626' },
      REJECTED: { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
    };
    const style = map[statusName];
    return (
      <span
        style={{
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: style.bg,
          color: style.color,
        }}
      >
        {statusName}
      </span>
    );
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: 12,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <select
          value={providerFilter}
          onChange={(e) => onProviderFilterChange(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
        >
          <option value="">Tất cả Providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.providerCode}>
              {p.name} ({p.providerCode})
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="QUEUED">QUEUED</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="REJECTED">REJECTED</option>
        </select>

        <input
          value={eventTypeFilter}
          onChange={(e) => onEventTypeFilterChange(e.target.value)}
          placeholder="Lọc eventType (vd: invoice.paid)"
          style={{
            minWidth: 180,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            fontSize: 12,
          }}
        />

        <input
          value={searchFilter}
          onChange={(e) => onSearchFilterChange(e.target.value)}
          placeholder="Tìm theo externalEventId, UID, mã lỗi..."
          style={{
            flex: 1,
            minWidth: 200,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            fontSize: 12,
          }}
        />
      </div>

      {reprocessTargetId !== null && (
        <form
          onSubmit={(e) => void handleConfirmReprocess(e)}
          style={{
            padding: 14,
            borderRadius: 12,
            border: '1px solid rgba(37,99,235,0.35)',
            background: 'rgba(37,99,235,0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            Xác nhận đẩy xử lý lại (Reprocess) cho Inbound Event #{reprocessTargetId}
          </div>
          <input
            value={reprocessReason}
            onChange={(e) => setReprocessReason(e.target.value)}
            placeholder="Nhập lý do xử lý lại để ghi Audit Log (tùy chọn)"
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                setReprocessTargetId(null);
                setReprocessReason('');
              }}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={reprocessing}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {reprocessing ? 'Đang đẩy Queue...' : 'Xác nhận Reprocess'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.4fr) minmax(320px, 1fr)', gap: 16 }}>
        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: 10 }}>ID / Provider</th>
                <th style={{ padding: 10 }}>External Event / Type</th>
                <th style={{ padding: 10 }}>Trạng thái</th>
                <th style={{ padding: 10 }}>Trùng / Attempts</th>
                <th style={{ padding: 10 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có sự kiện Inbound Webhook nào.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr
                    key={ev.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background:
                        selectedEvent?.id === ev.id ? 'rgba(37,99,235,0.06)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: 10 }}>
                      <div style={{ fontWeight: 700 }}>
                        #{ev.id} • {ev.providerCode}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(ev.receivedAt).toLocaleString()}
                      </div>
                    </td>
                    <td style={{ padding: 10 }}>
                      <div>
                        <code>{ev.externalEventId ?? '(rejected / null)'}</code>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {ev.eventType ?? '—'}
                      </div>
                    </td>
                    <td style={{ padding: 10 }}>
                      {renderEventStatus(ev.statusName)}
                      {ev.rejectionReason && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                          {ev.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 10 }}>
                      <div>Dup: {ev.duplicateCount}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {ev.attemptCount}/{ev.maxAttempts} attempts
                      </div>
                    </td>
                    <td style={{ padding: 10 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => void onSelectEvent(ev.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                            background: 'transparent',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          <Eye size={12} /> Chi tiết
                        </button>
                        {ev.statusName === 'FAILED' && (
                          <button
                            type="button"
                            onClick={() => setReprocessTargetId(ev.id)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: '1px solid var(--border-subtle)',
                              background: 'transparent',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            <RotateCcw size={12} /> Reprocess
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            Chi tiết Inbound Event &amp; Lịch sử xử lý
          </div>
          {detailLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đang tải chi tiết...</div>
          ) : !selectedEvent ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Chọn một sự kiện ở bảng bên trái để xem Header/Payload đã redact và kết quả xử lý.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <strong>UID:</strong> <code>{selectedEvent.eventUid}</code>
                </div>
                <div>
                  <strong>External ID:</strong>{' '}
                  <code>{selectedEvent.externalEventId ?? 'null'}</code> •{' '}
                  <strong>Source IP:</strong> {selectedEvent.sourceIpMasked ?? '—'}
                </div>
                <div>
                  <strong>SHA-256:</strong>{' '}
                  <code style={{ fontSize: 11 }}>{selectedEvent.payloadHash}</code>
                </div>
                {selectedEvent.lastErrorMessage && (
                  <div style={{ color: '#dc2626' }}>
                    <strong>Lỗi / Từ chối:</strong> [{selectedEvent.lastErrorCode}]{' '}
                    {selectedEvent.lastErrorMessage}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                  Headers (đã che thông tin nhạy cảm)
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    fontSize: 11,
                    overflowX: 'auto',
                    maxHeight: 110,
                  }}
                >
                  {JSON.stringify(selectedEvent.headers, null, 2)}
                </pre>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                  Payload đối soát (đã che dữ liệu nhạy cảm
                  {selectedEvent.payloadTruncated ? ' — đã cắt ngắn' : ''})
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    fontSize: 11,
                    overflowX: 'auto',
                    maxHeight: 160,
                  }}
                >
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Attempts ({selectedEvent.attempts?.length ?? 0})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(selectedEvent.attempts ?? []).length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Chưa có lần xử lý Worker nào.
                    </div>
                  ) : (
                    (selectedEvent.attempts ?? []).map((att) => (
                      <div
                        key={att.id}
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          border: '1px solid var(--border-subtle)',
                          fontSize: 11,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                          <span>
                            Attempt #{att.attemptNumber} — {att.isSuccess ? 'OK' : 'FAILED'} (
                            {att.handlerName})
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={11} /> {att.durationMs}ms
                          </span>
                        </div>
                        {att.errorMessage && <div style={{ color: '#dc2626' }}>{att.errorMessage}</div>}
                        {att.resultSummary && (
                          <pre
                            style={{
                              margin: 0,
                              padding: 6,
                              borderRadius: 6,
                              background: 'var(--bg-subtle, rgba(148,163,184,0.1))',
                              overflowX: 'auto',
                            }}
                          >
                            {JSON.stringify(att.resultSummary, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
};
