import React, { useState, useEffect, useCallback } from 'react';
import type { PackageSummary } from '../types/system-ops.types';
import { PackageStatus } from '../types/system-ops.types';
import { getSystemOpsPackages, executePackageAction } from '../services/system-ops.api';
import { PackageCard } from '../components/PackageCard';
import { useLocale } from '../../../core/i18n/index';
import '../styles/system-ops.css';

export const SystemOpsPage: React.FC = () => {
  const { t } = useLocale();
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSystemOpsPackages();
      setPackages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemOps.connectError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const handleExecuteAction = async (packageId: string, actionId: string) => {
    try {
      const result = await executePackageAction(packageId, actionId);
      if (result.success) {
        setNotification({ type: 'success', message: result.message || t('systemOps.actionSuccess') });
        await loadPackages();
      } else {
        setNotification({ type: 'error', message: result.message || t('systemOps.actionFailed') });
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : t('systemOps.actionError'),
      });
    }

    setTimeout(() => setNotification(null), 5000);
  };

  const healthyCount = packages.filter((p) => p.statusReport.status === PackageStatus.HEALTHY).length;
  const warningCount = packages.filter(
    (p) => p.statusReport.status === PackageStatus.WARNING || p.statusReport.status === PackageStatus.ERROR,
  ).length;

  return (
    <div className="ops-container">
      {/* Header */}
      <div className="ops-header">
        <div>
          <div className="ops-badge">⚙️ {t('systemOps.badge')}</div>
          <h1 className="ops-title">{t('systemOps.title')}</h1>
          <p className="ops-subtitle">{t('systemOps.subtitle')}</p>
        </div>

        <button
          onClick={() => void loadPackages()}
          disabled={loading}
          className="btn-secondary ops-refresh-btn"
        >
          {loading ? t('common.refreshing') : `🔄 ${t('common.refresh')}`}
        </button>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`ops-toast ${
            notification.type === 'success' ? 'ops-toast-success' : 'ops-toast-error'
          }`}
        >
          <span>{notification.type === 'success' ? '✅ ' : '❌ '}{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ops-toast-close"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Overview Stats Bar */}
      <div className="ops-stats-grid">
        <div className="glass ops-stat-card">
          <div className="ops-stat-label">{t('systemOps.totalPackages')}</div>
          <div className="ops-stat-value ops-stat-value-primary">
            {packages.length}
          </div>
        </div>

        <div className="glass ops-stat-card">
          <div className="ops-stat-label">{t('systemOps.healthyPackages')}</div>
          <div className="ops-stat-value ops-stat-value-success">
            {healthyCount}
          </div>
        </div>

        <div className="glass ops-stat-card">
          <div className="ops-stat-label">{t('systemOps.warningPackages')}</div>
          <div
            className={`ops-stat-value ${
              warningCount > 0 ? 'ops-stat-value-warning' : 'ops-stat-value-idle'
            }`}
          >
            {warningCount}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="glass ops-error-box">
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>
            {t('systemOps.loadFailed')}
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>{error}</p>
          <button onClick={() => void loadPackages()} className="btn-primary">
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !error && packages.length === 0 && (
        <div className="ops-empty-loading">
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
          <p>{t('systemOps.loading')}</p>
        </div>
      )}

      {/* Packages Grid */}
      {!loading && !error && (
        <div className="ops-packages-grid">
          {packages.map((pkg) => (
            <PackageCard key={pkg.packageId} pkg={pkg} onExecuteAction={handleExecuteAction} />
          ))}
        </div>
      )}
    </div>
  );
};
