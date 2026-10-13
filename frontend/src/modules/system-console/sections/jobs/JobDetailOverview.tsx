import React from 'react';
import { ArrowRight, ExternalLink, FileText, Layers } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { useTicker } from '@core/hooks/useTicker';
import { RELATIVE_TIME_TICK_MS } from '@core/constants/ui.constants';
import { Badge, Button } from '@core/ui/primitives';
import { KeyValueGrid, Panel, PanelGrid, RelativeTime, StatGrid, StatTile, StatusBanner, type KeyValueItem } from '@core/ui/blocks';
import type { JobDetail } from '../../types/jobs.types';
import { CHILD_COLUMNS, DEPENDENCY_PATH, HANDLER_SOURCE_PATH, PHASE_TONE } from '../../constants/jobs';
import { JobStatusBadge, JobProgress } from '../../components/jobs/JobStatus';
import { JobTable } from '../../components/jobs/JobTable';
import { StackTrace } from '../../components/jobs/JobAttempts';
import { RetryableBadge } from '../../components/jobs/FailureGroups';
import { attemptsLabel, dateTime, instanceLabel, jobShortId, logsPathOf, msUntil } from '../../utils/jobs-format';
import type { JobsPage } from './useJobsPage';

const Link = ({ onClick, children, mono }: { onClick: () => void; children: React.ReactNode; mono?: boolean }) => (
  <button type="button" onClick={onClick} className={mono ? 'break-all text-left font-mono text-xs text-info-fg hover:underline' : 'text-left text-info-fg hover:underline'}>
    {children}
  </button>
);

/** Cảnh báo của job: treo, chạy lâu, chờ lâu, đã huỷ. */
export function JobDetailBanners({ page, data }: { page: JobsPage; data: JobDetail }) {
  const { t } = useLocale();
  const f = useFormat();
  const j = data.job;
  return (
    <>
      {j.status === 'stalled' && (
        <StatusBanner
          tone="crit"
          title={t('jobs.detail.stalledBanner', { value: data.stalled.heartbeatAgeSec !== null ? f.duration(data.stalled.heartbeatAgeSec * 1000) : t('jobs.detail.unknownAge') })}
          actions={
            <Button size="xs" onClick={() => page.navigate('worker/workers')}>
              {t('jobs.detail.inspectWorker')}
            </Button>
          }
        />
      )}
      {data.longRunning.detected && (
        <StatusBanner tone="warn" title={t('jobs.detail.longRunningBanner', { running: f.duration(data.longRunning.runningMs), typical: f.duration(data.timing.typicalMs) })} />
      )}
      {j.longWait && (
        <StatusBanner
          tone="warn"
          title={t('jobs.detail.longWaitBanner', { wait: f.duration(j.waitMs) })}
          actions={
            <Button size="xs" onClick={() => page.navigate(`worker/queues/${encodeURIComponent(j.queue)}`)}>
              {t('jobs.detail.openQueue')}
            </Button>
          }
        />
      )}
      {j.status === 'cancelled' && j.cancelledAt && (
        <StatusBanner tone="info" title={t('jobs.detail.cancelledBanner', { by: j.cancelledBy ?? t('jobs.audit.anonymous') })} meta={<RelativeTime value={j.cancelledAt} />} />
      )}
    </>
  );
}

