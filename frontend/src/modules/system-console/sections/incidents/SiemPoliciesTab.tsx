import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge } from '@core/ui/primitives';
import { DataTable, Panel, RelativeTime } from '@core/ui/blocks';
import { INCIDENT_SEVERITY_TONE } from '../../constants/incidents';
import { incidentsApi } from '../../services/incidents.api';
import type { IncidentSeverityPolicyDto, SiemDispatchLogDto } from '../../types/incidents.types';

const policyCol = createColumnHelper<IncidentSeverityPolicyDto>();
const logCol = createColumnHelper<SiemDispatchLogDto>();

export const SiemPoliciesTab: React.FC = () => {
  const { t } = useLocale();

  const policies = useLiveQuery(
    ['console', 'incidents', 'policies'],
    () => incidentsApi.listPolicies(),
    { tier: 'slow' },
  );
  const siemLogs = useLiveQuery(
    ['console', 'incidents', 'siem-logs'],
    () => incidentsApi.listSiemLogs(),
    { tier: 'live' },
  );

  const policyColumns = useMemo(
    () => [
      policyCol.accessor('severity', {
        header: t('incidents.col.severity'),
        cell: (c) => (
          <Badge tone={INCIDENT_SEVERITY_TONE[c.getValue()]}>
            {t(`incidents.severity.${c.getValue()}`)}
          </Badge>
        ),
      }),
      policyCol.accessor('name', { header: t('incidents.col.title') }),
      policyCol.display({
        id: 'sla',
        header: t('incidents.col.sla'),
        cell: (c) => `${c.row.original.responseSlaMinutes}m / ${c.row.original.resolutionSlaMinutes}m`,
      }),
    ],
    [t],
  );

  const siemColumns = useMemo(
    () => [
      logCol.accessor('dispatchedAt', {
        header: t('incidents.col.dispatchedAt'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
      logCol.accessor('eventType', {
        header: t('incidents.col.eventType'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      logCol.accessor('severity', { header: t('incidents.col.severity') }),
      logCol.accessor('driver', { header: t('incidents.col.driver') }),
      logCol.accessor('destination', { header: t('incidents.col.destination') }),
      logCol.accessor('status', {
        header: t('incidents.col.status'),
        cell: (c) => (
          <Badge tone={c.getValue() === 'SENT' ? 'ok' : c.getValue() === 'FAILED' ? 'crit' : 'warn'}>
            {c.getValue()}
          </Badge>
        ),
      }),
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <Panel title={t('incidents.panel.slaPolicies')}>
        <DataTable
          data={policies.data ?? []}
          columns={policyColumns}
          getRowId={(r) => r.severity}
        />
      </Panel>
      <Panel title={t('incidents.panel.siemLogs')}>
        <DataTable
          data={siemLogs.data?.data ?? []}
          columns={siemColumns}
          getRowId={(r) => String(r.id)}
          emptyMessage={t('incidents.empty.siemLogs')}
        />
      </Panel>
    </div>
  );
};
