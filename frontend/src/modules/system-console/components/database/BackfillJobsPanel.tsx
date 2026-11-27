import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Play, Square, TestTube2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, Panel, QueryView } from '@core/ui/blocks';
import type { DbBackfillJob } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { dbKeys } from '../../sections/database/database-keys';

const jobCol = createColumnHelper<DbBackfillJob>();

const JOB_TONE: Record<DbBackfillJob['status'], 'ok' | 'warn' | 'crit' | 'unknown'> = {
  COMPLETED: 'ok',
  QUEUED: 'warn',
  RUNNING: 'warn',
  FAILED: 'crit',
  CANCELLED: 'unknown',
};

export function BackfillJobsPanel() {
  const { t } = useLocale();
  const q = useLiveQuery(dbKeys.backfills(), () => databaseApi.backfills(), { tier: 'slow' });

  const runJob = useAppMutation<
    { jobName: string; dryRun?: boolean },
    { job: DbBackfillJob; executionMode: 'queue' | 'inline' }
  >({
    mutationFn: (payload) => databaseApi.runBackfill(payload),
    invalidate: [dbKeys.backfills()],
    success: false,
    error: t('db.action.failed'),
    onSuccess: (res) => {
      toast.success(t('db.migrations.backfill.queuedOk', { code: res.job.jobCode }));
    },
  });

  const cancelJob = useAppMutation<number, DbBackfillJob>({
    mutationFn: (id) => databaseApi.cancelBackfill(id),
    invalidate: [dbKeys.backfills()],
    success: false,
    error: t('db.action.failed'),
    onSuccess: (res) => {
      toast.success(t('db.migrations.backfill.cancelOk', { code: res.jobCode }));
    },
  });

  const columns = useMemo(
    () => [
      jobCol.accessor('jobName', {
        header: t('db.migrations.backfill.colJob'),
        cell: (c) => {
          const j = c.row.original;
          return `${j.jobName}${j.dryRun ? ' [DRY]' : ''}`;
        },
        meta: { mono: true, truncate: true },
      }),
      jobCol.accessor('status', {
        header: t('db.migrations.backfill.colStatus'),
        cell: (c) => (
          <Badge tone={JOB_TONE[c.getValue()]} size="xs">
            {c.getValue()}
          </Badge>
        ),
        meta: { width: '110px' },
      }),
      jobCol.display({
        id: 'progress',
        header: t('db.migrations.backfill.colProgress'),
        cell: (c) => {
          const j = c.row.original;
          return `${j.processedRows}/${j.totalRows ?? '?'} (${j.percent}%)`;
        },
        meta: { align: 'right', mono: true, width: '140px' },
      }),
      jobCol.accessor('lastCursor', {
        header: t('db.migrations.backfill.colCursor'),
        cell: (c) => c.getValue() ?? NO_VALUE,
        meta: { mono: true, width: '100px' },
      }),
      jobCol.accessor('triggeredBy', {
        header: t('db.migrations.backfill.colBy'),
        meta: { mono: true, width: '110px' },
      }),
      jobCol.display({
        id: 'actions',
        header: t('db.migrations.backfill.colActions'),
        cell: (c) => {
          const j = c.row.original;
          const active = j.status === 'QUEUED' || j.status === 'RUNNING';
          if (!active) return NO_VALUE;
          return (
            <Button
              size="xs"
              variant="outline"
              disabled={cancelJob.isPending || j.cancelRequested}
              onClick={() => cancelJob.mutate(j.id)}
            >
              <Square />
              {t('db.migrations.backfill.cancel')}
            </Button>
          );
        },
        meta: { align: 'right', width: '110px' },
      }),
    ],
    [t, cancelJob],
  );

  return (
    <Panel
      className="mt-4"
      title={t('db.migrations.backfill.title')}
      hint={t('db.migrations.backfill.hint')}
    >
      <QueryView query={q} compact>
        {(data) => (
          <div className="flex flex-col gap-3">
            {data.definitions.length === 0 ? (
              <p className="text-xs text-muted">{t('db.migrations.backfill.emptyDefs')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.definitions.map((def) => (
                  <div
                    key={def.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-fg">{def.name}</div>
                      <div className="text-muted">{def.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={runJob.isPending}
                        onClick={() => runJob.mutate({ jobName: def.name, dryRun: true })}
                      >
                        <TestTube2 />
                        {t('db.migrations.backfill.runDry')}
                      </Button>
                      <Button
                        size="xs"
                        disabled={runJob.isPending}
                        onClick={() => runJob.mutate({ jobName: def.name, dryRun: false })}
                      >
                        <Play />
                        {t('db.migrations.backfill.runLive')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <DataTable
              data={data.jobs}
              columns={columns}
              getRowId={(j) => String(j.id)}
              maxHeight={240}
              emptyMessage={t('db.migrations.backfill.emptyJobs')}
            />
          </div>
        )}
      </QueryView>
    </Panel>
  );
}
