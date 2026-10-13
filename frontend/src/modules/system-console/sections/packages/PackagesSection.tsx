import React, { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { worstTone } from '@core/theme';
import { setSearchParams, useQueryState } from '@core/router';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { ConfirmDialog, DataTable, FilterBar, PageHeader, Panel, QueryView, SearchInput, StatGrid, StatTile, StatusDot } from '@core/ui/blocks';
import type { PackageActionDescriptor, PackageSummary } from '../../types/packages.types';
import { useConsoleData } from '../../context/console-data-context';
import { FILTER_ALL, PACKAGE_CATEGORIES, PACKAGE_CATEGORY_ICON, PACKAGE_METRICS_PREVIEW, PACKAGE_STATUS_TONE } from '../../constants/governance';
import { usePackagesQuery } from './usePackages';
import { PackageDetailSheet } from './PackageDetailSheet';

const col = createColumnHelper<PackageSummary>();

interface PendingAction {
  pkg: PackageSummary;
  action: PackageActionDescriptor;
}

/**
 * Package hạ tầng (contract ManageablePackage): đếm theo trạng thái → lọc danh mục + tìm → bảng; bấm dòng mở drawer
 * (`?item=<packageId>`) có tóm tắt, metric, thao tác và JSON gốc. Thao tác nguy hiểm phải xác nhận.
 */
export const PackagesSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const query = usePackagesQuery();
  const { executeAction } = useConsoleData();
  const [search, setSearch] = useQueryState('q', '');
  const [category, setCategory] = useQueryState('category', FILTER_ALL);
  const [itemId] = useQueryState('item', '');
  const [confirm, setConfirm] = useState<PendingAction | null>(null);
  const data = query.data;

  /* executeAction đã toast kết quả và làm mới dữ liệu console. */
  const run = useMutation({
    mutationFn: ({ pkg, action }: PendingAction) => executeAction(pkg.packageId, action.id),
    onSettled: () => setConfirm(null),
  });
  const request = (pkg: PackageSummary, action: PackageActionDescriptor) => (action.isDanger ? setConfirm({ pkg, action }) : run.mutate({ pkg, action }));
  const openItem = (id: string | null) => setSearchParams({ item: id }, id ? 'push' : 'replace');

  const categories = useMemo(() => {
    const present = new Set((data ?? []).map((p) => p.category));
    return [...PACKAGE_CATEGORIES.filter((c) => present.has(c)), ...[...present].filter((c) => !PACKAGE_CATEGORIES.includes(c))];
  }, [data]);

  const counts = useMemo(() => {
    const by = { healthy: 0, warning: 0, error: 0, idle: 0 };
    for (const p of data ?? []) by[p.statusReport.status] = (by[p.statusReport.status] ?? 0) + 1;
    return by;
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (category === FILTER_ALL || p.category === category) &&
        (!q || [p.displayName, p.packageId, p.statusReport.summary].some((s) => s.toLowerCase().includes(q))),
    );
  }, [data, category, search]);

  const categoryLabel = (c: string) => {
    const key = `gov.packages.category.${c}`;
    const label = t(key);
    return label === key ? c : label;
  };

  const columns = useMemo(
    () => [
      col.accessor('displayName', {
        header: t('gov.packages.col.package'),
        cell: (c) => {
          const p = c.row.original;
          const Icon = PACKAGE_CATEGORY_ICON[p.category] ?? PACKAGE_CATEGORY_ICON.custom;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon className="size-4 shrink-0 text-muted" />
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">{p.displayName}</div>
                <div className="truncate font-mono text-2xs text-faint">{p.packageId}</div>
              </div>
            </div>
          );
        },
        meta: { width: '22%' },
      }),
      col.accessor((p) => p.statusReport.status, {
        id: 'status',
        header: t('gov.packages.col.status'),
        cell: (c) => {
          const tone = PACKAGE_STATUS_TONE[c.getValue()] ?? 'unknown';
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <StatusDot tone={tone} />
              {t(`console.status.${c.getValue()}`)}
            </span>
          );
        },
        meta: { width: '9rem' },
      }),
      col.accessor('category', {
        header: t('gov.packages.col.category'),
        cell: (c) => <Badge>{categoryLabel(c.getValue())}</Badge>,
        meta: { width: '8rem' },
      }),
      col.accessor((p) => p.statusReport.summary, {
        id: 'summary',
        header: t('gov.packages.col.summary'),
        meta: { truncate: true },
      }),
      col.display({
        id: 'metrics',
        header: t('gov.packages.col.metrics'),
        cell: (c) => {
          const entries = Object.entries(c.row.original.statusReport.metrics).slice(0, PACKAGE_METRICS_PREVIEW);
          if (entries.length === 0) return <span className="text-faint">{NO_VALUE}</span>;
          return (
            <span className="block truncate font-mono text-2xs text-muted">
              {entries.map(([k, v]) => t('gov.packages.metricPair', { key: k, value: String(v) })).join(' · ')}
            </span>
          );
        },
        meta: { width: '24%', className: 'max-w-0' },
      }),
      col.accessor((p) => p.actions.length, {
        id: 'actions',
        header: t('gov.packages.col.actions'),
        cell: (c) => (c.getValue() > 0 ? <Badge tone={c.row.original.actions.some((a) => a.isDanger) ? 'warn' : undefined}>{f.number(c.getValue())}</Badge> : <span className="text-faint">{NO_VALUE}</span>),
        meta: { align: 'right', width: '6rem' },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, f],
  );

  const tone = data && data.length > 0 ? worstTone(data.map((p) => PACKAGE_STATUS_TONE[p.statusReport.status] ?? 'unknown')) : undefined;
  const problems = counts.warning + counts.error;
  const selected = data?.find((p) => p.packageId === itemId) ?? null;

  return (
    <div>
      <PageHeader
        title={t('nav.packages')}
        icon={Package}
        status={tone ? { tone, label: problems > 0 ? t('gov.packages.needAttention', { count: f.number(problems) }) : t('console.status.healthy') } : undefined}
      />

      <StatGrid columns={4}>
        <StatTile label={t('gov.packages.kpi.total')} value={data ? f.number(data.length) : NO_VALUE} sub={data && counts.idle > 0 ? t('gov.packages.kpi.idle', { count: f.number(counts.idle) }) : undefined} loading={query.isPending} />
        <StatTile label={t('gov.packages.kpi.healthy')} value={data ? f.number(counts.healthy) : NO_VALUE} loading={query.isPending} />
        <StatTile label={t('gov.packages.kpi.warning')} value={data ? f.number(counts.warning) : NO_VALUE} tone={counts.warning > 0 ? 'warn' : undefined} loading={query.isPending} />
        <StatTile label={t('gov.packages.kpi.error')} value={data ? f.number(counts.error) : NO_VALUE} tone={counts.error > 0 ? 'crit' : undefined} loading={query.isPending} />
      </StatGrid>

      <FilterBar
        active={Boolean(search) || category !== FILTER_ALL}
        onClear={() => {
          setSearch(null);
          setCategory(null);
        }}
      >
        {categories.length > 1 && (
          <ToggleGroup type="single" value={category} onValueChange={(v) => v && setCategory(v)} aria-label={t('gov.packages.col.category')} className="max-w-full overflow-x-auto">
            <ToggleGroupItem value={FILTER_ALL}>{t('gov.packages.category.all')}</ToggleGroupItem>
            {categories.map((c) => (
              <ToggleGroupItem key={c} value={c}>
                {categoryLabel(c)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder={t('gov.packages.search')} className="w-64 max-sm:w-full" />
      </FilterBar>

      <Panel flush>
        <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t('gov.packages.empty')}>
          {() => (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(p) => p.packageId}
              onRowClick={(p) => openItem(p.packageId)}
              activeRowId={selected?.packageId ?? null}
              rowTone={(p) => {
                const tn = PACKAGE_STATUS_TONE[p.statusReport.status];
                return tn === 'warn' || tn === 'crit' ? tn : undefined;
              }}
              emptyMessage={t('ui.table.noMatch')}
            />
          )}
        </QueryView>
      </Panel>

      <PackageDetailSheet
        pkg={selected}
        onClose={() => openItem(null)}
        onAction={request}
        runningId={run.isPending ? (run.variables?.action.id ?? null) : null}
        categoryLabel={categoryLabel}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !run.isPending && setConfirm(null)}
        tone="danger"
        title={t('gov.packages.confirm.title', { action: confirm?.action.label ?? '' })}
        description={t('gov.packages.confirm.description', { pkg: confirm?.pkg.displayName ?? '' })}
        impact={[confirm?.action.description || t('gov.packages.confirm.defaultImpact')]}
        typeToConfirm={confirm?.pkg.packageId}
        confirmLabel={t('gov.packages.confirm.run')}
        loading={run.isPending}
        onConfirm={() => confirm && run.mutate(confirm)}
      />
    </div>
  );
};
