import React from 'react';
import type { ConsoleSectionId } from '../types/console.types';
import { useConsoleData } from '../context/console-data-context';
import { OverallHealthBanner } from '../components/overview/OverallHealthBanner';
import { KeyMetricsGrid } from '../components/overview/KeyMetricsGrid';
import { SystemHealthMap } from '../components/overview/SystemHealthMap';
import { PerformanceChart } from '../components/overview/PerformanceChart';
import { CurrentProblemsPanel } from '../components/overview/CurrentProblemsPanel';
import { InfraSnapshotGrid } from '../components/overview/InfraSnapshotGrid';
import { RecentEventsTimeline } from '../components/overview/RecentEventsTimeline';
import { OfflineFallbackBanner } from '../components/overview/OfflineFallbackBanner';
import { EnvironmentBadge } from '../components/common/EnvironmentBadge';
import { useLocale } from '../../../core/i18n/index';
import { useNow } from '../../../core/hooks/useNow';

interface OverviewSectionProps {
  onNavigate: (section: ConsoleSectionId) => void;
}

/**
 * Màn điều hành chính: Health → Metrics → Health map → Trend + Problems → Snapshot → Events.
 * Chỉ giữ thông tin vận hành; cấu hình chi tiết nằm ở các trang con.
 */
export const OverviewSection: React.FC<OverviewSectionProps> = ({ onNavigate }) => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const {
    overviewData,
    performanceSeries,
    performanceStats,
    metricTrends,
    activePerformanceMetric,
    setActivePerformanceMetric,
    performanceTimeRange,
    setPerformanceTimeRange,
    isLoading,
    isOffline,
    isShowingLastKnown,
    lastSuccessfulSync,
    environment,
  } = useConsoleData();

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <div className="ov-page-title-row">
            <h1 className="ov-page-title">{t('overview.title')}</h1>
            <EnvironmentBadge environment={environment} />
          </div>
          <p className="ov-page-subtitle">{t('overview.subtitle')}</p>
        </div>

        <div className="ov-page-actions">
          <span className="ov-page-updated">
            {t('ov.page.autoUpdated')}{' · '}
            <time dateTime={(lastSuccessfulSync ?? overviewData.lastUpdated).toISOString()}>
              {lastSuccessfulSync ? formatRelative(lastSuccessfulSync, now) : '--'}
            </time>
          </span>
        </div>
      </header>

      {isOffline && (
        <OfflineFallbackBanner
          lastSync={lastSuccessfulSync}
          now={now}
          isShowingLastKnown={isShowingLastKnown}
        />
      )}

      <div className={`ov-body ${isOffline ? 'is-stale' : ''}`}>
        {/* Chưa từng có dữ liệu thì banner offline phía trên đã đủ, tránh báo trùng */}
        {(!isOffline || isShowingLastKnown) && (
          <OverallHealthBanner healthReport={overviewData.overallHealth} now={now} onNavigate={onNavigate} />
        )}
        <KeyMetricsGrid metrics={overviewData.keyMetrics} trends={metricTrends} isLoading={isLoading} />
        <SystemHealthMap items={overviewData.healthMap} onNavigate={onNavigate} />

        <div className="ov-split">
          <PerformanceChart
            activeMetric={activePerformanceMetric}
            onMetricChange={setActivePerformanceMetric}
            timeRange={performanceTimeRange}
            onTimeRangeChange={setPerformanceTimeRange}
            series={performanceSeries}
            stats={performanceStats}
          />
          <CurrentProblemsPanel incidents={overviewData.incidents} now={now} onNavigate={onNavigate} />
        </div>

        <InfraSnapshotGrid snapshots={overviewData.infraSnapshots} onNavigate={onNavigate} />
        <RecentEventsTimeline events={overviewData.recentActivities} onNavigate={onNavigate} />
      </div>
    </div>
  );
};
