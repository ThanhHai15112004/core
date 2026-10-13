import React from 'react';
import { FileText, GitBranch, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, RelativeTime, StatusBanner, type PageTab } from '@core/ui/blocks';
import type { LogsTab } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { LOGS_STATUS_TONE, LOGS_TABS } from '../../constants/logs';
import { LogDetailSheet } from '../../components/logs/LogDetailSheet';
import { useLogsPage } from './useLogsPage';
import { logsKeys } from './logs-keys';
import { LogsOverviewTab } from './LogsOverviewTab';
import { LogsExplorerTab } from './LogsExplorerTab';
import { ErrorGroupDetail, LogsErrorsTab } from './LogsErrorsTab';
import { LogsAuditTab } from './LogsAuditTab';
import { LogsTracePage } from './LogsTracePage';
import { LogsConfigSheet } from './LogsConfigSheet';

/**
 * Logs — trung tâm điều tra: Tổng quan · Tìm kiếm · Nhóm lỗi · Audit; Trace là trang con; cấu hình mở dạng sheet;
 * chi tiết một log mở drawer (`?log=<id>`) ở mọi tab. Kho log không truy vấn được → nói rõ, không làm chết trang.
 */
export const LogsSection: React.FC = () => {
  const { t } = useLocale();
  const page = useLogsPage();
  const overview = useLiveQuery(logsKeys.overview(page.range), () => logsApi.overview(page.range));
  const data = overview.data;

  const tabs: PageTab<LogsTab>[] = LOGS_TABS.map((id) => ({
    id,
    label: t(`logs.tab.${id}`),
    ...(id === 'errors' ? { count: data?.kpis.uniqueErrors ?? null, countTone: 'crit' as const } : {}),
  }));

  const renderTab = () => {
    if (page.isTrace) return <LogsTracePage page={page} />;
    switch (page.tab) {
      case 'explorer':
        return <LogsExplorerTab page={page} overview={data} />;
      case 'errors':
        return page.itemId ? <ErrorGroupDetail page={page} fingerprint={page.itemId} /> : <LogsErrorsTab page={page} />;
      case 'audit':
        return <LogsAuditTab page={page} />;
      default:
        return <LogsOverviewTab page={page} data={data} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.logs')}
        icon={FileText}
        status={data ? { tone: LOGS_STATUS_TONE[data.status] ?? 'unknown', label: t(`logs.state.${data.status}`) } : undefined}
        description={t('logs.subtitle')}
        meta={
          data && (
            <>
              {data.environment.toUpperCase()} · {t('logs.backend.redis')}
              {data.lastEventAt && (
                <>
                  {' · '}
                  {t('logs.lastEvent', { when: '' })}
                  <RelativeTime value={data.lastEventAt} />
                </>
              )}
            </>
          )
        }
        actions={
          <Button size="sm" onClick={() => page.openTrace()}>
            <GitBranch />
            {t('logs.page.trace')}
          </Button>
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
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
      {data?.status === 'unavailable' && (
        <StatusBanner
          tone="crit"
          title={t('logs.unavailable.title')}
          description={t('logs.unavailable.message', { when: data.lastIngestAt ? new Date(data.lastIngestAt).toLocaleString() : '' })}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('logs.unavailable.retry')}
            </Button>
          }
        />
      )}

      {!page.isTrace && <PageTabs tabs={tabs} value={page.tab} onChange={page.go} />}
      {renderTab()}

      <LogDetailSheet
        logId={page.logId}
        onClose={() => page.openLog(null)}
        onOpenLog={page.openLog}
        onTrace={(id) => page.openTrace(id)}
        onError={page.openError}
        navigate={page.navigate}
      />
      <LogsConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} />
    </div>
  );
};
