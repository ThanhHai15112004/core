import React, { useState } from 'react';
import { HardDrive, PlugZap, RefreshCw, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, RelativeTime, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { StorageTest } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { STORAGE_HEALTH_TONE, STORAGE_TABS, type StoragePageTab } from '../../constants/storage';
import { KNOWN_ENVIRONMENTS } from '../../constants/cache';
import { ContainerSheet } from '../../components/storage/ContainerSheet';
import { ObjectSheet } from '../../components/storage/ObjectSheet';
import { useStoragePage } from './useStoragePage';
import { useStorageActions } from './useStorageActions';
import { storageKeys } from './storage-keys';
import { StorageOverviewTab } from './StorageOverviewTab';
import { StorageObjectsTab } from './StorageObjectsTab';
import { StorageUploadsTab } from './StorageUploadsTab';
import { StorageActivityTab } from './StorageActivityTab';
import { StorageConfigSheet } from './StorageConfigSheet';

/**
 * Storage — Tổng quan (dung lượng, tăng trưởng, lifecycle) · Container & Object · Upload · Hoạt động (lỗi, sự kiện, audit).
 * Chi tiết container / object mở drawer (`?detail=`, `?object=`) ở mọi tab; cấu hình mở dạng sheet (⚙).
 */
export const StorageSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const page = useStoragePage();
  const overview = useLiveQuery(storageKeys.overview(page.range), () => storageApi.overview(page.range));
  const data = overview.data;
  const [result, setResult] = useState<StorageTest | null>(null);
  const actions = useStorageActions((versioned) => {
    if (!versioned) page.openObject(null);
  });
  const test = useAppMutation({ mutationFn: () => storageApi.test(), success: false, invalidate: [storageKeys.all], onSuccess: setResult });

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const tabs: PageTab<StoragePageTab>[] = STORAGE_TABS.map((id) => ({
    id,
    label: t(`storage.tab.${id}`),
    ...(id === 'overview' ? { count: problems, countTone: data?.alerts.some((a) => a.severity === 'critical') ? ('crit' as const) : ('warn' as const) } : {}),
    ...(id === 'uploads' ? { count: data?.uploads.stale ?? null, countTone: 'warn' as const } : {}),
    ...(id === 'activity' ? { count: data?.kpis.failedOps ?? null, countTone: 'crit' as const } : {}),
  }));
  const health = data?.health;
  const tone = health ? STORAGE_HEALTH_TONE[health.status] : undefined;
  const env = data ? (KNOWN_ENVIRONMENTS.includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment) : '';

  const renderTab = () => {
    switch (page.tab) {
      case 'objects':
        return <StorageObjectsTab page={page} data={data} />;
      case 'uploads':
        return <StorageUploadsTab page={page} product={data?.provider.product} onAbort={actions.requestAbort} />;
      case 'activity':
        return <StorageActivityTab page={page} driver={data?.provider.driver} />;
      default:
        return <StorageOverviewTab page={page} query={overview} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.storage')}
        icon={HardDrive}
        status={health && tone ? { tone, label: t(`storage.health.${health.status}`) } : undefined}
        actions={
          <>
            {data && (
              <Badge variant="outline" className="hidden max-w-80 truncate font-mono sm:inline-flex" title={data.provider.location}>
                {data.provider.product} · {env} · {data.provider.location}
              </Badge>
            )}
            <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
              <PlugZap />
              {test.isPending ? t('storage.test.running') : t('storage.test.button')}
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
          title={t(`storage.health.${health.status}`)}
          reasons={health.reasons.map((r) => ({ id: r.code, text: r.message }))}
          meta={
            <span>
              {health.pingMs !== null && `${t('storage.health.ping', { value: f.duration(health.pingMs) })} · `}
              {health.lastSuccessAt && (
                <>
                  {t('storage.health.lastSuccess')} <RelativeTime value={health.lastSuccessAt} />
                </>
              )}
            </span>
          }
        />
      )}
      {result && (
        <StatusBanner
          tone={result.ok ? 'ok' : 'crit'}
          title={result.ok ? t('storage.test.ok', { ms: f.duration(result.totalMs) }) : t('storage.test.fail', { step: t(`storage.test.step.${result.failedStep}`) })}
          description={result.steps
            .map((s) => `${s.ok ? '' : `${t('storage.test.failed')}: `}${t(`storage.test.step.${s.step}`)}${s.ms === null ? '' : ` ${f.duration(s.ms)}`}${s.error ? ` (${s.error})` : ''}`)
            .join(' · ')}
          actions={
            <Button size="icon-xs" variant="ghost" onClick={() => setResult(null)} aria-label={t('ui.action.close')}>
              <X />
            </Button>
          }
        />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={(tab) => page.go(tab)} />
      {renderTab()}

      <ContainerSheet
        name={page.containerId}
        range={page.range}
        driver={data?.provider.driver}
        onClose={() => page.openContainer(null)}
        onBrowse={(c) => page.browseObjects({ container: c })}
        onOpenObject={page.openObject}
      />
      <ObjectSheet objectKey={page.objectId} onClose={() => page.openObject(null)} onDelete={actions.requestDelete} onOpenContainer={page.openContainer} />
      <StorageConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} />
      {actions.dialog}
    </div>
  );
};
