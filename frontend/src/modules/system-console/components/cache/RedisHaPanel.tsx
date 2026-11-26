import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Badge } from '@core/ui/primitives';
import { KeyValueGrid, Panel } from '@core/ui/blocks';
import type { RedisHaOverview } from '../../types/cache.types';

/** Bảng trạng thái Redis High Availability: mode, primary/nodes, failover/reconnect, timeout & bypass. */
export function RedisHaPanel({ ha }: { ha?: RedisHaOverview }) {
  const { t } = useLocale();
  const f = useFormat();

  if (!ha) {
    return null;
  }

  const clusterPartial = Boolean(ha.clusterNodes && ha.clusterNodes.readyMasters < ha.clusterNodes.masters);
  const statusTone: Tone = !ha.ready
    ? 'crit'
    : ha.degraded.degraded || clusterPartial
      ? 'warn'
      : 'ok';
  const statusLabel = !ha.ready
    ? t('cache.ha.status.unavailable')
    : ha.degraded.degraded
      ? t('cache.ha.status.degraded')
      : clusterPartial
        ? t('cache.ha.status.partial')
        : t('cache.ha.status.healthy');

  return (
    <Panel
      title={t('cache.ha.title')}
      hint={t('cache.ha.hint')}
      actions={
        <div className="flex items-center gap-1.5">
          <Badge tone="info">{t(`cache.ha.mode.${ha.mode}`)}</Badge>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <KeyValueGrid
          items={[
            {
              label: t('cache.ha.primary'),
              value: ha.currentPrimary ?? (ha.endpoints[0] || NO_VALUE),
              mono: true,
            },
            {
              label: ha.mode === 'sentinel' ? t('cache.ha.masterName') : t('cache.ha.endpoints'),
              value:
                ha.mode === 'sentinel' && ha.masterName
                  ? `${ha.masterName} (${ha.endpoints.join(', ')})`
                  : ha.endpoints.join(', ') || NO_VALUE,
              mono: true,
            },
            {
              label: t('cache.ha.failovers'),
              value: f.number(ha.failoverCount),
              mono: true,
            },
            {
              label: t('cache.ha.reconnects'),
              value: f.number(ha.reconnectCount),
              mono: true,
            },
          ]}
        />
        <div className="border-t border-border pt-3">
          <KeyValueGrid
            items={[
              {
                label: t('cache.ha.timeouts'),
                value: `${f.duration(ha.timeouts.connectTimeoutMs)} / ${f.duration(ha.timeouts.commandTimeoutMs)}`,
                mono: true,
              },
              {
                label: t('cache.ha.maxRetries'),
                value: f.number(ha.timeouts.maxRetriesPerRequest),
                mono: true,
              },
              {
                label: t('cache.ha.bypassed'),
                value: (
                  <span className={ha.degraded.degraded ? 'text-warn-fg' : undefined}>
                    {f.number(ha.degraded.bypassedCount)}
                  </span>
                ),
                mono: true,
              },
              {
                label: t('cache.ha.lastFailover'),
                value: ha.lastFailoverAt ? f.dateTime(ha.lastFailoverAt, true) : NO_VALUE,
                mono: Boolean(ha.lastFailoverAt),
              },
              ...(ha.clusterNodes
                ? [
                    {
                      label: t('cache.ha.clusterNodes'),
                      value: `${ha.clusterNodes.readyMasters}/${ha.clusterNodes.masters} masters (${ha.clusterNodes.total} total)`,
                      mono: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}
