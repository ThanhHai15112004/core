import React from 'react';
import { Database, PlugZap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, RelativeTime, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { DbPing } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_TABS, HEALTH_TONE, type DbPageTab } from '../../constants/database';
import { QueryDetailSheet } from '../../components/database/QueryDetailSheet';
import { SessionDetailSheet } from '../../components/database/SessionDetailSheet';
import { TableDetailSheet } from '../../components/database/TableDetailSheet';
import { useDatabasePage } from './useDatabasePage';
import { useDbActions } from './useDbActions';
import { dbKeys } from './database-keys';
import { DbOverviewTab } from './DbOverviewTab';
import { DbQueriesTab } from './DbQueriesTab';
import { DbTablesTab } from './DbTablesTab';
import { DbActivityTab } from './DbActivityTab';
import { DbConfigSheet } from './DbConfigSheet';

const ENVIRONMENTS = ['production', 'staging', 'development'];

/**
 * Database — Tổng quan · Queries & Sessions (query / kết nối / transaction) · Tables (bảng / migration) · Hoạt động.
 * Chi tiết query / session / bảng mở drawer ở mọi tab; cấu hình mở dạng sheet. Phần driver không hỗ trợ nói rõ lý do.
 */
export const DatabaseSection: React.FC = () => {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const page = useDatabasePage();
  const actions = useDbActions();
  const overview = useLiveQuery(dbKeys.overview(page.range), () => databaseApi.overview(page.range));
  const data = overview.data;
  const caps = new Set(data?.capabilities ?? []);
  const health = data?.health;
  const healthTone = health ? HEALTH_TONE[health.status] : undefined;

  const ping = useAppMutation<void, DbPing>({
    mutationFn: () => databaseApi.ping(),
    success: false,
    onSuccess: (r) => {
      if (r.ok) toast.success(t('db.test.ok', { latency: f.duration(r.latencyMs), time: formatTime(r.checkedAt) }));
      else toast.error(t('db.test.fail', { error: `${r.error?.code ?? ''} ${r.error?.message ?? ''}`.trim() }));
    },
    error: t('db.test.failTitle'),
  });

  const alerts = data?.alerts ?? [];
  const tabs: PageTab<DbPageTab>[] = DB_TABS.map((id) => ({
    id,
    label: t(`db.tab.${id}`),
    ...(id === 'overview' ? { count: alerts.length, countTone: alerts.some((a) => a.severity === 'critical') ? ('crit' as const) : ('warn' as const) } : {}),
  }));

  const product = data ? (data.server.available ? `${data.server.data.product} ${data.server.data.version}` : data.driver) : null;
  const env = data ? (ENVIRONMENTS.includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment) : null;

  const renderTab = () => {
    switch (page.tab) {
      case 'queries':
        return <DbQueriesTab page={page} overview={data} actions={actions} />;
      case 'tables':
        return <DbTablesTab page={page} overview={data} actions={actions} />;
      case 'activity':
        return <DbActivityTab page={page} />;
      default:
        return <DbOverviewTab page={page} overview={overview} actions={actions} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.database')}
        icon={Database}
        status={health && healthTone ? { tone: healthTone, label: t(`db.state.${health.status}`) } : undefined}
        actions={
          <>
            {product && (
              <Badge variant="outline" className="hidden font-mono md:inline-flex">
                {product} · {data?.database}
              </Badge>
            )}
            {env && <Badge variant="outline" className="hidden md:inline-flex">{env}</Badge>}
            {health?.pingMs !== null && health?.pingMs !== undefined && (
              <Badge variant="outline" className="hidden font-mono md:inline-flex">
                {t('db.test.ping', { ms: f.duration(health.pingMs) })}
              </Badge>
            )}
            <Button size="sm" onClick={() => ping.mutate()} disabled={ping.isPending}>
              <PlugZap />
              {ping.isPending ? t('db.test.running') : t('db.test.button')}
            </Button>
          </>
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          description={errorMessage(overview.error)}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {health && healthTone && healthTone !== 'ok' && (
        <StatusBanner
          tone={healthTone}
          title={t(`db.health.${health.status}`)}
          reasons={health.reasons.map((r) => ({ id: `${r.code}-${r.message}`, text: r.message }))}
          meta={
            health.status !== 'healthy' && health.lastSuccessAt ? (
              <span>
                {t('db.health.lastSuccessLabel')} <RelativeTime value={health.lastSuccessAt} />
              </span>
            ) : undefined
          }
        />
      )}

      <PageTabs tabs={tabs} value={page.tab} onChange={page.goTab} />
      {renderTab()}

      <QueryDetailSheet id={page.digestId} range={page.range} onClose={() => page.openQuery(null)} navigate={page.navigate} />
      <SessionDetailSheet
        id={page.sessionId}
        canCancel={caps.has('cancel')}
        canTerminate={caps.has('terminate')}
        onClose={() => page.openSession(null)}
        onCancel={actions.requestCancel}
        onTerminate={actions.requestTerminate}
        navigate={page.navigate}
      />
      <TableDetailSheet name={page.tableName} onClose={() => page.openTable(null)} />
      <DbConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} />
      {actions.dialog}
    </div>
  );
};
