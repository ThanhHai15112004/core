import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Button } from '@core/ui/primitives';
import { Panel, PanelGrid, QueryView, StatusBanner } from '@core/ui/blocks';
import { workerApi } from '../../services/worker.api';
import { WorkerTable } from '../../components/worker/WorkerTable';
import { ConcurrencyPanel } from '../../components/worker/ConcurrencyPanel';
import { StabilityHistory } from '../../components/worker/StabilityHistory';
import { workerKeys } from './worker-keys';
import type { WorkerPage } from './useWorkerPage';

/** Worker instance (tự báo, có TTL) + concurrency + ổn định (restart / crash, lấy từ Runtime Monitor). */
export function WorkerWorkersTab({ page }: { page: WorkerPage }) {
  const { t } = useLocale();
  const query = useLiveQuery(workerKeys.workers(), () => workerApi.workers());
  return (
    <QueryView query={query}>
      {(d) => (
        <>
          {d.unconsumed.length > 0 && (
            <StatusBanner
              tone="crit"
              title={t('wq.worker.unconsumedTitle')}
              description={t('wq.worker.unconsumedHint')}
              reasons={d.unconsumed.map((q) => ({ id: q, text: <span className="font-mono">{q}</span>, onClick: () => page.openQueue(q) }))}
              actions={
                <Button size="xs" variant="secondary" onClick={() => page.navigate('runtimes/worker')}>
                  {t('wq.health.inspectRuntime')}
                  <ArrowRight />
                </Button>
              }
            />
          )}
          <Panel
            title={t('wq.worker.title')}
            hint={t('wq.worker.note')}
            actions={
              <span className="font-mono text-xs text-muted">
                {d.brokerWorkers === null ? t('wq.worker.hint', { count: d.workers.length }) : t('wq.worker.hintBroker', { count: d.workers.length, broker: d.brokerWorkers })}
              </span>
            }
            flush
            className="mb-4"
          >
            <WorkerTable rows={d.workers} onOpen={(id) => page.openWorker(id)} activeId={page.workerId} emptyMessage={t('wq.worker.empty')} />
          </Panel>
          <PanelGrid>
            <Panel title={t('wq.concurrency.title')}>
              <ConcurrencyPanel concurrency={d.concurrency} workers={d.workers} />
            </Panel>
            <Panel title={t('wq.stability.title')} hint={t('wq.stability.note')}>
              <StabilityHistory stability={d.stability} />
            </Panel>
          </PanelGrid>
        </>
      )}
    </QueryView>
  );
}
