import React, { useState } from 'react';
import { RotateCcw, Eye, Clock } from 'lucide-react';
import { webhooksApi } from '../services/webhooks.api';
import type {
  WebhookDeliveryItem,
  WebhookEndpointItem,
} from '../types/webhooks.types';

interface WebhookDeliveriesPanelProps {
  endpoints: readonly WebhookEndpointItem[];
  deliveries: readonly WebhookDeliveryItem[];
  selectedDelivery: WebhookDeliveryItem | null;
  detailLoading: boolean;
  endpointFilter: string;
  statusFilter: string;
  eventFilter: string;
  onEndpointFilterChange: (v: string) => void;
  onStatusFilterChange: (v: string) => void;
  onEventFilterChange: (v: string) => void;
  onSelectDelivery: (deliveryId: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const WebhookDeliveriesPanel: React.FC<WebhookDeliveriesPanelProps> = ({
  endpoints,
  deliveries,
  selectedDelivery,
  detailLoading,
  endpointFilter,
  statusFilter,
  eventFilter,
  onEndpointFilterChange,
  onStatusFilterChange,
  onEventFilterChange,
  onSelectDelivery,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [replayTargetId, setReplayTargetId] = useState<number | null>(null);
  const [replayReason, setReplayReason] = useState('');
  const [replaying, setReplaying] = useState(false);

  const handleConfirmReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replayTargetId) return;
    onError(null);
    onFeedback(null);
    setReplaying(true);
    try {
      const replayed = await webhooksApi.replayDelivery(replayTargetId, replayReason.trim() || null);
      onFeedback(`Đã tạo bản ghi Replay #${replayed.id} (từ Delivery #${replayTargetId}) và đưa vào Queue.`);
      setReplayTargetId(null);
      setReplayReason('');
      await onRefresh();
      await onSelectDelivery(replayed.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể replay Webhook Delivery');
    } finally {
      setReplaying(false);
    }
  };

  const renderDeliveryStatus = (statusName: WebhookDeliveryItem['statusName']) => {
    const map: Record<WebhookDeliveryItem['statusName'], { bg: string; color: string }> = {
      PENDING: { bg: 'rgba(37,99,235,0.12)', color: '#2563eb' },
      RETRYING: { bg: 'rgba(217,119,6,0.12)', color: '#d97706' },
      DELIVERED: { bg: 'rgba(5,150,105,0.12)', color: '#059669' },
      FAILED: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626' },
      CANCELLED: { bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
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
      {/* Bộ lọc */}
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
          value={endpointFilter}
          onChange={(e) => onEndpointFilterChange(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
        >
          <option value="">Tất cả Endpoints</option>
          {endpoints.map((ep) => (
            <option key={ep.id} value={String(ep.id)}>
              {ep.name} (#{ep.id})
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="PENDING">PENDING</option>
          <option value="RETRYING">RETRYING</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="FAILED">FAILED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>

        <input
          value={eventFilter}
          onChange={(e) => onEventFilterChange(e.target.value)}
          placeholder="Lọc theo eventName (vd: user.created)"
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

      {/* Modal/Form xác nhận Replay */}
      {replayTargetId !== null && (
        <form
          onSubmit={(e) => void handleConfirmReplay(e)}
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
            Xác nhận gửi lại thủ công (Manual Replay) cho Delivery #{replayTargetId}
          </div>
          <input
            value={replayReason}
            onChange={(e) => setReplayReason(e.target.value)}
            placeholder="Nhập lý do gửi lại để ghi Audit Log (tùy chọn)"
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                setReplayTargetId(null);
                setReplayReason('');
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
              disabled={replaying}
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
              {replaying ? 'Đang gửi lại...' : 'Xác nhận Replay'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1.4fr) minmax(320px, 1fr)', gap: 16 }}>
        {/* Bảng Deliveries */}
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
                <th style={{ padding: 10 }}>ID / Event</th>
                <th style={{ padding: 10 }}>Endpoint</th>
                <th style={{ padding: 10 }}>Trạng thái</th>
                <th style={{ padding: 10 }}>HTTP / Attempts</th>
                <th style={{ padding: 10 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Chưa có lịch sử gửi Webhook nào.
                  </td>
                </tr>
              ) : (
                deliveries.map((d) => {
                  const canReplay = d.statusName !== 'PENDING' && d.statusName !== 'RETRYING';
                  return (
                    <tr
                      key={d.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background:
                          selectedDelivery?.id === d.id ? 'rgba(37,99,235,0.06)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: 10 }}>
                        <div style={{ fontWeight: 700 }}>
                          #{d.id} • {d.eventName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {d.triggerSource}
                          {d.replayedFromDeliveryId ? ` (replay #${d.replayedFromDeliveryId})` : ''}
                        </div>
                      </td>
                      <td style={{ padding: 10 }}>
                        <div>{d.endpointName ?? `Endpoint #${d.endpointId}`}</div>
                      </td>
                      <td style={{ padding: 10 }}>{renderDeliveryStatus(d.statusName)}</td>
                      <td style={{ padding: 10 }}>
                        <div>HTTP: {d.lastHttpStatus ?? '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {d.attemptCount}/{d.maxAttempts} attempts
                        </div>
                      </td>
                      <td style={{ padding: 10 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => void onSelectDelivery(d.id)}
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
                          {canReplay && (
                            <button
                              type="button"
                              onClick={() => setReplayTargetId(d.id)}
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
                              <RotateCcw size={12} /> Replay
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Panel Chi tiết Delivery & Attempts */}
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
          <div style={{ fontSize: 13, fontWeight: 700 }}>Chi tiết Delivery &amp; Lịch sử Attempts</div>
          {detailLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đang tải chi tiết...</div>
          ) : !selectedDelivery ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Chọn một dòng ở bảng bên trái để xem Payload và từng lần thử HTTP.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  <strong>UID:</strong> <code>{selectedDelivery.deliveryUid}</code>
                </div>
                <div>
                  <strong>Event:</strong> {selectedDelivery.eventName} (ID: {selectedDelivery.eventId})
                </div>
                {selectedDelivery.lastErrorMessage && (
                  <div style={{ color: '#dc2626' }}>
                    <strong>Lỗi:</strong> [{selectedDelivery.lastErrorCode}] {selectedDelivery.lastErrorMessage}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Payload JSON</div>
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
                  {JSON.stringify(selectedDelivery.payload, null, 2)}
                </pre>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  Attempts ({selectedDelivery.attempts?.length ?? 0})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(selectedDelivery.attempts ?? []).length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Chưa có lần thử nào được thực thi.
                    </div>
                  ) : (
                    (selectedDelivery.attempts ?? []).map((att) => (
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
                            {att.responseStatus ?? att.errorCode ?? 'ERR'})
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={11} /> {att.durationMs}ms
                          </span>
                        </div>
                        {att.errorMessage && <div style={{ color: '#dc2626' }}>{att.errorMessage}</div>}
                        {att.responseBodySnippet && (
                          <pre
                            style={{
                              margin: 0,
                              padding: 6,
                              borderRadius: 6,
                              background: 'var(--bg-subtle, rgba(148,163,184,0.1))',
                              overflowX: 'auto',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {att.responseBodySnippet}
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
