import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { formatBytes } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { KeyValueGrid, Panel, PanelGrid, QueryView } from '@core/ui/blocks';
import type { Tone } from '@core/theme';
import { trafficApi } from '../../services/traffic.api';
import { trafficKeys } from '../../sections/traffic/traffic-keys';

const CHECK_TONE: Record<'pass' | 'warn' | 'fail', Tone> = {
  pass: 'ok',
  warn: 'warn',
  fail: 'crit',
};

const ms = (v: number) => `${v.toLocaleString()} ms`;

/**
 * Tab Gateway & Edge trong System Console → HTTP Traffic:
 * hiển thị kiểm tra nhất quán LB↔API, Trusted Proxy, ma trận Timeout, Body Limit, Rate Limit Layering và bảng Service Routing.
 */
export function GatewayEdgePanel() {
  const { t } = useLocale();
  const query = useLiveQuery(trafficKeys.gateway(), () => trafficApi.gateway());

  return (
    <QueryView query={query}>
      {(data) => (
        <div className="space-y-4">
          <Panel
            title={t('tr.gateway.checksTitle')}
            actions={
              <Badge tone={data.status === 'ok' ? 'ok' : data.status === 'warn' ? 'warn' : 'crit'}>
                {t(`ui.status.${data.status === 'ok' ? 'ok' : data.status === 'warn' ? 'warn' : 'crit'}`)}
              </Badge>
            }
          >
            <div className="space-y-2">
              {data.checks.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={CHECK_TONE[c.status]} size="xs">
                      {c.status.toUpperCase()}
                    </Badge>
                    <span className="font-mono font-medium text-fg">{c.id}</span>
                  </div>
                  <span className="text-fg-2">{c.message}</span>
                </div>
              ))}
            </div>
          </Panel>

          <PanelGrid>
            <Panel title={t('tr.gateway.proxyTitle')}>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: t('tr.gateway.trustMode'), value: data.proxy.trustMode, mono: true },
                  { label: t('tr.gateway.maxHops'), value: String(data.proxy.maxHops), mono: true },
                  { label: t('tr.gateway.vendor'), value: data.gateway.vendor, mono: true },
                  { label: t('tr.gateway.prefixHeader'), value: data.proxy.forwardedPrefixHeader, mono: true },
                  { label: t('tr.gateway.ipHeaders'), value: data.proxy.ipHeaders.join(', '), mono: true },
                  {
                    label: t('tr.gateway.trustedCidrs'),
                    value: data.proxy.trustedCidrs.length > 0 ? data.proxy.trustedCidrs.join(', ') : '—',
                    mono: true,
                  },
                ]}
              />
            </Panel>

            <Panel title={t('tr.gateway.timeoutsTitle')}>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: t('tr.gateway.lbConnect'), value: ms(data.timeouts.lbConnectTimeoutMs), mono: true },
                  { label: t('tr.gateway.apiConn'), value: ms(data.timeouts.apiConnectionTimeoutMs), mono: true },
                  {
                    label: t('tr.gateway.lbRead'),
                    value: `${ms(data.timeouts.lbReadTimeoutMs)} / ${ms(data.timeouts.lbSendTimeoutMs)}`,
                    mono: true,
                  },
                  { label: t('tr.gateway.apiRequest'), value: ms(data.timeouts.apiRequestTimeoutMs), mono: true },
                  { label: t('tr.gateway.lbKeepAlive'), value: ms(data.timeouts.lbKeepAliveTimeoutMs), mono: true },
                  { label: t('tr.gateway.apiKeepAlive'), value: ms(data.timeouts.apiKeepAliveTimeoutMs), mono: true },
                  { label: t('tr.gateway.apiHeaders'), value: ms(data.timeouts.apiHeadersTimeoutMs), mono: true },
                ]}
              />
            </Panel>
          </PanelGrid>

          <Panel title={t('tr.gateway.limitsTitle')}>
            <KeyValueGrid
              columns={3}
              items={[
                { label: t('tr.gateway.gatewayMaxBody'), value: formatBytes(data.bodyLimits.gatewayMaxBodySizeBytes), mono: true },
                { label: t('tr.gateway.apiMaxBody'), value: formatBytes(data.bodyLimits.apiMaxBodySizeBytes), mono: true },
                { label: t('tr.gateway.apiJsonLimit'), value: formatBytes(data.bodyLimits.apiJsonBodyLimitBytes), mono: true },
                { label: t('tr.gateway.rateLayerMode'), value: data.rateLimit.layerMode, mono: true },
                {
                  label: t('tr.gateway.rateEdgeMarker'),
                  value: `${data.rateLimit.gatewaySourceHeader}=${data.rateLimit.gatewaySourceValue}`,
                  mono: true,
                },
                {
                  label: t('tr.gateway.rateSkipIp'),
                  value: data.rateLimit.skipBackendIpWhenEdgeApplied ? t('tr.gateway.yes') : t('tr.gateway.no'),
                },
                {
                  label: t('tr.gateway.rateDistributed'),
                  value: data.rateLimit.distributedStoreReady ? t('tr.gateway.yes') : t('tr.gateway.no'),
                },
                {
                  label: t('tr.gateway.rateSensitive'),
                  value: data.rateLimit.alwaysEnforceIpRoutes.join(', '),
                  mono: true,
                },
              ]}
            />
          </Panel>

          <Panel title={t('tr.gateway.routingTitle')} hint={t('tr.gateway.routingHint')}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-2 pr-3 font-medium">{t('tr.gateway.colDomain')}</th>
                    <th className="py-2 pr-3 font-medium">{t('tr.gateway.colService')}</th>
                    <th className="py-2 pr-3 font-medium">{t('tr.gateway.colUpstream')}</th>
                    <th className="py-2 pr-3 font-medium">{t('tr.gateway.colPrefixes')}</th>
                    <th className="py-2 font-medium">{t('tr.gateway.colStability')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.serviceRouting.domains.map((row) => (
                    <tr key={row.domain} className="align-top">
                      <td className="py-2 pr-3 font-mono font-medium text-fg">{row.domain}</td>
                      <td className="py-2 pr-3 font-mono text-fg-2">{row.serviceName}</td>
                      <td className="py-2 pr-3 font-mono text-fg-2">{row.upstreamDefault}</td>
                      <td className="py-2 pr-3 font-mono text-fg-2">{row.prefixes.join(', ')}</td>
                      <td className="py-2">
                        <Badge tone="info" size="xs">
                          {row.stability}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </QueryView>
  );
}
