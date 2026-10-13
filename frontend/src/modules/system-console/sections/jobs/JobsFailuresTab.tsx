import { useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { Panel, QueryView, StatGrid, StatTile, StatusBanner, AvailableView } from '@core/ui/blocks';
import type { JobsFailures } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { DEPENDENCY_PATH, FAILURE_RATE_WARN_PERCENT } from '../../constants/jobs';
import { FailureGroups } from '../../components/jobs/FailureGroups';
import { jobsKeys } from './jobs-keys';
import type { JobsPage } from './useJobsPage';

const ALL = '__all__';

/** Lỗi: retry storm, 4 chỉ số lỗi (bấm → Explorer), nhóm lỗi theo loại (lọc theo queue; bấm → danh sách job của nhóm). */
export function JobsFailuresTab({ page, queues }: { page: JobsPage; queues: string[] }) {
  const { range } = page;
  const [queue, setQueue] = useState<string | null>(null);
  const query = useLiveQuery(jobsKeys.failures(range, queue), () => jobsApi.failures(range, queue ?? undefined));
  return <QueryView query={query}>{(data) => <FailuresBody page={page} data={data} queues={queues} queue={queue} setQueue={setQueue} />}</QueryView>;
}

function FailuresBody({ page, data, queues, queue, setQueue }: { page: JobsPage; data: JobsFailures; queues: string[]; queue: string | null; setQueue: (q: string | null) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const { explore, navigate, range } = page;
  const s = data.stats;
  const storm = data.retryStorm;
  const stormDep = storm && data.groups.available ? data.groups.data.find((g) => g.errorType === storm.primaryError)?.dependency : null;
  const q = queue ?? undefined;

  return (
    <>
      {storm && (
        <StatusBanner
          tone="crit"
          title={t('jobs.storm.title', { count: f.compact(storm.retriesPerMin) })}
          reasons={[
            { id: 'type', text: `${t('jobs.storm.type')}: ${storm.primaryType ?? NO_VALUE}` },
            { id: 'error', text: `${t('jobs.storm.error')}: ${storm.primaryError ?? NO_VALUE}` },
          ]}
          actions={
            <>
              <Button size="xs" onClick={() => explore({ status: 'retrying', errorType: storm.primaryError ?? undefined })}>
                <Search />
                {t('jobs.storm.inspect')}
              </Button>
              {stormDep && DEPENDENCY_PATH[stormDep] && (
                <Button size="xs" onClick={() => navigate(DEPENDENCY_PATH[stormDep])}>
                  {t('jobs.dependency.open', { name: t(`jobs.dependency.${stormDep}`) })}
                  <ArrowRight />
                </Button>
              )}
            </>
          }
        />
      )}

      <StatGrid columns={4}>
        <StatTile
          label={t('jobs.failures.kpi.failedToday')}
          value={f.compact(s.failedToday)}
          sub={s.failedNow !== null ? t('jobs.kpi.failedNow', { count: f.compact(s.failedNow) }) : undefined}
          tone={s.failedToday > 0 ? 'warn' : 'ok'}
          onClick={() => explore({ status: 'failed', window: '24h', queue: q })}
        />
        <StatTile
          label={t('jobs.failures.kpi.failureRate')}
          value={f.percent(s.failureRatePercent)}
          hint={t('ui.time.last', { range: t(`ui.time.ranges.${range}`) })}
          tone={s.failureRatePercent === null ? undefined : s.failureRatePercent >= FAILURE_RATE_WARN_PERCENT ? 'warn' : 'ok'}
          onClick={() => explore({ status: 'failed', queue: q })}
        />
        <StatTile
          label={t('jobs.failures.kpi.retryable')}
          value={f.compact(s.retryable)}
          sub={t('jobs.failures.kpi.retriedToday', { count: f.compact(s.retriedToday) })}
          hint={t('jobs.failures.kpi.retryableHint')}
          onClick={() => explore({ status: 'failed', queue: q })}
        />
        <StatTile
          label={t('jobs.failures.kpi.nonRetryable')}
          value={f.compact(s.nonRetryable)}
          sub={s.retryingNow !== null ? t('jobs.failures.kpi.retryingNow', { count: f.compact(s.retryingNow) }) : undefined}
          tone={(s.nonRetryable ?? 0) > 0 ? 'warn' : undefined}
          onClick={() => explore({ status: 'retrying', queue: q })}
        />
      </StatGrid>

      <Panel
        title={t('jobs.failures.groups')}
        hint={t('jobs.failures.sampled', { count: f.compact(data.sampled) })}
        flush
        className="mb-4"
        actions={
          queues.length > 1 ? (
            <Select value={queue ?? ALL} onValueChange={(v) => setQueue(v === ALL ? null : v)}>
              <SelectTrigger size="sm" className="w-40" aria-label={t('jobs.filter.queue')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('jobs.filter.allQueues')}</SelectItem>
                {queues.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      >
        <AvailableView source={data.groups}>
          {(groups) => <FailureGroups groups={groups} detailed onOpen={(g) => explore({ status: 'failed', errorType: g.errorType, queue: q })} />}
        </AvailableView>
      </Panel>
    </>
  );
}
