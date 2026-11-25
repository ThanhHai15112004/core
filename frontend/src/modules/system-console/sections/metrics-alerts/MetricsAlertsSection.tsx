import React from 'react';
import { BellRing, Play, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery, useTimeRange } from '@core/data';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, QueryView, StatusBanner, type PageTab } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { useSectionRoute } from '../../shell/useSectionRoute';
import {
  METRICS_ALERTS_RANGES,
  METRICS_ALERTS_TABS,
  type MetricsAlertsTab,
} from '../../constants/metrics-alerts';
import { metricsAlertsApi } from '../../services/metrics-alerts.api';
import { MetricsSummaryTab } from './MetricsSummaryTab';
import { AlertRulesTab } from './AlertRulesTab';
import { AlertEventsTab } from './AlertEventsTab';

export const MetricsAlertsSection: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const r = useSectionRoute<MetricsAlertsTab>(METRICS_ALERTS_TABS);
  const range = useTimeRange(METRICS_ALERTS_RANGES);

  const overview = useLiveQuery(
    ['console', 'metrics-alerts', 'overview', range],
    () => metricsAlertsApi.overview(range),
    { tier: 'live' },
  );

  const evalMut = useMutation({
    mutationFn: () => metricsAlertsApi.evaluateNow(),
    onSuccess: (res) => {
      addToast({
        type: 'success',
        title: t('metricsAlerts.evaluateSuccess', {
          evaluatedRules: res.evaluatedRules,
          firingCount: res.firingCount,
          firedNew: res.firedNew,
          autoResolved: res.autoResolved,
        }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'metrics-alerts'] });
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const active = overview.data?.activeAlerts;
  const tabs: PageTab<MetricsAlertsTab>[] = METRICS_ALERTS_TABS.map((id) => ({
    id,
    label: t(`metricsAlerts.tab.${id}`),
    ...(id === 'events' && active && active.total > 0
      ? { count: active.total, countTone: active.critical > 0 ? ('crit' as const) : ('warn' as const) }
      : {}),
  }));

  return (
    <div>
      <PageHeader
        title={t('metricsAlerts.title')}
        icon={BellRing}
        status={
          active
            ? {
                tone: active.critical > 0 ? 'crit' : active.warning > 0 ? 'warn' : 'ok',
                label:
                  active.critical > 0
                    ? t('console.status.critical')
                    : active.warning > 0
                      ? t('console.status.warning')
                      : t('console.status.healthy'),
              }
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {overview.data && (
              <Badge variant="outline">
                {t(overview.data.source === 'prometheus' ? 'metricsAlerts.sourcePrometheus' : 'metricsAlerts.sourceLocal')}
              </Badge>
            )}
            <Button size="xs" variant="outline" disabled={evalMut.isPending} onClick={() => evalMut.mutate()}>
              <Play />
              {t('metricsAlerts.evaluateNow')}
            </Button>
          </div>
        }
      />

      {overview.isError && !overview.data && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}

      <PageTabs tabs={tabs} value={r.tab} onChange={(tab) => r.go(tab)} />

      {r.tab === 'metrics' && (
        <QueryView query={overview}>
          {(data) => <MetricsSummaryTab data={data} />}
        </QueryView>
      )}
      {r.tab === 'rules' && <AlertRulesTab />}
      {r.tab === 'events' && <AlertEventsTab />}
    </div>
  );
};
