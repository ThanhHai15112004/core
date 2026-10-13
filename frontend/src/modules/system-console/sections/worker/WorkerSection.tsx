import React from 'react';
import { ArrowRight, Boxes, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { WorkerAlert, WorkerEvent } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { BACKGROUND_TONE, WORKER_PAGE_TABS, type WorkerPageTab } from '../../constants/worker';
import { QueueActionDialog } from '../../components/worker/QueueActionDialog';
import { WorkerDetailSheet } from '../../components/worker/WorkerDetailSheet';
import { useWorkerPage } from './useWorkerPage';
import { workerKeys } from './worker-keys';
import { WorkerOverviewTab } from './WorkerOverviewTab';
import { WorkerQueuesTab } from './WorkerQueuesTab';
import { WorkerWorkersTab } from './WorkerWorkersTab';
import { WorkerActivityTab } from './WorkerActivityTab';
import { QueueDetailPage } from './QueueDetailPage';
import { WorkerConfigSheet } from './WorkerConfigSheet';

/**
 * Worker & Queue — công việc nền có được worker thực thi kịp và thành công không.
 * Tổng quan · Queues · Workers · Lỗi & Hoạt động; chi tiết queue là trang con; worker instance mở drawer
 * (`?item=`); cấu hình mở sheet ⚙. Phần provider không hỗ trợ / không kết nối nói rõ lý do — không số liệu giả.
 */
export const WorkerSection: React.FC = () => {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const page = useWorkerPage();
  const overview = useLiveQuery(workerKeys.overview(page.range), () => workerApi.overview(page.range));
  const data = overview.data;
  const health = data?.health;
  const product = data?.provider.product;

  const openAlert = (a: WorkerAlert) => (a.queue ? page.openQueue(a.queue, a.tab === 'failures' ? 'failures' : 'overview') : page.openLegacyTab(a.tab));
  const openEvent = (e: WorkerEvent) => (e.queue ? page.openQueue(e.queue) : e.tab ? page.openLegacyTab(e.tab) : undefined);

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? null;
  const tabs: PageTab<WorkerPageTab>[] = WORKER_PAGE_TABS.map((id) => ({
    id,
    label: t(`wq.tab.${id}`),
    ...(id === 'overview' ? { count: problems, countTone: 'warn' as const } : {}),
    ...(id === 'activity' ? { count: data?.kpis.failed ?? null, countTone: 'crit' as const } : {}),
  }));

  const noWorkers = health?.reasons.some((r) => r.code.startsWith('NO_WORKER')) ?? false;
  const queueProblems = new Set(health?.reasons.map((r) => r.queue).filter(Boolean)).size;

  const renderTab = () => {
    if (page.queueName) return <QueueDetailPage key={page.queueName} page={page} name={page.queueName} product={product} />;
    switch (page.tab) {
      case 'queues':
        return <WorkerQueuesTab page={page} product={product} />;
      case 'workers':
        return <WorkerWorkersTab page={page} />;
      case 'activity':
        return <WorkerActivityTab page={page} data={data} openAlert={openAlert} openEvent={openEvent} />;
      default:
        return <WorkerOverviewTab page={page} overview={overview} openAlert={openAlert} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.worker')}
        icon={Boxes}
        status={health ? { tone: BACKGROUND_TONE[health.status], label: t(`wq.health.short.${health.status}`) } : undefined}
        actions={
          data ? (
            <Hint
              content={
                <span className="font-mono">
                  {data.provider.endpoint}
                  {health?.pingMs !== null && health?.pingMs !== undefined && ` · ${t('wq.provider.ping', { value: f.duration(health.pingMs) })}`}
                  {` · ${t('wq.provider.checked', { time: formatTime(data.generatedAt, true) })}`}
                </span>
              }
            >
              <Badge variant="outline" className="hidden font-mono sm:inline-flex">
                {data.provider.product} · {data.provider.backend} · {data.environment}
              </Badge>
            </Hint>
          ) : undefined
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={t('wq.offline')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}

      {health && health.status !== 'healthy' && page.tab === 'overview' && !page.queueName && (
        <StatusBanner
          tone={BACKGROUND_TONE[health.status]}
          title={t(`wq.health.${health.status}`)}
          description={
            [
              health.status === 'degraded' && queueProblems > 0 ? t('wq.health.queuesNeedAttention', { count: queueProblems }) : null,
              health.lastWorkerSeenAt ? t('wq.health.lastWorkerSeen', { time: formatTime(health.lastWorkerSeenAt, true) }) : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
          reasons={health.reasons.map((r) => ({ id: `${r.code}-${r.queue ?? ''}`, text: r.message, onClick: r.queue ? () => page.openQueue(r.queue!) : undefined }))}
          actions={
            health.status === 'down' || noWorkers ? (
              <Button size="xs" variant="secondary" onClick={() => (noWorkers ? page.go('workers') : page.navigate('runtimes/worker'))}>
                {t(noWorkers ? 'wq.health.inspectWorkers' : 'wq.health.inspectRuntime')}
                <ArrowRight />
              </Button>
            ) : undefined
          }
        />
      )}

      {!page.queueName && <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />}
      {renderTab()}

      <WorkerDetailSheet id={page.workerId} onClose={() => page.openWorker(null)} onOpenQueue={(q) => page.openQueue(q)} navigate={page.navigate} />
      <WorkerConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} />
      <QueueActionDialog request={page.action} settings={data?.settings} onClose={() => page.requestAction(null)} />
    </div>
  );
};
