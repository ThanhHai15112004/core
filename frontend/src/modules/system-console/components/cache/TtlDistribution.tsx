import React from 'react';
import type { KeyspaceSummary } from '../../types/cache.types';
import { TTL_BUCKETS } from '../../constants/cache';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

/** Phân bố TTL của key (thanh ngang) — nhìn ra chính sách cache sai (quá nhiều key không TTL / TTL quá ngắn). */
export const TtlDistribution: React.FC<{ keyspace: KeyspaceSummary }> = ({ keyspace }) => {
  const { t, locale } = useLocale();
  const max = Math.max(1, ...TTL_BUCKETS.map((b) => keyspace.ttlDistribution[b]));
  return (
    <ul className="cache-bars">
      {TTL_BUCKETS.map((b) => {
        const n = keyspace.ttlDistribution[b];
        return (
          <li key={b} className={b === 'none' ? 'is-muted' : b === 'lt1m' && n > 0 ? 'is-warn' : ''}>
            <span className="cache-bar-label">{t(`cache.ttl.bucket.${b}`)}</span>
            <span className="cache-bar-track">
              <span style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="cache-bar-value">{formatCompact(n, locale)}</span>
          </li>
        );
      })}
    </ul>
  );
};

/** Thanh ngang tổng quát (bộ nhớ theo namespace…). */
export const BarList: React.FC<{ items: { id: string; label: React.ReactNode; value: number; text: string; onClick?: () => void }[] }> = ({ items }) => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="cache-bars">
      {items.map((i) => (
        <li key={i.id}>
          {i.onClick ? (
            <button type="button" className="cache-bar-label ov-link" onClick={i.onClick}>
              {i.label}
            </button>
          ) : (
            <span className="cache-bar-label">{i.label}</span>
          )}
          <span className="cache-bar-track">
            <span style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="cache-bar-value">{i.text}</span>
        </li>
      ))}
    </ul>
  );
};
