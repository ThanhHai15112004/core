import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { CacheRange, CacheTab } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { SectionState } from '../../components/database/SectionState';
import { BarList, TtlDistribution } from '../../components/cache/TtlDistribution';
import { CacheChart } from '../../components/cache/CacheChart';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatPercent, formatTtl } from '../../utils/cache-format';
import { formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Go = (tab: CacheTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;

/** Bộ nhớ: dung lượng cache của core + Redis server (dùng chung), phân bố theo namespace, key lớn, eviction. */
export const CacheMemoryView: React.FC<{ range: CacheRange; paused: boolean; driver: string; reloadKey: number; go: Go }> = ({
  range,
  paused,
  driver,
  reloadKey,
  go,
}) => {
  const { t, locale, formatTime } = useLocale();
  const { data } = usePolling(() => cacheApi.memory(range), `mem:${range}:${reloadKey}`, 30_000, paused);
  const d = data;
  return (
    <>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.cacheTitle')}</h3>
            {d?.scannedAt && <span className="ov-section-hint">{t('cache.memory.scannedAt', { time: formatTime(Date.parse(d.scannedAt), true) })}</span>}
          </header>
          <p className="db-pool-big">
            {formatBytes(d?.cacheBytes)}
            {d?.limit.limitSource === 'config' && <small> / {formatBytes(d.limit.limitBytes)}</small>}
          </p>
          {d?.limit.limitSource === 'config' && d.limit.percent !== null && (
            <span className={`rt-bar ${d.limit.percent >= 85 ? 'is-high' : ''}`}>
              <span style={{ width: `${Math.min(100, d.limit.percent)}%` }} />
            </span>
          )}
          <p className="pf-chart-note">{d?.bytesPartial ? t('cache.memory.partial') : t(`cache.memory.note.${driver === 'memory' ? 'memory' : 'redis'}`)}</p>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.serverTitle')}</h3>
            <span className="pf-chip ov-tone-unknown">{t('cache.shared')}</span>
          </header>
          {d && (
            <SectionState section={d.server} driver={driver} scope="cache">
              {(s) => (
                <>
                  <p className="db-pool-big">
                    {formatBytes(s.usedBytes)}
                    <small> / {s.maxBytes ? formatBytes(s.maxBytes) : t('cache.memory.unlimited')}</small>
                  </p>
                  {s.percent !== null && (
                    <span className={`rt-bar ${s.percent >= 85 ? 'is-high' : ''}`}>
                      <span style={{ width: `${Math.min(100, s.percent)}%` }} />
                    </span>
                  )}
                  <dl className="db-stat-grid db-stat-compact">
                    <div>
                      <dt>{t('cache.memory.peak')}</dt>
                      <dd>{formatBytes(s.peakBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t('cache.memory.available')}</dt>
                      <dd>{s.maxBytes && s.usedBytes !== null ? formatBytes(s.maxBytes - s.usedBytes) : NO_VALUE}</dd>
                    </div>
                    <div>
                      <dt>{t('cache.memory.fragmentation')}</dt>
                      <dd className={(s.fragmentationRatio ?? 1) >= 1.5 ? 'is-warn' : ''}>{s.fragmentationRatio ?? NO_VALUE}</dd>
                    </div>
                    <div>
                      <dt>{t('cache.memory.policy')}</dt>
                      <dd>{s.policy ?? NO_VALUE}</dd>
                    </div>
                  </dl>
                  {!s.maxBytes && <p className="pf-chart-note">{t('cache.memory.noMaxmemory')}</p>}
                </>
              )}
            </SectionState>
          )}
        </section>
      </div>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.byNamespace')}</h3>
          </header>
          {!d || d.byNamespace.length === 0 ? (
            <p className="ov-empty-line">{d ? t('cache.memory.noSize') : t('common.loading')}</p>
          ) : (
            <BarList
              items={d.byNamespace.slice(0, 12).map((n) => ({
                id: n.name,
                label: <code>{n.name}</code>,
                value: n.bytes,
                text: `${formatBytes(n.bytes)}${n.percent !== null ? ` · ${formatPercent(n.percent)}` : ''}`,
                onClick: () => go('namespaces', n.name),
              }))}
            />
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.memory.evictions')}</h3>
            <span className="pf-chip ov-tone-unknown">{t('cache.shared')}</span>
          </header>
          {d && (
            <SectionState section={d.evictions} driver={driver} scope="cache">
              {(e) =>
                (e.inRange ?? 0) === 0 ? (
                  <p className="cache-ok-line">
                    <CheckCircle2 size={15} /> {t('cache.memory.noEvictions', { policy: e.policy ?? NO_VALUE })}
                  </p>
                ) : (
                  <>
                    <p className="db-pool-big is-warn">{formatUnit(e.perMin, '/min')}</p>
                    <p className="scp-alert-warning">
                      <AlertTriangle size={13} /> {t('cache.memory.evicting', { count: formatCompact(e.inRange, locale), policy: e.policy ?? NO_VALUE })}
                    </p>
                  </>
                )
              }
            </SectionState>
          )}
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.memory.largestKeys')}</h3>
          <span className="ov-section-hint">{t('cache.memory.largeHint', { size: formatBytes(d?.largeKeyBytes ?? 0) })}</span>
        </header>
        {!d || d.largestKeys.length === 0 ? (
          <p className="ov-empty-line">{d ? t('cache.memory.noSize') : t('common.loading')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table cache-key-table">
              <thead>
                <tr>
                  <th>{t('cache.key.key')}</th>
                  <th>{t('cache.key.type')}</th>
                  <th>{t('cache.key.size')}</th>
                  <th>{t('cache.key.ttl')}</th>
                </tr>
              </thead>
              <tbody>
                {d.largestKeys.map((k) => (
                  <tr key={k.key} className={`is-clickable ${k.large ? 'db-row-warn' : ''}`} onClick={() => go('keys', k.key)}>
                    <td className="cache-key-cell">
                      <code>{k.key}</code>
                      {k.large && <span className="pf-chip ov-tone-warn cache-chip">{t('cache.memory.largeKey')}</span>}
                    </td>
                    <td>{k.type ?? NO_VALUE}</td>
                    <td>{formatBytes(k.bytes)}</td>
                    <td>{k.ttlMs === null ? t('cache.ttl.none') : formatTtl(k.ttlMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CacheChart range={range} paused={paused} initial="memory" />
    </>
  );
};

/** Hết hạn / TTL: phân bố, key không TTL theo namespace (chỉ cảnh báo), key sắp hết hạn (nguy cơ stampede). */
export const CacheTtlView: React.FC<{ paused: boolean; reloadKey: number; go: Go }> = ({ paused, reloadKey, go }) => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => cacheApi.ttl(), `ttl:${reloadKey}`, 30_000, paused);
  const ks = data?.keyspace;
  const spike = ks && data ? ks.expiringNext60s >= data.expirySpikeKeys : false;
  return (
    <>
      <div className="ov-kpi-grid db-kpi-grid">
        {[
          { key: 'expiring', value: ks ? formatCompact(ks.expiring, locale) : NO_VALUE, tone: 'unknown' },
          { key: 'persistent', value: ks ? formatCompact(ks.persistent, locale) : NO_VALUE, tone: ks && ks.persistent > 0 ? 'warn' : 'ok' },
          { key: 'avgTtl', value: ks?.avgTtlMs == null ? NO_VALUE : formatTtl(ks.avgTtlMs), tone: 'unknown' },
          { key: 'soon', value: ks ? formatCompact(ks.expiringNext60s, locale) : NO_VALUE, tone: spike ? 'warn' : 'ok' },
        ].map((k) => (
          <div key={k.key} className={`ov-card ov-kpi ov-tone-${k.tone}`}>
            <span className="ov-kpi-label">{t(`cache.ttl.kpi.${k.key}`)}</span>
            <span className="ov-kpi-value">{k.value}</span>
            <span className="ov-kpi-sub">
              {k.key === 'soon' ? t('cache.ttl.soonSub', { expired: formatUnit(data?.expiredPerMin ?? null, '/min') }) : t(`cache.ttl.kpiSub.${k.key}`)}
            </span>
          </div>
        ))}
      </div>
      {spike && data && (
        <p className="scp-alert-warning">
          <AlertTriangle size={13} /> <strong>{t('cache.ttl.spikeTitle')}</strong>{' '}
          {t('cache.ttl.spikeMessage', { count: formatCompact(ks!.expiringNext60s, locale) })}
        </p>
      )}
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.ttl.distribution')}</h3>
          </header>
          {ks ? <TtlDistribution keyspace={ks} /> : <p className="ov-empty-line">{t('common.loading')}</p>}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.ttl.persistentTitle')}</h3>
          </header>
          {data && data.persistentByNamespace.length === 0 ? (
            <p className="cache-ok-line">
              <CheckCircle2 size={15} /> {t('cache.ttl.noPersistent')}
            </p>
          ) : (
            <>
              <BarList
                items={(data?.persistentByNamespace ?? []).slice(0, 10).map((n) => ({
                  id: n.name,
                  label: <code>{n.name}</code>,
                  value: n.persistent,
                  text: `${formatCompact(n.persistent, locale)} / ${formatCompact(n.keys, locale)}`,
                  onClick: () => go('keys', null, { namespace: n.name, ttl: 'persistent' }),
                }))}
              />
              <p className="pf-chart-note">{t('cache.ttl.persistentNote')}</p>
            </>
          )}
        </section>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.ttl.soonTitle')}</h3>
        </header>
        {data && data.expiringSoonByNamespace.length === 0 ? (
          <p className="ov-empty-line">{t('cache.ttl.noSoon')}</p>
        ) : (
          <BarList
            items={(data?.expiringSoonByNamespace ?? []).slice(0, 10).map((n) => ({
              id: n.name,
              label: <code>{n.name}</code>,
              value: n.count,
              text: formatCompact(n.count, locale),
              onClick: () => go('keys', null, { namespace: n.name, ttl: 'lt1m' }),
            }))}
          />
        )}
        <p className="pf-chart-note">{t('cache.ttl.soonNote')}</p>
      </section>
    </>
  );
};

/** Kết nối Redis của core theo runtime (CLIENT LIST, lọc theo tên `core-*`) + số liệu server. */
export const CacheConnectionsView: React.FC<{ paused: boolean; driver: string; navigate: (path: string) => void }> = ({ paused, driver, navigate }) => {
  const { t } = useLocale();
  const { data } = usePolling(() => cacheApi.clients(), 'clients', 15_000, paused);
  return (
    <>
      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.clients.byRuntime')}</h3>
          </header>
          {data?.byRuntime.length === 0 ? (
            <p className="ov-empty-line">{t('cache.clients.empty')}</p>
          ) : (
            <ul className="db-runtime-bars">
              {data?.byRuntime.map((r) => (
                <li key={r.runtime}>
                  <button type="button" onClick={() => navigate(`runtimes/${r.runtime}`)}>
                    <strong>{t(`rt.name.${r.runtime}`)}</strong>
                    <span className="ov-section-hint">{t('cache.clients.runtimeLine', { count: r.connections, bull: r.bull, blocked: r.blocked })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('cache.clients.server')}</h3>
            <span className="pf-chip ov-tone-unknown">{t('cache.shared')}</span>
          </header>
          {data && (
            <SectionState section={data.server} driver={driver} scope="cache">
              {(s) => (
                <dl className="db-stat-grid db-stat-compact">
                  <div>
                    <dt>{t('cache.clients.connected')}</dt>
                    <dd>
                      {s.connectedClients ?? NO_VALUE}
                      {s.maxClients ? ` / ${formatCompact(s.maxClients, 'en')}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('cache.clients.blocked')}</dt>
                    <dd>{s.blockedClients ?? NO_VALUE}</dd>
                  </div>
                  <div>
                    <dt>{t('cache.clients.rejected')}</dt>
                    <dd className={(s.rejectedConnections ?? 0) > 0 ? 'is-warn' : ''}>{s.rejectedConnections ?? NO_VALUE}</dd>
                  </div>
                  <div>
                    <dt>{t('cache.clients.usage')}</dt>
                    <dd>{formatPercent(s.percent, 2)}</dd>
                  </div>
                </dl>
              )}
            </SectionState>
          )}
          <p className="pf-chart-note">{t('cache.clients.blockedNote')}</p>
        </section>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.clients.title')}</h3>
        </header>
        {data && (
          <SectionState section={data.clients} driver={driver} scope="cache">
            {(list) => (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('cache.clients.name')}</th>
                      <th>{t('cache.clients.runtime')}</th>
                      <th>{t('cache.clients.command')}</th>
                      <th>{t('cache.clients.age')}</th>
                      <th>{t('cache.clients.idle')}</th>
                      <th>{t('cache.clients.addr')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <code>{c.name}</code>
                          {c.bull && <span className="pf-chip ov-tone-unknown cache-chip">BullMQ</span>}
                        </td>
                        <td>{c.runtime ? t(`rt.name.${c.runtime}`) : NO_VALUE}</td>
                        <td>
                          {c.command ?? NO_VALUE}
                          {c.blocked && <small className="pf-row-note">{c.bull ? t('cache.clients.waitingJob') : t('cache.clients.blockedCmd')}</small>}
                        </td>
                        <td>{formatUptime(c.ageSec)}</td>
                        <td>{formatUptime(c.idleSec)}</td>
                        <td>
                          <code>{c.addr ?? NO_VALUE}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionState>
        )}
      </section>
    </>
  );
};
