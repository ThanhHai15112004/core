import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Panel, PanelGrid, QueryView, StatGrid, StatTile } from '@core/ui/blocks';
import type { TrafficSummary } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { errorRateTone } from '../../utils/traffic-format';
import { TrafficChart } from '../../components/traffic/TrafficChart';
import { ErrorAnalysis } from '../../components/traffic/ErrorAnalysis';
import { SecurityTrafficPanel } from '../../components/traffic/SecurityTrafficPanel';
import { useTrafficFormat } from '../../components/traffic/useTrafficFormat';
import { trafficKeys } from './traffic-keys';
import type { TrafficPage } from './useTrafficPage';

/** Lỗi: số lỗi 4xx / 5xx → tỷ lệ lỗi + status theo thời gian → endpoint / status lỗi nhiều nhất → tín hiệu bảo mật. */
export function TrafficErrorsTab({ page, summary }: { page: TrafficPage; summary: TrafficSummary | undefined }) {
  const { t } = useLocale();
  const tf = useTrafficFormat();
  const { filters, openEndpoint, openLogs, navigate } = page;
  const errors = useLiveQuery(trafficKeys.errors(filters), () => trafficApi.errors(filters));
  const insights = useLiveQuery(trafficKeys.insights(filters), () => trafficApi.insights(filters));
  const s = errors.data?.stats;
  const loading = !errors.data && !errors.isError;

  return (
    <>
      <StatGrid columns={4}>
        <StatTile
          label={t('tr.kpi.errorRate')}
          value={tf.rate(s?.errorRatePercent)}
          tone={summary ? errorRateTone(summary) : undefined}
          hint={summary ? t('tr.kpi.errorRateHint', { warn: summary.settings.errorRateWarnPercent, crit: summary.settings.errorRateCritPercent }) : undefined}
          loading={loading}
        />
        <StatTile
          label={t('tr.errors.serverErrors')}
          value={s ? tf.count(s.serverErrors) : NO_VALUE}
          tone={s ? (s.serverErrors > 0 ? 'crit' : 'ok') : undefined}
          onClick={s && s.serverErrors > 0 ? () => openLogs({ status: '5xx' }) : undefined}
          loading={loading}
        />
        <StatTile label={t('tr.kpi.clientErrorRate')} value={tf.rate(s?.clientErrorRatePercent)} loading={loading} />
        <StatTile
          label={t('tr.errors.clientErrors')}
          value={s ? tf.count(s.clientErrors) : NO_VALUE}
          onClick={s && s.clientErrors > 0 ? () => openLogs({ status: '4xx' }) : undefined}
          loading={loading}
        />
      </StatGrid>

      <PanelGrid>
        <TrafficChart title={t('tr.chart.errors')} filters={filters} metrics={['errors']} />
        <TrafficChart title={t('tr.chart.status')} filters={filters} metrics={['status']} />
      </PanelGrid>

      {errors.data ? (
        <ErrorAnalysis data={errors.data} onOpenRoute={openEndpoint} onSelectStatus={(status) => openLogs({ status })} />
      ) : (
        <Panel title={t('tr.errors.title')} className="mb-4">
          <QueryView query={errors}>{() => null}</QueryView>
        </Panel>
      )}

      {insights.data ? (
        <SecurityTrafficPanel insights={insights.data} onSelectStatus={(status) => openLogs({ status })} onOpenSecurity={() => navigate('security')} />
      ) : (
        <Panel title={t('tr.security.title')}>
          <QueryView query={insights} compact>
            {() => null}
          </QueryView>
        </Panel>
      )}
    </>
  );
}
