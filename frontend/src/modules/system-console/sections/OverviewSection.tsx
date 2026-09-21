import React from 'react';
import type { ConsoleSectionId } from '../types/console.types';
import { useConsoleData } from '../context/ConsoleDataContext';
import { StatCard } from '../components/common/StatCard';
import { StatusPill } from '../components/common/StatusPill';
import { Sparkline } from '../components/common/Sparkline';
import { UptimeCounter } from '../components/common/UptimeCounter';
import { SectionHeader } from '../components/common/SectionHeader';
import { resolvePackageIcon } from '../constants/console.constants';

interface OverviewSectionProps {
  onNavigate: (section: ConsoleSectionId) => void;
  onOpenPackageDetail: (packageId: string) => void;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  onNavigate,
  onOpenPackageDetail,
}) => {
  const {
    health,
    packages,
    currentLatency,
    avgLatency,
    latencyHistory,
    events,
    refresh,
    isRefreshing,
  } = useConsoleData();

  const healthyPackages = packages.filter((p) => p.statusReport.status === 'healthy').length;
  const isAllHealthy = health.status === 'ok' && (packages.length === 0 || healthyPackages === packages.length);

  return (
    <div>
      <SectionHeader
        title="System Overview"
        description="Unified real-time visibility into Core Framework runtimes, infrastructure packages, and operational events."
        actions={
          <button
            type="button"
            className="scp-btn scp-btn-secondary scp-btn-sm"
            onClick={() => refresh()}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Checking...' : 'Refresh Status'}
          </button>
        }
      />

      {/* Primary Status Banner */}
      <div className={`status-banner ${isAllHealthy ? 'is-ok' : health.status === 'down' ? 'is-down' : 'is-warning'}`}>
        <div className="status-banner-left">
          <div className="status-banner-icon-box">
            {isAllHealthy ? '🛡️' : '⚠️'}
          </div>
          <div>
            <h3 className="status-banner-title">
              {isAllHealthy ? 'All Systems Operational' : 'System Degraded or Pending Check'}
            </h3>
            <div className="status-banner-meta">
              API Gateway connected • Uptime: <UptimeCounter uptimeSeconds={health.uptime} /> • Version: {health.version || '1.0.0'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <StatusPill status={health.status} label={`API: ${health.status.toUpperCase()}`} />
          <StatusPill status="healthy" label={`Packages: ${healthyPackages}/${packages.length} Healthy`} />
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="overview-grid-4">
        <StatCard
          title="API Latency"
          value={`${currentLatency} ms`}
          icon="⚡"
          subtext={<span>Avg: <strong>{avgLatency} ms</strong> (last {latencyHistory.length} checks)</span>}
        >
          <Sparkline data={latencyHistory} height={32} />
        </StatCard>

        <StatCard
          title="Manageable Packages"
          value={`${packages.length}`}
          icon="📦"
          subtext={
            <span style={{ color: 'var(--scp-success)' }}>
              ✓ {healthyPackages} operational
            </span>
          }
        >
          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
            {packages.map((pkg) => (
              <span
                key={pkg.packageId}
                className="code-badge"
                style={{ fontSize: '0.7rem', cursor: 'pointer' }}
                onClick={() => onOpenPackageDetail(pkg.packageId)}
                title={`Click to inspect ${pkg.displayName}`}
              >
                {resolvePackageIcon(pkg)} {pkg.packageId}
              </span>
            ))}
          </div>
        </StatCard>

        <StatCard
          title="Active Runtimes"
          value="4 Multi-Runtime"
          icon="🚀"
          subtext="API, Worker, Scheduler, CLI"
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-secondary)', marginTop: '0.25rem' }}>
            Multi-Runtime architecture ready
          </div>
        </StatCard>

        <StatCard
          title="Framework Uptime"
          value={<UptimeCounter uptimeSeconds={health.uptime} />}
          icon="⏱️"
          subtext={<span>Started: {new Date(Date.now() - health.uptime * 1000).toLocaleTimeString()}</span>}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
            Service: <code>{health.service || 'core-framework'}</code>
          </div>
        </StatCard>
      </div>

      {/* Multi-Runtime Quick Status Grid */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span>⚡ Multi-Runtime Status</span>
          </h3>
          <button
            className="scp-btn scp-btn-sm scp-btn-secondary"
            onClick={() => onNavigate('runtime')}
          >
            View Details →
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {/* API */}
          <div
            style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--scp-border-subtle)',
              backgroundColor: 'var(--scp-bg-surface-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>🌐 HTTP API Gateway</strong>
              <StatusPill status={health.status} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
              Port 3005 • Fastify Adapter
            </div>
          </div>

          {/* Worker */}
          <div
            style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--scp-border-subtle)',
              backgroundColor: 'var(--scp-bg-surface-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>⚙️ Worker Runtime</strong>
              <StatusPill status="healthy" label="Ready" />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
              BullMQ Consumer • Redis Queue
            </div>
          </div>

          {/* Scheduler */}
          <div
            style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--scp-border-subtle)',
              backgroundColor: 'var(--scp-bg-surface-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>⏱️ Cron Scheduler</strong>
              <StatusPill status="healthy" label="Active" />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
              NestJS Schedule • 3 Cron Jobs
            </div>
          </div>

          {/* CLI */}
          <div
            style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--scp-border-subtle)',
              backgroundColor: 'var(--scp-bg-surface-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>💻 CLI Command Tool</strong>
              <StatusPill status="idle" label="Standby" />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
              Nest Commander • Migrations & Seeds
            </div>
          </div>
        </div>
      </div>

      {/* Packages Mini-Grid & Recent Event Log */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        {/* Packages Mini Overview */}
        <div className="scp-panel" style={{ margin: 0 }}>
          <div className="scp-panel-header">
            <h3 className="scp-panel-title">
              <span>📦 Registered Packages</span>
            </h3>
            <button
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => onNavigate('packages')}
            >
              All Packages ({packages.length}) →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {packages.map((pkg) => (
              <div
                key={pkg.packageId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--scp-border-subtle)',
                  backgroundColor: 'var(--scp-bg-surface-subtle)',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onClick={() => onOpenPackageDetail(pkg.packageId)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>{resolvePackageIcon(pkg)}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--scp-text-primary)' }}>
                      {pkg.displayName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
                      {pkg.statusReport.summary}
                    </div>
                  </div>
                </div>
                <StatusPill status={pkg.statusReport.status} />
              </div>
            ))}

            {packages.length === 0 && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--scp-text-muted)', fontSize: '0.85rem' }}>
                No packages registered yet.
              </div>
            )}
          </div>
        </div>

        {/* Live Operational Events */}
        <div className="scp-panel" style={{ margin: 0 }}>
          <div className="scp-panel-header">
            <h3 className="scp-panel-title">
              <span>📋 Recent Operational Events</span>
            </h3>
            <button
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => onNavigate('logs')}
            >
              Full Log Viewer →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflowY: 'auto' }}>
            {events.slice(0, 5).map((evt) => (
              <div
                key={evt.id}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--scp-bg-surface-subtle)',
                  borderLeft: `3px solid var(--scp-${evt.level === 'error' ? 'danger' : evt.level === 'warn' ? 'warning' : evt.level === 'success' ? 'success' : 'info'})`,
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--scp-text-primary)' }}>
                    [{evt.source}]
                  </span>
                  <span style={{ color: 'var(--scp-text-muted)', fontSize: '0.72rem' }}>
                    {evt.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ color: 'var(--scp-text-secondary)', fontSize: '0.78rem' }}>
                  {evt.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
