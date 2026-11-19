import React, { useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, PauseCircle, ShieldAlert } from 'lucide-react';
import { providerRegistryApi } from '../services/provider-registry.api';
import {
  PROVIDER_TYPE_LABELS,
  type ProviderDashboardView,
} from '../types/provider-registry.types';

interface ProviderDashboardPanelProps {
  dashboard: ProviderDashboardView | null;
  typeFilter: string;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

function healthTone(status: string): { bg: string; fg: string } {
  if (status === 'HEALTHY') return { bg: 'rgba(22,163,74,0.14)', fg: '#15803d' };
  if (status === 'DEGRADED') return { bg: 'rgba(217,119,6,0.14)', fg: '#b45309' };
  if (status === 'DOWN') return { bg: 'rgba(220,38,38,0.14)', fg: '#b91c1c' };
  return { bg: 'rgba(100,116,139,0.14)', fg: '#475569' };
}

function statusTone(status: string): { bg: string; fg: string } {
  if (status === 'ACTIVE') return { bg: 'rgba(37,99,235,0.12)', fg: '#1d4ed8' };
  if (status === 'PAUSED') return { bg: 'rgba(217,119,6,0.14)', fg: '#b45309' };
  return { bg: 'rgba(100,116,139,0.14)', fg: '#475569' };
}

export const ProviderDashboardPanel: React.FC<ProviderDashboardPanelProps> = ({
  dashboard,
  typeFilter,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [checkingAll, setCheckingAll] = useState(false);

  const handleCheckAll = async () => {
    setCheckingAll(true);
    onError(null);
    onFeedback(null);
    try {
      const results = await providerRegistryApi.checkAllProvidersHealth(typeFilter || undefined);
      onFeedback(`Đã kiểm tra sức khỏe ${results.length} nhà cung cấp.`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể kiểm tra sức khỏe hàng loạt');
    } finally {
      setCheckingAll(false);
    }
  };

  if (!dashboard) {
    return (
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        Đang tải số liệu Dashboard Provider Registry...
      </div>
    );
  }

  const totals = dashboard.totals;
  const kpiCards = [
    {
      label: 'Tổng Provider',
      value: totals.totalProviders,
      sub: `${totals.activeCount} hoạt động • ${totals.unitAssignmentCount} gán đơn vị`,
      icon: <Activity size={16} color="#2563eb" />,
    },
    {
      label: 'Healthy / Degraded / Down',
      value: `${totals.healthyCount} / ${totals.degradedCount} / ${totals.downCount}`,
      sub: `${totals.unknownCount} chưa kiểm tra`,
      icon: <CheckCircle2 size={16} color="#16a34a" />,
    },
    {
      label: 'Đang tạm dừng (Paused)',
      value: totals.pausedCount,
      sub: `${totals.disabledCount} vô hiệu hóa`,
      icon: <PauseCircle size={16} color="#d97706" />,
    },
    {
      label: `Độ trễ & Lỗi (${dashboard.windowMinutes}p)`,
      value:
        totals.overallAvgLatencyMs !== null
          ? `${totals.overallAvgLatencyMs} ms`
          : '— (chưa có mẫu)',
      sub:
        totals.overallErrorRatePercent !== null
          ? `Lỗi: ${totals.overallErrorRatePercent}% (${totals.totalErrors}/${totals.totalObservations})`
          : 'Chưa có lượt gọi thực tế',
      icon:
        totals.overallErrorRatePercent !== null && totals.overallErrorRatePercent >= 5 ? (
          <ShieldAlert size={16} color="#dc2626" />
        ) : (
          <AlertTriangle size={16} color="#64748b" />
        ),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Policy strip + action */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: 14,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontWeight: 600,
              background: dashboard.policy.fallbackEnabled
                ? 'rgba(22,163,74,0.12)'
                : 'rgba(100,116,139,0.14)',
              color: dashboard.policy.fallbackEnabled ? '#15803d' : '#475569',
            }}
          >
            Fallback Policy: {dashboard.policy.fallbackEnabled ? 'BẬT' : 'TẮT (Strict Primary)'}
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontWeight: 600,
              background: dashboard.policy.unitRoutingEnabled
                ? 'rgba(37,99,235,0.12)'
                : 'rgba(100,116,139,0.14)',
              color: dashboard.policy.unitRoutingEnabled ? '#1d4ed8' : '#475569',
            }}
          >
            Định tuyến Đơn vị: {dashboard.policy.unitRoutingEnabled ? 'BẬT' : 'TẮT'}
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--bg-subtle, rgba(148,163,184,0.12))',
              color: 'var(--text-muted)',
            }}
          >
            Ngưỡng Degraded: {dashboard.thresholds.degradedLatencyMs}ms /{' '}
            {dashboard.thresholds.degradedErrorRatePct}% lỗi • Down:{' '}
            {dashboard.thresholds.downErrorRatePct}%
          </span>
        </div>

        <button
          type="button"
          disabled={checkingAll}
          onClick={() => void handleCheckAll()}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {checkingAll ? 'Đang kiểm tra...' : 'Kiểm tra sức khỏe tất cả'}
        </button>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {kpiCards.map((card) => (
          <div
            key={card.label}
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
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <span>{card.label}</span>
              {card.icon}
            </div>
            <div style={{ marginTop: 6, fontSize: 19, fontWeight: 800 }}>{card.value}</div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Breakdown by Type */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
          Tổng hợp theo Loại Nhà cung cấp
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ padding: '8px 6px' }}>Loại</th>
              <th style={{ padding: '8px 6px' }}>Primary mặc định</th>
              <th style={{ padding: '8px 6px' }}>Tổng / Hoạt động / Tạm dừng</th>
              <th style={{ padding: '8px 6px' }}>Sức khỏe (H / Deg / Down / Unk)</th>
              <th style={{ padding: '8px 6px' }}>Lượt gọi</th>
              <th style={{ padding: '8px 6px' }}>Độ trễ TB</th>
              <th style={{ padding: '8px 6px' }}>Tỷ lệ lỗi</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.byType.map((row) => (
              <tr key={row.providerType} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '8px 6px', fontWeight: 700 }}>
                  {PROVIDER_TYPE_LABELS[row.providerType] ?? row.providerType}
                </td>
                <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>
                  {row.primaryProviderCode ?? '—'}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {row.total} / {row.activeCount} / {row.pausedCount}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {row.healthyCount} / {row.degradedCount} / {row.downCount} / {row.unknownCount}
                </td>
                <td style={{ padding: '8px 6px' }}>{row.sampleCount}</td>
                <td style={{ padding: '8px 6px' }}>
                  {row.avgLatencyMs !== null ? `${row.avgLatencyMs} ms` : '—'}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {row.errorRatePercent !== null ? `${row.errorRatePercent}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Provider Telemetry Table */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>
          Độ trễ &amp; Tỷ lệ lỗi chi tiết từng Provider
        </h3>
        {dashboard.providers.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Chưa có nhà cung cấp nào được đăng ký.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '8px 6px' }}>Provider</th>
                <th style={{ padding: '8px 6px' }}>Loại / Vai trò</th>
                <th style={{ padding: '8px 6px' }}>Trạng thái</th>
                <th style={{ padding: '8px 6px' }}>Sức khỏe</th>
                <th style={{ padding: '8px 6px' }}>Probe gần nhất</th>
                <th style={{ padding: '8px 6px' }}>Mẫu ({dashboard.windowMinutes}p)</th>
                <th style={{ padding: '8px 6px' }}>Avg / P95</th>
                <th style={{ padding: '8px 6px' }}>Tỷ lệ lỗi</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.providers.map(({ provider, telemetry }) => {
                const sTone = statusTone(provider.statusName);
                const hTone = healthTone(provider.healthStatusName);
                return (
                  <tr
                    key={provider.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td style={{ padding: '8px 6px' }}>
                      <div style={{ fontWeight: 700 }}>{provider.displayName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {provider.providerCode} ({provider.driverCode})
                      </div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <div>{provider.providerType}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {provider.isPrimary
                          ? 'PRIMARY'
                          : provider.fallbackAllowed
                            ? `FALLBACK (#${provider.priority})`
                            : `STANDBY (#${provider.priority})`}
                      </div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: sTone.bg,
                          color: sTone.fg,
                        }}
                      >
                        {provider.statusName}
                      </span>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: hTone.bg,
                          color: hTone.fg,
                        }}
                      >
                        {provider.healthStatusName}
                      </span>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {provider.lastHealthLatencyMs !== null
                        ? `${provider.lastHealthLatencyMs} ms`
                        : '—'}
                      {provider.lastHealthErrorCode && (
                        <div style={{ fontSize: 10, color: '#dc2626' }}>
                          {provider.lastHealthErrorCode}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{telemetry.sampleCount}</td>
                    <td style={{ padding: '8px 6px' }}>
                      {telemetry.available && telemetry.avgLatencyMs !== null
                        ? `${telemetry.avgLatencyMs} / ${telemetry.p95LatencyMs ?? '—'} ms`
                        : '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {telemetry.available && telemetry.errorRatePercent !== null
                        ? `${telemetry.errorRatePercent}%`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
