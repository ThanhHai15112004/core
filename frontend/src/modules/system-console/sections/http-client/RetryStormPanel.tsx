import React, { useMemo } from 'react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { AlertList, Panel, StatusBanner, type AlertItem } from '@core/ui/blocks';
import type { RetryStormOverviewDto } from '../../types/http-client.types';

interface RetryStormPanelProps {
  storm: RetryStormOverviewDto;
}

export const RetryStormPanel: React.FC<RetryStormPanelProps> = ({ storm }) => {
  const { t } = useLocale();
  const f = useFormat();

  const items = useMemo<AlertItem[]>(
    () =>
      storm.alerts.map((a) => ({
        id: `storm-${a.service}`,
        tone: a.severity === 'critical' ? 'crit' : 'warn',
        title: t('httpClient.storm.itemTitle', { service: a.service }),
        detail: t('httpClient.storm.itemDetail', {
          retries: f.number(a.retriesInLastMin),
          requests: f.number(a.requestsInLastMin),
          ratio: f.number(a.retryRatioPercent),
          threshold: f.number(a.retriesPerMinThreshold),
          ratioThreshold: f.number(a.retryRatioThresholdPercent),
          shedState: a.sheddingActive
            ? t('httpClient.storm.shedActive', { count: f.number(a.sheddedRetriesCount) })
            : t('httpClient.storm.shedAlertOnly'),
        }),
        since: a.detectedAt,
      })),
    [f, storm.alerts, t],
  );

  const okChecks = useMemo(
    () => [
      t('httpClient.storm.okThreshold', {
        perMin: f.number(storm.policy.retriesPerMinThreshold),
        ratio: f.number(storm.policy.retryRatioPercent),
        minReq: f.number(storm.policy.minRequests),
      }),
      t('httpClient.storm.okShedding', {
        state: t(storm.policy.sheddingEnabled ? 'httpClient.resilience.enabled' : 'httpClient.resilience.disabled'),
      }),
    ],
    [f, storm.policy, t],
  );

  const hasCritical = storm.alerts.some((a) => a.severity === 'critical');

  return (
    <div className="mt-4 space-y-3">
      {storm.activeStormCount > 0 && (
        <StatusBanner
          tone={hasCritical ? 'crit' : 'warn'}
          title={t('httpClient.storm.bannerTitle', { count: f.number(storm.activeStormCount) })}
          description={t('httpClient.storm.bannerDesc', {
            perMin: f.number(storm.totalRetriesInLastMin),
          })}
        />
      )}
      <Panel title={t('httpClient.stormTitle')}>
        <AlertList items={items} okChecks={okChecks} emptyMessage={t('httpClient.storm.none')} />
      </Panel>
    </div>
  );
};
