import React from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { OutboxMetricsSnapshot } from '../types/outbox.types';

interface OutboxMetricsBarProps {
  readonly metrics: OutboxMetricsSnapshot | null;
}

function formatAgeSec(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export const OutboxMetricsBar: React.FC<OutboxMetricsBarProps> = ({ metrics }) => {
  if (!metrics) return null;

  const isCritical = metrics.lagStatus === 'CRITICAL';
  const isWarning = metrics.lagStatus === 'WARNING';

  const cards = [
    { label: 'Pending', value: metrics.pendingCount, accent: '#2563eb' },
    { label: 'Processing', value: metrics.processingCount, accent: '#0284c7' },
    { label: 'Failed (Retry)', value: metrics.failedCount, accent: '#b45309' },
    { label: 'Dead Letter', value: metrics.deadLetterCount, accent: '#dc2626' },
    { label: 'Published (24h)', value: metrics.publishedLast24hCount, accent: '#15803d' },
    {
      label: 'Độ trễ cũ nhất',
      value: formatAgeSec(metrics.oldestPendingAgeSec),
      accent: isCritical ? '#dc2626' : isWarning ? '#b45309' : '#0f766e',
    },
    {
      label: 'Lag TB (24h)',
      value: metrics.avgPublishLagMs !== null ? `${metrics.avgPublishLagMs} ms` : '—',
      accent: '#4f46e5',
    },
  ];

  return (
    <section style={{ marginBottom: 16 }}>
      {(isCritical || isWarning) && (
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
            <strong>Cảnh báo tồn đọng Outbox ({metrics.lagStatus}):</strong>{' '}
            {metrics.alertReasons.join(' • ')}
          </div>
        </div>
      )}

      {!isCritical && !isWarning && (
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
            Outbox đang ổn định (HEALTHY) — Ngưỡng cảnh báo: backlog &ge;{' '}
            {metrics.thresholds.lagWarnCount}, độ trễ &ge; {metrics.thresholds.lagWarnAgeSec}s, DLQ
            &ge; {metrics.thresholds.deadLetterWarnCount}
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
        }}
      >
        {cards.map((card) => (
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
    </section>
  );
};
