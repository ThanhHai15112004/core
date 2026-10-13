import { useState } from 'react';
import { ArrowLeft, ExternalLink, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Hint,
  ToggleGroup,
  ToggleGroupItem,
} from '@core/ui/primitives';
import {
  AlertList,
  KeyValueGrid,
  PageTabs,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  StatGrid,
  StatTile,
  StatusBanner,
  StatusDot,
  UsageBar,
  type PageTab,
} from '@core/ui/blocks';
import type { JobState, QueueDetail } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { DEFAULT_JOB_STATES, JOB_STATES, JOB_TABLE_MAX_HEIGHT_PX, QUEUE_JOBS_LIMIT, QUEUE_PAGE_TABS, QUEUE_STATUS_TONE, type QueuePageTab } from '../../constants/worker';
import { JobTable } from '../../components/worker/JobTable';
import { QueueMetricChart } from '../../components/worker/QueueMetricChart';
import { RateBalance } from '../../components/worker/RateBalance';
import { WorkerTable } from '../../components/worker/WorkerTable';
import { ConcurrencyPanel } from '../../components/worker/ConcurrencyPanel';
import { SectionGate } from '../../components/worker/SectionGate';
import { DENSE_GRID, toAlertItems } from '../../components/worker/worker-ui';
import { WorkerFailuresView } from './WorkerFailuresView';
import { workerKeys } from './worker-keys';
import type { WorkerPage } from './useWorkerPage';

/**
 * Trang chi tiết queue `worker/queues/<name>`: trạng thái + thao tác (pause / resume, retry lỗi, drain) + số chính;
 * tab Tổng quan (biểu đồ, cảnh báo, nhận vào vs xử lý, ngưỡng, cấu hình, worker, kết nối, job gần đây) · Jobs · Lỗi.
 */
export function QueueDetailPage({ page, name, product }: { page: WorkerPage; name: string; product: string | undefined }) {
  const { t } = useLocale();
  const query = useLiveQuery(workerKeys.queue(name, page.range), () => workerApi.queue(name, page.range), { keepPrevious: false });
  return (
    <>
      <Button variant="ghost" size="xs" className="-ml-2 mb-2" onClick={() => page.go('queues')}>
        <ArrowLeft />
        {t('wq.detail.back')}
      </Button>
      <QueryView query={query}>{(d) => <QueueBody page={page} d={d} product={product} />}</QueryView>
    </>
  );
}

