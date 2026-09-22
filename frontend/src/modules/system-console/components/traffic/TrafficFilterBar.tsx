import React, { useEffect, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { TrafficFilters } from '../../types/traffic.types';
import { HTTP_METHODS, SLOW_THRESHOLDS, STATUS_FILTERS } from '../../constants/traffic';
import { formatMs } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface TrafficFilterBarProps {
  filters: TrafficFilters;
  instances: string[];
  modules: string[];
  setFilters: (patch: Partial<Record<keyof TrafficFilters, unknown>>) => void;
  /** Bộ lọc chỉ áp dụng cho danh sách request (status, tìm kiếm, latency). */
  requestFilters?: boolean;
}

const SEARCH_DEBOUNCE_MS = 400;

/** Hàng lọc gọn: Method, Status, tìm endpoint + "Thêm bộ lọc" (Instance, Module, Latency, traffic nội bộ). */
export const TrafficFilterBar: React.FC<TrafficFilterBarProps> = ({ filters, instances, modules, setFilters, requestFilters = false }) => {
  const { t } = useLocale();
  const [search, setSearch] = useState(filters.q ?? '');
  const extraActive = Boolean(filters.instance || filters.module || filters.minMs || !filters.internal);
  const [showMore, setShowMore] = useState(extraActive);

  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    if (!requestFilters || search === (filters.q ?? '')) return;
    const timer = setTimeout(() => setFilters({ q: search.trim() || undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q, requestFilters, setFilters]);

  return (
    <div className="tr-filters">
      <div className="tr-filter-row">
        <label className="tr-field">
          <span>{t('tr.filter.method')}</span>
          <select value={filters.method ?? ''} onChange={(e) => setFilters({ method: e.target.value || undefined })}>
            <option value="">{t('tr.filter.all')}</option>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {requestFilters && (
          <>
            <label className="tr-field">
              <span>{t('tr.filter.status')}</span>
              <select value={filters.status ?? ''} onChange={(e) => setFilters({ status: e.target.value || undefined })}>
                <option value="">{t('tr.filter.all')}</option>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {filters.status && !STATUS_FILTERS.includes(filters.status as never) && <option value={filters.status}>{filters.status}</option>}
              </select>
            </label>
            <label className="tr-field tr-field-search">
              <Search size={14} />
              <input
                type="search"
                value={search}
                placeholder={t('tr.filter.searchPlaceholder')}
                aria-label={t('tr.filter.search')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </>
        )}
        <button type="button" className={`scp-btn scp-btn-sm scp-btn-secondary ${extraActive ? 'is-active' : ''}`} aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
          <SlidersHorizontal size={13} /> {t('tr.filter.more')}
          {extraActive && <span className="tr-dot" />}
        </button>
      </div>

      {showMore && (
        <div className="tr-filter-row">
          <label className="tr-field">
            <span>{t('tr.filter.instance')}</span>
            <select value={filters.instance ?? ''} onChange={(e) => setFilters({ instance: e.target.value || undefined })}>
              <option value="">{t('tr.filter.all')}</option>
              {instances.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <label className="tr-field">
            <span>{t('tr.filter.module')}</span>
            <select value={filters.module ?? ''} onChange={(e) => setFilters({ module: e.target.value || undefined })}>
              <option value="">{t('tr.filter.all')}</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          {requestFilters && (
            <label className="tr-field">
              <span>{t('tr.filter.latency')}</span>
              <select value={filters.minMs ?? ''} onChange={(e) => setFilters({ minMs: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">{t('tr.filter.any')}</option>
                {SLOW_THRESHOLDS.map((ms) => (
                  <option key={ms} value={ms}>
                    &gt; {formatMs(ms)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="tr-check">
            <input type="checkbox" checked={!filters.internal} onChange={(e) => setFilters({ internal: e.target.checked ? false : undefined })} />
            {t('tr.filter.hideInternal')}
          </label>
        </div>
      )}
    </div>
  );
};
