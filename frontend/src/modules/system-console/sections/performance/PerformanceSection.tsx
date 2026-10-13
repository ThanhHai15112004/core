import React from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorStatus, useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import { performanceApi } from '../../services/performance.api';
import { LEVEL_TONE, PERF_TABS, type PerfTab } from '../../constants/performance';
import { ComponentSheet } from '../../components/performance/ComponentPerf';
import { usePerformancePage } from './usePerformancePage';
import { perfKeys } from './performance-keys';
import { PerfOverviewTab } from './PerfOverviewTab';
import { PerfBottlenecksTab } from './PerfBottlenecksTab';
import { PerfEventsTab } from './PerfEventsTab';
import { PerfConfigSheet } from './PerfConfigSheet';

const UNAVAILABLE_STATUS = 503;

/**
 * Performance: hệ thống nhanh hay chậm, nghẽn ở đâu, từ lúc nào — Tổng quan · Điểm nghẽn & Thành phần · Sự kiện.
 * Chỉ đọc; thao tác nằm ở đúng subsystem (Runtimes, HTTP Traffic, Database…). Chi tiết thành phần mở drawer `?item=`.
 */
export const PerformanceSection: React.FC = () => {
  const { t } = useLocale();
  const page = usePerformancePage();
  const overview = useLiveQuery(perfKeys.overview(page.range), () => performanceApi.overview(page.range));
  const data = overview.data;
  const unavailable = overview.isError && errorStatus(overview.error) === UNAVAILABLE_STATUS;

  const tabs: PageTab<PerfTab>[] = PERF_TABS.map((id) => ({
    id,
    label: t(`perf.tab.${id}`),
    ...(id === 'bottlenecks' && data ? { count: data.bottlenecks.length, countTone: data.bottlenecks.some((b) => b.severity === 'critical') ? ('crit' as const) : ('warn' as const) } : {}),
  }));

  const renderTab = () => {
    switch (page.tab) {
      case 'bottlenecks':
        return <PerfBottlenecksTab page={page} overview={overview} />;
      case 'events':
        return <PerfEventsTab page={page} />;
      default:
        return <PerfOverviewTab page={page} overview={overview} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.performance')}
        icon={Gauge}
        status={data ? { tone: LEVEL_TONE[data.status.level], label: t(`perf.level.${data.status.level}`) } : undefined}
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={unavailable ? t('perf.empty.unavailableTitle') : t('ov.offline.title')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />
      {renderTab()}

      <ComponentSheet id={page.item} range={page.range} onClose={() => page.openItem(null)} navigate={page.navigate} />
      <PerfConfigSheet data={data} open={page.settingsOpen} onOpenChange={page.setSettings} />
    </div>
  );
};
