import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import type { IdempotencyMetricsSnapshot } from '../types/idempotency.types';

interface IdempotencyMetricsBarProps {
  readonly metrics: IdempotencyMetricsSnapshot | null;
}

const SCOPE_LABELS: Record<string, { label: string; accent: string }> = {
  API: { label: 'HTTP API', accent: '#2563eb' },
  JOB: { label: 'Background Job', accent: '#7c3aed' },
  WEBHOOK: { label: 'Inbound Webhook', accent: '#d97706' },
  EVENT: { label: 'Domain Event', accent: '#059669' },
};

export const IdempotencyMetricsBar: React.FC<IdempotencyMetricsBarProps> = ({ metrics }) => {
  if (!metrics) return null;

  const isCritical = metrics.alertStatus === 'CRITICAL';
  const isWarning = metrics.alertStatus === 'WARNING';

  const summaryCards = [
    { label: 'Tổng khóa gốc', value: metrics.totalUniqueKeys, accent: '#2563eb' },
    { label: 'Khóa còn hiệu lực', value: metrics.activeKeysCount, accent: '#0284c7' },
    { label: 'Lượt gửi trùng', value: metrics.totalDuplicateHits, accent: '#d97706' },
    {
      label: 'Tỷ lệ trùng (%)',
      value: `${metrics.duplicateRatePercent}%`,
      accent: isCritical ? '#dc2626' : isWarning ? '#b45309' : '#0f766e',
    },
    {
      label: 'Xung đột sai dữ liệu (409)',
      value: metrics.totalConflictHits,
      accent: metrics.totalConflictHits > 0 ? '#dc2626' : '#64748b',
    },
    {
      label: 'Hết hạn chờ dọn',
      value: metrics.expiredPendingPurgeCount,
      accent: '#4f46e5',
    },
  ];

  return (
    <section style={{ marginBottom: 18 }}>
      {isCritical || isWarning ? (
        <div
          style={{
            marginBottom: 12,
            padding: '12px 16px',
            borderRadius: 12,
            background: isCritical ? 'rgba(220,38,38,0.09)' : 'rgba(217,119,6,0.1)',
            border: `1px solid ${isCritical ? 'rgba(220,38,38,0.35)' : 'rgba(217,119,6,0.35)'}`,
            color: isCritical ? '#dc2626' : '#b45309',
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Cảnh báo gửi lặp Idempotency ({metrics.alertStatus}):</strong>{' '}
            {metrics.alertReasons.join(' • ')}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(22,163,74,0.08)',
            border: '1px solid rgba(22,163,74,0.25)',
            color: '#15803d',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={15} />
          <span>
            Tỷ lệ trùng ổn định (HEALTHY, cửa sổ {metrics.windowHours}h) — Ngưỡng cảnh báo: tỷ lệ
            trùng &ge; {metrics.thresholds.duplicateRateWarnPercent}%, client lặp &ge;{' '}
            {metrics.thresholds.clientRepeatWarnHits} lượt
          </span>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              opacity: 0.85,
            }}
          >
            <Clock size={12} /> {new Date(metrics.observedAt).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Overall KPI Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
          marginBottom: 14,
        }}
      >
        {summaryCards.map((card) => (
          <div
            key={card.label}
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: card.accent }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Breakdown by 4 scopes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 10,
          marginBottom: 14,
        }}
      >
        {metrics.byScope.map((item) => {
          const meta = SCOPE_LABELS[item.scope] ?? { label: item.scope, accent: '#334155' };
          return (
            <div
              key={item.scope}
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700, color: meta.accent }}>
                  {meta.label}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(100,116,139,0.12)',
                  }}
                >
                  Trùng: {item.duplicateRatePercent}%
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 6,
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                }}
              >
                <div>
                  Khóa: <strong style={{ color: 'var(--text-primary)' }}>{item.uniqueKeys}</strong>
                </div>
                <div>
                  Lặp:{' '}
                  <strong style={{ color: item.duplicateHits > 0 ? '#d97706' : 'var(--text-primary)' }}>
                    {item.duplicateHits}
                  </strong>
                </div>
                <div>
                  Lỗi 409:{' '}
                  <strong style={{ color: item.conflictHits > 0 ? '#dc2626' : 'var(--text-primary)' }}>
                    {item.conflictHits}
                  </strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Top Repeated Clients / Sources */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <ShieldAlert size={16} color="#d97706" />
          <span>Phát hiện Client / Nguồn gửi lặp ({metrics.topRepeatedClients.length})</span>
        </div>

        {metrics.topRepeatedClients.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Chưa ghi nhận client hay nguồn phát nào gửi lặp trong cửa sổ {metrics.windowHours} giờ
            gần đây.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    textAlign: 'left',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <th style={{ padding: '6px 8px' }}>Client / Nguồn</th>
                  <th style={{ padding: '6px 8px' }}>Luồng</th>
                  <th style={{ padding: '6px 8px' }}>Đích (Target)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Khóa gốc</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Lượt trùng</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Sai dữ liệu</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Tỷ lệ trùng</th>
                  <th style={{ padding: '6px 8px' }}>Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                {metrics.topRepeatedClients.map((client) => (
                  <tr
                    key={`${client.clientIdentifier}:${client.scope}:${client.scopeTarget}`}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {client.clientIdentifier}
                    </td>
                    <td style={{ padding: '7px 8px' }}>{client.scope}</td>
                    <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11.5 }}>
                      {client.scopeTarget}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{client.uniqueKeys}</td>
                    <td
                      style={{
                        padding: '7px 8px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: '#d97706',
                      }}
                    >
                      {client.duplicateHits}
                    </td>
                    <td
                      style={{
                        padding: '7px 8px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: client.conflictHits > 0 ? '#dc2626' : 'var(--text-muted)',
                      }}
                    >
                      {client.conflictHits}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>
                      {client.duplicateRatePercent}%
                    </td>
                    <td style={{ padding: '7px 8px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background:
                            client.severity === 'CRITICAL'
                              ? 'rgba(220,38,38,0.14)'
                              : client.severity === 'WARNING'
                                ? 'rgba(217,119,6,0.14)'
                                : 'rgba(22,163,74,0.12)',
                          color:
                            client.severity === 'CRITICAL'
                              ? '#dc2626'
                              : client.severity === 'WARNING'
                                ? '#b45309'
                                : '#15803d',
                        }}
                      >
                        {client.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
