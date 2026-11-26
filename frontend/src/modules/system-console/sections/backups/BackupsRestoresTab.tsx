import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, Panel, QueryView, RelativeTime } from '@core/ui/blocks';
import { BACKUP_STATUS_TONE } from '../../constants/backups';
import { backupsApi } from '../../services/backups.api';
import type { BackupRestoreHistoryDto } from '../../types/backups.types';
import { RestoreActionDialog } from './RestoreActionDialog';

const col = createColumnHelper<BackupRestoreHistoryDto>();

export const BackupsRestoresTab: React.FC<{ restoreExecutionEnabled?: boolean }> = ({
  restoreExecutionEnabled = false,
}) => {
  const { t } = useLocale();
  const [modalOpen, setModalOpen] = useState(false);

  const query = useLiveQuery(
    ['console', 'backups', 'restores'],
    () => backupsApi.listRestores({ page: 1, limit: 30 }),
    { tier: 'live' },
  );

  const columns = useMemo(
    () => [
      col.accessor('restoreCode', {
        header: t('backups.restores.code'),
        cell: (c) => (
          <div>
            <div className="font-mono text-xs font-medium">{c.getValue()}</div>
            <div className="text-xs text-muted">{c.row.original.backupCode ?? NO_VALUE}</div>
          </div>
        ),
      }),
      col.accessor('operationType', {
        header: t('backups.restores.type'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      col.accessor('scope', { header: t('backups.restores.scope') }),
      col.accessor('targetEnvironment', {
        header: t('backups.restores.targetEnv'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      col.accessor('actorName', { header: t('backups.restores.actor') }),
      col.accessor('reason', { header: t('backups.restores.reason') }),
      col.accessor('status', {
        header: t('backups.restores.status'),
        cell: (c) => (
          <Badge tone={BACKUP_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      col.accessor('startedAt', {
        header: t('backups.restores.when'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
    ],
    [t],
  );

  return (
    <>
      <Panel
        title={t('backups.restores.title')}
        actions={
          <Button size="xs" variant="outline" onClick={() => setModalOpen(true)}>
            <Plus />
            {t('backups.actions.recordManualRestore')}
          </Button>
        }
      >
        <QueryView query={query}>
          {(page) => <DataTable columns={columns} data={page.data} />}
        </QueryView>
      </Panel>

      <RestoreActionDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        restoreExecutionEnabled={restoreExecutionEnabled}
      />
    </>
  );
};
