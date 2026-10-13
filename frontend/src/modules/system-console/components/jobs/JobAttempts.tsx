import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import { CodeBlock, DataTable, DetailSection, KeyValueGrid, Timeline, type TimelineItem } from '@core/ui/blocks';
import type { Attempt } from '../../types/jobs.types';
import { ATTEMPT_TONE } from '../../constants/jobs';
import { dateTime, instanceLabel } from '../../utils/jobs-format';
import { RetryableBadge } from './FailureGroups';

const col = createColumnHelper<Attempt>();

/** Stack trace thu gọn mặc định (không chiếm cả màn hình), có nút sao chép khi mở. */
export function StackTrace({ stack }: { stack: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown /> : <ChevronRight />}
        {open ? t('jobs.stack.hide') : t('jobs.stack.show')}
      </Button>
      {open && <CodeBlock code={stack} className="mt-1.5" />}
    </div>
  );
}

/** Bảng các lần thử; bấm một lần thử → chi tiết (worker, thời điểm, lỗi, stack). */
export function JobAttempts({ attempts }: { attempts: Attempt[] }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const [openId, setOpenId] = useState<number | null>(null);
  const open = attempts.find((a) => a.attempt === openId) ?? null;

  const columns = useMemo(
    () => [
      col.accessor('attempt', {
        header: t('jobs.attempts.col.attempt'),
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            #{c.getValue()}
            {c.row.original.manual && <Badge size="xs">{t('jobs.attempts.manual')}</Badge>}
          </span>
        ),
        meta: { mono: true, width: '120px' },
      }),
      col.accessor('result', {
        header: t('jobs.attempts.col.result'),
        cell: (c) => <Badge tone={ATTEMPT_TONE[c.getValue()]}>{t(`jobs.attempts.result.${c.getValue()}`)}</Badge>,
        meta: { width: '110px' },
      }),
      col.accessor('durationMs', { header: t('jobs.attempts.col.duration'), cell: (c) => f.duration(c.getValue()), meta: { align: 'right', mono: true, width: '96px' } }),
      col.accessor((a) => a.errorType ?? '', {
        id: 'error',
        header: t('jobs.attempts.col.error'),
        cell: (c) => (c.row.original.errorType ? <span className="font-mono text-xs text-crit-fg">{c.row.original.errorType}</span> : NO_VALUE),
        meta: { truncate: true },
      }),
      col.accessor((a) => a.instance ?? a.runtime ?? '', {
        id: 'worker',
        header: t('jobs.attempts.col.worker'),
        cell: (c) => (c.row.original.instance ? instanceLabel(c.row.original.instance) : (c.row.original.runtime ?? NO_VALUE)),
        meta: { mono: true, truncate: true },
      }),
      col.accessor((a) => (a.startedAt ? Date.parse(a.startedAt) : null), {
        id: 'started',
        header: t('jobs.attempts.col.started'),
        cell: (c) => (c.row.original.startedAt ? formatTime(c.row.original.startedAt, true) : NO_VALUE),
        meta: { mono: true, width: '96px' },
      }),
    ],
    [t, f, formatTime],
  );

  return (
    <>
      <DataTable
        data={attempts}
        columns={columns}
        getRowId={(a) => String(a.attempt)}
        onRowClick={(a) => setOpenId((cur) => (cur === a.attempt ? null : a.attempt))}
        activeRowId={open ? String(open.attempt) : null}
        rowTone={(a) => (a.result === 'failed' ? 'crit' : undefined)}
        emptyMessage={t('jobs.attempts.none')}
      />
      {open && (
        <div className="border-t border-border p-3">
          <DetailSection title={t('jobs.attempts.attemptN', { n: open.attempt })}>
            <KeyValueGrid
              columns={4}
              items={[
                { label: t('jobs.attempts.col.worker'), value: open.instance ?? open.runtime, mono: true },
                { label: t('jobs.attempts.col.started'), value: dateTime(open.startedAt) },
                { label: t('jobs.attempts.finished'), value: dateTime(open.finishedAt) },
                { label: t('jobs.failure.retryable'), value: open.result === 'failed' ? <RetryableBadge value={open.retryable} /> : null },
              ]}
            />
            {open.error && <p className="mt-3 break-words text-sm text-crit-fg">{open.error}</p>}
            {open.stack && <StackTrace stack={open.stack} />}
          </DetailSection>
        </div>
      )}
    </>
  );
}

/** Dòng thời gian retry: từng lần thử, backoff giữa các lần, cạn retry. */
export function RetryTimeline({ attempts, maxAttempts, exhausted }: { attempts: Attempt[]; maxAttempts: number; exhausted: boolean }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const items: TimelineItem[] = attempts.map((a, i) => {
    const prev = i > 0 ? attempts[i - 1] : null;
    return {
      id: String(a.attempt),
      tone: ATTEMPT_TONE[a.result],
      time: a.startedAt ? formatTime(a.startedAt, true) : NO_VALUE,
      title: t('jobs.attempts.attemptN', { n: a.attempt }),
      detail: a.errorType ? <span className="font-mono text-crit-fg">{a.errorType}</span> : t(`jobs.attempts.result.${a.result}`),
      gap: prev ? (prev.backoffMs !== null ? t('jobs.attempts.backoff', { value: f.duration(prev.backoffMs) }) : a.manual ? t('jobs.attempts.manual') : undefined) : undefined,
      current: a.result === 'running',
    };
  });
  if (exhausted) items.push({ id: 'exhausted', tone: 'crit', title: t('jobs.attempts.exhausted', { max: Math.max(maxAttempts, attempts.length) }) });
  return <Timeline items={items} emptyMessage={t('jobs.attempts.none')} />;
}
