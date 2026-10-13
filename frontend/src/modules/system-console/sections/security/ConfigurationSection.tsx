import React, { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useQueryState } from '@core/router';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { FilterBar, KeyValueGrid, MaskedValue, PageHeader, Panel, PanelState, QueryView, SearchInput, StatGrid, StatTile } from '@core/ui/blocks';
import { fetchConfiguration, type ConfigItem } from '../../services/governance.api';
import { FILTER_ALL } from '../../constants/governance';
import { securityKeys } from './security-keys';

/** Giá trị đã nạp → chuỗi hiển thị; `null` = rỗng (KeyValueGrid hiện `—`). */
function plainValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ') : null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function matches(item: ConfigItem, q: string): boolean {
  if (!q) return true;
  const hay = [item.domain, item.key, item.sensitive ? '' : (plainValue(item.value) ?? '')].join(' ').toLowerCase();
  return hay.includes(q);
}

function ConfigValue({ item }: { item: ConfigItem }) {
  const { t } = useLocale();
  const text = item.sensitive ? null : plainValue(item.value);
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      {item.sensitive ? (
        <MaskedValue />
      ) : typeof item.value === 'boolean' ? (
        <Badge tone={item.value ? 'ok' : undefined} size="xs" className="font-mono">
          {String(item.value)}
        </Badge>
      ) : (
        <span className={text === null ? 'text-faint' : 'min-w-0 break-all font-mono text-xs text-fg'}>{text ?? NO_VALUE}</span>
      )}
      {item.source === 'env' && (
        <Badge tone="info" size="xs" className="shrink-0">
          {t('gov.config.source.env')}
        </Badge>
      )}
    </span>
  );
}

/** Cấu hình đã nạp: số tham số theo nguồn → lọc theo domain + tìm → nhóm theo domain. Giá trị nhạy cảm luôn che. */
export const ConfigurationSection: React.FC = () => {
  const { t } = useLocale();
  const f = useFormat();
  /* Cấu hình chỉ đổi khi khởi động lại → không tự làm mới, bấm làm mới để tải lại. */
  const query = useLiveQuery(securityKeys.configuration(), () => fetchConfiguration(), { tier: 'static' });
  const [search, setSearch] = useQueryState('q', '');
  const [domain, setDomain] = useQueryState('domain', FILTER_ALL);
  const data = query.data;

  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of data ?? []) counts.set(i.domain, (counts.get(i.domain) ?? 0) + 1);
    return [...counts];
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const env = data.filter((i) => i.source === 'env').length;
    return { total: data.length, env, defaults: data.length - env, sensitive: data.filter((i) => i.sensitive).length };
  }, [data]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, ConfigItem[]>();
    for (const i of data ?? []) {
      if (domain !== FILTER_ALL && i.domain !== domain) continue;
      if (!matches(i, q)) continue;
      map.set(i.domain, [...(map.get(i.domain) ?? []), i]);
    }
    return [...map];
  }, [data, domain, search]);

  const filtered = Boolean(search.trim()) || domain !== FILTER_ALL;

  return (
    <div>
      <PageHeader title={t('nav.configuration')} icon={Settings2} />

      <StatGrid columns={4}>
        <StatTile label={t('gov.config.kpi.total')} value={stats ? f.number(stats.total) : NO_VALUE} sub={stats ? t('gov.config.kpi.domains', { count: f.number(domains.length) }) : undefined} loading={query.isPending} />
        <StatTile label={t('gov.config.kpi.env')} value={stats ? f.number(stats.env) : NO_VALUE} loading={query.isPending} hint={t('gov.config.kpi.envHint')} />
        <StatTile label={t('gov.config.kpi.defaults')} value={stats ? f.number(stats.defaults) : NO_VALUE} loading={query.isPending} hint={t('gov.config.kpi.defaultsHint')} />
        <StatTile label={t('gov.config.kpi.sensitive')} value={stats ? f.number(stats.sensitive) : NO_VALUE} loading={query.isPending} hint={t('gov.config.kpi.sensitiveHint')} />
      </StatGrid>

      <FilterBar
        active={filtered}
        onClear={() => {
          setSearch(null);
          setDomain(null);
        }}
      >
        <SearchInput value={search} onChange={setSearch} placeholder={t('gov.config.search')} className="w-72 max-sm:w-full" />
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger aria-label={t('gov.config.domain')} className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FILTER_ALL}>{t('gov.config.allDomains')}</SelectItem>
            {domains.map(([d, count]) => (
              <SelectItem key={d} value={d}>
                {t('gov.config.domainOption', { domain: d, count: f.number(count) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t('gov.config.empty')}>
        {() =>
          groups.length === 0 ? (
            <PanelState status="empty" message={t('ui.table.noMatch')} />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(([d, items]) => (
                <Panel key={d} title={<span className="font-mono">{d}</span>} actions={<Badge size="xs">{f.number(items.length)}</Badge>}>
                  <KeyValueGrid columns={3} items={items.map((i) => ({ key: i.key, label: i.key, value: <ConfigValue item={i} /> }))} />
                </Panel>
              ))}
            </div>
          )
        }
      </QueryView>
    </div>
  );
};
