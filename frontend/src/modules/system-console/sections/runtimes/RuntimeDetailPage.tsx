import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf } from '@core/theme';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, PanelState, RelativeTime, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { RuntimeId } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { RUNTIME_DETAIL_TABS, RUNTIME_ICON, type RuntimeDetailTab } from '../../constants/runtime-metrics';
import { RuntimeActions } from '../../components/runtimes/RuntimeActions';
import { runtimesKeys } from './runtimes-keys';
import type { RuntimesPage } from './useRuntimesPage';
import { RuntimeOverviewTab } from './RuntimeOverviewTab';
import { RuntimeMetricsTab } from './RuntimeMetricsTab';
import { RuntimeLogsTab } from './RuntimeLogsTab';
import { RuntimeConfigSheet } from './RuntimeConfigSheet';

/** Chi tiết một runtime: Tổng quan (gồm process) · Metrics · Logs & Sự kiện; cấu hình mở dạng sheet (⚙). */
export function RuntimeDetailPage({ page, id }: { page: RuntimesPage; id: RuntimeId }) {
  const { t } = useLocale();
  const f = useFormat();
  const detail = useLiveQuery(runtimesKeys.detail(id), () => runtimesApi.detail(id), { keepPrevious: false });
  const d = detail.data;
  const tone = d ? toneOf(d.status) : 'unknown';
  const tabs: PageTab<RuntimeDetailTab>[] = RUNTIME_DETAIL_TABS.map((tab) => ({
    id: tab,
    label: t(`rt.tab.${tab}`),
  }));

  const renderTab = () => {
    if (!d) return <PanelState status={detail.isError ? 'error' : 'loading'} error={detail.error} onRetry={() => void detail.refetch()} />;
    switch (page.tab) {
      case 'metrics':
        return <RuntimeMetricsTab d={d} />;
      case 'logs':
        return <RuntimeLogsTab d={d} page={page} />;
      default:
        return <RuntimeOverviewTab d={d} page={page} />;
    }
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={page.back}>
        <ArrowLeft />
        {t('nav.runtimes')}
      </Button>
      <PageHeader
        title={d?.name ?? t(`rt.name.${id}`)}
        icon={RUNTIME_ICON[id]}
        status={d ? { tone, label: t(`rt.status.${d.status}`) } : undefined}
        actions={
          d && (
            <>
              <Badge variant="outline" className="font-mono">
                {t('rt.detail.pidUptime', { pid: d.pid ?? NO_VALUE, uptime: f.uptime(d.uptimeSec) })}
              </Badge>
              <RuntimeActions runtime={d} size="sm" />
            </>
          )
        }
        onSettings={() => page.setSettings(true)}
      />

      {detail.isError && d && (
        <StatusBanner
          tone="warn"
          title={t('ui.state.offline')}
          actions={
            <Button size="xs" onClick={() => void detail.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {d && (tone === 'warn' || tone === 'crit') && (d.reasons.length > 0 || d.alerts.length > 0) && (
        <StatusBanner
          tone={tone}
          title={t(`rt.status.${d.status}`)}
          reasons={[
            ...d.alerts.map((a) => ({
              id: a.key,
              text: (
                <>
                  {a.message} <RelativeTime value={a.since} className="text-xs text-faint" />
                </>
              ),
            })),
            ...d.reasons.filter((r) => !d.alerts.some((a) => r.code === `alert.${a.key}`)).map((r) => ({ id: r.code, text: r.message })),
          ]}
        />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />
      {renderTab()}

      <RuntimeConfigSheet d={d} open={page.settingsOpen} onOpenChange={page.setSettings} />
    </div>
  );
}
