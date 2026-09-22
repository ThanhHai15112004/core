import React from 'react';
import { KeyRound, Search, Trash2 } from 'lucide-react';
import type { CacheRange, NamespaceRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { DbDrawer } from '../database/DbDrawer';
import { LineChart } from '../common/LineChart';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatPercent, formatTtl, toChartSeries } from '../../utils/cache-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết namespace: KPI, lịch sử key/dung lượng/hit-miss, key lớn nhất, Browse Keys, Clear Namespace. */
export const NamespaceDrawer: React.FC<{
  name: string;
  range: CacheRange;
  reloadKey: number;
  onClose: () => void;
  onBrowse: (ns: string) => void;
  onOpenKey: (key: string) => void;
  onClear: (row: NamespaceRow) => void;
}> = ({ name, range, reloadKey, onClose, onBrowse, onOpenKey, onClear }) => {
  const { t, locale, formatTime } = useLocale();
  const { data, error } = usePolling(() => cacheApi.namespace(name, range), `${name}:${range}:${reloadKey}`, 30_000);
  const n = data?.namespace;
  const chart = (list: Parameters<typeof toChartSeries>[0], title: string) => {
    const { series, unit } = toChartSeries(list);
    return (
      <div className="cache-mini-chart">
        <h4>{title}</h4>
        <LineChart
          series={series}
          unit={unit}
          height={140}
          formatTime={(ts) => formatTime(ts, range === '15m')}
          emptyText={t('cache.chart.empty')}
          ariaLabel={title}
        />
      </div>
    );
  };
  return (
    <DbDrawer title={<code>{name}</code>} meta={n?.session ? t('cache.ns.sessionHint') : t('cache.ns.drawerMeta')} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {n && data && (
        <>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('cache.ns.keys')}</dt>
              <dd>{formatCompact(n.keys, locale)}</dd>
            </div>
            <div>
              <dt>{t('cache.ns.memory')}</dt>
              <dd>{formatBytes(n.bytes)}</dd>
            </div>
            <div>
              <dt>{t('cache.ns.hitRate')}</dt>
              <dd>{formatPercent(n.hitRatePercent)}</dd>
            </div>
            <div>
              <dt>{t('cache.ns.avgTtl')}</dt>
              <dd>{n.avgTtlMs === null ? (n.keys ? t('cache.ttl.none') : NO_VALUE) : formatTtl(n.avgTtlMs)}</dd>
            </div>
            <div>
              <dt>{t('cache.ns.hitsMisses')}</dt>
              <dd>
                {formatCompact(n.hits, locale)} / {formatCompact(n.misses, locale)}
              </dd>
            </div>
            <div>
              <dt>{t('cache.ns.persistent')}</dt>
              <dd>{formatCompact(n.persistent, locale)}</dd>
            </div>
          </dl>
          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onBrowse(name)}>
              <Search size={13} /> {t('cache.ns.browse')}
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              disabled={!data.actionsEnabled || n.keys === 0}
              title={!data.actionsEnabled ? t('cache.action.disabled') : undefined}
              onClick={() => onClear(n)}
            >
              <Trash2 size={13} /> {t('cache.ns.clear')}
            </button>
          </div>
          {n.session && (
            <p className="scp-alert-warning">
              <KeyRound size={13} /> {t('cache.ns.sessionWarning')}
            </p>
          )}
          {chart([data.history.keys], t('cache.ns.historyKeys'))}
          {chart([data.history.bytes], t('cache.ns.historyBytes'))}
          {chart([data.history.hits, data.history.misses], t('cache.ns.historyHits'))}
          {data.largestKeys.length > 0 && (
            <>
              <h4>{t('cache.memory.largestKeys')}</h4>
              <ul className="cache-key-list">
                {data.largestKeys.map((k) => (
                  <li key={k.key}>
                    <button type="button" className="ov-link" onClick={() => onOpenKey(k.key)}>
                      <code>{k.key}</code>
                    </button>
                    <span className={k.large ? 'is-warn' : ''}>{formatBytes(k.bytes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="pf-chart-note">{t('cache.ns.historyNote')}</p>
        </>
      )}
    </DbDrawer>
  );
};
