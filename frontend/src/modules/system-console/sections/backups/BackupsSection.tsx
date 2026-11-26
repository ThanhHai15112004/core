import React from 'react';
import { ArchiveRestore, Database, HardDrive, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatGrid, StatTile, type PageTab } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { useSectionRoute } from '../../shell/useSectionRoute';
import { BACKUPS_TABS, type BackupsTab } from '../../constants/backups';
import { backupsApi } from '../../services/backups.api';
import { BackupsOverviewTab } from './BackupsOverviewTab';
import { BackupsRecordsTab } from './BackupsRecordsTab';
import { BackupsRestoresTab } from './BackupsRestoresTab';
import { BackupsRunbookTab } from './BackupsRunbookTab';

export const BackupsSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const r = useSectionRoute<BackupsTab>(BACKUPS_TABS);

  const overview = useLiveQuery(['console', 'backups', 'overview'], () => backupsApi.overview(), {
    tier: 'live',
  });

  const runMut = useMutation({
    mutationFn: (targetType: 'DATABASE' | 'STORAGE') => backupsApi.runBackup({ targetType }),
    onSuccess: (res) => {
      addToast({ type: 'success', title: t('backups.toast.backupSuccess', { code: res.backupCode }) });
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const pruneMut = useMutation({
    mutationFn: () => backupsApi.pruneExpired(),
    onSuccess: (res) => {
      addToast({ type: 'success', title: t('backups.toast.pruneSuccess', { count: res.purgedCount }) });
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const ov = overview.data;
  const tabs: PageTab<BackupsTab>[] = BACKUPS_TABS.map((id) => ({
    id,
    label: t(`backups.tab.${id}`),
  }));

  return (
    <div>
      <PageHeader
        title={t('backups.title')}
        icon={ArchiveRestore}
        status={
          ov
            ? {
                tone:
                  ov.healthStatus === 'critical'
                    ? 'crit'
                    : ov.healthStatus === 'warning'
                      ? 'warn'
                      : ov.healthStatus === 'healthy'
                        ? 'ok'
                        : 'unknown',
                label: t(`console.status.${ov.healthStatus}`),
              }
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={runMut.isPending}
              onClick={() => runMut.mutate('DATABASE')}
            >
              <Database />
              {t('backups.actions.runDb')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={runMut.isPending}
              onClick={() => runMut.mutate('STORAGE')}
            >
              <HardDrive />
              {t('backups.actions.runStorage')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={pruneMut.isPending}
              onClick={() => pruneMut.mutate()}
            >
              <Trash2 />
              {t('backups.actions.prune')}
            </Button>
          </div>
        }
      />

      {ov && (
        <StatGrid columns={4}>
          <StatTile
            label={t('backups.kpi.latestDb')}
            value={ov.latestDatabaseBackup ? ov.latestDatabaseBackup.status : 'NONE'}
            tone={
              ov.latestDatabaseBackup?.status === 'SUCCESS'
                ? 'ok'
                : ov.latestDatabaseBackup?.status === 'FAILED'
                  ? 'crit'
                  : 'unknown'
            }
            sub={ov.latestDatabaseBackup ? ov.latestDatabaseBackup.backupCode : t('backups.kpi.noBackupYet')}
          />
          <StatTile
            label={t('backups.kpi.encryption')}
            value={ov.encryptionEnabled ? 'AES-256-GCM' : 'OFF'}
            tone={ov.encryptionEnabled && ov.encryptionConfigured ? 'ok' : 'warn'}
            sub={ov.encryptionConfigured ? t('backups.kpi.encReady') : t('backups.kpi.encMissingKey')}
          />
          <StatTile
            label={t('backups.kpi.drill')}
            value={`${ov.drillPassedCount}/${ov.drillTotalCount}`}
            tone={
              ov.drillTotalCount === 0
                ? 'unknown'
                : ov.drillPassedCount === ov.drillTotalCount
                  ? 'ok'
                  : 'warn'
            }
            sub={t('backups.kpi.drillSub', { passed: ov.drillPassedCount, total: ov.drillTotalCount })}
          />
          <StatTile
            label={t('backups.kpi.storedSize')}
            value={f.bytes(ov.totalStoredBytes)}
            tone={ov.failedRecords24h > 0 ? 'crit' : 'ok'}
            sub={t('backups.kpi.storedSub', {
              success: ov.successfulRecords,
              failed: ov.failedRecords24h,
            })}
          />
        </StatGrid>
      )}

      <PageTabs tabs={tabs} value={r.tab} onChange={(tab) => r.go(tab)} />

      {r.tab === 'overview' && <BackupsOverviewTab overview={ov} />}
      {r.tab === 'records' && (
        <BackupsRecordsTab restoreExecutionEnabled={ov?.restoreExecutionEnabled} />
      )}
      {r.tab === 'restores' && (
        <BackupsRestoresTab restoreExecutionEnabled={ov?.restoreExecutionEnabled} />
      )}
      {r.tab === 'runbook' && <BackupsRunbookTab />}
    </div>
  );
};
