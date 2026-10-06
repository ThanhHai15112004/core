import React from 'react';
import type { TrafficFilters } from '../../types/traffic.types';
import { HTTP_METHODS } from '../../constants/traffic';
import { useLocale } from '../../../../core/i18n/index';

interface TrafficFilterBarProps {
  filters: TrafficFilters;
  setFilters: (patch: Partial<Record<keyof TrafficFilters, unknown>>) => void;
}

/** Hàng lọc gọn: Method + ẩn traffic nội bộ (các chiều có trong label `http_request_duration_seconds`). */
export const TrafficFilterBar: React.FC<TrafficFilterBarProps> = ({ filters, setFilters }) => {
  const { t } = useLocale();
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
        <label className="tr-check">
          <input type="checkbox" checked={!filters.internal} onChange={(e) => setFilters({ internal: e.target.checked ? false : undefined })} />
          {t('tr.filter.hideInternal')}
        </label>
      </div>
    </div>
  );
};
