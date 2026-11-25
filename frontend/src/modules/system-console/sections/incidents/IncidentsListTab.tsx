import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { DataTable, Panel, RelativeTime } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_TONE,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_TONE,
} from '../../constants/incidents';
import { incidentsApi } from '../../services/incidents.api';
import type { IncidentDto } from '../../types/incidents.types';
import { IncidentDetailSheet } from './IncidentDetailSheet';

const col = createColumnHelper<IncidentDto>();
const ALL_VALUE = '__all__';

export const IncidentsListTab: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const [status, setStatus] = useState<string>(ALL_VALUE);
  const [severity, setSeverity] = useState<string>(ALL_VALUE);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const query = useLiveQuery(
    ['console', 'incidents', 'list', status, severity],
    () =>
      incidentsApi.listIncidents({
        limit: 50,
        status: status === ALL_VALUE ? undefined : status,
        severity: severity === ALL_VALUE ? undefined : severity,
      }),
    { tier: 'live' },
  );

  const ackMut = useMutation({
    mutationFn: (id: number) => incidentsApi.acknowledgeIncident(id),
    onSuccess: () => {
      addToast({ type: 'success', title: t('incidents.actions.ackSuccess') });
      void qc.invalidateQueries({ queryKey: ['console', 'incidents'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('incidentCode', {
        header: t('incidents.col.code'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      col.accessor('severity', {
        header: t('incidents.col.severity'),
        cell: (c) => (
          <Badge tone={INCIDENT_SEVERITY_TONE[c.getValue()]}>
            {t(`incidents.severity.${c.getValue()}`)}
          </Badge>
        ),
      }),
      col.accessor('status', {
        header: t('incidents.col.status'),
        cell: (c) => (
          <Badge tone={INCIDENT_STATUS_TONE[c.getValue()]}>
            {t(`incidents.status.${c.getValue()}`)}
          </Badge>
        ),
      }),
      col.accessor('title', { header: t('incidents.col.title') }),
      col.accessor('ownerUserId', {
        header: t('incidents.col.owner'),
        cell: (c) => <span className="font-mono text-xs">#{c.getValue()}</span>,
      }),
      col.accessor('occurrenceCount', {
        header: t('incidents.col.occurrences'),
        cell: (c) => (
          <Badge tone={c.getValue() > 1 ? 'warn' : 'unknown'}>×{c.getValue()}</Badge>
        ),
      }),
      col.accessor('lastSeenAt', {
        header: t('incidents.col.lastSeen'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
      col.display({
        id: 'actions',
        header: t('incidents.col.actions'),
        cell: (c) => {
          const row = c.row.original;
          return (
            <div className="flex items-center gap-1">
              {row.status === 'OPEN' && (
                <Button size="xs" variant="outline" onClick={() => ackMut.mutate(row.id)}>
                  <Check />
                  {t('incidents.actions.ack')}
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => setSelectedId(row.id)}>
                <Eye />
                {t('incidents.actions.view')}
              </Button>
            </div>
          );
        },
      }),
    ],
    [t, ackMut],
  );

  return (
    <>
      <Panel
        title={t('incidents.tab.incidents')}
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('incidents.actions.allStatuses')}</SelectItem>
                {INCIDENT_STATUSES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {t(`incidents.status.${st}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{t('incidents.actions.allSeverities')}</SelectItem>
                {INCIDENT_SEVERITIES.map((sev) => (
                  <SelectItem key={sev} value={sev}>
                    {t(`incidents.severity.${sev}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <DataTable
          data={query.data?.data ?? []}
          columns={columns}
          getRowId={(r) => String(r.id)}
          emptyMessage={t('incidents.empty.incidents')}
        />
      </Panel>

      <IncidentDetailSheet incidentId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
};
