import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable, Panel, QueryView, RelativeTime } from '@core/ui/blocks';
import type { DbMigrationRolloutHistory } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { dbKeys } from '../../sections/database/database-keys';

const col = createColumnHelper<DbMigrationRolloutHistory>();

const STATUS_TONE: Record<DbMigrationRolloutHistory['status'], 'ok' | 'warn' | 'crit' | 'unknown'> = {
  SUCCESS: 'ok',
  NO_OP: 'ok',
  RUNNING: 'warn',
  POST_CHECK_FAILED: 'crit',
  FAILED: 'crit',
};

export function MigrationHistoryPanel() {
  const { t } = useLocale();
  const f = useFormat();
  const q = useLiveQuery(dbKeys.migrationHistory(), () => databaseApi.migrationHistory(20), {
    tier: 'slow',
  });

  const columns = useMemo(
    () => [
      col.accessor('rolloutCode', {
        header: t('db.migrations.history.colCode'),
        meta: { mono: true, truncate: true, width: '160px' },
      }),
      col.accessor('releaseVersion', {
        header: t('db.migrations.history.colRelease'),
        meta: { mono: true, width: '110px' },
      }),
      col.accessor('environment', {
        header: t('db.migrations.history.colEnv'),
        meta: { mono: true, width: '100px' },
      }),
      col.accessor('riskLevel', {
        header: t('db.migrations.history.colRisk'),
        cell: (c) => (
          <Badge
            tone={c.getValue() === 'LOW' ? 'ok' : c.getValue() === 'CRITICAL' ? 'crit' : 'warn'}
            size="xs"
          >
            {c.getValue()}
          </Badge>
        ),
        meta: { width: '90px' },
      }),
      col.accessor('approvedBy', {
        header: t('db.migrations.history.colApprover'),
        cell: (c) => c.getValue() ?? NO_VALUE,
        meta: { mono: true, width: '120px' },
      }),
      col.accessor('backupCode', {
        header: t('db.migrations.history.colBackup'),
        cell: (c) => {
          const r = c.row.original;
          if (!r.backupCode) return NO_VALUE;
          return r.backupVerified ? `${r.backupCode} ✓` : r.backupCode;
        },
        meta: { mono: true, truncate: true, width: '140px' },
      }),
      col.display({
        id: 'duration',
        header: t('db.migrations.history.colDuration'),
        cell: (c) => {
          const r = c.row.original;
          const lockMs = r.maxMigrationDurationMs !== null ? f.duration(r.maxMigrationDurationMs) : NO_VALUE;
          return `${lockMs} / ${f.duration(r.durationMs)}`;
        },
        meta: { align: 'right', mono: true, width: '140px' },
      }),
      col.accessor('status', {
        header: t('db.migrations.history.colStatus'),
        cell: (c) => (
          <Badge tone={STATUS_TONE[c.getValue()]} size="xs">
            {c.getValue()}
          </Badge>
        ),
        meta: { width: '130px' },
      }),
      col.accessor('startedAt', {
        header: t('db.migrations.history.colTime'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
        meta: { align: 'right', width: '120px' },
      }),
    ],
    [t, f],
  );

  return (
    <Panel
      className="mt-4"
      title={t('db.migrations.history.title')}
      hint={t('db.migrations.history.hint')}
      flush
    >
      <QueryView query={q}>
        {(rows) => (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => String(r.id)}
            maxHeight={280}
            emptyMessage={t('db.migrations.history.empty')}
          />
        )}
      </QueryView>
    </Panel>
  );
}
