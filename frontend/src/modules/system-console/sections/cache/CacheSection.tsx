import React, { useState } from 'react';
import { PlugZap, RefreshCw, X, Zap } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, PanelState, RelativeTime, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { CacheCapability, CachePing } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { CACHE_HEALTH_TONE, CACHE_TABS, KNOWN_ENVIRONMENTS, type CachePageTab } from '../../constants/cache';
import { NamespaceSheet } from '../../components/cache/NamespaceSheet';
import { KeySheet } from '../../components/cache/KeySheet';
import { useCachePage } from './useCachePage';
import { useCacheActions } from './useCacheActions';
import { cacheKeys } from './cache-keys';
import { CacheOverviewTab } from './CacheOverviewTab';
import { CacheNamespacesTab } from './CacheNamespacesTab';
import { CacheKeysTab } from './CacheKeysTab';
import { CacheActivityTab } from './CacheActivityTab';
import { CacheConfigSheet } from './CacheConfigSheet';

/** Tab cần capability nào (driver không hỗ trợ → nói rõ thay vì bảng trống). */
const TAB_CAPABILITY: Partial<Record<CachePageTab, CacheCapability>> = { keys: 'keyExplorer' };

/**
 * Cache — Tổng quan (hiệu quả, bộ nhớ, TTL, kết nối) · Namespaces · Keys · Hoạt động (lỗi, sự kiện, thao tác).
 * Chi tiết namespace / key mở drawer (`?ns=`, `?key=`) ở mọi tab; cấu hình mở dạng sheet (⚙).
 */
export const CacheSection: React.FC = () => {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const page = useCachePage();
  const overview = useLiveQuery(cacheKeys.overview(page.range), () => cacheApi.overview(page.range));
  const data = overview.data;
  const [ping, setPing] = useState<CachePing | null>(null);
  const actions = useCacheActions((action) => {
    if (action === 'deleteKey') page.openKey(null);
    if (action === 'clearNamespace') page.openNamespace(null);
  });
  const test = useAppMutation({ mutationFn: () => cacheApi.ping(), success: false, onSuccess: setPing });

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const tabs: PageTab<CachePageTab>[] = CACHE_TABS.map((id) => ({
    id,
    label: t(`cache.tab.${id}`),
    ...(id === 'overview' ? { count: problems, countTone: data?.alerts.some((a) => a.severity === 'critical') ? ('crit' as const) : ('warn' as const) } : {}),
  }));
  const health = data?.health;
  const tone = health ? CACHE_HEALTH_TONE[health.status] : undefined;
  const cap = TAB_CAPABILITY[page.tab];
  const unsupported = data && cap && !data.capabilities.includes(cap);
  const actionsEnabled = data?.settings.actionsEnabled ?? false;

  const renderTab = () => {
    if (unsupported) return <PanelState status="no-source" message={t('cache.unsupported.message', { driver: t(`cache.driver.${data.driver}`) })} />;
    switch (page.tab) {
      case 'namespaces':
        return <CacheNamespacesTab page={page} />;
      case 'keys':
        return <CacheKeysTab page={page} driver={data?.driver} actionsEnabled={actionsEnabled} onDelete={actions.requestDeleteKey} />;
      case 'activity':
        return <CacheActivityTab page={page} data={data} onFlush={actions.requestFlush} />;
      default:
        return <CacheOverviewTab page={page} query={overview} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.cache')}
        icon={Zap}
        status={health && tone ? { tone, label: t(`cache.health.${health.status}`) } : undefined}
        actions={
          <>
            {data && (
              <Badge variant="outline" className="hidden font-mono sm:inline-flex">
                {t(`cache.driver.${data.driver}`)} · {KNOWN_ENVIRONMENTS.includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment}
              </Badge>
            )}
            <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
              <PlugZap />
              {test.isPending ? t('cache.test.running') : t('cache.test.button')}
            </Button>
          </>
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && page.tab !== 'overview' && (
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
      {health && tone && tone !== 'ok' && (
        <StatusBanner
          tone={tone}
          title={t(`cache.health.${health.status}`)}
          reasons={health.reasons.map((r) => ({ id: r.code, text: r.message }))}
          meta={
            health.lastSuccessAt ? (
              <span>
                {t('cache.health.lastSuccess')} <RelativeTime value={health.lastSuccessAt} />
              </span>
            ) : undefined
          }
        />
      )}
      {ping && (
        <StatusBanner
          tone={ping.ok ? 'ok' : 'crit'}
          title={ping.ok ? t('cache.test.ok', { latency: f.duration(ping.latencyMs), time: formatTime(ping.at, true) }) : t('cache.test.fail', { error: ping.error ?? '' })}
          actions={
            <Button size="icon-xs" variant="ghost" onClick={() => setPing(null)} aria-label={t('ui.action.close')}>
              <X />
            </Button>
          }
        />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={(tab) => page.go(tab)} />
      {renderTab()}

      <NamespaceSheet
        name={page.nsId}
        range={page.range}
        onClose={() => page.openNamespace(null)}
        onBrowse={(ns) => page.browseKeys({ namespace: ns })}
        onOpenKey={page.openKey}
        onClear={actions.requestClearNamespace}
      />
      <KeySheet keyId={page.keyId} onClose={() => page.openKey(null)} onDelete={actions.requestDeleteKey} onOpenNamespace={page.openNamespace} />
      <CacheConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} />
      {actions.dialogs}
    </div>
  );
};