/** Tab Tổng quan của Job Detail. */
export function JobOverviewPane({ page, data }: { page: JobsPage; data: JobDetail }) {
  const { t } = useLocale();
  const f = useFormat();
  const now = useTicker(RELATIVE_TIME_TICK_MS);
  const { navigate, openJob } = page;
  const j = data.job;
  const tm = data.timing;
  const running = j.status === 'active' || j.status === 'stalled';
  const failure = data.failure;
  const dep = failure?.dependency ?? null;
  const src = data.source;
  const c = data.correlation;
  const priority = (p: number, level: string) => (p ? `${t(`jobs.priority.${level}`)} (${p})` : t('jobs.priority.normal'));

  const jobItems: KeyValueItem[] = [
    { label: t('jobs.col.status'), value: <JobStatusBadge status={j.status} /> },
    { label: t('jobs.col.queue'), value: <Link mono onClick={() => navigate(`worker/queues/${encodeURIComponent(j.queue)}`)}>{j.queue}</Link> },
    { label: t('jobs.col.worker'), value: j.worker ? <Link mono onClick={() => navigate('worker/workers')}>{instanceLabel(j.worker)}</Link> : null },
    { label: t('jobs.col.priority'), value: priority(j.priority, j.priorityLevel) },
    { label: t('jobs.col.attempts'), value: attemptsLabel(j), mono: true },
    { label: t('jobs.detail.idempotency'), value: t(`jobs.idempotency.${data.idempotency.protection}`) },
    { label: t('jobs.col.created'), value: dateTime(j.createdAt) },
    ...(j.availableAt ? [{ label: t('jobs.col.runAt'), value: `${dateTime(j.availableAt)} · ${t('jobs.runsIn', { value: f.duration(msUntil(j.availableAt, now)) })}` }] : []),
    { label: t('jobs.detail.started'), value: dateTime(j.startedAt) },
    { label: t('jobs.detail.finished'), value: dateTime(j.finishedAt) },
    ...(j.cancelledAt ? [{ label: t('jobs.detail.cancelled'), value: `${dateTime(j.cancelledAt)}${j.cancelledBy ? ` · ${j.cancelledBy}` : ''}` }] : []),
  ];

  const sourceName: Record<string, string> = { http: 'jobs.detail.request', scheduler: 'jobs.detail.task', job: 'jobs.detail.parentJob', system: 'jobs.detail.producer', manual: 'jobs.detail.producer' };
  const sourceItems: KeyValueItem[] = [
    { label: t('jobs.col.source'), value: t(`jobs.source.${src.kind}`) },
    { label: t(sourceName[src.kind]), value: src.name, mono: true },
    {
      label: t('jobs.detail.correlationId'),
      value: c.correlationId ? <Link mono onClick={() => navigate(`logs/explorer?correlationId=${encodeURIComponent(c.correlationId!)}`)}>{c.correlationId}</Link> : null,
    },
    { label: t('jobs.detail.requestId'), value: c.requestId, mono: true },
    { label: t('jobs.detail.messageId'), value: <Link mono onClick={() => navigate(`messaging/messages/${encodeURIComponent(c.messageId)}?q=${encodeURIComponent(j.queue)}`)}>{jobShortId(c.messageId)}</Link> },
    { label: t('jobs.detail.schedulerExecution'), value: c.schedulerExecutionId, mono: true },
  ];
  const flow = [
    src.kind === 'http' ? t('jobs.flow.http') : src.kind === 'scheduler' ? t('jobs.flow.scheduler') : src.kind === 'job' ? t('jobs.flow.parent') : t(`jobs.source.${src.kind}`),
    t('jobs.flow.message'),
    t('jobs.flow.job'),
    j.worker ? instanceLabel(j.worker) : t('jobs.flow.worker'),
    ...(dep ? [t(`jobs.dependency.${dep}`)] : []),
  ];

  const cfg = data.config;
  const configItems: KeyValueItem[] = [
    { label: t('jobs.config.maxAttempts'), value: String(cfg.maxAttempts), mono: true },
    { label: t('jobs.config.backoff'), value: cfg.backoff ? `${cfg.backoff.type} · ${f.duration(cfg.backoff.delayMs)}` : t('jobs.config.none') },
    { label: t('jobs.config.timeout'), value: t('jobs.config.noTimeout') },
    { label: t('jobs.col.priority'), value: priority(cfg.priority, cfg.priorityLevel) },
    { label: t('jobs.config.cancellable'), value: cfg.cancellable ? t('jobs.config.yes') : t('jobs.config.no') },
    { label: t('jobs.config.idempotencyKey'), value: data.idempotency.key, mono: true },
    { label: t('jobs.config.removeOnComplete'), value: cfg.removeOnComplete, mono: true },
    { label: t('jobs.config.removeOnFail'), value: cfg.removeOnFail, mono: true },
    { label: t('jobs.config.lock'), value: f.duration(cfg.lockDurationMs), mono: true },
  ];
  const handlerItems: KeyValueItem[] = [
    { label: t('jobs.handler.processor'), value: data.handler.processors.join(', '), mono: true },
    { label: t('jobs.handler.runtime'), value: data.handler.runtimes.join(', '), mono: true },
    { label: t('jobs.handler.instances'), value: String(data.handler.instances), mono: true },
    { label: t('jobs.handler.path'), value: HANDLER_SOURCE_PATH, mono: true },
  ];

  return (
    <>
      <StatGrid columns={4}>
        <StatTile
          label={t('jobs.timing.wait')}
          value={f.duration(tm.waitMs)}
          sub={`${t('jobs.timing.queueAvg', { value: f.duration(tm.queueAvgWaitMs) })}${tm.waitDeviationPercent !== null && tm.waitDeviationPercent > 100 ? ` · +${f.number(tm.waitDeviationPercent)}%` : ''}`}
          tone={tm.diagnosis === 'wait' ? 'warn' : undefined}
        />
        <StatTile
          label={running ? t('jobs.timing.running') : t('jobs.timing.processing')}
          value={f.duration(tm.processingMs)}
          sub={t('jobs.typical', { value: f.duration(tm.typicalMs) })}
          tone={tm.diagnosis === 'processing' || j.longRunning ? 'warn' : undefined}
        />
        <StatTile label={t('jobs.timing.total')} value={f.duration(tm.totalMs)} hint={t('jobs.timing.totalHint')} />
        <StatTile
          label={t('jobs.col.attempts')}
          value={attemptsLabel(j)}
          sub={j.stalledCount > 0 ? t('jobs.detail.stalledCount', { count: j.stalledCount }) : undefined}
          hint={t('jobs.detail.attemptsHint')}
          tone={j.status === 'failed' ? 'crit' : undefined}
        />
      </StatGrid>
      {tm.diagnosis && <StatusBanner tone="warn" title={t(`jobs.timing.diagnosis.${tm.diagnosis}`)} />}

      {j.progress && (
        <Panel title={t('jobs.progress.title')} className="mb-4">
          <JobProgress job={j} className="mb-3" />
          <KeyValueGrid
            columns={3}
            items={[
              { label: t('jobs.progress.processed'), value: j.progress.total !== null ? `${f.number(j.progress.processed ?? 0)} / ${f.number(j.progress.total)}` : null, mono: true },
              { label: t('jobs.progress.step'), value: j.progress.step },
            ]}
          />
          {j.progress.phases.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {j.progress.phases.map((p) => (
                <Badge key={p.name} tone={PHASE_TONE[p.state]}>
                  {p.name}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      )}

      {failure && (
        <Panel
          title={t('jobs.failure.title')}
          className="mb-4 border-crit-border"
          actions={
            <>
              {dep && DEPENDENCY_PATH[dep] && (
                <Button size="xs" onClick={() => navigate(DEPENDENCY_PATH[dep])}>
                  {t('jobs.dependency.open', { name: t(`jobs.dependency.${dep}`) })}
                  <ArrowRight />
                </Button>
              )}
              <Button size="xs" onClick={() => navigate(logsPathOf(data))}>
                <FileText />
                {t('jobs.detail.openLogs')}
              </Button>
            </>
          }
        >
          <KeyValueGrid
            columns={4}
            items={[
              { label: t('jobs.failure.type'), value: <span className="font-mono text-xs text-crit-fg">{failure.type}</span> },
              { label: t('jobs.failure.occurred'), value: dateTime(failure.occurredAt) },
              { label: t('jobs.failure.attempt'), value: `${failure.attempt} / ${failure.maxAttempts}`, mono: true },
              { label: t('jobs.failure.dependency'), value: dep ? t(`jobs.dependency.${dep}`) : t('jobs.failure.noDependency') },
              { label: t('jobs.failure.retryable'), value: <RetryableBadge value={failure.retryable} /> },
            ]}
          />
          <p className="mt-3 break-words text-sm text-crit-fg">{failure.message}</p>
          {failure.stack && <StackTrace stack={failure.stack} />}
        </Panel>
      )}

      <PanelGrid>
        <Panel title={t('jobs.detail.overview')}>
          <KeyValueGrid items={jobItems} />
        </Panel>
        <Panel
          title={t('jobs.detail.source')}
          actions={
            <>
              {src.kind === 'http' && c.requestId && (
                <Button size="xs" onClick={() => navigate(`http-traffic/requests/${encodeURIComponent(c.requestId!)}`)}>
                  <ExternalLink />
                  {t('jobs.detail.openRequest')}
                </Button>
              )}
              {src.kind === 'scheduler' && c.schedulerExecutionId && (
                <Button size="xs" onClick={() => navigate(`scheduler/history?exec=${encodeURIComponent(c.schedulerExecutionId!)}`)}>
                  <ExternalLink />
                  {t('jobs.detail.openExecution')}
                </Button>
              )}
              {src.kind === 'scheduler' && src.name && (
                <Button size="xs" onClick={() => navigate(`scheduler/tasks/${encodeURIComponent(src.name!)}`)}>
                  {t('jobs.detail.openTask')}
                </Button>
              )}
              {src.kind === 'job' && c.parentJobId && (
                <Button size="xs" onClick={() => openJob(c.parentJobId!, c.parentQueue)}>
                  <Layers />
                  {t('jobs.detail.openParent')}
                </Button>
              )}
            </>
          }
        >
          <KeyValueGrid items={sourceItems} />
          <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
            {flow.map((step, i) => (
              <React.Fragment key={`${step}-${i}`}>
                {i > 0 && <ArrowRight className="size-3.5 text-faint" />}
                <Badge>{step}</Badge>
              </React.Fragment>
            ))}
          </div>
        </Panel>
      </PanelGrid>

      {data.children.length > 0 && (
        <Panel title={t('jobs.tree.title')} flush className="mb-4">
          <JobTable rows={data.children} columns={CHILD_COLUMNS} onOpen={(x) => openJob(x.id, x.queue)} emptyMessage={t('jobs.tree.none')} />
        </Panel>
      )}

      <PanelGrid>
        <Panel title={t('jobs.detail.configuration')}>
          <KeyValueGrid items={configItems} />
        </Panel>
        <Panel title={t('jobs.handler.title')} hint={t('jobs.handler.hint')}>
          <KeyValueGrid items={handlerItems} />
        </Panel>
      </PanelGrid>
    </>
  );
}
