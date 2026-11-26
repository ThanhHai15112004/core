import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import {
  Badge,
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
import {
  ConfirmDialog,
  DataTable,
  DetailSheet,
  Panel,
  QueryView,
  RelativeTime,
  StatusBanner,
} from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { DR_LIST_LIMIT, DR_STATUS_TONE } from '../../constants/dr';
import { drApi } from '../../services/dr.api';
import type {
  DrSwitchDirection,
  DrSwitchExecutionDto,
  DrSwitchMode,
} from '../../types/dr.types';

const col = createColumnHelper<DrSwitchExecutionDto>();

export const DrSwitchoverTab: React.FC<{ liveSwitchEnabled?: boolean }> = ({
  liveSwitchEnabled = false,
}) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const [dialogDir, setDialogDir] = useState<DrSwitchDirection | null>(null);
  const [mode, setMode] = useState<DrSwitchMode>('SIMULATED');
  const [reason, setReason] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [selectedSwitch, setSelectedSwitch] = useState<DrSwitchExecutionDto | null>(null);
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);

  const switchesQ = useLiveQuery(
    ['console', 'dr', 'switches'],
    () => drApi.listSwitches(1, DR_LIST_LIMIT),
    { tier: 'live' },
  );

  const startMut = useMutation({
    mutationFn: () => {
      const payload = {
        mode,
        reason: reason.trim(),
        ...(mode === 'LIVE' ? { confirm: confirmWord.trim() } : {}),
      };
      return dialogDir === 'FAILBACK'
        ? drApi.initiateFailback(payload)
        : drApi.initiateFailover(payload);
    },
    onSuccess: (res) => {
      addToast({ type: 'success', title: t('dr.toast.switchStarted', { code: res.switchCode }) });
      setDialogDir(null);
      setReason('');
      setConfirmWord('');
      setSelectedSwitch(res);
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const stepMut = useMutation({
    mutationFn: (p: { switchId: number; stepKey: string; status: 'COMPLETED' | 'SKIPPED' }) =>
      drApi.updateChecklistStep(p.switchId, p.stepKey, { status: p.status }),
    onSuccess: (res, vars) => {
      setSelectedSwitch(res);
      addToast({ type: 'success', title: t('dr.toast.checklistUpdated', { step: vars.stepKey }) });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const completeMut = useMutation({
    mutationFn: (sw: DrSwitchExecutionDto) =>
      drApi.completeSwitch(sw.id, {
        ...(sw.mode === 'LIVE' ? { confirm: sw.direction } : {}),
      }),
    onSuccess: (res) => {
      setSelectedSwitch(res);
      setConfirmCompleteOpen(false);
      addToast({ type: 'success', title: t('dr.toast.switchCompleted', { code: res.switchCode }) });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const abortMut = useMutation({
    mutationFn: (sw: DrSwitchExecutionDto) => drApi.abortSwitch(sw.id, t('dr.switchover.abortReason')),
    onSuccess: (res) => {
      setSelectedSwitch(res);
      addToast({ type: 'warning', title: t('dr.toast.switchAborted', { code: res.switchCode }) });
      void qc.invalidateQueries({ queryKey: ['console', 'dr'] });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('switchCode', {
        header: t('dr.switchover.code'),
        cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue()}</span>,
      }),
      col.accessor('direction', {
        header: t('dr.switchover.direction'),
        cell: (c) => <Badge tone="info">{c.getValue()}</Badge>,
      }),
      col.accessor('mode', {
        header: t('dr.switchover.mode'),
        cell: (c) => <Badge tone={c.getValue() === 'LIVE' ? 'warn' : 'unknown'}>{c.getValue()}</Badge>,
      }),
      col.display({
        id: 'route',
        header: t('dr.switchover.route'),
        cell: (c) => `${c.row.original.fromSite} → ${c.row.original.toSite}`,
      }),
      col.accessor('actualRtoSeconds', {
        header: t('dr.switchover.rto'),
        cell: (c) =>
          c.getValue() !== null ? `${c.getValue()}s / ${c.row.original.rtoTargetSeconds}s` : NO_VALUE,
      }),
      col.accessor('status', {
        header: t('dr.switchover.status'),
        cell: (c) => (
          <Badge tone={DR_STATUS_TONE[c.getValue()] ?? 'unknown'}>{c.getValue()}</Badge>
        ),
      }),
      col.accessor('startedAt', {
        header: t('dr.switchover.when'),
        cell: (c) => <RelativeTime value={c.getValue()} />,
      }),
      col.display({
        id: 'actions',
        header: t('dr.switchover.actions'),
        cell: (c) => (
          <Button size="xs" variant="outline" onClick={() => setSelectedSwitch(c.row.original)}>
            <ClipboardCheck />
            {t('dr.actions.openChecklist')}
          </Button>
        ),
      }),
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      {!liveSwitchEnabled && <StatusBanner tone="info" title={t('dr.switchover.liveLockedHint')} />}

      <Panel
        title={t('dr.switchover.title')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="outline" onClick={() => setDialogDir('FAILOVER')}>
              <ArrowRightLeft />
              {t('dr.actions.startFailover')}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setDialogDir('FAILBACK')}>
              <ArrowRightLeft />
              {t('dr.actions.startFailback')}
            </Button>
          </div>
        }
      >
        <QueryView query={switchesQ}>
          {(page) => (
            <DataTable
              columns={columns}
              data={page.data}
              getRowId={(r) => String(r.id)}
            />
          )}
        </QueryView>
      </Panel>

      <Dialog open={Boolean(dialogDir)} onOpenChange={(o) => !o && setDialogDir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogDir === 'FAILBACK'
                ? t('dr.switchover.dialogTitleFailback')
                : t('dr.switchover.dialogTitleFailover')}
            </DialogTitle>
            <DialogDescription>{t('dr.switchover.dialogDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-xs font-medium text-fg-2">{t('dr.switchover.modeLabel')}</div>
              <Select value={mode} onValueChange={(v) => setMode(v as DrSwitchMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SIMULATED">{'SIMULATED'}</SelectItem>
                  {liveSwitchEnabled && <SelectItem value="LIVE">{'LIVE'}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-fg-2">{t('dr.switchover.reasonLabel')}</div>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {mode === 'LIVE' && (
              <div>
                <div className="mb-1 text-xs font-medium text-fg-2">
                  {t('dr.switchover.confirmLabel')}
                </div>
                <Input value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} />
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              size="sm"
              disabled={reason.trim().length < 5 || startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {dialogDir === 'FAILBACK'
                ? t('dr.actions.startFailback')
                : t('dr.actions.startFailover')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DetailSheet
        open={Boolean(selectedSwitch)}
        onOpenChange={(o) => !o && setSelectedSwitch(null)}
        title={selectedSwitch ? `${selectedSwitch.switchCode} · ${selectedSwitch.direction}` : ''}
        subtitle={selectedSwitch?.reason}
        width="lg"
        actions={
          selectedSwitch?.status === 'IN_PROGRESS' ? (
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={abortMut.isPending}
                onClick={() => abortMut.mutate(selectedSwitch)}
              >
                <XCircle />
                {t('dr.actions.abortSwitch')}
              </Button>
              <Button
                size="xs"
                disabled={completeMut.isPending}
                onClick={() => setConfirmCompleteOpen(true)}
              >
                <CheckCircle2 />
                {t('dr.actions.completeSwitch')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedSwitch && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase text-muted">
              {t('dr.switchover.checklistTitle')}
            </div>
            {selectedSwitch.checklist.map((step) => (
              <div
                key={step.stepKey}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-fg">
                      {`${step.order}. ${step.title}`}
                    </div>
                    <div className="text-xs text-muted">{step.description}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge tone={step.required ? 'warn' : 'unknown'} size="xs">
                      {step.required ? t('dr.switchover.requiredTag') : t('dr.switchover.optionalTag')}
                    </Badge>
                    <Badge tone={DR_STATUS_TONE[step.status] ?? 'unknown'} size="xs">
                      {step.status}
                    </Badge>
                  </div>
                </div>
                {selectedSwitch.status === 'IN_PROGRESS' && step.status !== 'COMPLETED' && (
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={stepMut.isPending}
                      onClick={() =>
                        stepMut.mutate({
                          switchId: selectedSwitch.id,
                          stepKey: step.stepKey,
                          status: 'COMPLETED',
                        })
                      }
                    >
                      {t('dr.actions.markCompleted')}
                    </Button>
                    {!step.required && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={stepMut.isPending}
                        onClick={() =>
                          stepMut.mutate({
                            switchId: selectedSwitch.id,
                            stepKey: step.stepKey,
                            status: 'SKIPPED',
                          })
                        }
                      >
                        {t('dr.actions.markSkipped')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DetailSheet>

      {selectedSwitch && (
        <ConfirmDialog
          open={confirmCompleteOpen}
          onOpenChange={setConfirmCompleteOpen}
          title={t('dr.switchover.confirmCompleteTitle')}
          description={t('dr.switchover.confirmCompleteDesc')}
          confirmLabel={t('dr.actions.completeSwitch')}
          loading={completeMut.isPending}
          onConfirm={() => completeMut.mutate(selectedSwitch)}
        />
      )}
    </div>
  );
};
