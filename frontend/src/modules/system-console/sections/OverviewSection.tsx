import React from 'react';
import type { ConsoleSectionId, SystemEnvironment } from '../types/console.types';
import { useConsoleData } from '../context/ConsoleDataContext';
import { OverallHealthBanner } from '../components/overview/OverallHealthBanner';
import { KeyMetricsGrid } from '../components/overview/KeyMetricsGrid';
import { SystemHealthMap } from '../components/overview/SystemHealthMap';
import { PerformanceChart } from '../components/overview/PerformanceChart';
import { CurrentProblemsPanel } from '../components/overview/CurrentProblemsPanel';
import { InfraSnapshotGrid } from '../components/overview/InfraSnapshotGrid';
import { RecentEventsTimeline } from '../components/overview/RecentEventsTimeline';
import { OfflineFallbackBanner } from '../components/overview/OfflineFallbackBanner';

import { useLocale } from '../../../core/i18n/index';
import { RefreshCw } from 'lucide-react';

interface OverviewSectionProps {
  onNavigate: (section: ConsoleSectionId) => void;
  onOpenPackageDetail?: (packageId: string) => void;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  onNavigate,
}) => {
  const { t } = useLocale();
  const {
    overviewData,
    performanceSeries,
    performanceStats,
    activePerformanceMetric,
    setActivePerformanceMetric,
    performanceTimeRange,
    setPerformanceTimeRange,
    isRefreshing,
    isLoading,
    refresh,
    isOffline,
    lastSuccessfulSync,
    environment,
    setEnvironment,
  } = useConsoleData();

  const handleCycleEnvironment = () => {
    const envCycle: Record<SystemEnvironment, SystemEnvironment> = {
      production: 'staging',
      staging: 'development',
      development: 'production',
    };
    setEnvironment(envCycle[environment]);
  };

  return (
    <div className="overview-page-root">
      {/* Header Row: Title, Subtitle, Environment Badge, Refresh */}
      <div className="overview-header-row">
        <div className="overview-header-left">
          <div className="overview-title-wrap">
            <h1 className="overview-main-title">{t('overview.title')}</h1>
            <button
              type="button"
              className={`overview-env-badge is-${environment}`}
              onClick={handleCycleEnvironment}
              title="Click to toggle environment simulation"
              style={{ cursor: 'pointer', border: 'none' }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                  display: 'inline-block',
                }}
              />
              <span>{environment.toUpperCase()}</span>
            </button>
          </div>
          <p className="overview-subtitle">{t('overview.subtitle')}</p>
        </div>

        <div className="overview-header-actions">
          <span className="overview-last-updated">
            {t('common.lastUpdated')}: {overviewData.lastUpdated.toLocaleTimeString()}
          </span>

          <button
            type="button"
            className="scp-btn scp-btn-secondary scp-btn-sm"
            onClick={() => refresh()}
            disabled={isRefreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw
              size={13}
              style={{
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>{isRefreshing ? t('common.refreshing') : t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Offline Alert when API Gateway is down */}
      {isOffline && (
        <OfflineFallbackBanner
          lastSync={lastSuccessfulSync}
          onRetry={() => refresh()}
          isRetrying={isRefreshing}
        />
      )}

      {/* Main Operational 7-Zone Layout */}
      <div className={isOffline ? 'is-offline-dimmed' : ''}>
        {/* Zone 1: Overall System Health Banner */}
        <OverallHealthBanner
          healthReport={overviewData.overallHealth}
          onNavigate={onNavigate}
        />

        {/* Zone 2: Key System Metrics (6 KPIs) */}
        <KeyMetricsGrid
          metrics={overviewData.keyMetrics}
          isLoading={isLoading}
        />

        {/* Zone 3: System Health Map (Grouped) */}
        <SystemHealthMap
          items={overviewData.healthMap}
          onNavigate={onNavigate}
        />

        {/* Zone 4 & 5: Middle Split (Performance Chart 70% | Problems & Alerts 30%) */}
        <div className="overview-middle-split">
          <PerformanceChart
            activeMetric={activePerformanceMetric}
            onMetricChange={setActivePerformanceMetric}
            timeRange={performanceTimeRange}
            onTimeRangeChange={setPerformanceTimeRange}
            series={performanceSeries}
            stats={performanceStats}
          />

          <CurrentProblemsPanel
            incidents={overviewData.incidents}
            onNavigate={onNavigate}
          />
        </div>

        {/* Zone 6: Runtime & Infrastructure Snapshot */}
        <InfraSnapshotGrid
          snapshots={overviewData.infraSnapshots}
          onNavigate={onNavigate}
        />

        {/* Zone 7: Recent Activity Timeline */}
        <RecentEventsTimeline
          events={overviewData.recentActivities}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
};
