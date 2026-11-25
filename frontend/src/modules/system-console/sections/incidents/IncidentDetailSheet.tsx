import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { errorMessage, useLiveQuery } from '@core/data';
import { Badge, Button, Input } from '@core/ui/primitives';
import { DetailSheet, Panel } from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { INCIDENT_SEVERITY_TONE, INCIDENT_STATUS_TONE } from '../../constants/incidents';
import { incidentsApi } from '../../services/incidents.api';

interface Props {
  incidentId: number | null;
  onClose: () => void;
}

export const IncidentDetailSheet: React.FC<Props> = ({ incidentId, onClose }) => {
  const { t } = useLocale();
  const { addToast } = useConsoleData();
  const qc = useQueryClient();

  const detail = useLiveQuery(
    ['console', 'incidents', 'detail', incidentId ?? 0],
    () => incidentsApi.getIncidentDetail(incidentId!),
    { enabled: incidentId !== null, tier: 'live' },
  );

  const [rootCause, setRootCause] = useState('');
  const [mitigationSummary, setMitigationSummary] = useState('');
  const [pmTitle, setPmTitle] = useState('');
  const [pmSummary, setPmSummary] = useState('');
  const [pmRca, setPmRca] = useState('');
  const [pmLessons, setPmLessons] = useState('');
  const [pmActions, setPmActions] = useState('');

  useEffect(() => {
    const inc = detail.data;
    if (!inc) return;
    setRootCause(inc.rootCause ?? '');
    setMitigationSummary(inc.mitigationSummary ?? '');
    setPmTitle(inc.postmortem?.title ?? `Post-mortem: ${inc.incidentCode}`);
    setPmSummary(inc.postmortem?.summary ?? inc.title);
    setPmRca(inc.postmortem?.rootCauseAnalysis ?? inc.rootCause ?? '');
    setPmLessons(inc.postmortem?.lessonsLearned ?? '');
    setPmActions(inc.postmortem?.preventiveActions.map((a) => a.title).join('\n') ?? '');
  }, [detail.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['console', 'incidents'] });

  const resolveMut = useMutation({
    mutationFn: () =>
      incidentsApi.resolveIncident(incidentId!, {
        rootCause: rootCause.trim(),
        mitigationSummary: mitigationSummary.trim(),
      }),
    onSuccess: () => {
      addToast({ type: 'success', title: t('incidents.actions.resolveSuccess') });
      invalidate();
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const savePmMut = useMutation({
    mutationFn: () =>
      incidentsApi.upsertPostmortem(incidentId!, {
        title: pmTitle.trim() || `Post-mortem #${incidentId}`,
        summary: pmSummary.trim(),
        rootCauseAnalysis: pmRca.trim(),
        lessonsLearned: pmLessons.trim(),
        preventiveActions: pmActions
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((title) => ({ title, status: 'OPEN' as const })),
      }),
    onSuccess: () => {
      addToast({ type: 'success', title: t('incidents.actions.postmortemSaved') });
      invalidate();
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const publishPmMut = useMutation({
    mutationFn: () => incidentsApi.publishPostmortem(incidentId!),
    onSuccess: () => {
      addToast({ type: 'success', title: t('incidents.actions.postmortemPublished') });
      invalidate();
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('console.toast.actionFailed'), message: errorMessage(err) }),
  });

  const inc = detail.data;

  return (
    <DetailSheet
      open={incidentId !== null}
      onOpenChange={(open) => !open && onClose()}
      width="lg"
      title={inc ? `${inc.incidentCode} · ${inc.title}` : '...'}
      subtitle={inc ? `${inc.alertCode} · ${t('incidents.detail.owner', { id: inc.ownerUserId })}` : undefined}
      status={
        inc
          ? { tone: INCIDENT_STATUS_TONE[inc.status], label: t(`incidents.status.${inc.status}`) }
          : undefined
      }
    >
      {inc && (
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={INCIDENT_SEVERITY_TONE[inc.severity]}>
              {t(`incidents.severity.${inc.severity}`)}
            </Badge>
            <Badge variant="outline">
              {t('incidents.col.occurrences')}: {inc.occurrenceCount}
            </Badge>
            {inc.recoverySeconds !== null && (
              <Badge tone="ok">
                {t('incidents.detail.recovery')}: {inc.recoverySeconds}s
              </Badge>
            )}
          </div>

          {inc.runbook && (
            <Panel title={`${t('incidents.detail.runbookTitle')}: ${inc.runbook.title}`}>
              <div className="space-y-2">
                <div>
                  <p className="font-medium text-fg">{t('incidents.detail.triageSteps')}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-fg-2">
                    {inc.runbook.triageSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-fg">{t('incidents.detail.mitigationSteps')}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-fg-2">
                    {inc.runbook.mitigationSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>
          )}

          {inc.status !== 'RESOLVED' && inc.status !== 'CLOSED' && (
            <Panel title={t('incidents.detail.resolveFormTitle')}>
              <div className="space-y-2">
                <Input
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  placeholder={t('incidents.detail.rootCausePlaceholder')}
                />
                <Input
                  value={mitigationSummary}
                  onChange={(e) => setMitigationSummary(e.target.value)}
                  placeholder={t('incidents.detail.mitigationPlaceholder')}
                />
                <Button
                  size="xs"
                  disabled={resolveMut.isPending || rootCause.trim().length < 3 || mitigationSummary.trim().length < 3}
                  onClick={() => resolveMut.mutate()}
                >
                  {t('incidents.actions.resolve')}
                </Button>
              </div>
            </Panel>
          )}

          <Panel title={t('incidents.detail.postmortemTitle')}>
            <div className="space-y-2">
              <Input value={pmTitle} onChange={(e) => setPmTitle(e.target.value)} />
              <textarea
                className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg"
                rows={2}
                value={pmSummary}
                onChange={(e) => setPmSummary(e.target.value)}
                placeholder={t('incidents.detail.pmSummary')}
              />
              <textarea
                className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg"
                rows={2}
                value={pmRca}
                onChange={(e) => setPmRca(e.target.value)}
                placeholder={t('incidents.detail.pmRca')}
              />
              <textarea
                className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg"
                rows={2}
                value={pmLessons}
                onChange={(e) => setPmLessons(e.target.value)}
                placeholder={t('incidents.detail.pmLessons')}
              />
              <textarea
                className="w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg"
                rows={2}
                value={pmActions}
                onChange={(e) => setPmActions(e.target.value)}
                placeholder={t('incidents.detail.pmActionTitle')}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={savePmMut.isPending || pmSummary.trim().length < 5 || pmRca.trim().length < 5 || pmLessons.trim().length < 5}
                  onClick={() => savePmMut.mutate()}
                >
                  {t('incidents.actions.savePostmortem')}
                </Button>
                {inc.postmortem && inc.postmortem.status === 'DRAFT' && (
                  <Button size="xs" disabled={publishPmMut.isPending} onClick={() => publishPmMut.mutate()}>
                    {t('incidents.actions.publishPostmortem')}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}
    </DetailSheet>
  );
};
