import { useState } from 'react';
import { ArrowRight, Eye } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { CodeBlock, DetailSection, JsonView, KeyValueGrid, LevelBadge, Panel, PanelGrid, PanelState, QueryView, StatusBanner, type LogLevel } from '@core/ui/blocks';
import type { JobDetail } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { JOB_LOGS_MAX_HEIGHT_PX } from '../../constants/jobs';
import { jobsKeys } from './jobs-keys';
import { logsPathOf } from '../../utils/jobs-format';
import type { JobsPage } from './useJobsPage';

/** Tab Payload & log: metadata payload (nội dung đã che khi bấm xem — có audit), kết quả, log liên quan, log của handler. */
export function JobPayloadPane({ page, data }: { page: JobsPage; data: JobDetail }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const j = data.job;
  const [reveal, setReveal] = useState(false);
  const payload = useLiveQuery(jobsKeys.payload(j.id, j.queue), () => jobsApi.payload(j.id, j.queue), { tier: 'static', enabled: reveal, keepPrevious: false });
  const p = data.payload;
  const index = Object.entries(p.index);

  return (
    <>
      <PanelGrid>
        <Panel title={t('jobs.payload.title')} hint={t('jobs.payload.redactNote')}>
          {p.malformed && <StatusBanner tone="warn" title={t('jobs.payload.malformed')} />}
          <KeyValueGrid
            items={[
              { label: t('jobs.payload.size'), value: f.bytes(p.sizeBytes), mono: true },
              { label: t('jobs.payload.contentType'), value: p.contentType, mono: true },
              { label: t('jobs.payload.schema'), value: p.schema ?? t('jobs.payload.noSchema') },
              { label: t('jobs.payload.fields'), value: p.fields === null ? null : String(p.fields), mono: true },
            ]}
          />
          {index.length > 0 && (
            <DetailSection title={t('jobs.payload.index')} className="mt-4">
              <KeyValueGrid items={index.map(([k, v]) => ({ key: k, label: k, value: v, mono: true }))} />
            </DetailSection>
          )}
          <div className="mt-4">
            {!data.actions.payload.allowed ? (
              <p className="text-sm text-muted">{t(`jobs.detail.reason.${data.actions.payload.reason ?? 'disabled'}`)}</p>
            ) : !reveal ? (
              <Button size="sm" onClick={() => setReveal(true)}>
                <Eye />
                {t('jobs.payload.view')}
              </Button>
            ) : (
              <QueryView query={payload} compact>
                {(r) => <JsonView value={r.payload} />}
              </QueryView>
            )}
          </div>
        </Panel>
        <Panel title={t('jobs.result.title')}>
          {data.result ? (
            <>
              <KeyValueGrid
                items={[
                  { label: t('jobs.col.duration'), value: f.duration(j.durationMs), mono: true },
                  { label: t('jobs.payload.size'), value: f.bytes(data.result.sizeBytes), mono: true },
                ]}
              />
              <div className="mt-3">{data.result.truncated ? <p className="text-sm text-muted">{t('jobs.result.tooLarge')}</p> : <JsonView value={data.result.summary} />}</div>
            </>
          ) : (
            <PanelState status="empty" compact message={j.status === 'completed' ? t('jobs.result.none') : t('jobs.result.notCompleted')} />
          )}
        </Panel>
      </PanelGrid>

      <Panel
        title={t('jobs.logs.title')}
        hint={data.logsMatchedBy ? t(`jobs.logs.by.${data.logsMatchedBy}`) : undefined}
        flush
        className="mb-4"
        actions={
          <Button size="xs" variant="ghost" onClick={() => page.navigate(logsPathOf(data))}>
            {t('jobs.logs.openViewer')}
            <ArrowRight />
          </Button>
        }
      >
        {data.logs.length === 0 ? (
          <PanelState status="empty" compact message={t('jobs.logs.none')} />
        ) : (
          <ol className="divide-y divide-border overflow-y-auto" style={{ maxHeight: JOB_LOGS_MAX_HEIGHT_PX }}>
            {data.logs.map((l, i) => (
              <li key={`${l.t}-${i}`} className="flex min-w-0 items-start gap-2 px-3 py-1.5 text-sm">
                <time className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted">{formatTime(l.t, true)}</time>
                <LevelBadge level={l.level as LogLevel} />
                <span className="min-w-0 flex-1 break-words text-fg">
                  {l.context && <span className="mr-1.5 font-mono text-xs text-muted">[{l.context}]</span>}
                  {l.message}
                </span>
              </li>
            ))}
          </ol>
        )}
        {data.jobLogs.length > 0 && (
          <div className="border-t border-border p-3">
            <DetailSection title={t('jobs.logs.jobLog')}>
              <CodeBlock code={data.jobLogs.join('\n')} maxHeight={JOB_LOGS_MAX_HEIGHT_PX} />
            </DetailSection>
          </div>
        )}
      </Panel>
    </>
  );
}
