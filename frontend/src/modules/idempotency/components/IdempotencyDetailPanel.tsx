import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { IdempotencyRecordDetail } from '../types/idempotency.types';

interface IdempotencyDetailPanelProps {
  readonly record: IdempotencyRecordDetail | null;
  readonly loading: boolean;
  readonly submitting: boolean;
  readonly onClose: () => void;
  readonly onRevoke: (id: number, reason: string) => Promise<void>;
}

export const IdempotencyDetailPanel: React.FC<IdempotencyDetailPanelProps> = ({
  record,
  loading,
  submitting,
  onClose,
  onRevoke,
}) => {
  const [reason, setReason] = useState('');

  if (!record && !loading) return null;

  const handleRevoke = async () => {
    if (!record) return;
    await onRevoke(record.id, reason.trim() || 'Thu hồi thủ công từ giao diện Idempotency');
    setReason('');
  };

  return (
    <section
      style={{
        marginTop: 16,
        padding: 18,
        borderRadius: 14,
        background: 'var(--bg-surface)',
        border: '1px solid rgba(37,99,235,0.3)',
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
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          {loading
            ? 'Đang tải chi tiết khóa...'
            : `Chi tiết khóa #${record?.id} (${record?.scope} • ${record?.statusName})`}
        </h2>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {record && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
              fontSize: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Đích (Scope Target)</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{record.scopeTarget}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Idempotency Key</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {record.idempotencyKey}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Payload Fingerprint (SHA-256)</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 11 }}>
                {record.requestFingerprint}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Client / Nguồn</div>
              <div style={{ fontFamily: 'monospace' }}>{record.clientIdentifier ?? '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>HTTP Status Replay</div>
              <div>{record.responseStatusCode ?? '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Lượt trùng / Sai dữ liệu</div>
              <div>
                <strong>{record.duplicateHits}</strong> trùng •{' '}
                <strong style={{ color: record.conflictHits > 0 ? '#dc2626' : 'inherit' }}>
                  {record.conflictHits}
                </strong>{' '}
                lỗi 409
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Tạo lúc / Hết hạn TTL</div>
              <div>
                {new Date(record.createdAt).toLocaleString()} →{' '}
                {new Date(record.expiresAt).toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)' }}>Correlation ID</div>
              <div style={{ fontFamily: 'monospace' }}>{record.correlationId ?? '—'}</div>
            </div>
          </div>

          {record.lastErrorMessage && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(220,38,38,0.08)',
                color: '#dc2626',
                fontSize: 12,
              }}
            >
              <strong>Lỗi gần nhất ({record.lastErrorCode ?? 'ERROR'}):</strong>{' '}
              {record.lastErrorMessage}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              Dữ liệu phản hồi lưu Replay (đã che trường nhạy cảm)
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(15,23,42,0.06)',
                fontSize: 11.5,
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(record.responseBody ?? null, null, 2)}
            </pre>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              paddingTop: 12,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do thu hồi khóa (ghi vào Audit Log)..."
              style={{
                flex: '1 1 260px',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'inherit',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleRevoke()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid rgba(220,38,38,0.35)',
                background: 'rgba(220,38,38,0.1)',
                color: '#dc2626',
                fontSize: 12,
                fontWeight: 700,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              <Trash2 size={14} /> Thu hồi khóa này
            </button>
          </div>
        </>
      )}
    </section>
  );
};
