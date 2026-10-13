import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ChevronRight, Terminal } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Hint } from '@core/ui/primitives';
import { DataTable, DetailSection, DetailSheet, KeyValueGrid, RelativeTime } from '@core/ui/blocks';
import type { CliExecution, RuntimesOverview } from '../../types/runtime.types';
import { CLI_LOGS_LIMIT } from '../../constants/runtime-metrics';
import { RuntimeLogs } from './RuntimeLogs';
import { useDateTime } from './runtime-view';

type Cli = RuntimesOverview['cli'];
const col = createColumnHelper<CliExecution>();
const commandOf = (e: CliExecution) => [e.command, ...e.args].join(' ');

function ResultBadge({ e }: { e: CliExecution }) {
  const { t } = useLocale();
  return (
    <Hint content={e.error}>
      <span className="inline-flex">
        <Badge tone={e.result === 'success' ? 'ok' : 'crit'} size="xs">
          {t(`rt.cli.${e.result}`)} · {e.exitCode}
        </Badge>
      </span>
    </Hint>
  );
}

/** Thẻ CLI — runtime chạy theo yêu cầu: lần chạy cuối, số lần / lỗi hôm nay thay cho uptime. */
export function CliCard({ cli, onOpen }: { cli: Cli | null; onOpen: () => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const last = cli?.lastExecution ?? null;
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={t('rt.list.open', { name: t('rt.name.cli') })}
      className="@container group flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg border border-border bg-panel p-3 text-left transition-colors hover:border-border-strong hover:bg-panel-2"
    >
      <header className="flex min-w-0 items-center gap-2">
        <Terminal className="size-4 shrink-0 text-muted" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{t('rt.name.cli')}</h3>
        <Badge>{t('rt.cli.onDemand')}</Badge>
        <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" />
      </header>
      {last ? (
        <>
          <code className="truncate rounded-sm bg-panel-2 px-2 py-1 font-mono text-xs text-fg-2" title={commandOf(last)}>
            {commandOf(last)}
          </code>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2.5 text-xs @md:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-muted">{t('rt.cli.lastExecuted')}</dt>
              <dd className="text-fg">
                <RelativeTime value={last.startedAt} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted">{t('rt.cli.result')}</dt>
              <dd>
                <ResultBadge e={last} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted">{t('rt.cli.today')}</dt>
              <dd className="font-mono tabular-nums text-fg">{f.number(cli?.executionsToday)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted">{t('rt.cli.failures')}</dt>
              <dd className={cn('font-mono tabular-nums', (cli?.failuresToday ?? 0) > 0 ? 'text-crit-fg' : 'text-fg')}>{f.number(cli?.failuresToday)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="py-4 text-center text-sm text-muted">{t('rt.cli.empty')}</p>
      )}
    </article>
  );
}

/** Sheet CLI: lần chạy cuối, lịch sử thực thi, log CLI gần đây. */
export function CliSheet({ cli, open, onOpenChange }: { cli: Cli | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const dateTime = useDateTime();
  const last = cli?.lastExecution ?? null;
  const columns = useMemo(
    () => [
      col.accessor('startedAt', {
        header: t('rt.cli.time'),
        cell: (c) => dateTime(c.getValue()),
        meta: { mono: true, width: '180px', className: 'whitespace-nowrap' },
      }),
      col.accessor(commandOf, { id: 'command', header: t('rt.cli.command'), meta: { mono: true, truncate: true } }),
      col.accessor('durationMs', { header: t('rt.cli.duration'), cell: (c) => f.duration(c.getValue()), meta: { mono: true, align: 'right', width: '90px' } }),
      col.accessor('result', { header: t('rt.cli.result'), cell: (c) => <ResultBadge e={c.row.original} />, meta: { width: '120px' } }),
    ],
    [t, f, dateTime],
  );
  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={t('rt.name.cli')} width="lg">
      <DetailSection title={t('rt.cli.lastExecution')}>
        <KeyValueGrid
          items={[
            { label: t('rt.cli.command'), value: last ? commandOf(last) : null, mono: true },
            { label: t('rt.cli.time'), value: last ? <RelativeTime value={last.startedAt} /> : null },
            { label: t('rt.cli.duration'), value: last ? f.duration(last.durationMs) : null },
            { label: t('rt.cli.result'), value: last ? <ResultBadge e={last} /> : null },
            { label: t('rt.cli.today'), value: cli ? f.number(cli.executionsToday) : null },
            { label: t('rt.cli.failures'), value: cli ? f.number(cli.failuresToday) : null },
            ...(last?.error ? [{ label: t('rt.cli.error'), value: last.error, mono: true }] : []),
          ]}
        />
      </DetailSection>
      <DetailSection title={t('rt.cli.history', { count: cli?.recent.length ?? 0 })}>
        <DataTable data={cli?.recent ?? []} columns={columns} getRowId={(e) => e.id} emptyMessage={t('rt.cli.empty')} className="rounded-md border border-border" />
      </DetailSection>
      <DetailSection title={t('rt.logs.title')}>
        <RuntimeLogs runtime="cli" limit={CLI_LOGS_LIMIT} compact />
      </DetailSection>
    </DetailSheet>
  );
}
