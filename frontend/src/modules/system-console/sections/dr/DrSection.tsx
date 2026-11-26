import React from 'react';
import { GitCompare, Play, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatGrid, StatTile, type PageTab } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { useSectionRoute } from '../../shell/useSectionRoute';
import { DR_TABS, type DrTab } from '../../constants/dr';
import { drApi } from '../../services/dr.api';
import { DrOverviewTab } from './DrOverviewTab';
import { DrSyncReconcileTab } from './DrSyncReconcileTab';
import { DrSwitchoverTab } from './DrSwitchoverTab';
import { DrDrillsRunbookTab } from './DrDrillsRunbookTab';

export const DrSection: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const r = useSectionRoute<DrTab>(DR_TABS);

  const overview = useLiveQuery(['console', 'dr', 'overview'], () => drApi.overview(), {
    tier: 'live',
  });

  const syncMut = useMutation({
    mutationFn: () => drApi.runSync('FULL'),
    onSuccess: (res) => {
      addToast({
        type: res.status === 'FAILED' ? 'error' : 'success',
        title: t('dr.toast.syncDone', { code: res.syncCode, status: res.status }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const reconcileMut = useMutation({
    mutationFn: () => drApi.runReconciliation({ scope: 'FULL' }),
    onSuccess: (res) => {
      addToast({
        type: res.totalDiscrepancies > 0 ? 'warning' : 'success',
        title: t('dr.toast.reconcileDone', {
          code: res.reportCode,
          count: res.totalDiscrepancies,
        }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const drillMut = useMutation({
    mutationFn: () => drApi.runDrill({ drillType: 'MANUAL_SIMULATION' }),
    onSuccess: (res) => {
      addToast({
        type: res.status === 'PASSED' ? 'success' : 'warning',
        title: t('dr.toast.drillDone', { code: res.drillCode, status: res.status }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const ov = overview.data;
  const tabs: PageTab<DrTab>[] = DR_TABS.map((id) => ({
    id,
    label: t(`dr.tab.${id}`),
  }));

  return (
    <div>
      <PageHeader
        title={t('dr.title')}
        icon={RefreshCw}
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
                label: t(`console.status.${ov.healthStatus === 'disabled' ? 'idle' : ov.healthStatus}`),
              }
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={syncMut.isPending}
              onClick={() => syncMut.mutate()}
            >
              <RefreshCw />
              {t('dr.actions.syncNow')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={reconcileMut.isPending}
              onClick={() => reconcileMut.mutate()}
            >
              <GitCompare />
              {t('dr.actions.reconcileNow')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={drillMut.isPending}
              onClick={() => drillMut.mutate()}
            >
              <Play />
              {t('dr.actions.runDrill')}
            </Button>
          </div>
        }
      />

      {ov && (
        <StatGrid columns={4}>
          <StatTile
            label={t('dr.kpi.activeSite')}
            value={ov.profile.activeSite}
            tone={ov.effectiveEnabled ? (ov.profile.activeSite === 'PRIMARY' ? 'ok' : 'warn') : 'unknown'}
            sub={ov.profile.topologyMode}
          />
          <StatTile
            label={t('dr.kpi.rpo')}
            value={t('dr.kpi.targetVal', { sec: ov.profile.rpoTargetSeconds })}
            tone={ov.rpoStatus === 'MET' ? 'ok' : ov.rpoStatus === 'BREACHED' ? 'crit' : 'unknown'}
            sub={
              ov.latestSync?.actualRpoSeconds !== null && ov.latestSync?.actualRpoSeconds !== undefined
                ? t('dr.kpi.actualVal', { sec: ov.latestSync.actualRpoSeconds })
                : t('dr.kpi.noMeasurement')
            }
          />
          <StatTile
            label={t('dr.kpi.rto')}
            value={t('dr.kpi.targetVal', { sec: ov.profile.rtoTargetSeconds })}
            tone={ov.rtoStatus === 'MET' ? 'ok' : ov.rtoStatus === 'BREACHED' ? 'crit' : 'unknown'}
            sub={
              ov.latestDrill?.measuredRtoSeconds !== null && ov.latestDrill?.measuredRtoSeconds !== undefined
                ? t('dr.kpi.actualVal', { sec: ov.latestDrill.measuredRtoSeconds })
                : t('dr.kpi.noMeasurement')
            }
          />
          <StatTile
            label={t('dr.kpi.drillStatus')}
            value={ov.latestDrill ? ov.latestDrill.status : t('dr.kpi.noMeasurement')}
            tone={
              ov.drillOverdue
                ? 'warn'
                : ov.latestDrill?.status === 'PASSED'
                  ? 'ok'
                  : ov.latestDrill?.status === 'FAILED'
                    ? 'crit'
                    : 'unknown'
            }
            sub={
              ov.drillOverdue
                ? t('dr.kpi.drillDue')
                : t('dr.kpi.drillOnTrack', { days: ov.profile.drillIntervalDays })
            }
          />
        </StatGrid>
      )}

      <PageTabs tabs={tabs} value={r.tab} onChange={(tab) => r.go(tab)} />

      {r.tab === 'overview' && <DrOverviewTab overview={ov} />}
      {r.tab === 'sync-reconcile' && <DrSyncReconcileTab />}
      {r.tab === 'switchover' && <DrSwitchoverTab liveSwitchEnabled={ov?.liveSwitchEnabled} />}
      {r.tab === 'drills' && <DrDrillsRunbookTab />}
    </div>
  );
};
