import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { Panel, PanelGrid } from '@core/ui/blocks';
import type { JobDetail } from '../../types/jobs.types';
import { JobAttempts, RetryTimeline } from '../../components/jobs/JobAttempts';
import { JobLifecycle } from '../../components/jobs/JobLifecycle';

/** Tab Lần thử & vòng đời: bảng các lần thử (bấm → chi tiết) · vòng đời job · dòng thời gian retry. */
export function JobAttemptsPane({ data }: { data: JobDetail }) {
  const { t } = useLocale();
  const f = useFormat();
  const j = data.job;
  const backoff = data.config.backoff;
  return (
    <>
      <Panel
        title={t('jobs.detail.attemptsTitle')}
        flush
        className="mb-4"
        actions={backoff ? <Badge>{t('jobs.detail.backoffHint', { type: backoff.type, delay: f.duration(backoff.delayMs) })}</Badge> : undefined}
      >
        <JobAttempts attempts={data.attempts} />
      </Panel>
      <PanelGrid>
        <Panel
          title={t('jobs.detail.lifecycle')}
          hint={data.lifecycleAvailable ? undefined : t('jobs.lifecycle.partial')}
          actions={data.lifecycleAvailable ? undefined : <Badge tone="warn">{t('jobs.lifecycle.partialBadge')}</Badge>}
        >
          <JobLifecycle steps={data.lifecycle} />
        </Panel>
        <Panel title={t('jobs.attempts.timeline')}>
          <RetryTimeline attempts={data.attempts} maxAttempts={j.maxAttempts} exhausted={j.status === 'failed' && j.attempts >= j.maxAttempts} />
        </Panel>
      </PanelGrid>
    </>
  );
}
