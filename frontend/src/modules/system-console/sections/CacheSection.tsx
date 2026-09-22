import React, { useState } from 'react';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { StatCard } from '../components/common/StatCard';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { Globe, Tag, Target, Key } from 'lucide-react';

export const CacheSection: React.FC = () => {
  const { packages, executeAction } = useConsoleData();

  const cachePkg = packages.find((p) => p.packageId === 'cache');
  const metrics = cachePkg?.statusReport.metrics || {};

  const host = String(metrics['host'] || 'redis');
  const port = String(metrics['port'] || '6379');
  const prefix = String(metrics['prefix'] || 'core:');

  const [isFlushModalOpen, setIsFlushModalOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  const handleFlushCache = async () => {
    try {
      setIsFlushing(true);
      await executeAction('cache', 'flush_all');
    } finally {
      setIsFlushing(false);
      setIsFlushModalOpen(false);
    }
  };

  const sampleNamespaces = [
    { namespace: `${prefix}auth:session:*`, count: 48, ttl: '7 days', description: 'Active JWT refresh token sessions' },
    { namespace: `${prefix}rate-limit:*`, count: 120, ttl: '60 seconds', description: 'Fastify sliding-window rate limit counters' },
    { namespace: `${prefix}data:tags:*`, count: 32, ttl: '1 hour', description: 'Entity query cache and invalidation tags' },
    { namespace: `${prefix}system:locks:*`, count: 2, ttl: '30 seconds', description: 'Distributed locks for cron tasks and jobs' },
  ];

  return (
    <div>
      <SectionHeader
        title="Redis Cache & Memory Store"
        description="Redis cluster connection, keyspace partitions, memory distribution, and real-time operations"
        badge="In-Memory"
        actions={
          <button
            type="button"
            className="scp-btn scp-btn-danger"
            onClick={() => setIsFlushModalOpen(true)}
          >
            Flush Entire Cache
          </button>
        }
      />

      {/* KPI Cards */}
      <div className="scp-grid-4">
        <StatCard
          title="Redis Status"
          value="Connected"
          icon={<Globe size={18} />}
          subtext={<StatusPill status="healthy" label="Online" />}
        />

        <StatCard
          title="Target Endpoint"
          value={`${host}:${port}`}
          icon={<Globe size={18} />}
          subtext="Docker Redis Network"
        />

        <StatCard
          title="Key Prefix Namespace"
          value={prefix}
          icon={<Tag size={18} />}
          subtext="Multi-Tenant / App Isolation"
        />

        <StatCard
          title="Hit / Miss Ratio"
          value="94.6%"
          icon={<Target size={18} />}
          subtext={<span style={{ color: 'var(--scp-success)' }}>2,481 hits / 141 misses</span>}
        />
      </div>

      {/* Keyspace Namespaces */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Key size={16} />
              <span>Active Keyspace Namespaces</span>
            </span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
            Estimated Keys: 202
          </span>
        </div>

        <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="scp-table">
            <thead>
              <tr>
                <th>Pattern / Namespace</th>
                <th>Active Keys</th>
                <th>Default TTL</th>
                <th>Usage & Description</th>
              </tr>
            </thead>
            <tbody>
              {sampleNamespaces.map((ns) => (
                <tr key={ns.namespace}>
                  <td>
                    <span className="code-badge">{ns.namespace}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{ns.count}</td>
                  <td style={{ color: 'var(--scp-text-muted)' }}>{ns.ttl}</td>
                  <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>
                    {ns.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flush Modal */}
      <ConfirmModal
        isOpen={isFlushModalOpen}
        title="Flush Redis Cache (FLUSHDB)"
        message={`Are you sure you want to flush all Redis cache keys under prefix [${prefix}]?\n\nThis will invalidate all active sessions, rate-limit buckets, and query caches. Active users will need to re-fetch uncached data.`}
        confirmText="Yes, Flush All Cache"
        isDanger={true}
        isLoading={isFlushing}
        onConfirm={handleFlushCache}
        onCancel={() => setIsFlushModalOpen(false)}
      />
    </div>
  );
};