function QueueBody({ page, d, product }: { page: WorkerPage; d: QueueDetail; product: string | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const q = d.queue;
  const tone = QUEUE_STATUS_TONE[q.status];
  const tabs: PageTab<QueuePageTab>[] = QUEUE_PAGE_TABS.map((id) => ({
    id,
    label: t(`wq.detail.tab.${id}`),
    ...(id === 'failures' ? { count: q.failed, countTone: 'crit' as const } : {}),
  }));
  const isBacklog = q.status === 'backlog' || q.status === 'no_consumer';

  return (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate font-mono text-lg font-semibold text-fg">{q.name}</h2>
            <Badge tone={tone}>
              <StatusDot tone={tone} size="xs" />
              {t(`wq.queue.statusOf.${q.status}`)}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">{t(`wq.queue.statusHint.${q.status}`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.settings.pause &&
            (q.paused ? (
              <Button size="sm" variant="primary" onClick={() => page.requestAction({ action: 'resume', target: q })}>
                <Play />
                {t('wq.action.resume')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => page.requestAction({ action: 'pause', target: q })}>
                <Pause />
                {t('wq.action.pause')}
              </Button>
            ))}
          {d.settings.retryFailed && q.failed > 0 && (
            <Button size="sm" onClick={() => page.requestAction({ action: 'retry', target: q })}>
              <RotateCcw />
              {t('wq.action.retryFailed')}
            </Button>
          )}
          <Hint content={d.settings.drain ? undefined : t('wq.danger.disabled')}>
            <span>
              <Button size="sm" variant="danger-outline" disabled={!d.settings.drain || q.waiting + q.delayed === 0} onClick={() => page.requestAction({ action: 'drain', target: q })}>
                <Trash2 />
                {t('wq.action.drain')}
              </Button>
            </span>
          </Hint>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost">
                <ExternalLink />
                {t('wq.related.title')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => page.navigate(`jobs/explorer?queue=${encodeURIComponent(q.name)}`)}>{t('wq.related.jobs')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => page.navigate(`messaging/messages?queue=${encodeURIComponent(q.name)}`)}>{t('wq.related.messaging')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => page.navigate('runtimes/worker')}>{t('wq.related.runtime')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => page.navigate('performance')}>{t('wq.related.performance')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {q.paused && <StatusBanner tone="warn" title={t('wq.detail.pausedNote', { count: f.compact(q.waiting) })} />}

      <StatGrid columns={6}>
        <StatTile
          label={t('wq.queue.waiting')}
          value={f.compact(q.waiting)}
          sub={q.oldestWaitingSec === null ? undefined : t('wq.kpi.oldest', { age: f.duration(q.oldestWaitingSec * 1000) })}
          tone={isBacklog ? 'warn' : undefined}
        />
        <StatTile label={t('wq.queue.active')} value={f.compact(q.active)} />
        <StatTile label={t('wq.queue.delayed')} value={f.compact(q.delayed)} />
        <StatTile
          label={t('wq.queue.failed')}
          value={f.compact(q.failed)}
          sub={q.failureRatePercent === null ? undefined : t('wq.kpi.failureRate', { value: f.percent(q.failureRatePercent) })}
          tone={q.failed > 0 ? 'crit' : undefined}
          onClick={() => page.openQueue(q.name, 'failures')}
        />
        <StatTile label={t('wq.rates.processing')} value={f.rate(q.processingPerMin, 'min')} sub={t('wq.kpi.incoming', { value: f.rate(q.incomingPerMin, 'min') })} />
        <StatTile label={t('wq.kpi.durationP95')} value={f.duration(q.p95Ms)} sub={t('wq.kpi.avg', { value: f.duration(q.avgMs) })} />
      </StatGrid>

      <PageTabs tabs={tabs} value={page.queueTab} onChange={(sub) => page.openQueue(q.name, sub)} />

      {page.queueTab === 'jobs' ? (
        <QueueJobsPanel page={page} name={q.name} />
      ) : page.queueTab === 'failures' ? (
        <WorkerFailuresView range={page.range} product={product} queue={q.name} onAction={page.requestAction} openJob={page.openJob} />
      ) : (
        <QueueOverview page={page} d={d} product={product} />
      )}
    </>
  );
}

function QueueOverview({ page, d, product }: { page: WorkerPage; d: QueueDetail; product: string | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const q = d.queue;
  const cap = d.capacity;
  const critPercent = cap.warn > 0 ? (cap.crit / cap.warn) * 100 : 100;
  const defaults = d.defaults;
  return (
    <>
      <PanelGrid layout="2-1">
        <QueueMetricChart range={page.range} title={t('wq.detail.activity')} queue={q.name} />
        <Panel title={t('wq.alerts.queue')}>
          <AlertList items={toAlertItems(d.alerts, (a) => page.openQueue(q.name, a.tab === 'failures' ? 'failures' : 'overview'))} />
        </Panel>
      </PanelGrid>

      <PanelGrid layout={3}>
        <Panel title={t('wq.rates.title')}>
          <RateBalance rates={d.rates} wait={d.wait} processing={d.processing} onOpenOldest={d.wait.oldestJobId ? () => page.openJob({ id: d.wait.oldestJobId!, queue: q.name }) : undefined} />
        </Panel>
        <Panel title={t('wq.capacity.title')} hint={t('wq.capacity.note')}>
          <KeyValueGrid
            columns={3}
            className={DENSE_GRID[3]}
            items={[
              { label: t('wq.queue.waiting'), value: f.compact(cap.waiting), mono: true },
              { label: t('wq.capacity.warn'), value: f.compact(cap.warn), mono: true },
              { label: t('wq.capacity.crit'), value: f.compact(cap.crit), mono: true },
            ]}
          />
          <div className="mt-4 text-xs text-muted">{t('wq.capacity.current')}</div>
          <UsageBar className="mt-1" percent={cap.percentOfWarn} thresholds={{ warn: 100, crit: critPercent }} />
        </Panel>
        <Panel title={t('wq.detail.config')}>
          <KeyValueGrid
            items={[
              { label: t('wq.config.key.concurrency'), value: q.concurrency || null, mono: true },
              { label: t('wq.config.key.attempts'), value: defaults.attempts, mono: true },
              { label: t('wq.config.key.backoff'), value: t(`wq.config.value.backoff.${defaults.backoff?.type ?? 'none'}`) },
              { label: t('wq.config.key.backoffDelayMs'), value: defaults.backoff ? f.duration(defaults.backoff.delayMs) : null, mono: true },
              { label: t('wq.config.key.removeOnComplete'), value: defaults.removeOnComplete ?? t('wq.config.value.keepAll'), mono: true },
              { label: t('wq.config.key.removeOnFail'), value: defaults.removeOnFail ?? t('wq.config.value.keepAll'), mono: true },
            ]}
          />
        </Panel>
      </PanelGrid>

      <PanelGrid layout="2-1">
        <Panel title={t('wq.worker.title')} flush>
          <WorkerTable rows={d.workers} onOpen={(id) => page.openWorker(id)} emptyMessage={t('wq.detail.noWorkers')} />
        </Panel>
        <Panel title={t('wq.concurrency.title')}>
          <ConcurrencyPanel concurrency={d.concurrency} workers={d.workers} />
        </Panel>
      </PanelGrid>

      <PanelGrid layout="2-1">
        <Panel
          title={t('wq.detail.recentJobs')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.openQueue(q.name, 'jobs')}>
              {t('wq.detail.allJobs')}
            </Button>
          }
        >
          <SectionGate section={d.recentJobs} product={product} className="p-3">
            {(rows) => <JobTable rows={rows} columns={['id', 'type', 'state', 'attempt', 'duration', 'time']} onOpen={page.openJob} emptyMessage={t('wq.job.none')} />}
          </SectionGate>
        </Panel>
        <Panel title={t('wq.detail.connections')} hint={product}>
          {d.brokerWorkers === null ? (
            <PanelState status="no-source" compact message={t('wq.detail.connectionsUnknown')} />
          ) : d.brokerWorkers.length === 0 ? (
            <PanelState status="empty" compact message={t('wq.detail.noConnections')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {d.brokerWorkers.map((w, i) => (
                <li key={`${w.addr}-${i}`} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-fg">{w.name ?? NO_VALUE}</div>
                    <div className="truncate font-mono text-2xs text-faint">{w.addr ?? NO_VALUE}</div>
                  </div>
                  <span className="shrink-0 font-mono text-2xs text-muted">
                    {t('wq.detail.connectionAge', { age: f.uptime(w.ageSec), idle: f.uptime(w.idleSec) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}

/** Job của queue theo trạng thái (tối đa `limit` mỗi trạng thái). */
function QueueJobsPanel({ page, name }: { page: WorkerPage; name: string }) {
  const { t } = useLocale();
  const [states, setStates] = useState<JobState[]>(DEFAULT_JOB_STATES);
  const query = useLiveQuery(workerKeys.jobs(name, states), () => workerApi.jobs(name, states, QUEUE_JOBS_LIMIT));
  return (
    <Panel
      title={t('wq.detail.jobs')}
      flush
      actions={
        <ToggleGroup type="multiple" value={states} onValueChange={(v) => v.length > 0 && setStates(v as JobState[])} aria-label={t('wq.job.col.state')} className="flex-wrap">
          {JOB_STATES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {t(`wq.job.state.${s}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <QueryView query={query}>
        {(d) => (
          <SectionGate section={d.jobs} className="p-3">
            {(rows) => (
              <JobTable
                rows={rows}
                columns={['id', 'type', 'state', 'attempt', 'duration', 'worker', 'error', 'time']}
                onOpen={page.openJob}
                emptyMessage={t('wq.job.none')}
                maxHeight={JOB_TABLE_MAX_HEIGHT_PX}
                footer={t('wq.job.limitNote', { limit: d.limit })}
              />
            )}
          </SectionGate>
        )}
      </QueryView>
    </Panel>
  );
}
