import React from 'react';
import type { Capacity, Growth, Section } from '../../types/storage.types';
import { SectionState } from '../database/SectionState';
import { formatBytes } from '../../utils/database-format';
import { formatGrowth } from '../../utils/storage-format';
import { formatUnit } from '../../utils/performance-format';
import { useLocale } from '../../../../core/i18n/index';

/** Capacity: thanh % chỉ khi biết tổng dung lượng; S3 không cấu hình → "Provider managed", không bịa %. */
export const CapacityCard: React.FC<{ capacity: Section<Capacity>; growth: Growth; usedBytes: number | null; product: string }> = ({
  capacity,
  growth,
  usedBytes,
  product,
}) => {
  const { t } = useLocale();
  return (
    <SectionState section={capacity} driver={product} scope="storage">
      {(c) => (
        <>
          <p className="db-pool-big">
            {formatBytes(c.usedBytes ?? usedBytes)}
            {c.totalBytes !== null && <small> / {formatBytes(c.totalBytes)}</small>}
          </p>
          {c.percent !== null ? (
            <span className={`rt-bar ${c.percent >= 85 ? 'is-high' : ''}`}>
              <span style={{ width: `${Math.min(100, c.percent)}%` }} />
            </span>
          ) : (
            <p className="ov-section-hint">{t('storage.capacity.providerManaged')}</p>
          )}
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('storage.capacity.percent')}</dt>
              <dd>{formatUnit(c.percent, '%')}</dd>
            </div>
            <div>
              <dt>{t('storage.capacity.available')}</dt>
              <dd>
                {c.freeBytes !== null
                  ? formatBytes(c.freeBytes)
                  : c.totalBytes !== null && c.usedBytes !== null
                    ? formatBytes(c.totalBytes - c.usedBytes)
                    : '--'}
              </dd>
            </div>
            <div>
              <dt>{t('storage.growth.today')}</dt>
              <dd>{formatGrowth(growth.todayBytes)}</dd>
            </div>
            <div>
              <dt>{t('storage.growth.d7')}</dt>
              <dd>{formatGrowth(growth.d7Bytes)}</dd>
            </div>
            <div>
              <dt>{t('storage.growth.d30')}</dt>
              <dd>{formatGrowth(growth.d30Bytes)}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">{t(`storage.capacity.source.${c.source ?? 'none'}`)}</p>
        </>
      )}
    </SectionState>
  );
};
