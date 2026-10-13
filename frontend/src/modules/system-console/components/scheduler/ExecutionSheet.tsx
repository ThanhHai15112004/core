import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { CalendarClock, Cpu, FileText, Layers, Play } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { CodeBlock, CopyButton, DataTable, DetailSection, DetailSheet, KeyValueGrid, PanelState, QueryView } from '@core/ui/blocks';
import type { ExecutionDetail, GeneratedJob, TaskRow } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { EXECUTION_TONE } from '../../constants/scheduler';
import { execDurationMs, formatDateTime } from '../../utils/scheduler-format';
import { schedulerKeys } from '../../sections/scheduler/scheduler-keys';
import type { TaskAction } from '../../sections/scheduler/useTaskActions';
import { DownstreamGrid } from './DownstreamGrid';

interface Props {
  id: string | null;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onAction?: (action: TaskAction, task: TaskRow) => void;
  navigate: (path: string) => void;
}

/**
 * Chi tiết một lần chạy: lịch vs thực tế, kết quả / lỗi, correlation ID → log; job đã tạo (trigger thành công ≠ job
 * thành công) → Jobs / Queue. Chạy lại dùng cùng hộp xác nhận với Run Now.
 */
export function ExecutionSheet({ id, onClose, onOpenTask, onAction, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(schedulerKeys.execution(id ?? ''), () => schedulerApi.execution(id!), { enabled: Boolean(id), keepPrevious: false });
  const e = query.data?.execution;
  return (
    <DetailSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={<span className="font-mono">{t('sch.exec.title', { id: id ?? '' })}</span>}
      subtitle={e?.taskName}
      status={e ? { tone: EXECUTION_TONE[e.status], label: t(`sch.exec.status.${e.status}`) } : undefined}
    >
      <QueryView query={query}>{(d) => <Body d={d} onOpenTask={onOpenTask} onAction={onAction} navigate={navigate} />}</QueryView>
    </DetailSheet>
  );
}

const jobCol = createColumnHelper<GeneratedJob>();

function Body({ d, onOpenTask, onAction, navigate }: { d: ExecutionDetail } & Pick<Props, 'onOpenTask' | 'onAction' | 'navigate'>) {
  const { t, locale } = useLocale();
  const f = useFormat();
  const e = d.execution;
  const at = (v: string | null) => (v ? formatDateTime(v, locale) : null);
  const queue = d.downstream?.queue ?? e.jobs[0]?.queue ?? null;
  const done = e.status === 'success' || e.status === 'failed';

  const jobColumns = useMemo(
    () => [
      jobCol.accessor('id', {
        header: t('sch.exec.job.id'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg" title={c.getValue()}>
              {f.shortId(c.getValue())}
            </div>
            <div className="truncate text-2xs text-faint">{c.row.original.topic}</div>
          </div>
        ),
      }),
      jobCol.accessor('queue', { header: t('sch.exec.job.queue'), meta: { mono: true, truncate: true } }),
    ],
    [t, f],
  );

  return (
    <>
      <p className="mb-4 text-sm text-fg-2">{t(`sch.exec.statusHint.${e.status}`)}</p>

      <div className="mb-5 flex flex-wrap gap-2">
        {e.correlationId && (
          <Button size="sm" variant="primary" onClick={() => navigate(`logs/explorer?correlationId=${encodeURIComponent(e.correlationId)}`)}>
            <FileText />
            {t('sch.exec.openLogs')}
          </Button>
        )}
        <Button size="sm" onClick={() => onOpenTask(e.taskId)}>
          <CalendarClock />
          {t('sch.exec.openTask')}
        </Button>
        {queue && (
          <Button size="sm" onClick={() => navigate(`worker/queues/${encodeURIComponent(queue)}`)}>
            <Layers />
            {t('sch.exec.openQueue')}
          </Button>
        )}
        <Button size="sm" onClick={() => navigate('runtimes/scheduler')}>
          <Cpu />
          {t('sch.exec.openRuntime')}
        </Button>
        {onAction && d.task && d.settings.run && e.status !== 'running' && (
          <Button size="sm" onClick={() => onAction('run', d.task!)}>
            <Play />
            {t('sch.exec.runAgain')}
          </Button>
        )}
      </div>

      <DetailSection title={t('sch.exec.details')} actions={<CopyButton value={e.id} label={t('sch.exec.copyId')} size="xs" />}>
        <KeyValueGrid
          items={[
            { label: t('sch.exec.col.task'), value: e.taskName },
            { label: t('sch.exec.col.trigger'), value: t(`sch.exec.trigger.${e.trigger}`) },
            { label: t('sch.exec.scheduledAt'), value: at(e.scheduledAt), mono: true },
            { label: t('sch.exec.startedAt'), value: at(e.startedAt), mono: true },
            { label: t('sch.exec.finishedAt'), value: at(e.finishedAt), mono: true },
            { label: t('sch.exec.col.duration'), value: f.duration(execDurationMs(e)), mono: true },
            { label: t('sch.exec.attempts'), value: String(e.attempts), mono: true },
            { label: t('sch.exec.correlation'), value: e.correlationId || null, mono: true },
          ]}
        />
      </DetailSection>

      {e.error && (
        <DetailSection title={t('sch.exec.failedTitle')}>
          <p className="mb-1.5 font-mono text-xs text-crit-fg">{e.error.type}</p>
          <CodeBlock code={e.error.message} wrap maxHeight={240} />
        </DetailSection>
      )}

      <DetailSection title={t('sch.exec.jobs')}>
        {e.jobs.length === 0 ? (
          <PanelState status="empty" compact message={done ? t('sch.exec.noJobs') : NO_VALUE} />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <DataTable
              data={e.jobs}
              columns={jobColumns}
              getRowId={(j) => j.id}
              onRowClick={(j) => navigate(`jobs/job/${encodeURIComponent(j.id)}?queue=${encodeURIComponent(j.queue)}`)}
            />
          </div>
        )}
      </DetailSection>

      {d.downstream && (
        <DetailSection title={t('sch.downstream.title')}>
          <DownstreamGrid downstream={d.downstream} />
        </DetailSection>
      )}
    </>
  );
}
