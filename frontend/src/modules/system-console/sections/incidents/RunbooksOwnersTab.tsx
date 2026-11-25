import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge } from '@core/ui/primitives';
import { DataTable, Panel } from '@core/ui/blocks';
import { INCIDENT_SEVERITY_TONE } from '../../constants/incidents';
import { incidentsApi } from '../../services/incidents.api';
import type { AlertOwnerMappingDto, IncidentRunbookDto } from '../../types/incidents.types';

const ownerCol = createColumnHelper<AlertOwnerMappingDto>();
const rbCol = createColumnHelper<IncidentRunbookDto>();

export const RunbooksOwnersTab: React.FC = () => {
  const { t } = useLocale();

  const owners = useLiveQuery(['console', 'incidents', 'owners'], () => incidentsApi.listOwners(), {
    tier: 'slow',
  });
  const runbooks = useLiveQuery(
    ['console', 'incidents', 'runbooks'],
    () => incidentsApi.listRunbooks(),
    { tier: 'slow' },
  );

  const ownerColumns = useMemo(
    () => [
      ownerCol.accessor('alertCode', {
        header: t('incidents.col.alertCode'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      ownerCol.accessor('alertName', { header: t('incidents.col.alertName') }),
      ownerCol.accessor('source', { header: t('incidents.col.source') }),
      ownerCol.accessor('defaultSeverity', {
        header: t('incidents.col.severity'),
        cell: (c) => (
          <Badge tone={INCIDENT_SEVERITY_TONE[c.getValue()]}>
            {t(`incidents.severity.${c.getValue()}`)}
          </Badge>
        ),
      }),
      ownerCol.accessor('ownerUserId', {
        header: t('incidents.col.owner'),
        cell: (c) => <span className="font-mono text-xs">User #{c.getValue()}</span>,
      }),
    ],
    [t],
  );

  const runbookColumns = useMemo(
    () => [
      rbCol.accessor('code', {
        header: t('incidents.col.code'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      rbCol.accessor('title', { header: t('incidents.col.runbook') }),
      rbCol.accessor('alertCode', {
        header: t('incidents.col.alertCode'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue() ?? '-'}</span>,
      }),
      rbCol.accessor('defaultSeverity', {
        header: t('incidents.col.severity'),
        cell: (c) => (
          <Badge tone={INCIDENT_SEVERITY_TONE[c.getValue()]}>
            {t(`incidents.severity.${c.getValue()}`)}
          </Badge>
        ),
      }),
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <Panel title={t('incidents.col.owner')}>
        <DataTable
          data={owners.data?.data ?? []}
          columns={ownerColumns}
          getRowId={(r) => String(r.id)}
          emptyMessage={t('incidents.empty.owners')}
        />
      </Panel>
      <Panel title={t('incidents.col.runbook')}>
        <DataTable
          data={runbooks.data?.data ?? []}
          columns={runbookColumns}
          getRowId={(r) => String(r.id)}
          emptyMessage={t('incidents.empty.runbooks')}
        />
      </Panel>
    </div>
  );
};
