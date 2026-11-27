import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAppMutation, useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { useLocale } from '@core/i18n/index';
import { Badge, Button } from '@core/ui/primitives';
import { DataTable, KeyValueGrid, Panel, QueryView, StatusBanner } from '@core/ui/blocks';
import type {
  DbMigrationRiskLevel,
  DbPostMigrationVerificationReport,
  DbPreflightFinding,
} from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { dbKeys } from '../../sections/database/database-keys';

const col = createColumnHelper<DbPreflightFinding>();

const RISK_TONE: Record<DbMigrationRiskLevel, 'ok' | 'warn' | 'crit'> = {
  LOW: 'ok',
  MEDIUM: 'warn',
  HIGH: 'warn',
  CRITICAL: 'crit',
};

export function MigrationPreflightPanel() {
  const { t } = useLocale();
  const f = useFormat();
  const preflight = useLiveQuery(
    dbKeys.migrationPreflight(),
    () => databaseApi.migrationPreflight(),
    { tier: 'slow' },
  );

  const verify = useAppMutation<void, DbPostMigrationVerificationReport>({
    mutationFn: () => databaseApi.verifyMigrations(),
    success: false,
    error: t('db.migrations.preflight.verifyFail'),
    onSuccess: (res) => {
      if (res.passed) {
        toast.success(
          t('db.migrations.preflight.verifyOk', { duration: f.duration(res.durationMs) }),
        );
      } else {
        toast.error(t('db.migrations.preflight.verifyFail'));
      }
    },
  });

  const columns = useMemo(
    () => [
      col.accessor('severity', {
        header: t('db.migrations.preflight.colSeverity'),
        cell: (c) => (
          <Badge
            tone={c.getValue() === 'error' ? 'crit' : c.getValue() === 'warning' ? 'warn' : 'ok'}
            size="xs"
          >
            {c.getValue().toUpperCase()}
          </Badge>
        ),
        meta: { width: '90px' },
      }),
      col.accessor('category', {
        header: t('db.migrations.preflight.colCategory'),
        meta: { mono: true, width: '130px' },
      }),
      col.accessor('migrationName', {
        header: t('db.migrations.preflight.colMigration'),
        meta: { mono: true, truncate: true, width: '240px' },
      }),
      col.accessor('message', {
        header: t('db.migrations.preflight.colMessage'),
        meta: { truncate: true },
      }),
    ],
    [t],
  );

  const d = preflight.data;

  return (
    <Panel
      className="mb-4"
      title={t('db.migrations.preflight.title')}
      hint={t('db.migrations.preflight.hint')}
      actions={
        <div className="flex items-center gap-2">
          {d && (
            <Badge tone={d.report.passed ? 'ok' : 'crit'}>
              {d.report.passed
                ? t('db.migrations.preflight.passed')
                : t('db.migrations.preflight.failed')}
            </Badge>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() => void preflight.refetch()}
            disabled={preflight.isFetching}
          >
            <RefreshCw />
            {t('db.migrations.preflight.rerun')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
          >
            <CheckCircle2 />
            {t('db.migrations.preflight.verifyPost')}
          </Button>
        </div>
      }
    >
      <QueryView query={preflight} compact>
        {(data) => (
          <div className="flex flex-col gap-3">
            {!data.backupReadiness.satisfied && (
              <StatusBanner
                tone="warn"
                title={data.backupReadiness.reason}
                actions={<ShieldAlert className="h-4 w-4" />}
              />
            )}
            <KeyValueGrid
              columns={3}
              items={[
                {
                  label: t('db.migrations.preflight.risk'),
                  value: (
                    <Badge tone={RISK_TONE[data.report.overallRiskLevel]} size="xs">
                      {data.report.overallRiskLevel}
                    </Badge>
                  ),
                },
                {
                  label: t('db.migrations.preflight.backupGate'),
                  value: data.backupReadiness.reason,
                },
                {
                  label: t('db.migrations.status'),
                  value: t('db.migrations.preflight.errorsWarnings', {
                    errors: data.report.errorCount,
                    warnings: data.report.warningCount,
                  }),
                  mono: true,
                },
              ]}
            />
            <DataTable
              data={data.report.findings}
              columns={columns}
              getRowId={(r) => `${r.migrationName}-${r.code}-${r.message}`}
              maxHeight={240}
              emptyMessage={t('db.migrations.preflight.emptyFindings')}
            />
          </div>
        )}
      </QueryView>
    </Panel>
  );
}
