import React from 'react';
import { ArrowRight, CheckCircle2, Info } from 'lucide-react';
import type { CacheOverview, CacheTab } from '../../types/cache.types';
import { useLocale } from '../../../../core/i18n/index';

/** Vấn đề hiện tại: cảnh báo đang diễn ra + các kiểm tra đang ổn (bộ nhớ, eviction, kết nối). */
export const CacheAlerts: React.FC<{ data: CacheOverview; now: number; onOpen: (tab: CacheTab, id?: string | null) => void }> = ({ data, now, onOpen }) => {
  const { t, formatRelative } = useLocale();
  const rules = new Set(data.alerts.map((a) => a.rule));
  const ok: string[] = [];
  if (data.health.state === 'connected') ok.push(t('cache.alerts.connected'));
  if (!rules.has('MEMORY_PRESSURE') && data.kpis.memory.percent !== null) ok.push(t('cache.alerts.noMemoryPressure'));
  if (data.driver === 'redis' && !rules.has('EVICTIONS') && data.kpis.evictionsPerMin !== null) ok.push(t('cache.alerts.noEvictions'));
  if (!rules.has('HIT_RATE_LOW') && !rules.has('MISS_STORM') && data.hitRate.status === 'normal') ok.push(t('cache.alerts.hitRateOk'));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('cache.alerts.title')}</h3>
        {data.alerts.length > 0 && <span className="ov-count">{data.alerts.length}</span>}
      </header>
      <ul className="db-alerts">
        {data.alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'unknown'}`}>
            {a.severity === 'info' ? <Info size={14} /> : <span className="ov-dot" aria-hidden="true" />}
            <span className="db-alert-body">
              <strong>{a.title}</strong>
              <span>{a.message}</span>
              <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a.tab, a.tab === 'namespaces' ? a.namespace : null)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
        {data.alerts.length === 0 && ok.length === 0 && <li className="ov-empty-line">{t('cache.alerts.none')}</li>}
        {ok.map((line) => (
          <li key={line} className="ov-tone-ok is-ok">
            <CheckCircle2 size={14} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
