import { useMemo, useState, type ReactNode } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { DataTable, LevelBadge, QueryView, type LogLevel } from '@core/ui/blocks';
import type { RuntimeId, RuntimeLog } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { LOGS_MAX_HEIGHT_PX, RUNTIME_LOG_LEVELS, type RuntimeLogLevel } from '../../constants/runtime-metrics';
import { runtimesKeys } from '../../sections/runtimes/runtimes-keys';

type Row = RuntimeLog & { key: string };
const col = createColumnHelper<Row>();
const ALL = 'all';

interface RuntimeLogsProps {
  runtime: RuntimeId | 'cli';
  limit: number;
  /** Trong drawer: không cuộn riêng. */
  compact?: boolean;
  /** Nút / chip thêm bên phải bộ lọc level. */
  actions?: ReactNode;
}

/** Log gần nhất của một runtime (ring buffer Redis), lọc theo level. Tìm sâu hơn → Log Explorer. */
export function RuntimeLogs({ runtime, limit, compact, actions }: RuntimeLogsProps) {
  const { t, formatTime } = useLocale();
  const [level, setLevel] = useState<RuntimeLogLevel>('');
  const query = useLiveQuery(runtimesKeys.logs(runtime, limit, level), () => runtimesApi.logs(runtime, limit, level || undefined));
  const rows = useMemo<Row[]>(() => (query.data ?? []).map((l, i) => ({ ...l, key: `${l.t}-${i}` })), [query.data]);

  const columns = useMemo(
    () => [
      col.accessor('t', { header: t('rt.logs.time'), cell: (c) => formatTime(c.getValue(), true), meta: { mono: true, width: '84px' }, enableSorting: false }),
      col.accessor('level', {
        header: t('rt.logs.level'),
        cell: (c) => <LevelBadge level={(c.getValue() === 'warning' ? 'warn' : c.getValue()) as LogLevel} />,
        meta: { width: '76px' },
        enableSorting: false,
      }),
      col.accessor('context', { header: t('rt.logs.context'), cell: (c) => c.getValue() ?? NO_VALUE, meta: { mono: true, truncate: true, width: '140px' }, enableSorting: false }),
      col.accessor('message', { header: t('rt.logs.message'), meta: { truncate: true }, enableSorting: false }),
    ],
    [t, formatTime],
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={level || ALL} onValueChange={(v) => setLevel(v === ALL || !v ? '' : (v as RuntimeLogLevel))} aria-label={t('rt.logs.level')}>
          {RUNTIME_LOG_LEVELS.map((l) => (
            <ToggleGroupItem key={l || ALL} value={l || ALL}>
              {l ? l.toUpperCase() : t('ui.feed.all')}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        {actions}
      </div>
      <QueryView query={query}>
        {() => (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.key}
            emptyMessage={t('rt.logs.empty')}
            rowTone={(r) => (r.level === 'error' || r.level === 'fatal' ? 'crit' : r.level === 'warn' ? 'warn' : undefined)}
            maxHeight={compact ? undefined : LOGS_MAX_HEIGHT_PX}
            virtual={!compact}
            className="rounded-md border border-border"
          />
        )}
      </QueryView>
    </div>
  );
}
