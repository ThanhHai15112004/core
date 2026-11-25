import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { DataTable, Panel } from '@core/ui/blocks';
import type { ResilienceLayersSummaryDto } from '../../types/http-client.types';

interface LayerRow {
  id: string;
  layer: string;
  timeout: string;
  retry: string;
  protection: string;
  observed: string;
}

const col = createColumnHelper<LayerRow>();

interface ResilienceLayersPanelProps {
  data: ResilienceLayersSummaryDto;
}

export const ResilienceLayersPanel: React.FC<ResilienceLayersPanelProps> = ({ data }) => {
  const { t } = useLocale();
  const f = useFormat();

  const rows = useMemo<LayerRow[]>(
    () => [
      {
        id: 'api',
        layer: t('httpClient.resilience.layerApi'),
        timeout: t('httpClient.resilience.apiTimeout', {
          req: f.number(data.api.defaultTimeoutMs),
          conn: f.number(data.api.connectionTimeoutMs),
        }),
        retry: t('httpClient.resilience.apiRetry'),
        protection: t('httpClient.resilience.apiProtection'),
        observed: t('httpClient.resilience.apiObserved', {
          timeouts: f.number(data.api.totalTimeouts),
        }),
      },
      {
        id: 'database',
        layer: t('httpClient.resilience.layerDb'),
        timeout: t('httpClient.resilience.dbTimeout', {
          query: f.number(data.database.queryTimeoutMs),
          tx: f.number(data.database.transactionTimeoutMs),
          conn: f.number(data.database.connectTimeoutMs),
        }),
        retry: t('httpClient.resilience.dbRetry', {
          max: f.number(data.database.retryMax),
          base: f.number(data.database.retryBaseDelayMs),
          maxDelay: f.number(data.database.retryMaxDelayMs),
          jitter: t(data.database.retryJitter ? 'httpClient.resilience.jitterOn' : 'httpClient.resilience.jitterOff'),
        }),
        protection: t('httpClient.resilience.dbProtection'),
        observed: t('httpClient.resilience.dbObserved', {
          timeouts: f.number(data.database.timeoutCount),
          retries: f.number(data.database.retryCount),
          recovered: f.number(data.database.retryRecoveredCount),
        }),
      },
      {
        id: 'queue',
        layer: t('httpClient.resilience.layerQueue'),
        timeout: t('httpClient.resilience.queueTimeout', {
          exec: f.number(data.queue.defaultExecutionTimeoutMs),
          broker: f.number(data.queue.brokerTimeoutMs),
        }),
        retry: t('httpClient.resilience.queueRetry', {
          attempts: f.number(data.queue.maxAttempts),
          cap: f.number(data.queue.maxAttemptsCap),
          backoff: data.queue.backoffType,
          delay: f.number(data.queue.backoffDelayMs),
          jitter: f.number(data.queue.backoffJitter),
        }),
        protection: t('httpClient.resilience.queueProtection', {
          storm: f.number(data.queue.retryStormPerMin),
        }),
        observed: t('httpClient.resilience.queueObserved', {
          profiles: f.number(data.queue.profiles.length),
        }),
      },
      {
        id: 'provider',
        layer: t('httpClient.resilience.layerProvider'),
        timeout: t('httpClient.resilience.providerTimeout', {
          timeout: f.number(data.provider.defaultTimeoutMs),
        }),
        retry: t('httpClient.resilience.providerRetry', {
          max: f.number(data.provider.maxRetries),
          cap: f.number(data.provider.maxRetriesCap),
          base: f.number(data.provider.baseDelayMs),
          maxDelay: f.number(data.provider.maxDelayMs),
          jitter: t(data.provider.jitter ? 'httpClient.resilience.jitterOn' : 'httpClient.resilience.jitterOff'),
        }),
        protection: t('httpClient.resilience.providerProtection', {
          cb: t(data.provider.circuitBreakerEnabled ? 'httpClient.resilience.enabled' : 'httpClient.resilience.disabled'),
          conc: data.provider.concurrencyEnabled
            ? t('httpClient.resilience.concurrencyCap', {
                max: f.number(data.provider.maxConcurrent),
                queue: f.number(data.provider.maxQueue),
              })
            : t('httpClient.resilience.disabled'),
          storm: f.number(data.provider.retryStormPerMin),
          shed: t(data.provider.retryStormSheddingEnabled ? 'httpClient.resilience.shedOn' : 'httpClient.resilience.shedOff'),
        }),
        observed: t('httpClient.resilience.providerObserved', {
          timeouts: f.number(data.provider.timeoutCount),
          retries: f.number(data.provider.retryCount),
          rejected: f.number(data.provider.concurrencyRejectedCount),
        }),
      },
    ],
    [data, f, t],
  );

  const columns = useMemo(
    () => [
      col.accessor('layer', {
        header: t('httpClient.resilience.colLayer'),
        cell: (c) => <span className="font-medium text-fg">{c.getValue()}</span>,
        meta: { width: '14rem' },
      }),
      col.accessor('timeout', {
        header: t('httpClient.resilience.colTimeout'),
        meta: { mono: true, width: '16rem' },
      }),
      col.accessor('retry', {
        header: t('httpClient.resilience.colRetry'),
        meta: { width: '18rem' },
      }),
      col.accessor('protection', {
        header: t('httpClient.resilience.colProtection'),
      }),
      col.accessor('observed', {
        header: t('httpClient.resilience.colObserved'),
        meta: { align: 'right', mono: true, width: '15rem' },
      }),
    ],
    [t],
  );

  return (
    <Panel title={t('httpClient.resilienceTitle')} flush className="mt-4">
      <DataTable data={rows} columns={columns} getRowId={(r) => r.id} />
    </Panel>
  );
};
