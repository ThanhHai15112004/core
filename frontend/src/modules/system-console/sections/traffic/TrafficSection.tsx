import React from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery, errorMessage, errorStatus } from '@core/data';
import { worstTone, type Tone } from '@core/theme';
import { ApiError } from '@core/services/api';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { TrafficSummary } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { errorRateTone } from '../../utils/traffic-format';
import { TELEMETRY_DISABLED_CODE, TELEMETRY_UNAVAILABLE_STATUS, TRAFFIC_TABS, type TrafficTab } from '../../constants/traffic';
import { TrafficFilterBar } from '../../components/traffic/TrafficFilterBar';
import { useTrafficPage } from './useTrafficPage';
import { trafficKeys } from './traffic-keys';
import { TrafficOverviewTab } from './TrafficOverviewTab';
import { TrafficEndpointsTab } from './TrafficEndpointsTab';
import { TrafficErrorsTab } from './TrafficErrorsTab';
import { EndpointDetailPage } from './EndpointDetailPage';

/** Trạng thái chung của traffic: tệ nhất giữa tỷ lệ 5xx và P95 so với ngưỡng cấu hình. */
function overallTone(s: TrafficSummary): Tone {
  if (!s.hasTraffic || s.stats.requests === 0) return 'unknown';
  const p95 = s.stats.p95LatencyMs;
  const latency: Tone = p95 !== null && p95 > s.settings.endpointP95WarnMs ? 'warn' : 'ok';
  return worstTone([errorRateTone(s) ?? 'ok', latency]) ?? 'unknown';
}

/**
 * HTTP Traffic — số liệu tổng hợp từ Prometheus (không lưu từng request; chi tiết request xem ở Logs):
 * Tổng quan · Endpoints · Lỗi; chi tiết một endpoint là trang con `endpoints/<routeId>`.
 * Không có telemetry (503) → nói rõ lý do, không làm chết trang.
 */
export const TrafficSection: React.FC = () => {
  const { t } = useLocale();
  const page = useTrafficPage();
  const summary = useLiveQuery(trafficKeys.summary(page.filters), () => trafficApi.summary(page.filters));
  const data = summary.data;
  const unavailable = !data && errorStatus(summary.error) === TELEMETRY_UNAVAILABLE_STATUS;
  const disabled = unavailable && summary.error instanceof ApiError && summary.error.code === TELEMETRY_DISABLED_CODE;
  const isDetail = page.routeId !== null;

  const tabs: PageTab<TrafficTab>[] = TRAFFIC_TABS.map((id) => ({ id, label: t(`tr.tab.${id}`) }));
  const tone = data ? overallTone(data) : unavailable ? 'crit' : undefined;

  const retry = (
    <Button size="xs" onClick={() => void summary.refetch()}>
      <RefreshCw />
      {t('ui.state.retry')}
    </Button>
  );

  const renderTab = () => {
    if (page.routeId) return <EndpointDetailPage key={page.routeId} page={page} routeId={page.routeId} settings={data?.settings} />;
    switch (page.tab) {
      case 'endpoints':
        return <TrafficEndpointsTab page={page} />;
      case 'errors':
        return <TrafficErrorsTab page={page} summary={data} />;
      default:
        return <TrafficOverviewTab page={page} summary={summary} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.http-traffic')}
        icon={Globe}
        status={
          tone && !isDetail
            ? { tone, label: data && !data.hasTraffic ? t('tr.state.noTraffic') : unavailable ? t('tr.state.unavailable') : t(`ui.status.${tone}`) }
            : undefined
        }
      />

      {unavailable && (
        <StatusBanner
          tone="crit"
          title={t(disabled ? 'tr.empty.disabledTitle' : 'tr.empty.unavailableTitle')}
          description={errorMessage(summary.error)}
          actions={retry}
        />
      )}
      {!unavailable && summary.isError && !data && (
        <StatusBanner tone="crit" title={t('tr.empty.errorTitle')} description={errorMessage(summary.error)} actions={retry} />
      )}
      {data && !data.hasTraffic && <StatusBanner tone="info" title={t('tr.empty.noTrafficTitle')} description={t('tr.empty.noTrafficMessage')} />}

      {!isDetail && <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />}
      {!isDetail && page.tab !== 'endpoints' && <TrafficFilterBar page={page} />}
      {renderTab()}
    </div>
  );
};
