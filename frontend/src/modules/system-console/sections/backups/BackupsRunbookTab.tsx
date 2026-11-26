import React from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { CodeBlock, Panel, QueryView, StatusBanner } from '@core/ui/blocks';
import { backupsApi } from '../../services/backups.api';

export const BackupsRunbookTab: React.FC = () => {
  const { t } = useLocale();
  const query = useLiveQuery(['console', 'backups', 'runbook'], () => backupsApi.runbook(), {
    tier: 'slow',
  });

  return (
    <QueryView query={query}>
      {(rb) => (
        <div className="flex flex-col gap-4">
          <StatusBanner
            tone="info"
            title={`${t('backups.runbook.title')} · ${t('backups.runbook.docPath')}: ${rb.docPath}`}
          />

          {rb.sections.map((sec) => (
            <Panel key={sec.id} title={sec.title} hint={sec.summary}>
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted">
                    {t('backups.runbook.steps')}
                  </div>
                  <ol className="list-decimal space-y-1 pl-5 text-fg-2">
                    {sec.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>

                {sec.commands.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-muted">
                      {t('backups.runbook.commands')}
                    </div>
                    <CodeBlock code={sec.commands.join('\n')} />
                  </div>
                )}

                {sec.warnings.length > 0 && (
                  <div className="rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn-fg">
                    <strong>{t('backups.runbook.warnings')}:</strong> {sec.warnings.join(' · ')}
                  </div>
                )}
              </div>
            </Panel>
          ))}

          <Panel title={t('backups.runbook.checklist')}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
              {rb.postRestoreChecklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </QueryView>
  );
};
