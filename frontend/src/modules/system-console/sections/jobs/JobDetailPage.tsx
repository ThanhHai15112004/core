import React, { useState } from 'react';
import { ArrowLeft, Ban, Briefcase, RotateCcw, Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Button, Hint } from '@core/ui/primitives';
import { CopyButton, PageHeader, PageTabs, PanelState, type PageTab } from '@core/ui/blocks';
import type { ActionState, JobDetail } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { JOB_DETAIL_TABS, JOB_STATUS_TONE, type JobDetailPageTab } from '../../constants/jobs';
import { JobActionDialog, type JobAction, type JobActionRequest } from './JobActionDialog';
import { JobDetailBanners, JobOverviewPane } from './JobDetailOverview';
import { JobAttemptsPane } from './JobDetailAttempts';
import { JobPayloadPane } from './JobDetailPayload';
import { jobsKeys } from './jobs-keys';
import type { JobsPage } from './useJobsPage';

/**
 * Job Detail (trang con `jobs/job/<id>`): Tổng quan (thời gian chờ vs xử lý, lỗi, nguồn & trace, cấu hình) ·
 * Lần thử & vòng đời · Payload & log. Retry / Huỷ / Xoá bản ghi khi phù hợp (lý do không cho phép ở tooltip).
 */
export function JobDetailPage({ page, jobId, environment }: { page: JobsPage; jobId: string; environment: string | undefined }) {
  const { t } = useLocale();
  const query = useLiveQuery(jobsKeys.job(jobId, page.detailQueue), () => jobsApi.job(jobId, page.detailQueue), { keepPrevious: false });
  const back = () => (window.history.length > 1 ? window.history.back() : page.go('explorer'));

  return (
    <>
      <Button variant="ghost" size="xs" onClick={back} className="mb-2 -ml-2">
        <ArrowLeft />
        {t('nav.jobs')}
      </Button>
      {query.data === undefined ? (
        <>
          <PageHeader title={`#${jobId}`} icon={Briefcase} />
          <PanelState
            status={query.isError ? 'error' : 'loading'}
            error={query.error}
            message={query.isError ? t('jobs.detail.notFound') : undefined}
            onRetry={() => void query.refetch()}
          />
        </>
      ) : (
        <DetailBody page={page} data={query.data} environment={environment} />
      )}
    </>
  );
}

function DetailBody({ page, data, environment }: { page: JobsPage; data: JobDetail; environment: string | undefined }) {
  const { t } = useLocale();
  const [request, setRequest] = useState<JobActionRequest | null>(null);
  const j = data.job;

  const actionButton = (action: JobAction, state: ActionState, icon: React.ReactNode, label: string, variant: 'primary' | 'secondary' | 'danger') => {
    const button = (
      <Button size="sm" variant={variant} disabled={!state.allowed} onClick={() => setRequest({ action, job: j, detail: data })}>
        {icon}
        {label}
      </Button>
    );
    return state.reason && !state.allowed ? (
      <Hint content={t(`jobs.detail.reason.${state.reason}`)}>
        <span>{button}</span>
      </Hint>
    ) : (
      button
    );
  };

  const tabs: PageTab<JobDetailPageTab>[] = JOB_DETAIL_TABS.map((id) => ({
    id,
    label: t(`jobs.detail.tab.${id}`),
    ...(id === 'attempts' ? { count: data.attempts.length > 1 ? data.attempts.length : null, countTone: j.status === 'failed' ? ('crit' as const) : ('neutral' as const) } : {}),
  }));

  return (
    <>
      <PageHeader
        title={j.type}
        icon={Briefcase}
        status={{ tone: JOB_STATUS_TONE[j.status], label: t(`jobs.status.${j.status}`) }}
        className="mb-1"
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted">
          <span className="truncate">{j.id}</span>
          <CopyButton value={j.id} label={t('jobs.detail.copyId')} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actionButton('retry', data.actions.retry, <RotateCcw />, t('jobs.action.retry'), 'primary')}
          {actionButton('cancel', data.actions.cancel, <Ban />, data.actions.cancel.mode === 'cooperative' ? t('jobs.action.requestCancel') : t('jobs.action.cancel'), 'secondary')}
          {actionButton('remove', data.actions.remove, <Trash2 />, t('jobs.action.remove'), 'danger')}
        </div>
      </div>

      <JobDetailBanners page={page} data={data} />
      <PageTabs tabs={tabs} value={page.detailTab} onChange={page.setDetailTab} />
      {page.detailTab === 'attempts' ? (
        <JobAttemptsPane data={data} />
      ) : page.detailTab === 'payload' ? (
        <JobPayloadPane page={page} data={data} />
      ) : (
        <JobOverviewPane page={page} data={data} />
      )}

      <JobActionDialog
        request={request}
        onClose={() => setRequest(null)}
        settings={data.settings}
        environment={environment}
        onDone={(req) => req.action === 'remove' && page.go('explorer')}
      />
    </>
  );
}
