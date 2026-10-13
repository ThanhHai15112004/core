import React from 'react';
import { ListChecks, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import { jobsApi } from '../../services/jobs.api';
import { JOBS_STATUS_TONE, JOBS_TABS, type JobsPageTab } from '../../constants/jobs';
import { JobSearchBox } from '../../components/jobs/JobSearchBox';
import { useJobsPage } from './useJobsPage';
import { jobsKeys } from './jobs-keys';
import { JobsOverviewTab } from './JobsOverviewTab';
import { JobsExplorerTab } from './JobsExplorerTab';
import { JobsFailuresTab } from './JobsFailuresTab';
import { JobsActivityTab } from './JobsActivityTab';
import { JobDetailPage } from './JobDetailPage';
import { JobsConfigSheet } from './JobsConfigSheet';

/**
 * Jobs — tra cứu và thao tác từng job: Tổng quan · Explorer · Lỗi · Hoạt động; Job Detail là trang con
 * (`jobs/job/<id>`); cấu hình mở dạng sheet. Provider không kết nối → nói rõ, không giả dữ liệu.
 */
export const JobsSection: React.FC = () => {
  const { t } = useLocale();
  const page = useJobsPage();
  const overview = useLiveQuery(jobsKeys.overview(page.range), () => jobsApi.overview(page.range));
  const data = overview.data;

  const config = <JobsConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} overview={data} />;

  if (page.isDetail && page.jobId) {
    return (
      <div>
        <JobDetailPage key={`${page.jobId}:${page.detailQueue ?? ''}`} page={page} jobId={page.jobId} environment={data?.environment} />
        {config}
      </div>
    );
  }

  const failing = data?.failureGroups.available ? data.failureGroups.data.length : null;
  const tabs: PageTab<JobsPageTab>[] = JOBS_TABS.map((id) => ({
    id,
    label: t(`jobs.tab.${id}`),
    ...(id === 'overview' ? { count: data?.problems.length ?? null, countTone: 'warn' as const } : {}),
    ...(id === 'failures' ? { count: failing, countTone: 'crit' as const } : {}),
  }));

  const renderTab = () => {
    switch (page.tab) {
      case 'explorer':
        return <JobsExplorerTab page={page} overview={data} />;
      case 'failures':
        return <JobsFailuresTab page={page} queues={data?.queues ?? []} />;
      case 'activity':
        return <JobsActivityTab page={page} />;
      default:
        return <JobsOverviewTab page={page} overview={overview} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.jobs')}
        icon={ListChecks}
        status={data ? { tone: JOBS_STATUS_TONE[data.status] ?? 'unknown', label: t(`jobs.state.${data.status}`) } : undefined}
        actions={page.tab !== 'explorer' ? <JobSearchBox value="" onSubmit={(q) => page.explore({ q: q || undefined })} className="hidden w-80 md:flex" /> : undefined}
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && page.tab !== 'overview' && (
        <StatusBanner
          tone="crit"
          title={t('jobs.offline')}
          description={errorMessage(overview.error)}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {data?.status === 'unavailable' && (
        <StatusBanner tone="crit" title={t('jobs.unavailable.title')} description={t('jobs.unavailable.message', { product: data.provider.product, state: data.provider.connection })} />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />
      {renderTab()}

      {config}
    </div>
  );
};
