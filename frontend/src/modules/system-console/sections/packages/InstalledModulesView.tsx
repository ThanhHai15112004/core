import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { DataTable, FilterBar, Panel, QueryView, SearchInput, StatGrid, StatTile, StatusDot } from '@core/ui/blocks';
import type { InstalledModule } from '../../types/packages.types';
import { useInstalledModulesQuery } from './usePackages';

const col = createColumnHelper<InstalledModule>();

type StatusFilter = 'all' | 'enabled' | 'disabled';

export const InstalledModulesView: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const query = useInstalledModulesQuery();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const data = query.data;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (m) =>
        (statusFilter === 'all' || m.status === statusFilter) &&
        (!q ||
          [m.name, m.displayName, m.category, ...m.dependencies].some((s) =>
            s.toLowerCase().includes(q),
          )),
    );
  }, [data?.items, statusFilter, search]);

  const columns = useMemo(
    () => [
      col.accessor('displayName', {
        header: t('gov.modules.col.name'),
        cell: (c) => {
          const m = c.row.original;
          return (
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{m.displayName}</div>
              <div className="truncate font-mono text-2xs text-faint">{m.name}</div>
            </div>
          );
        },
        meta: { width: '24%' },
      }),
      col.accessor('version', {
        header: t('gov.modules.col.version'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
        meta: { width: '7rem' },
      }),
      col.accessor('type', {
        header: t('gov.modules.col.type'),
        cell: (c) => (
          <Badge tone={c.getValue() === 'project' ? 'info' : undefined}>
            {t(c.getValue() === 'project' ? 'gov.modules.typeProject' : 'gov.modules.typeCore')}
          </Badge>
        ),
        meta: { width: '7rem' },
      }),
      col.accessor('status', {
        header: t('gov.modules.col.status'),
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <StatusDot tone={c.getValue() === 'enabled' ? 'ok' : 'unknown'} />
            {t(c.getValue() === 'enabled' ? 'gov.modules.statusEnabled' : 'gov.modules.statusDisabled')}
          </span>
        ),
        meta: { width: '8rem' },
      }),
      col.accessor('category', {
        header: t('gov.modules.col.category'),
        cell: (c) => <Badge>{c.getValue()}</Badge>,
        meta: { width: '9rem' },
      }),
      col.accessor((m) => m.dependencies.join(', '), {
        id: 'dependencies',
        header: t('gov.modules.col.dependencies'),
        cell: (c) => (
          <span className="block truncate font-mono text-2xs text-muted">
            {c.getValue() || NO_VALUE}
          </span>
        ),
        meta: { truncate: true },
      }),
      col.accessor('tablesCount', {
        header: t('gov.modules.col.tables'),
        cell: (c) => (c.getValue() > 0 ? f.number(c.getValue()) : NO_VALUE),
        meta: { align: 'right', mono: true, width: '6rem' },
      }),
    ],
    [t, f],
  );

  return (
    <>
      <StatGrid columns={4}>
        <StatTile label={t('gov.modules.kpi.total')} value={data ? f.number(data.summary.total) : NO_VALUE} loading={query.isPending} />
        <StatTile label={t('gov.modules.kpi.enabled')} value={data ? f.number(data.summary.enabled) : NO_VALUE} tone="ok" loading={query.isPending} />
        <StatTile label={t('gov.modules.kpi.disabled')} value={data ? f.number(data.summary.disabled) : NO_VALUE} tone={data && data.summary.disabled > 0 ? 'warn' : undefined} loading={query.isPending} />
        <StatTile label={t('gov.modules.kpi.project')} value={data ? f.number(data.summary.project) : NO_VALUE} loading={query.isPending} />
      </StatGrid>

      <FilterBar
        active={Boolean(search) || statusFilter !== 'all'}
        onClear={() => {
          setSearch('');
          setStatusFilter('all');
        }}
      >
        <ToggleGroup
          type="single"
          value={statusFilter}
          onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}
          aria-label={t('gov.modules.col.status')}
        >
          <ToggleGroupItem value="all">{t('gov.modules.filterAll')}</ToggleGroupItem>
          <ToggleGroupItem value="enabled">{t('gov.modules.filterEnabled')}</ToggleGroupItem>
          <ToggleGroupItem value="disabled">{t('gov.modules.filterDisabled')}</ToggleGroupItem>
        </ToggleGroup>
        <SearchInput value={search} onChange={setSearch} placeholder={t('gov.modules.search')} className="w-72 max-sm:w-full" />
      </FilterBar>

      <Panel flush>
        <QueryView query={query} isEmpty={(d) => d.items.length === 0} emptyMessage={t('gov.modules.empty')}>
          {() => (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(m) => m.name}
              rowTone={(m) => (m.status === 'disabled' ? 'warn' : undefined)}
              emptyMessage={t('ui.table.noMatch')}
            />
          )}
        </QueryView>
      </Panel>
    </>
  );
};
