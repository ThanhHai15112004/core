import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { DataTable, Panel, RelativeTime } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import {
  ALERT_EVENT_STATUSES,
  ALERT_SEVERITIES,
  EVENT_STATUS_TONE_MAP,
  SEVERITY_TONE_MAP,
} from '../../constants/metrics-alerts';
import { metricsAlertsApi } from '../../services/metrics-alerts.api';
import type { AlertEventDto } from '../../types/metrics-alerts.types';

const col = createColumnHelper<AlertEventDto>();
const ALL_VALUE = '__all__';

export const AlertEventsTab: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>(ALL_VALUE);
  const [severity, setSeverity] = useState<string>(ALL_VALUE);

  const queryKey = ['console', 'metrics-alerts', 'events', status, severity] as const;
  const query = useLiveQuery(
    queryKey,
    () =>
      metricsAlertsApi.listEvents({
        limit: 50,
        status: status === ALL_VALUE ? undefined : status,
        severity: severity === ALL_VALUE ? undefined : severity,
      }),
    { tier: 'live' },
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['console', 'metrics-alerts'] });

  const ackMut = useMutation({
    mutationFn: (id: number) => metricsAlertsApi.acknowledgeEvent(id),
    onSuccess: () => {
      addToast({ type: 'success', title: t('metricsAlerts.events.ackSuccess') });
      invalidate();
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const resolveMut = useMutation({
    mutationFn: (id: number) => metricsAlertsApi.resolveEvent(id),
    onSuccess: () => {
      addToast({ type: 'success', title: t('metricsAlerts.events.resolveSuccess') });
      invalidate();
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('firedAt', {
        header: t('metricsAlerts.col.firedAt'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
      col.accessor('severity', {
        header: t('metricsAlerts.col.severity'),
        cell: (c) => <Badge tone={SEVERITY_TONE_MAP[c.getValue()]}>{t(`metricsAlerts.severity.${c.getValue()}`)}</Badge>,
      }),
      col.accessor('status', {
        header: t('metricsAlerts.col.status'),
        cell: (c) => <Badge tone={EVENT_STATUS_TONE_MAP[c.getValue()]}>{t(`metricsAlerts.status.${c.getValue()}`)}</Badge>,
      }),
      col.accessor('summary', { header: t('metricsAlerts.col.summary') }),
      col.display({
        id: 'val',
        header: t('metricsAlerts.col.value'),
        cell: (c) => `${c.row.original.metricValue} (${c.row.original.operator} ${c.row.original.threshold})`,
      }),
      col.display({
        id: 'channels',
        header: t('metricsAlerts.col.channels'),
        cell: (c) =>
          c.row.original.deliveryStatus
            .filter((d) => d.status === 'sent')
            .map((d) => d.channel)
            .join(', '),
      }),
      col.display({
        id: 'actions',
        header: t('metricsAlerts.col.actions'),
        cell: (c) => {
          const r = c.row.original;
          if (r.status === 'RESOLVED') return null;
          return (
            <div className="flex items-center gap-1">
              {r.status === 'FIRING' && (
                <Button size="xs" variant="outline" onClick={() => ackMut.mutate(r.id)}>
                  <Check />
                  {t('metricsAlerts.events.ack')}
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => resolveMut.mutate(r.id)}>
                <CheckCheck />
                {t('metricsAlerts.events.resolve')}
              </Button>
            </div>
          );
        },
      }),
    ],
    [t, ackMut, resolveMut],
  );

  return (
    <Panel
      title={t('metricsAlerts.tab.events')}
      actions={
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('metricsAlerts.events.allStatuses')}</SelectItem>
              {ALERT_EVENT_STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {t(`metricsAlerts.status.${st}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{t('metricsAlerts.events.allSeverities')}</SelectItem>
              {ALERT_SEVERITIES.map((sev) => (
                <SelectItem key={sev} value={sev}>
                  {t(`metricsAlerts.severity.${sev}`)}
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
        emptyMessage={t('metricsAlerts.events.empty')}
      />
    </Panel>
  );
};
