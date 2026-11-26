import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage } from '@core/data';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@core/ui/primitives';
import { useConsoleData } from '../../context/console-data-context';
import { backupsApi } from '../../services/backups.api';
import type { BackupRecordDto, RestoreScope } from '../../types/backups.types';

interface RestoreActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record?: BackupRecordDto | null;
  restoreExecutionEnabled?: boolean;
}

export const RestoreActionDialog: React.FC<RestoreActionDialogProps> = ({
  open,
  onOpenChange,
  record,
  restoreExecutionEnabled = false,
}) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const [actorName, setActorName] = useState('ops-admin');
  const [scope, setScope] = useState<RestoreScope>(
    record?.targetType === 'STORAGE' ? 'STORAGE' : 'DATABASE',
  );
  const [targetEnvironment, setTargetEnvironment] = useState('staging');
  const [mode, setMode] = useState<'RECORD_MANUAL' | 'EXECUTE_LIVE'>('RECORD_MANUAL');
  const [reason, setReason] = useState('');
  const [confirmWord, setConfirmWord] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      backupsApi.recordOrExecuteRestore({
        backupRecordId: record?.id ?? null,
        mode,
        scope,
        targetEnvironment,
        actorName: actorName.trim(),
        reason: reason.trim(),
        ...(mode === 'EXECUTE_LIVE' ? { confirm: confirmWord.trim() } : {}),
      }),
    onSuccess: (res) => {
      addToast({
        type: 'success',
        title: t('backups.toast.restoreSaved', { code: res.restoreCode }),
      });
      setReason('');
      setConfirmWord('');
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['console', 'backups'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const canSubmit =
    actorName.trim().length >= 2 &&
    targetEnvironment.trim().length >= 2 &&
    reason.trim().length >= 5 &&
    (mode === 'RECORD_MANUAL' || confirmWord.trim() === 'RESTORE') &&
    !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('backups.restores.modalTitle')}
            {record ? ` · ${record.backupCode}` : ''}
          </DialogTitle>
          <DialogDescription>{t('backups.restores.modalDesc')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-2">
              {t('backups.restores.actorLabel')}
            </label>
            <Input value={actorName} onChange={(e) => setActorName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-2">
                {t('backups.restores.scopeLabel')}
              </label>
              <Select value={scope} onValueChange={(v) => setScope(v as RestoreScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DATABASE">DATABASE</SelectItem>
                  <SelectItem value="STORAGE">STORAGE</SelectItem>
                  <SelectItem value="SECRETS_CONFIG">SECRETS_CONFIG</SelectItem>
                  <SelectItem value="FULL">FULL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-2">
                {t('backups.restores.envLabel')}
              </label>
              <Input
                value={targetEnvironment}
                onChange={(e) => setTargetEnvironment(e.target.value)}
              />
            </div>
          </div>

          {record && restoreExecutionEnabled && (
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-2">
                {t('backups.restores.modeLabel')}
              </label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as 'RECORD_MANUAL' | 'EXECUTE_LIVE')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECORD_MANUAL">{t('backups.restores.modeRecord')}</SelectItem>
                  <SelectItem value="EXECUTE_LIVE">{t('backups.restores.modeExecute')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-2">
              {t('backups.restores.reasonLabel')}
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Incident #42 database point-in-time recovery"
            />
          </div>

          {mode === 'EXECUTE_LIVE' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-crit-fg">
                Type RESTORE to confirm live overwrite
              </label>
              <Input
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="RESTORE"
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('ui.action.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => mut.mutate()}>
            {t('backups.actions.restore')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
