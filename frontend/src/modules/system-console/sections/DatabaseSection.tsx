import React, { useState } from 'react';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { StatCard } from '../components/common/StatCard';
import { Sparkline } from '../components/common/Sparkline';

export const DatabaseSection: React.FC = () => {
  const { packages, executeAction } = useConsoleData();

  const dbPkg = packages.find((p) => p.packageId === 'database');
  const metrics = dbPkg?.statusReport.metrics || {};

  const driver = String(metrics['driver'] || 'mysql');
  const host = String(metrics['host'] || 'global_mysql');
  const port = String(metrics['port'] || '3306');
  const poolLimit = Number(metrics['poolLimit'] || 10);
  const synchronize = Boolean(metrics['synchronize']);
  const isConnected = Boolean(metrics['isConnected'] ?? true);

  const [pingHistory, setPingHistory] = useState<number[]>([4, 6, 5, 8, 4, 7, 5, 4]);
  const [isPinging, setIsPinging] = useState(false);
  const [lastPingResult, setLastPingResult] = useState<string | null>(null);

  const handlePing = async () => {
    try {
      setIsPinging(true);
      const start = performance.now();
      const res = await executeAction('database', 'ping');
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      setPingHistory((prev) => [...prev.slice(-15), latencyMs]);
      setLastPingResult(`${res.message || 'PONG'} in ${latencyMs}ms`);
    } catch {
      setLastPingResult('Ping failed');
    } finally {
      setIsPinging(false);
    }
  };

  const avgPing = Math.round(
    pingHistory.reduce((a, b) => a + b, 0) / (pingHistory.length || 1),
  );

  return (
    <div>
      <SectionHeader
        title="Database & TypeORM ORM Engine"
        description="Monitor relational database connections, connection pool limits, ping latency, and schema synchronization safety."
        actions={
          <button
            type="button"
            className="scp-btn scp-btn-primary scp-btn-sm"
            disabled={isPinging}
            onClick={handlePing}
          >
            {isPinging ? 'Testing Ping...' : '⚡ Test Database Ping'}
          </button>
        }
      />

      {/* Safety Alert if synchronize is true */}
      {synchronize && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '8px',
            backgroundColor: 'var(--scp-warning-bg)',
            border: '1px solid var(--scp-warning-border)',
            color: 'var(--scp-warning-text)',
            fontSize: '0.85rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
          <div>
            <strong>TypeORM Schema Synchronize is ENABLED (`synchronize: true`)</strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', lineHeight: 1.4 }}>
              Automatic schema synchronization is active for local development. Never enable this in staging or production environments to avoid accidental table drops.
            </p>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="overview-grid-4">
        <StatCard
          title="Connection State"
          value={isConnected ? 'Connected' : 'Disconnected'}
          icon="🗄️"
          subtext={
            <StatusPill
              status={isConnected ? 'healthy' : 'error'}
              label={isConnected ? 'Active & Ready' : 'Down'}
            />
          }
        />

        <StatCard
          title="Engine & Driver"
          value={driver.toUpperCase()}
          icon="🐬"
          subtext={`Host: ${host}:${port}`}
        />

        <StatCard
          title="Connection Pool"
          value={`${poolLimit} Max`}
          icon="🏊"
          subtext="TypeORM Connection Pool Size"
        />

        <StatCard
          title="Query Ping Latency"
          value={`${pingHistory[pingHistory.length - 1] ?? 0} ms`}
          icon="⚡"
          subtext={<span>Average: <strong>{avgPing} ms</strong></span>}
        >
          <Sparkline data={pingHistory} height={28} />
        </StatCard>
      </div>

      {/* Connection Properties Table */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span>⚙️ Connection Parameters & Environment</span>
          </h3>
          {lastPingResult && (
            <span style={{ fontSize: '0.8rem', color: 'var(--scp-success)', fontWeight: 600 }}>
              Last ping: {lastPingResult}
            </span>
          )}
        </div>

        <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="scp-table">
            <thead>
              <tr>
                <th>Configuration Key</th>
                <th>Resolved Value</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Database Engine (Driver)</td>
                <td>
                  <span className="code-badge">{driver}</span>
                </td>
                <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                  Supported drivers: mysql, postgres, sqlite, mssql
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Target Host & Port</td>
                <td>
                  <span className="code-badge">{host}:{port}</span>
                </td>
                <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                  Docker network host gateway address
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Connection Pool Limit</td>
                <td>
                  <span className="code-badge">{poolLimit} connections</span>
                </td>
                <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                  Maximum active pooled client instances
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Auto-Load Entities</td>
                <td>
                  <span className="code-badge">true</span>
                </td>
                <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                  Discovers entities automatically from <code>modules/**/entities/</code>
                </td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Schema Synchronize</td>
                <td>
                  <span className="code-badge" style={{ color: synchronize ? 'var(--scp-warning)' : 'var(--scp-success)' }}>
                    {synchronize ? 'Enabled (Dev Mode)' : 'Disabled'}
                  </span>
                </td>
                <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                  Controls whether TypeORM modifies tables automatically
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
