import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { KeyRound } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useQueryState } from '@core/router';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { DataTable, MaskedValue, PageHeader, Panel, QueryView, SearchInput, StatGrid, StatTile, StatusDot } from '@core/ui/blocks';
import { fetchSecrets, type SecretItem } from '../../services/governance.api';
import { SECURITY_CONFIG_ENV } from '../../constants/governance';
import { securityKeys } from './security-keys';

const col = createColumnHelper<SecretItem>();

/**
 * Secrets: secret key đã đăng ký, có mặt hay chưa, độ dài, nguồn (driver). Giá trị thật KHÔNG BAO GIỜ được gửi
 * về trình duyệt — cột giá trị luôn che.
 */
export const SecretsSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(securityKeys.secrets(), fetchSecrets, { tier: 'slow' });
  const [search, setSearch] = useQueryState('q', '');
  const data = query.data;

  const stats = useMemo(() => {
    if (!data) return null;
    const present = data.filter((s) => s.present).length;
    const drivers = [...new Set(data.map((s) => s.driver.toUpperCase()))];
    return { total: data.length, present, missing: data.length - present, drivers };
  }, [data]);

  const columns = useMemo(
    () => [
      col.accessor('key', {
        header: t('gov.secrets.col.key'),
        cell: (c) => <span className="font-mono text-xs font-medium text-fg">{c.getValue()}</span>,
      }),
      col.accessor((r) => (r.present ? 1 : 0), {
        id: 'present',
        header: t('gov.secrets.col.status'),
        meta: { width: '11rem' },
        cell: (c) => {
          const ok = c.row.original.present;
          return (
            <span className={ok ? 'inline-flex items-center gap-1.5 text-ok-fg' : 'inline-flex items-center gap-1.5 text-crit-fg'}>
              <StatusDot tone={ok ? 'ok' : 'crit'} />
              {ok ? t('gov.secrets.present') : t('gov.secrets.missing')}
            </span>
          );
        },
      }),
      col.accessor('length', {
        header: t('gov.secrets.col.length'),
        cell: (c) => {
          const v = c.getValue();
          return v === undefined ? <span className="text-faint">{NO_VALUE}</span> : t('gov.secrets.chars', { count: f.number(v) });
        },
        meta: { align: 'right', mono: true, width: '7rem' },
        sortUndefined: 'last',
      }),
      col.accessor('driver', {
        header: t('gov.secrets.col.driver'),
        cell: (c) => <Badge className="font-mono uppercase">{c.getValue()}</Badge>,
        meta: { width: '7rem' },
      }),
      col.display({
        id: 'value',
        header: t('gov.secrets.col.value'),
        cell: () => <MaskedValue />,
        meta: { width: '9rem' },
      }),
    ],
    [t, f],
  );

  return (
    <div>
      <PageHeader
        title={t('nav.secrets')}
        icon={KeyRound}
        status={
          stats && stats.total > 0
            ? stats.missing > 0
              ? { tone: 'warn', label: t('gov.secrets.missingCount', { count: f.number(stats.missing) }) }
              : { tone: 'ok', label: t('gov.secrets.allPresent') }
            : undefined
        }
      />

      <StatGrid columns={4}>
        <StatTile label={t('gov.secrets.kpi.total')} value={stats ? f.number(stats.total) : NO_VALUE} loading={query.isPending} hint={t('gov.secrets.kpi.totalHint')} />
        <StatTile label={t('gov.secrets.kpi.present')} value={stats ? f.number(stats.present) : NO_VALUE} loading={query.isPending} />
        <StatTile
          label={t('gov.secrets.kpi.missing')}
          value={stats ? f.number(stats.missing) : NO_VALUE}
          tone={stats && stats.missing > 0 ? 'crit' : undefined}
          loading={query.isPending}
        />
        <StatTile
          label={t('gov.secrets.kpi.driver')}
          value={stats && stats.drivers.length > 0 ? stats.drivers.join(' / ') : NO_VALUE}
          loading={query.isPending}
          hint={t('gov.common.envVar', { name: SECURITY_CONFIG_ENV.secretDriver })}
        />
      </StatGrid>

      <Panel
        title={t('gov.secrets.table')}
        hint={t('gov.secrets.tableHint')}
        flush
        actions={<SearchInput value={search} onChange={setSearch} placeholder={t('gov.secrets.search')} className="w-56 max-sm:w-40" />}
      >
        <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t('gov.secrets.empty')}>
          {(rows) => (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(r) => r.key}
              globalFilter={search}
              rowTone={(r) => (r.present ? undefined : 'crit')}
              initialSorting={[{ id: 'present', desc: false }]}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  );
};
