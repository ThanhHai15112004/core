import React, { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  OUTBOX_STATUS_BADGE_STYLES,
  OUTBOX_STATUS_LABELS,
  type OutboxEventDetail,
} from '../types/outbox.types';

interface OutboxDetailPanelProps {
  readonly event: OutboxEventDetail | null;
  readonly loading: boolean;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onReplay: (id: number, reason: string, force: boolean) => Promise<void>;
}

export const OutboxDetailPanel: React.FC<OutboxDetailPanelProps> = ({
  event,
  loading,
  submitting,
  onClose,
  onReplay,
}) => {
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);

  if (!event && !loading) return null;

  const badge = event ? OUTBOX_STATUS_BADGE_STYLES[event.statusName] : null;
  const canReplay =
    event &&
    (event.statusName === 'FAILED' ||
      event.statusName === 'DEAD_LETTER' ||
      event.statusName === 'PUBLISHED');

  const handleSubmitReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || reason.trim().length < 3) return;
    await onReplay(event.id, reason.trim(), event.statusName === 'PUBLISHED' ? true : force);
    setReason('');
    setForce(false);
  };

  return (
    <aside
      style={{
        marginTop: 16,
        padding: 18,
        borderRadius: 14,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
            {loading
              ? 'Đang tải chi tiết Outbox...'
              : `Chi tiết Outbox #${event?.id} · ${event?.eventType}`}
          </h2>
          {event && badge && (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                background: badge.bg,
                color: badge.color,
                border: `1px solid ${badge.border}`,
              }}
            >
              {OUTBOX_STATUS_LABELS[event.statusName]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: 6,
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            cursor: 'pointer',
          }}
          aria-label="Đóng chi tiết"
        >
          <X size={15} />
        </button>
      </div>

      {event && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
              fontSize: 12,
            }}
          >
            <div>
              <strong>Event ID:</strong> <span style={{ fontFamily: 'monospace' }}>{event.eventId}</span>
            </div>
            <div>
              <strong>Correlation ID:</strong>{' '}
              <span style={{ fontFamily: 'monospace' }}>{event.correlationId ?? '—'}</span>
            </div>
            <div>
              <strong>Request ID:</strong>{' '}
              <span style={{ fontFamily: 'monospace' }}>{event.requestId ?? '—'}</span>
            </div>
            <div>
              <strong>Đích:</strong>{' '}
              <span style={{ fontFamily: 'monospace' }}>
                {event.destinationQueue} / {event.destinationTopic}
              </span>
            </div>
            <div>
              <strong>Attempts:</strong> {event.attemptCount}/{event.maxRetries} (Replay:{' '}
              {event.replayCount}x)
            </div>
            <div>
              <strong>Next Attempt:</strong>{' '}
              {event.nextAttemptAt ? new Date(event.nextAttemptAt).toLocaleString() : '—'}
            </div>
          </div>

          {(event.lastErrorMessage || event.deadLetterReason) && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.25)',
                color: '#dc2626',
                fontSize: 12,
              }}
            >
              <div>
                <strong>Lỗi ({event.lastErrorCode ?? 'ERROR'}):</strong> {event.lastErrorMessage}
              </div>
              {event.deadLetterReason && (
                <div style={{ marginTop: 4 }}>
                  <strong>Lý do Dead Letter:</strong> {event.deadLetterReason}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Payload JSON</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.06)',
                  fontSize: 11.5,
                  overflowX: 'auto',
                  maxHeight: 220,
                }}
              >
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Metadata &amp; Headers</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.06)',
                  fontSize: 11.5,
                  overflowX: 'auto',
                  maxHeight: 220,
                }}
              >
                {JSON.stringify({ metadata: event.metadata, headers: event.headers }, null, 2)}
              </pre>
            </div>
          </div>

          {canReplay && (
            <form
              onSubmit={(e) => void handleSubmitReplay(e)}
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do phát lại (bắt buộc, ghi Audit Log)..."
                minLength={3}
                required
                style={{
                  flex: '1 1 280px',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  fontSize: 12.5,
                }}
              />
              {event.statusName === 'PUBLISHED' && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                    required
                  />
                  Xác nhận gửi lại event đã Published (force)
                </label>
              )}
              <button
                type="submit"
                disabled={submitting || reason.trim().length < 3}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                <RotateCcw size={14} />
                {submitting ? 'Đang gửi lại...' : 'Phát lại Event (Replay)'}
              </button>
            </form>
          )}
        </div>
      )}
    </aside>
  );
};
