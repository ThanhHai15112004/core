import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitCompare, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, Panel, QueryView, RelativeTime } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { DR_LIST_LIMIT, DR_STATUS_TONE } from '../../constants/dr';
import { drApi } from '../../services/dr.api';
import type { DrReconciliationReportDto, DrSyncRunDto } from '../../types/dr.types';

const syncCol = createColumnHelper<DrSyncRunDto>();
const recCol = createColumnHelper<DrReconciliationReportDto>();

export const DrSyncReconcileTab: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const syncQ = useLiveQuery(
    ['console', 'dr', 'sync-runs'],
    () => drApi.listSyncRuns(1, DR_LIST_LIMIT),
    { tier: 'live' },
  );

  const recQ = useLiveQuery(
    ['console', 'dr', 'reconciliations'],
    () => drApi.listReconciliations(1, DR_LIST_LIMIT),
    { tier: 'live' },
  );

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

  const recMut = useMutation({
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

  const syncColumns = useMemo(
    () => [
      syncCol.accessor('syncCode', {
        header: t('dr.sync.code'),
        cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue()}</span>,
      }),
      syncCol.accessor('scope', {
        header: t('dr.sync.scope'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      syncCol.accessor('dbLagSeconds', {
        header: t('dr.sync.dbLag'),
        cell: (c) => (c.getValue() !== null ? `${c.getValue()}s` : NO_VALUE),
      }),
      syncCol.display({
        id: 'storageStats',
        header: t('dr.sync.storageStats'),
        cell: (c) =>
          t('dr.sync.storageCount', {
            synced: c.row.original.storageSyncedCount,
            skipped: c.row.original.storageSkippedCount,
          }),
      }),
      syncCol.accessor('actualRpoSeconds', {
        header: t('dr.sync.actualRpo'),
        cell: (c) => {
          const val = c.getValue();
          if (val === null) return NO_VALUE;
          return (
            <Badge tone={c.row.original.rpoMet ? 'ok' : 'crit'}>
              {`${val}s / ${c.row.original.rpoTargetSeconds}s`}
            </Badge>
          );
        },
      }),
      syncCol.accessor('status', {
        header: t('dr.sync.status'),
        cell: (c) => (
          <Badge tone={DR_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      syncCol.accessor('startedAt', {
        header: t('dr.sync.when'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
    ],
    [t],
  );

  const recColumns = useMemo(
    () => [
      recCol.accessor('reportCode', {
        header: t('dr.reconcile.code'),
        cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue()}</span>,
      }),
      recCol.accessor('scope', {
        header: t('dr.reconcile.scope'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      recCol.accessor('dbTablesChecked', { header: t('dr.reconcile.dbChecked') }),
      recCol.accessor('storageObjectsChecked', { header: t('dr.reconcile.storageChecked') }),
      recCol.accessor('totalDiscrepancies', {
        header: t('dr.reconcile.discrepancies'),
        cell: (c) => (
          <Badge tone={c.getValue() === 0 ? 'ok' : 'warn'}>{String(c.getValue())}</Badge>
        ),
      }),
      recCol.accessor('status', {
        header: t('dr.reconcile.status'),
        cell: (c) => (
          <Badge tone={DR_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      recCol.accessor('startedAt', {
        header: t('dr.reconcile.when'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={t('dr.sync.title')}
        actions={
          <Button
            size="xs"
            variant="outline"
            disabled={syncMut.isPending}
            onClick={() => syncMut.mutate()}
          >
            <RefreshCw />
            {t('dr.actions.syncNow')}
          </Button>
        }
      >
        <QueryView query={syncQ}>
          {(page) => (
            <DataTable
              columns={syncColumns}
              data={page.data}
              getRowId={(r) => String(r.id)}
            />
          )}
        </QueryView>
      </Panel>

      <Panel
        title={t('dr.reconcile.title')}
        actions={
          <Button
            size="xs"
            variant="outline"
            disabled={recMut.isPending}
            onClick={() => recMut.mutate()}
          >
            <GitCompare />
            {t('dr.actions.reconcileNow')}
          </Button>
        }
      >
        <QueryView query={recQ}>
          {(page) => (
            <DataTable
              columns={recColumns}
              data={page.data}
              getRowId={(r) => String(r.id)}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  );
};
