import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { DataTable, Panel, PanelState, StatGrid, StatTile } from '@core/ui/blocks';
import type { DomainEventCatalogRow, DomainEventHandlerRow } from '../../types/messaging.types';
import { DOMAIN_EVENT_CRITICALITY_TONE } from '../../constants/messaging';
import { messagingApi } from '../../services/messaging.api';
import { messagingKeys } from '../../sections/messaging/messaging-keys';

const handlerCol = createColumnHelper<DomainEventHandlerRow>();
const catalogCol = createColumnHelper<DomainEventCatalogRow>();

/** Hiển thị danh mục Domain Event, danh sách handler đăng ký (required/optional) và thống kê runtime. */
export function DomainEventsPanel() {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(messagingKeys.domainEvents(), () => messagingApi.domainEvents());
  const d = query.data;

  const handlerColumns = useMemo(
    () => [
      handlerCol.accessor('id', {
        header: t('messaging.domainEvents.handlers.id'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
            {c.row.original.description && <div className="truncate text-2xs text-faint">{c.row.original.description}</div>}
          </div>
        ),
      }),
      handlerCol.accessor('module', {
        header: t('messaging.domainEvents.handlers.module'),
        cell: (c) => <Badge variant="outline" className="font-mono">{c.getValue()}</Badge>,
      }),
      handlerCol.accessor('eventPattern', {
        header: t('messaging.domainEvents.handlers.pattern'),
        cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
      }),
      handlerCol.accessor('criticality', {
        header: t('messaging.domainEvents.handlers.criticality'),
        cell: (c) => (
          <Badge tone={DOMAIN_EVENT_CRITICALITY_TONE[c.getValue()]}>
            {t(`messaging.domainEvents.handlers.criticalityOf.${c.getValue()}`)}
          </Badge>
        ),
      }),
      handlerCol.accessor('invokedCount', {
        header: t('messaging.domainEvents.handlers.invoked'),
        cell: (c) => f.number(c.getValue()),
        meta: { align: 'right', mono: true },
      }),
      handlerCol.accessor('failedCount', {
        header: t('messaging.domainEvents.handlers.failed'),
        cell: (c) => (
          <span className={c.getValue() > 0 ? 'text-crit-fg' : 'text-faint'}>
            {f.number(c.getValue())}
          </span>
        ),
        meta: { align: 'right', mono: true },
      }),
    ],
    [t, f],
  );

  const catalogColumns = useMemo(
    () => [
      catalogCol.accessor('type', {
        header: t('messaging.domainEvents.catalog.type'),
        cell: (c) => <span className="font-mono text-xs text-fg">{c.getValue()}</span>,
      }),
      catalogCol.accessor('dotName', {
        header: t('messaging.domainEvents.catalog.dotName'),
        cell: (c) => <span className="font-mono text-xs text-muted">{c.getValue()}</span>,
      }),
      catalogCol.accessor('module', {
        header: t('messaging.domainEvents.catalog.module'),
        cell: (c) => <Badge variant="outline" className="font-mono">{c.getValue()}</Badge>,
      }),
      catalogCol.accessor('subscribedHandlers', {
        header: t('messaging.domainEvents.catalog.handlers'),
        cell: (c) => f.number(c.getValue()),
        meta: { align: 'right', mono: true },
      }),
    ],
    [t, f],
  );

  if (!d) {
    return (
      <Panel title={t('messaging.domainEvents.handlers.title')}>
        <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} className="p-3" />
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <StatGrid columns={4}>
        <StatTile label={t('messaging.domainEvents.kpi.catalog')} value={f.number(d.stats.catalogCount)} />
        <StatTile label={t('messaging.domainEvents.kpi.handlers')} value={f.number(d.stats.handlerCount)} />
        <StatTile label={t('messaging.domainEvents.kpi.published')} value={f.number(d.stats.totalPublished)} />
        <StatTile
          label={t('messaging.domainEvents.kpi.failures')}
          value={`${f.number(d.stats.totalRequiredFailures)} / ${f.number(d.stats.totalOptionalFailures)}`}
          tone={d.stats.totalRequiredFailures > 0 ? 'crit' : d.stats.totalOptionalFailures > 0 ? 'warn' : undefined}
        />
      </StatGrid>

      <Panel title={t('messaging.domainEvents.handlers.title')} hint={t('messaging.domainEvents.handlers.hint')} flush>
        <DataTable
          data={d.handlers}
          columns={handlerColumns}
          getRowId={(r) => r.id}
          emptyMessage={t('messaging.domainEvents.handlers.empty')}
        />
      </Panel>

      <Panel title={t('messaging.domainEvents.catalog.title')} hint={t('messaging.domainEvents.catalog.hint')} flush>
        <DataTable
          data={d.catalog}
          columns={catalogColumns}
          getRowId={(r) => r.dotName}
          emptyMessage={t('messaging.domainEvents.catalog.empty')}
        />
      </Panel>
    </div>
  );
}
