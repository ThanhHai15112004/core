import React from 'react';
import type { DbOverview } from '../../types/database.types';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import type { StatusTone } from '../../utils/status-tone';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** 8 KPI của database: kết nối, P95, query/s, tỷ lệ lỗi, query chậm, transaction, deadlock, dung lượng. */
export const DbKpis: React.FC<{ data: DbOverview | null }> = ({ data }) => {
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
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.length ? 'warn' : null;
  };
  const range = t(`tr.range.${data.range}`);
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'connections',
      value: k.connections.used === null ? NO_VALUE : `${Math.round(k.connections.used)} / ${k.connections.limit}`,
      sub: k.sessions === null ? t('db.kpi.poolSub') : t('db.kpi.sessionsSub', { count: k.sessions }),
      tone: alert('POOL_PRESSURE', 'POOL_WAITING') ?? (k.connections.used === null ? 'unknown' : 'ok'),
    },
    { key: 'p95', value: formatUnit(k.p95Ms, 'ms'), sub: t('db.kpi.latencySub', { p50: formatUnit(k.p50Ms, 'ms'), p99: formatUnit(k.p99Ms, 'ms') }), tone: alert('QUERY_LATENCY') ?? (k.p95Ms === null ? 'unknown' : 'ok') },
    { key: 'qps', value: formatUnit(k.queriesPerSec, '/s'), sub: t('db.kpi.fromApp', { range }), tone: 'unknown' },
    {
      key: 'errorRate',
      value: formatUnit(k.errorRatePercent, '%'),
      sub: t('db.kpi.failedSub', { count: formatCompact(k.failedQueries, locale) }),
      tone: alert('ERROR_RATE') ?? (k.errorRatePercent === null ? 'unknown' : 'ok'),
    },
    { key: 'slow', value: String(k.slowQueries), sub: t('db.kpi.slowSub', { ms: data.settings.slowQueryMs, range }), tone: alert('SLOW_QUERIES') ?? 'ok' },
    {
      key: 'transactions',
      value: k.activeTransactions === null ? NO_VALUE : String(k.activeTransactions),
      sub: k.lockWaits === null ? t('db.kpi.txSub') : t('db.kpi.lockWaitsSub', { count: k.lockWaits }),
      tone: alert('LONG_TRANSACTION', 'LOCK_WAITS') ?? (k.activeTransactions === null ? 'unknown' : 'ok'),
    },
    { key: 'deadlocks', value: String(k.deadlocks24h), sub: t('db.kpi.deadlocksSub'), tone: k.deadlocks24h > 0 ? 'warn' : 'ok' },
    { key: 'size', value: formatBytes(k.sizeBytes), sub: t('db.kpi.sizeSub'), tone: alert('STORAGE') ?? 'unknown' },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`db.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};
