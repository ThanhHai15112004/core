import { useLocale } from '@core/i18n/index';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@core/ui/primitives';
import { FilterBar, SearchInput } from '@core/ui/blocks';
import { ENDPOINT_STATUS_FILTERS, HTTP_METHODS } from '../../constants/traffic';
import type { TrafficPage } from '../../sections/traffic/useTrafficPage';

const ALL = '__all__';

/**
 * Bộ lọc nằm trên URL: method + bỏ traffic nội bộ (lọc ở Prometheus, áp dụng cho mọi tab);
 * `endpoints` thêm tìm route và lọc trạng thái (lọc ở bảng).
 */
export function TrafficFilterBar({ page, endpoints = false }: { page: TrafficPage; endpoints?: boolean }) {
  const { t } = useLocale();
  const { method, scope, status, search, setFilter, clearFilters, hasFilters } = page;
  return (
    <FilterBar active={hasFilters} onClear={clearFilters}>
      {endpoints && <SearchInput value={search} onChange={(v) => setFilter({ q: v || null })} placeholder={t('tr.filter.search')} className="w-full sm:w-64" />}
      <Select value={method ?? ALL} onValueChange={(v) => setFilter({ method: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="w-36" aria-label={t('tr.filter.method')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>
            {t('tr.filter.method')}: {t('tr.filter.all')}
          </SelectItem>
          {HTTP_METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {endpoints && (
        <Select value={status ?? ALL} onValueChange={(v) => setFilter({ status: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="w-44" aria-label={t('tr.filter.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {t('tr.filter.status')}: {t('tr.filter.all')}
            </SelectItem>
            {ENDPOINT_STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`tr.filter.statusOption.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <label className="flex h-7 items-center gap-2 text-sm text-fg-2">
        <Switch checked={scope === 'app'} onCheckedChange={(on) => setFilter({ scope: on ? 'app' : null })} />
        {t('tr.filter.hideInternal')}
      </label>
    </FilterBar>
  );
}
