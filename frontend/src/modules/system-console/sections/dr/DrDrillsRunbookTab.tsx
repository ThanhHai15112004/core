import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { CodeBlock, DataTable, Panel, QueryView, RelativeTime, StatusBanner } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { DR_LIST_LIMIT, DR_STATUS_TONE } from '../../constants/dr';
import { drApi } from '../../services/dr.api';
import type { DrDrillDto } from '../../types/dr.types';

const col = createColumnHelper<DrDrillDto>();

export const DrDrillsRunbookTab: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const drillsQ = useLiveQuery(
    ['console', 'dr', 'drills'],
    () => drApi.listDrills(1, DR_LIST_LIMIT),
    { tier: 'live' },
  );

  const runbookQ = useLiveQuery(['console', 'dr', 'runbook'], () => drApi.runbook(), {
    tier: 'slow',
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

  const columns = useMemo(
    () => [
      col.accessor('drillCode', {
        header: t('dr.drills.code'),
        cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue()}</span>,
      }),
      col.accessor('drillType', {
        header: t('dr.drills.type'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      col.accessor('scenario', { header: t('dr.drills.scenario') }),
      col.accessor('measuredRpoSeconds', {
        header: t('dr.drills.measuredRpo'),
        cell: (c) =>
          c.getValue() !== null ? (
            <Badge tone={c.row.original.rpoMet ? 'ok' : 'crit'}>
              {`${c.getValue()}s / ${c.row.original.rpoTargetSeconds}s`}
            </Badge>
          ) : (
            NO_VALUE
          ),
      }),
      col.accessor('measuredRtoSeconds', {
        header: t('dr.drills.measuredRto'),
        cell: (c) =>
          c.getValue() !== null ? (
            <Badge tone={c.row.original.rtoMet ? 'ok' : 'crit'}>
              {`${c.getValue()}s / ${c.row.original.rtoTargetSeconds}s`}
            </Badge>
          ) : (
            NO_VALUE
          ),
      }),
      col.accessor('status', {
        header: t('dr.drills.status'),
        cell: (c) => (
          <Badge tone={DR_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      col.accessor('startedAt', {
        header: t('dr.drills.when'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={t('dr.drills.title')}
        actions={
          <Button
            size="xs"
            variant="outline"
            disabled={drillMut.isPending}
            onClick={() => drillMut.mutate()}
          >
            <Play />
            {t('dr.actions.runDrill')}
          </Button>
        }
      >
        <QueryView query={drillsQ}>
          {(page) => (
            <DataTable
              columns={columns}
              data={page.data}
              getRowId={(r) => String(r.id)}
            />
          )}
        </QueryView>
      </Panel>

      <QueryView query={runbookQ}>
        {(rb) => (
          <div className="flex flex-col gap-4">
            <StatusBanner tone="info" title={t('dr.drills.runbookTitle')} />
            {rb.sections.map((sec) => (
              <Panel key={sec.id} title={sec.title} hint={sec.summary}>
                <div className="flex flex-col gap-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-muted">
                    {t('dr.drills.steps')}
                  </div>
                  <ol className="list-decimal space-y-1 pl-5 text-fg-2">
                    {sec.steps.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ol>
                  {sec.commands && sec.commands.length > 0 && (
                    <CodeBlock code={sec.commands.join('\n')} />
                  )}
                </div>
              </Panel>
            ))}
            <Panel title={t('dr.drills.antiSplitBrainTitle')}>
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
                {rb.antiSplitBrainRules.map((rule, idx) => (
                  <li key={idx}>{rule}</li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </QueryView>
    </div>
  );
};
