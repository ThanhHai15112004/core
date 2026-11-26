import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, Panel, QueryView, RelativeTime } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { BACKUP_STATUS_TONE } from '../../constants/backups';
import { backupsApi } from '../../services/backups.api';
import type { BackupRecordDto } from '../../types/backups.types';
import { RestoreActionDialog } from './RestoreActionDialog';

const col = createColumnHelper<BackupRecordDto>();

export const BackupsRecordsTab: React.FC<{ restoreExecutionEnabled?: boolean }> = ({
  restoreExecutionEnabled = false,
}) => {
  const { t } = useLocale();
  const f = useFormat();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<BackupRecordDto | null>(null);

  const recordsQ = useLiveQuery(
    ['console', 'backups', 'records'],
    () => backupsApi.listRecords({ page: 1, limit: 30 }),
    { tier: 'live' },
  );

  const verifyMut = useMutation({
    mutationFn: (id: number) => backupsApi.verifyRecord(id, 'Manual verify drill from Console'),
    onSuccess: (res) => {
      addToast({
        type: res.passed ? 'success' : 'warning',
        title: t(res.passed ? 'backups.toast.verifyPassed' : 'backups.toast.verifyFailed', {
          mode: res.verificationMode,
        }),
      });
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('backupCode', {
        header: t('backups.records.code'),
        cell: (c) => (
          <div>
            <div className="font-mono text-xs font-medium">{c.getValue()}</div>
            <div className="text-xs text-muted">{c.row.original.policyCode ?? c.row.original.triggerSource}</div>
          </div>
        ),
      }),
      col.accessor('targetType', {
        header: t('backups.records.target'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      col.accessor('status', {
        header: t('backups.records.status'),
        cell: (c) => (
          <Badge tone={BACKUP_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      col.accessor('storedSizeBytes', {
        header: t('backups.records.size'),
        cell: (c) => (c.getValue() !== null ? f.bytes(c.getValue()!) : NO_VALUE),
      }),
      col.accessor('encrypted', {
        header: t('backups.records.encryption'),
        cell: (c) => (
          <Badge tone={c.getValue() ? 'ok' : 'warn'}>
            {c.getValue() ? (c.row.original.encryptionAlgorithm ?? 'AES-256-GCM') : 'PLAIN'}
          </Badge>
        ),
      }),
      col.accessor('verifyStatus', {
        header: t('backups.records.verify'),
        cell: (c) => (
          <Badge tone={BACKUP_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      col.accessor('expiresAt', {
        header: t('backups.records.expiresAt'),
        cell: (c) => (c.getValue() ? <RelativeTime value={c.getValue()!} /> : NO_VALUE),
      }),
      col.display({
        id: 'actions',
        header: t('backups.records.actions'),
        cell: (c) => {
          const rec = c.row.original;
          if (rec.status !== 'SUCCESS') return NO_VALUE;
          return (
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="outline"
                disabled={verifyMut.isPending}
                onClick={() => verifyMut.mutate(rec.id)}
              >
                <CheckCircle2 />
                {t('backups.actions.verify')}
              </Button>
              <Button size="xs" variant="outline" onClick={() => setRestoreTarget(rec)}>
                <RotateCcw />
                {t('backups.actions.restore')}
              </Button>
            </div>
          );
        },
      }),
    ],
    [t, f, verifyMut],
  );

  return (
    <>
      <Panel title={t('backups.records.title')}>
        <QueryView query={recordsQ}>
          {(page) => <DataTable columns={columns} data={page.data} />}
        </QueryView>
      </Panel>

      {restoreTarget && (
        <RestoreActionDialog
          open={Boolean(restoreTarget)}
          onOpenChange={(o) => {
            if (!o) setRestoreTarget(null);
          }}
          record={restoreTarget}
          restoreExecutionEnabled={restoreExecutionEnabled}
        />
      )}
    </>
  );
};
