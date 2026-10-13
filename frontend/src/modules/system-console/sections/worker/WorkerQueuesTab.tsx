import { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Panel, QueryView, SearchInput } from '@core/ui/blocks';
import { workerApi } from '../../services/worker.api';
import { QueueTable } from '../../components/worker/QueueTable';
import { SectionGate } from '../../components/worker/SectionGate';
import { workerKeys } from './worker-keys';
import type { WorkerPage } from './useWorkerPage';

/** Danh sách queue: sort theo cột, tìm theo tên; bấm → trang chi tiết queue. */
export function WorkerQueuesTab({ page, product }: { page: WorkerPage; product: string | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const [search, setSearch] = useState('');
  const query = useLiveQuery(workerKeys.queues(page.range), () => workerApi.queues(page.range));
  const d = query.data;
  const needle = search.trim().toLowerCase();
  return (
    <Panel
      title={t('wq.queue.title')}
      hint={
        d
          ? `${t('wq.queue.thresholds', { warn: f.compact(d.thresholds.backlogWarn), crit: f.compact(d.thresholds.backlogCrit) })} · ${t('wq.queue.note', { range: t(`ui.time.ranges.${d.range}`) })}`
          : undefined
      }
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t('wq.queue.search')} className="w-56" />}
      flush
    >
      <QueryView query={query}>
        {(data) => (
          <SectionGate section={data.queues} product={product} className="p-3">
            {(rows) => <QueueTable rows={needle ? rows.filter((q) => q.name.toLowerCase().includes(needle)) : rows} onOpen={(name) => page.openQueue(name)} emptyMessage={needle && rows.length > 0 ? t('wq.queue.noMatch') : undefined} />}
          </SectionGate>
        )}
      </QueryView>
    </Panel>
  );
}
