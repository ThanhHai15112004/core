import React from 'react';
import { Send, ShieldAlert } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatGrid, StatTile, type PageTab } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { useSectionRoute } from '../../shell/useSectionRoute';
import { INCIDENTS_TABS, type IncidentsTab } from '../../constants/incidents';
import { incidentsApi } from '../../services/incidents.api';
import { IncidentsListTab } from './IncidentsListTab';
import { RunbooksOwnersTab } from './RunbooksOwnersTab';
import { SiemPoliciesTab } from './SiemPoliciesTab';

export const IncidentsSection: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const r = useSectionRoute<IncidentsTab>(INCIDENTS_TABS);

  const overview = useLiveQuery(['console', 'incidents', 'overview'], () => incidentsApi.overview(), {
    tier: 'live',
  });

  const testSiemMut = useMutation({
    mutationFn: () => incidentsApi.testSiem(),
    onSuccess: (res) => {
      addToast({
        type: res.status === 'FAILED' ? 'warning' : 'success',
        title: t('incidents.testSiemSuccess', { status: res.status, destination: res.destination }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'incidents'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const ov = overview.data;
  const tabs: PageTab<IncidentsTab>[] = INCIDENTS_TABS.map((id) => ({
    id,
    label: t(`incidents.tab.${id}`),
    ...(id === 'incidents' && ov && ov.openTotal > 0
      ? { count: ov.openTotal, countTone: ov.openBySeverity.P1 > 0 ? ('crit' as const) : ('warn' as const) }
      : {}),
  }));

  return (
    <div>
      <PageHeader
        title={t('incidents.title')}
        icon={ShieldAlert}
        status={
          ov
            ? {
                tone: ov.openBySeverity.P1 > 0 || ov.slaBreachedCount > 0 ? 'crit' : ov.openTotal > 0 ? 'warn' : 'ok',
                label:
                  ov.openBySeverity.P1 > 0 || ov.slaBreachedCount > 0
                    ? t('console.status.critical')
                    : ov.openTotal > 0
                      ? t('console.status.warning')
                      : t('console.status.healthy'),
              }
            : undefined
        }
        actions={
          <Button size="xs" variant="outline" disabled={testSiemMut.isPending} onClick={() => testSiemMut.mutate()}>
            <Send />
            {t('incidents.testSiem')}
          </Button>
        }
      />

      {ov && (
        <StatGrid columns={4}>
          <StatTile
            label={t('incidents.kpi.openTotal')}
            value={ov.openTotal}
            tone={ov.openBySeverity.P1 > 0 ? 'crit' : ov.openTotal > 0 ? 'warn' : 'ok'}
            sub={t('incidents.kpi.openSub', {
              p1: ov.openBySeverity.P1,
              p2: ov.openBySeverity.P2,
              p3: ov.openBySeverity.P3,
              p4: ov.openBySeverity.P4,
            })}
          />
          <StatTile
            label={t('incidents.kpi.slaBreached')}
            value={ov.slaBreachedCount}
            tone={ov.slaBreachedCount > 0 ? 'crit' : 'ok'}
            sub={t('incidents.kpi.slaBreachedSub')}
          />
          <StatTile
            label={t('incidents.kpi.repeated')}
            value={ov.repeatedIncidentsCount}
            tone={ov.repeatedIncidentsCount > 0 ? 'warn' : 'ok'}
            sub={t('incidents.kpi.repeatedSub', { suppressed: ov.totalSuppressedAlerts })}
          />
          <StatTile
            label={t('incidents.kpi.siemSent')}
            value={ov.siem.sentLast24h}
            tone={ov.siem.failedLast24h > 0 ? 'warn' : 'ok'}
            sub={t('incidents.kpi.siemSub', {
              failed: ov.siem.failedLast24h,
              driver: ov.siem.driver,
            })}
          />
        </StatGrid>
      )}

      <PageTabs tabs={tabs} value={r.tab} onChange={(tab) => r.go(tab)} />

      {r.tab === 'incidents' && <IncidentsListTab />}
      {r.tab === 'governance' && <RunbooksOwnersTab />}
      {r.tab === 'siem' && <SiemPoliciesTab />}
    </div>
  );
};
