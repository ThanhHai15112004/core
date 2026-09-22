import React from 'react';
import type { CacheOverview } from '../../types/cache.types';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatPercent, hitRateTone } from '../../utils/cache-format';
import type { StatusTone } from '../../utils/status-tone';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** 8 KPI: hit rate, bộ nhớ, số key, ops/s, miss rate, eviction, hết hạn, kết nối. */
export const CacheKpis: React.FC<{ data: CacheOverview | null }> = ({ data }) => {
  const { t, locale } = useLocale();
  if (!data) {
    return (
      <div className="ov-kpi-grid db-kpi-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }
  const k = data.kpis;
  const redis = data.driver === 'redis';
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
  };
  const range = t(`tr.range.${data.range}`);
  const reads = k.hits + k.misses;
  const mem = k.memory;
  const memValue =
    mem.limitSource === 'config'
      ? `${formatBytes(mem.cacheBytes)} / ${formatBytes(mem.limitBytes)}`
      : mem.cacheBytes === null
        ? NO_VALUE
        : formatBytes(mem.cacheBytes);
  const memSub =
    mem.limitSource === 'maxmemory'
      ? t('cache.kpi.memoryServerSub', { percent: formatPercent(mem.percent), limit: formatBytes(mem.limitBytes) })
      : mem.limitSource === 'config'
        ? t('cache.kpi.memoryLimitSub', { percent: formatPercent(mem.percent) })
        : t('cache.kpi.memoryNoLimit');
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'hitRate',
      value: formatPercent(k.hitRatePercent),
      sub: reads
        ? t('cache.kpi.hitsSub', { hits: formatCompact(k.hits, locale), misses: formatCompact(k.misses, locale), range })
        : t('cache.kpi.noReads', { range }),
      tone: alert('HIT_RATE_LOW', 'MISS_STORM') ?? (hitRateTone(k.hitRatePercent, data.settings.hitRateWarnPercent) as StatusTone),
    },
    { key: 'memory', value: memValue, sub: memSub, tone: alert('MEMORY_PRESSURE') ?? (mem.percent === null ? 'unknown' : 'ok') },
    {
      key: 'keys',
      value: k.keys === null ? NO_VALUE : `${formatCompact(k.keys, locale)}${k.keysTruncated ? '+' : ''}`,
      sub: data.keyspace
        ? t('cache.kpi.keysSub', { expiring: formatCompact(data.keyspace.expiring, locale), persistent: formatCompact(data.keyspace.persistent, locale) })
        : NO_VALUE,
      tone: 'unknown',
    },
    {
      key: 'ops',
      value: formatUnit(k.opsPerSec, '/s'),
      sub: t('cache.kpi.opsSub', { get: formatUnit(k.getsPerSec, '/s'), set: formatUnit(k.setsPerSec, '/s'), del: formatUnit(k.deletesPerSec, '/s') }),
      tone: 'unknown',
    },
    { key: 'missRate', value: formatPercent(k.missRatePercent), sub: t('cache.kpi.missSub', { range }), tone: alert('MISS_STORM') ?? 'unknown' },
    {
      key: 'evictions',
      value: redis ? (k.evictionsPerMin === null ? NO_VALUE : formatUnit(k.evictionsPerMin, '/min')) : t('cache.kpi.notApplicable'),
      sub: redis ? t('cache.kpi.serverWide', { total: k.evictedInRange ?? NO_VALUE }) : t('cache.kpi.memoryDriver'),
      tone: alert('EVICTIONS') ?? (k.evictionsPerMin === null ? 'unknown' : 'ok'),
    },
    {
      key: 'expired',
      value: redis ? (k.expiredPerMin === null ? NO_VALUE : formatUnit(k.expiredPerMin, '/min')) : t('cache.kpi.notApplicable'),
      sub: redis ? t('cache.kpi.expiredSub') : t('cache.kpi.memoryDriver'),
      tone: alert('EXPIRY_SPIKE') ?? 'unknown',
    },
    {
      key: 'connections',
      value: k.connections === null ? (redis ? NO_VALUE : t('cache.kpi.notApplicable')) : String(k.connections),
      sub: redis ? t('cache.kpi.connectionsSub') : t('cache.kpi.memoryDriver'),
      tone: alert('REJECTED_CONNECTIONS', 'CONNECTIONS_HIGH') ?? 'unknown',
    },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`cache.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};
