import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Badge, Button, Switch } from '@core/ui/primitives';
import { ConfirmDialog, DataTable, Panel } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { SEVERITY_TONE_MAP } from '../../constants/metrics-alerts';
import { metricsAlertsApi } from '../../services/metrics-alerts.api';
import type { AlertRuleDto, CreateAlertRuleInput, UpdateAlertRuleInput } from '../../types/metrics-alerts.types';
import { AlertRuleFormSheet } from './AlertRuleFormSheet';

const col = createColumnHelper<AlertRuleDto>();
const RULES_KEY = ['console', 'metrics-alerts', 'rules'] as const;

export const AlertRulesTab: React.FC = () => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRuleDto | null>(null);
  const [deleting, setDeleting] = useState<AlertRuleDto | null>(null);

  const query = useLiveQuery(RULES_KEY, () => metricsAlertsApi.listRules({ limit: 100 }), { tier: 'slow' });
  const invalidate = () => void qc.invalidateQueries({ queryKey: RULES_KEY });

  const saveMut = useMutation({
    mutationFn: ({ payload, id }: { payload: CreateAlertRuleInput | UpdateAlertRuleInput; id?: number }) =>
      id ? metricsAlertsApi.updateRule(id, payload) : metricsAlertsApi.createRule(payload as CreateAlertRuleInput),
    onSuccess: () => {
      addToast({ type: 'success', title: t('metricsAlerts.rules.saved') });
      setSheetOpen(false);
      invalidate();
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isEnabled }: { id: number; isEnabled: boolean }) =>
      metricsAlertsApi.updateRule(id, { isEnabled }),
    onSuccess: () => invalidate(),
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => metricsAlertsApi.deleteRule(id),
    onSuccess: () => {
      addToast({ type: 'success', title: t('metricsAlerts.rules.deleted') });
      setDeleting(null);
      invalidate();
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const testMut = useMutation({
    mutationFn: (id: number) => metricsAlertsApi.testRule(id, false),
    onSuccess: (res) => {
      addToast({
        type: res.matched ? 'warning' : 'info',
        title: res.matched
          ? t('metricsAlerts.rules.testedMatched', { code: res.ruleCode, count: res.samples.length })
          : t('metricsAlerts.rules.testedNormal', { code: res.ruleCode }),
      });
    },
    onError: (err) => addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('metricsAlerts.col.code'),
        cell: (c) => <span className="font-mono text-xs text-fg">{c.getValue()}</span>,
      }),
      col.accessor('name', { header: t('metricsAlerts.col.name') }),
      col.accessor('metricKey', {
        header: t('metricsAlerts.col.metric'),
        cell: (c) => t(`metricsAlerts.metricLabel.${c.getValue()}`),
      }),
      col.display({
        id: 'cond',
        header: t('metricsAlerts.col.condition'),
        cell: (c) => `${c.row.original.operator} ${c.row.original.threshold}`,
      }),
      col.display({
        id: 'timing',
        header: t('metricsAlerts.col.timing'),
        cell: (c) => {
          const r = c.row.original;
          return `${r.windowSeconds}s / ${r.forSeconds}s / ${r.cooldownSeconds}s`;
        },
      }),
      col.accessor('severity', {
        header: t('metricsAlerts.col.severity'),
        cell: (c) => <Badge tone={SEVERITY_TONE_MAP[c.getValue()]}>{t(`metricsAlerts.severity.${c.getValue()}`)}</Badge>,
      }),
      col.accessor('isEnabled', {
        header: t('metricsAlerts.col.enabled'),
        cell: (c) => (
          <Switch
            checked={c.getValue()}
            onCheckedChange={(checked) => toggleMut.mutate({ id: c.row.original.id, isEnabled: checked })}
          />
        ),
      }),
      col.display({
        id: 'actions',
        header: t('metricsAlerts.col.actions'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={() => testMut.mutate(r.id)}>
                <FlaskConical />
                {t('metricsAlerts.rules.test')}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditing(r);
                  setSheetOpen(true);
                }}
              >
                <Pencil />
                {t('metricsAlerts.rules.edit')}
              </Button>
              {!r.isSystem && (
                <Button size="xs" variant="ghost" onClick={() => setDeleting(r)}>
                  <Trash2 />
                  {t('metricsAlerts.rules.delete')}
                </Button>
              )}
            </div>
          );
        },
      }),
    ],
    [t, toggleMut, testMut],
  );

  return (
    <>
      <Panel
        title={t('metricsAlerts.tab.rules')}
        actions={
          <Button
            size="xs"
            onClick={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
          >
            <Plus />
            {t('metricsAlerts.rules.create')}
          </Button>
        }
      >
        <DataTable
          data={query.data?.data ?? []}
          columns={columns}
          getRowId={(r) => String(r.id)}
          emptyMessage={t('metricsAlerts.empty')}
        />
      </Panel>

      <AlertRuleFormSheet
        open={sheetOpen}
        editing={editing}
        saving={saveMut.isPending}
        onOpenChange={setSheetOpen}
        onSubmit={(payload, id) => saveMut.mutate({ payload, id })}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('metricsAlerts.rules.confirmDeleteTitle')}
        description={deleting ? t('metricsAlerts.rules.confirmDeleteDesc', { code: deleting.code }) : undefined}
        confirmLabel={t('metricsAlerts.rules.delete')}
        tone="danger"
        loading={deleteMut.isPending}
        onConfirm={() => deleting && deleteMut.mutate(deleting.id)}
      />
    </>
  );
};
