import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { ConfirmDialog, DataTable, KeyValueGrid, Panel, RelativeTime, StatusBanner } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { BACKUP_STATUS_TONE } from '../../constants/backups';
import { backupsApi } from '../../services/backups.api';
import type { BackupOverviewDto, BackupPolicyDto } from '../../types/backups.types';

const col = createColumnHelper<BackupPolicyDto>();

export const BackupsOverviewTab: React.FC<{ overview: BackupOverviewDto | undefined }> = ({
  overview,
}) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const [confirmVersioning, setConfirmVersioning] = useState(false);

  const togglePolicyMut = useMutation({
    mutationFn: (p: BackupPolicyDto) => backupsApi.updatePolicy(p.id, { isEnabled: !p.isEnabled }),
    onSuccess: () => {
      addToast({ type: 'success', title: t('backups.toast.policyUpdated') });
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const versioningMut = useMutation({
    mutationFn: () => backupsApi.enableStorageVersioning(),
    onSuccess: () => {
      addToast({ type: 'success', title: t('backups.toast.versioningEnabled') });
      setConfirmVersioning(false);
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('backups.policies.code'),
        cell: (c) => (
          <div>
            <div className="font-mono text-xs font-medium">{c.getValue()}</div>
            <div className="text-xs text-muted">{c.row.original.name}</div>
          </div>
        ),
      }),
      col.accessor('targetType', {
        header: t('backups.policies.target'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      col.accessor('scheduleCron', {
        header: t('backups.policies.cron'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      col.display({
        id: 'retention',
        header: t('backups.policies.retention'),
        cell: (c) =>
          t('backups.policies.retentionVal', {
            days: c.row.original.retentionDays,
            count: c.row.original.maxKeepCount,
          }),
      }),
      col.display({
        id: 'security',
        header: t('backups.policies.security'),
        cell: (c) => (
          <div className="flex flex-wrap gap-1">
            {c.row.original.encryptionEnabled && (
              <Badge tone="ok" size="xs">
                {t('backups.policies.encrypted')}
              </Badge>
            )}
            {c.row.original.autoVerifyDrill && (
              <Badge tone="info" size="xs">
                {t('backups.policies.autoDrill')}
              </Badge>
            )}
          </div>
        ),
      }),
      col.accessor('lastRunAt', {
        header: t('backups.policies.lastRun'),
        cell: (c) => (c.getValue() ? <RelativeTime value={c.getValue()!} /> : NO_VALUE),
      }),
      col.display({
        id: 'actions',
        header: t('backups.policies.status'),
        cell: (c) => {
          const p = c.row.original;
          return (
            <div className="flex items-center gap-2">
              <Badge tone={p.isEnabled ? 'ok' : 'unknown'}>
                {p.isEnabled ? 'ON' : 'OFF'}
              </Badge>
              <Button
                size="xs"
                variant="outline"
                disabled={togglePolicyMut.isPending}
                onClick={() => togglePolicyMut.mutate(p)}
              >
                {p.isEnabled ? t('backups.actions.toggleOff') : t('backups.actions.toggleOn')}
              </Button>
            </div>
          );
        },
      }),
    ],
    [t, togglePolicyMut],
  );

  const v = overview?.storageVersioning;

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('backups.policies.title')}>
        <DataTable columns={columns} data={overview?.policies ?? []} getRowId={(r) => String(r.id)} />
      </Panel>

      <Panel
        title={t('backups.versioning.title')}
        actions={
          v?.supported && v.status !== 'enabled' ? (
            <Button size="xs" variant="outline" onClick={() => setConfirmVersioning(true)}>
              <ShieldCheck />
              {t('backups.actions.enableVersioning')}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          {v && !v.supported && <StatusBanner tone="info" title={t('backups.versioning.unsupportedHint')} />}
          <KeyValueGrid
            items={[
              { label: t('backups.versioning.driver'), value: v?.driver ?? NO_VALUE },
              { label: t('backups.versioning.bucket'), value: v?.bucket ?? NO_VALUE },
              {
                label: t('backups.versioning.status'),
                value: v ? (
                  <Badge tone={BACKUP_STATUS_TONE[v.status] ?? 'unknown'}>{v.status}</Badge>
                ) : (
                  NO_VALUE
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmVersioning}
        onOpenChange={setConfirmVersioning}
        title={t('backups.versioning.confirmTitle')}
        description={t('backups.versioning.confirmDesc')}
        confirmLabel={t('backups.actions.enableVersioning')}
        typeToConfirm="ENABLE_VERSIONING"
        loading={versioningMut.isPending}
        onConfirm={() => versioningMut.mutate()}
      />
    </div>
  );
};
