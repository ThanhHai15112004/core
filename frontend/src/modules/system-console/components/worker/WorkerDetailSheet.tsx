import { Activity, FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { AlertList, DetailSection, DetailSheet, KeyValueGrid, QueryView } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { WorkerDetail } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { WORKER_STATUS_TONE } from '../../constants/worker';
import { instanceLabel } from '../../utils/worker-format';
import { workerKeys } from '../../sections/worker/worker-keys';
import { StabilityHistory } from './StabilityHistory';

interface Props {
  id: string | null;
  onClose: () => void;
  onOpenQueue: (queue: string) => void;
  navigate: (path: string) => void;
}

/**
 * Worker instance: tài nguyên, job đang xử lý, queue tiêu thụ và phân bổ xử lý hôm nay, lịch sử restart.
 * Restart / stop thuộc trang Runtime — ở đây chỉ dẫn sang.
 */
export function WorkerDetailSheet({ id, onClose, onOpenQueue, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(workerKeys.worker(id ?? ''), () => workerApi.worker(id!), { enabled: Boolean(id), keepPrevious: false });
  const w = query.data?.worker;
  return (
    <DetailSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={<span className="font-mono">{id ? instanceLabel(id) : ''}</span>}
      subtitle={w ? t(`wq.worker.statusHint.${w.status}`) : undefined}
      status={w ? { tone: WORKER_STATUS_TONE[w.status], label: t(`wq.worker.statusOf.${w.status}`) } : undefined}
      actions={
        <>
          <Button size="xs" variant="secondary" onClick={() => navigate('runtimes/worker')}>
            <Activity />
            {t('wq.worker.viewRuntime')}
          </Button>
          <Button size="xs" variant="secondary" onClick={() => navigate('logs/explorer?runtime=worker')}>
            <FileText />
            {t('wq.worker.viewLogs')}
          </Button>
        </>
      }
    >
      <QueryView query={query}>{(d) => <Body d={d} onOpenQueue={onOpenQueue} />}</QueryView>
    </DetailSheet>
  );
}

function Body({ d, onOpenQueue }: { d: WorkerDetail; onOpenQueue: (queue: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const w = d.worker;
  return (
    <>
      {d.runtimeAlerts.length > 0 && (
        <AlertList
          className="mb-4"
          items={d.runtimeAlerts.map((a) => ({ id: a.key, tone: 'warn' as const, title: t(`wq.worker.pressure.${a.key}`, { value: a.value, threshold: a.threshold }) }))}
        />
      )}
      <DetailSection title={t('wq.worker.resources')}>
        <KeyValueGrid
          columns={4}
          items={[
            { label: t('wq.worker.pid'), value: w.pid, mono: true },
            { label: t('wq.worker.host'), value: w.host, mono: true },
            { label: t('wq.worker.cpu'), value: <span className={w.status === 'high_cpu' ? 'text-warn-fg' : undefined}>{f.percent(w.cpuPercent)}</span>, mono: true },
            {
              label: t('wq.worker.memory'),
              value: <span className={w.status === 'high_memory' ? 'text-warn-fg' : undefined}>{w.memoryLimitMb === null ? f.mb(w.memoryMb) : `${f.mb(w.memoryMb)} / ${f.mb(w.memoryLimitMb)}`}</span>,
              mono: true,
            },
            { label: t('wq.worker.uptime'), value: f.uptime(w.uptimeSec), mono: true },
            { label: t('wq.worker.processing'), value: t('wq.worker.processingValue', { active: w.active ?? NO_VALUE, concurrency: w.concurrency }), mono: true },
            { label: t('wq.kpi.duration'), value: f.duration(d.processing.avgMs), mono: true },
            { label: t('wq.kpi.durationP95'), value: f.duration(d.processing.p95Ms), mono: true },
          ]}
        />
      </DetailSection>
      <DetailSection title={t('wq.worker.consumes')}>
        <BarList
          items={d.distribution.map((x) => ({
            id: x.queue,
            label: <span className="font-mono text-xs">{x.queue}</span>,
            value: x.completed,
            display: `${f.compact(x.completed)} · ${f.percent(x.percent)}`,
            sub: x.failed > 0 ? <span className="text-crit-fg">{t('wq.worker.failedN', { count: f.compact(x.failed) })}</span> : undefined,
            onClick: () => onOpenQueue(x.queue),
          }))}
        />
        <KeyValueGrid className="mt-3" columns={1} items={[{ label: t('wq.worker.processors'), value: w.processors.join(', '), mono: true }]} />
      </DetailSection>
      <DetailSection title={t('wq.stability.title')}>
        <StabilityHistory stability={d.stability} />
      </DetailSection>
    </>
  );
}
