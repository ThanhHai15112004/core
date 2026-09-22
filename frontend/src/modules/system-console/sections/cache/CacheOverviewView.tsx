import React from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { CacheOverview, CacheReport, CacheTab, ImpactItem } from '../../types/cache.types';
import { CacheKpis } from '../../components/cache/CacheKpis';
import { CacheChart } from '../../components/cache/CacheChart';
import { CacheAlerts } from '../../components/cache/CacheAlerts';
import { CacheEventList } from '../../components/cache/CacheEventList';
import { NamespaceTable } from '../../components/cache/NamespaceTable';
import { TtlDistribution } from '../../components/cache/TtlDistribution';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit, trendOf } from '../../utils/performance-format';
import { formatPercent, formatTtl } from '../../utils/cache-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: CacheOverview | null;
  now: number;
  paused: boolean;
  go: (tab: CacheTab, id?: string | null) => void;
  navigate: (path: string) => void;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/**
 * Tổng quan: KPI → biểu đồ → hiệu quả (hit rate có baseline) + vấn đề → namespace → bộ nhớ + TTL →
 * ảnh hưởng tới hệ thống → báo cáo hôm nay → sự kiện.
 */
export const CacheOverviewView: React.FC<Props> = ({ data, now, paused, go, navigate }) => {
  const { t, locale } = useLocale();
  if (!data) return <CacheKpis data={null} />;
  const hr = data.hitRate;
  const reportRow = (key: keyof CacheReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`cache.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  const impactRow = (key: 'missRatePercent' | 'dbQueriesPerSec' | 'apiP95Ms', item: ImpactItem) => {
    const trend = trendOf(item.changePercent, true);
    return (
      <div key={key}>
        <dt>{t(`cache.impact.${key}`)}</dt>
        <dd>
          {formatUnit(item.current, item.unit)}
          {trend && <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span>}
        </dd>
        <small>{t('cache.impact.baseline', { value: formatUnit(item.baseline, item.unit) })}</small>
      </div>
    );
  };
  const mem = data.kpis.memory;
  const server = data.server.available ? data.server.data : null;
  const ks = data.keyspace;

  return (
    <>
      <CacheKpis data={data} />
      <CacheChart range={data.range} paused={paused} />

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.effect.title')}</h3>
            <span className="ov-section-hint">{t('cache.effect.hint')}</span>
          </header>
          <div className={`cache-effect ov-tone-${hr.status === 'low' ? 'warn' : hr.status === 'normal' ? 'ok' : 'unknown'}`}>
            <p className="db-pool-big">{formatPercent(hr.currentPercent)}</p>
            <p className="cache-effect-status">
              {hr.status === 'low' ? <TrendingDown size={14} /> : hr.status === 'normal' ? <TrendingUp size={14} /> : null}
              {t(`cache.effect.status.${hr.status}`, { reads: hr.reads, min: 5 })}
            </p>
          </div>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('cache.effect.baseline')}</dt>
              <dd>{formatPercent(hr.baselinePercent)}</dd>
            </div>
            <div>
              <dt>{t('cache.effect.change')}</dt>
              <dd className={(hr.changePoints ?? 0) <= -5 ? 'is-warn' : ''}>
                {hr.changePoints === null ? NO_VALUE : `${hr.changePoints > 0 ? '+' : ''}${hr.changePoints} ${t('cache.effect.points')}`}
              </dd>
            </div>
            <div>
              <dt>{t('cache.effect.hits')}</dt>
              <dd>{formatCompact(data.kpis.hits, locale)}</dd>
            </div>
            <div>
              <dt>{t('cache.effect.misses')}</dt>
              <dd>{formatCompact(data.kpis.misses, locale)}</dd>
            </div>
            <div>
              <dt>{t('cache.effect.avgOp')}</dt>
              <dd>{formatUnit(data.kpis.avgOpMs, 'ms')}</dd>
            </div>
            <div>
              <dt>{t('cache.effect.errors')}</dt>
              <dd className={data.kpis.errors > 0 ? 'is-warn' : ''}>{data.kpis.errors}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">{t('cache.effect.note')}</p>
        </section>
        <CacheAlerts data={data} now={now} onOpen={go} />
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.ns.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('namespaces')}>
            {t('cache.ns.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <NamespaceTable
          rows={data.topNamespaces}
          warnPercent={data.settings.hitRateWarnPercent}
          sortable={false}
          onOpen={(name) => go('namespaces', name)}
          emptyText={data.keyspace?.totalKeys === 0 ? t('cache.empty.title') : t('cache.ns.empty')}
        />
      </section>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('memory')}>
              {t('cache.memory.view')} <ArrowRight size={13} />
            </button>
          </header>
          <p className="db-pool-big">
            {formatBytes(mem.cacheBytes)}
            {mem.limitSource === 'config' && <small> / {formatBytes(mem.limitBytes)}</small>}
          </p>
          {mem.percent !== null && (
            <span className={`rt-bar ${mem.percent >= 85 ? 'is-high' : ''}`}>
              <span style={{ width: `${Math.min(100, mem.percent)}%` }} />
            </span>
          )}
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('cache.memory.largestNs')}</dt>
              <dd>{data.largestNamespace ? `${data.largestNamespace.name} · ${formatBytes(data.largestNamespace.bytes)}` : NO_VALUE}</dd>
            </div>
            {server && (
              <>
                <div>
                  <dt>{t('cache.memory.serverUsed')}</dt>
                  <dd>
                    {formatBytes(server.usedBytes)}
                    {server.maxBytes ? ` / ${formatBytes(server.maxBytes)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>{t('cache.memory.peak')}</dt>
                  <dd>{formatBytes(server.peakBytes)}</dd>
                </div>
              </>
            )}
            <div>
              <dt>{t('cache.kpi.evictions')}</dt>
              <dd className={(data.kpis.evictionsPerMin ?? 0) > 0 ? 'is-warn' : ''}>
                {data.driver === 'redis' ? (data.kpis.evictedInRange ?? NO_VALUE) : t('cache.kpi.notApplicable')}
              </dd>
            </div>
          </dl>
          <p className="pf-chart-note">{server ? t('cache.memory.sharedNote') : t(`cache.memory.note.${data.driver}`)}</p>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.ttl.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('ttl')}>
              {t('cache.ttl.view')} <ArrowRight size={13} />
            </button>
          </header>
          {ks ? (
            <>
              <TtlDistribution keyspace={ks} />
              <p className="pf-chart-note">
                {t('cache.ttl.summary', {
                  avg: ks.avgTtlMs === null ? NO_VALUE : formatTtl(ks.avgTtlMs),
                  soon: formatCompact(ks.expiringNext60s, locale),
                })}
              </p>
            </>
          ) : (
            <SectionState section={{ available: false, reason: 'disconnected', message: null }} scope="cache">
              {() => null}
            </SectionState>
          )}
        </section>
      </div>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.impact.title')}</h3>
            <button type="button" className="ov-link" onClick={() => navigate('performance')}>
              {t('cache.impact.open')} <ArrowRight size={13} />
            </button>
          </header>
          <dl className="db-stat-grid cache-impact">
            {impactRow('missRatePercent', data.relatedImpact.missRatePercent)}
            {impactRow('dbQueriesPerSec', data.relatedImpact.dbQueriesPerSec)}
            {impactRow('apiP95Ms', data.relatedImpact.apiP95Ms)}
          </dl>
          <p className="pf-chart-note">{t('cache.impact.note', { window: data.relatedImpact.windowMin, baseline: data.relatedImpact.baselineMin })}</p>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.report.title')}</h3>
            <span className="ov-section-hint">{t('db.report.hint')}</span>
          </header>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table db-report">
              <thead>
                <tr>
                  <th />
                  <th>{t('db.report.today')}</th>
                  <th>{t('db.report.yesterday')}</th>
                  <th>{t('db.report.change')}</th>
                </tr>
              </thead>
              <tbody>
                {reportRow('hits', (v) => formatCompact(v, locale), null)}
                {reportRow('misses', (v) => formatCompact(v, locale), true)}
                {reportRow('hitRatePercent', (v) => formatPercent(v), false)}
                {reportRow('sets', (v) => formatCompact(v, locale), null)}
                {reportRow('errors', (v) => String(v ?? NO_VALUE), true)}
                {reportRow('peakMemoryBytes', formatBytes, true)}
                {reportRow('peakKeys', (v) => formatCompact(v, locale), null)}
                {data.driver === 'redis' && reportRow('evictions', (v) => formatCompact(v, locale), true)}
                {data.driver === 'redis' && reportRow('expired', (v) => formatCompact(v, locale), null)}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.events.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('events')}>
            {t('db.events.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <CacheEventList events={data.events} onOpen={(tab) => go(tab)} emptyText={t('cache.events.empty')} />
      </section>
    </>
  );
};
