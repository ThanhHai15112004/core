import React, { useState } from 'react';
import { Check, Copy, FileText, Flame, ShieldAlert } from 'lucide-react';
import type { CacheErrorKind, CacheRange, CacheTab } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { CacheEventList } from '../../components/cache/CacheEventList';
import { formatBytes, formatCompact, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const ERROR_KINDS: CacheErrorKind[] = ['connection', 'timeout', 'command', 'oom', 'serialization'];

/** Lỗi cache theo loại (bảng → mở log theo correlationId) + dòng thời gian sự kiện. */
export const CacheEventsView: React.FC<{
  range: CacheRange;
  paused: boolean;
  reloadKey: number;
  go: (tab: CacheTab) => void;
  navigate: (path: string) => void;
}> = ({ range, paused, reloadKey, go, navigate }) => {
  const { t, formatTime } = useLocale();
  const errors = usePolling(() => cacheApi.errors(range), `errors:${range}`, undefined, paused);
  const events = usePolling(() => cacheApi.events(range), `events:${range}:${reloadKey}`, undefined, paused);
  const d = errors.data;
  return (
    <>
      <div className="ov-kpi-grid cache-error-kpis">
        {ERROR_KINDS.map((k) => (
          <div key={k} className={`ov-card ov-kpi ov-tone-${(d?.counts[k] ?? 0) > 0 ? (k === 'oom' ? 'crit' : 'warn') : 'ok'}`}>
            <span className="ov-kpi-label">{t(`cache.errors.kind.${k}`)}</span>
            <span className="ov-kpi-value">{d ? d.counts[k] : NO_VALUE}</span>
          </div>
        ))}
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.errors.title')}</h3>
          <span className="ov-section-hint">{t('cache.errors.hint')}</span>
        </header>
        {d && d.items.length === 0 ? (
          <p className="ov-empty-line">{t('cache.errors.empty', { range: t(`tr.range.${range}`) })}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('db.errors.type')}</th>
                  <th>{t('cache.errors.operation')}</th>
                  <th>{t('db.session.source')}</th>
                  <th>{t('db.errors.message')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d?.items.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{formatTime(Date.parse(e.at), true)}</td>
                    <td>
                      <span className={`pf-chip ov-tone-${e.kind === 'oom' ? 'crit' : 'warn'}`}>{t(`cache.errors.kind.${e.kind}`)}</span>
                    </td>
                    <td>
                      {e.operation.toUpperCase()} <code>{e.namespace}</code>
                    </td>
                    <td>{e.runtime ? t(`rt.name.${e.runtime}`) : NO_VALUE}</td>
                    <td className="db-sql-cell">
                      <span>{e.message}</span>
                    </td>
                    <td>
                      {e.correlationId && (
                        <button
                          type="button"
                          className="ov-link"
                          onClick={() => navigate(`logs?runtime=${e.runtime ?? 'api'}&correlationId=${encodeURIComponent(e.correlationId!)}`)}
                        >
                          <FileText size={12} /> {t('db.query.openLogs')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.events.title')}</h3>
        </header>
        <CacheEventList events={events.data} onOpen={(tab) => go(tab)} emptyText={t('cache.events.empty')} />
      </section>
    </>
  );
};

/** Lịch sử thao tác (audit) + Danger Zone (Flush cache) — tách xa khỏi Tổng quan. */
export const CacheOperationsView: React.FC<{
  paused: boolean;
  reloadKey: number;
  flushEnabled: boolean;
  actionsEnabled: boolean;
  onFlush: () => void;
}> = ({ paused, reloadKey, flushEnabled, actionsEnabled, onFlush }) => {
  const { t, formatTime } = useLocale();
  const { data } = usePolling(() => cacheApi.operations(), `ops:${reloadKey}`, undefined, paused);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('cache.ops.title')}</h3>
          <span className="ov-section-hint">{t('cache.ops.hint')}</span>
        </header>
        {data && data.length === 0 ? (
          <p className="ov-empty-line">{t('cache.ops.empty')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('cache.ops.actor')}</th>
                  <th>{t('cache.ops.action')}</th>
                  <th>{t('cache.ops.affected')}</th>
                  <th>{t('cache.ops.result')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {new Date(o.at).toLocaleDateString()} {formatTime(Date.parse(o.at), true)}
                    </td>
                    <td>
                      {o.actor ?? t('cache.ops.anonymous')}
                      {o.ip && <small className="pf-row-note">{o.ip}</small>}
                    </td>
                    <td>
                      {t(`cache.ops.kind.${o.action}`)} {o.action !== 'flush_all' && <code>{o.target}</code>}
                    </td>
                    <td>
                      {o.affected} <small className="pf-row-note">{formatDuration(o.durationMs)}</small>
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${o.result === 'success' ? 'ok' : 'crit'}`}>{t(`cache.ops.status.${o.result}`)}</span>
                      {o.error && <small className="pf-row-note">{o.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!actionsEnabled && <p className="pf-chart-note">{t('cache.action.disabled')}</p>}
      </section>

      <section className="ov-card ov-section cache-danger">
        <header className="ov-section-head">
          <h3>
            <Flame size={16} /> {t('cache.danger.title')}
          </h3>
        </header>
        <div className="cache-danger-row">
          <div>
            <strong>{t('cache.danger.flushTitle')}</strong>
            <p>{t('cache.danger.flushDescription')}</p>
            <p className="ov-section-hint">{t('cache.danger.prefer')}</p>
          </div>
          <button
            type="button"
            className="scp-btn scp-btn-danger"
            disabled={!flushEnabled}
            onClick={onFlush}
            title={!flushEnabled ? t('cache.danger.disabled') : undefined}
          >
            <Flame size={14} /> {t('cache.danger.flushButton')}
          </button>
        </div>
        {!flushEnabled && (
          <p className="pf-chart-note">
            <ShieldAlert size={12} /> {t('cache.danger.disabled')}
          </p>
        )}
      </section>
    </>
  );
};

/** Cấu hình đang nạp — host/port/prefix nằm ở đây (không lên Tổng quan); mật khẩu chỉ hiện "đã cấu hình". */
export const CacheConfigView: React.FC = () => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => cacheApi.config(), 'cache-config', 60_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!data) return;
    const safe = Object.fromEntries(data.items.filter((i) => !i.sensitive).map((i) => [i.key, i.value]));
    void navigator.clipboard?.writeText(JSON.stringify(safe, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const render = (item: NonNullable<typeof data>['items'][number]) => {
    if (item.sensitive) return item.value ? t('db.config.configured') : t('db.config.notConfigured');
    if (typeof item.value === 'boolean') return item.value ? t('db.config.yes') : t('db.config.no');
    if (item.value === null) return NO_VALUE;
    if (item.key === 'maxMemory') return item.value === 0 ? t('cache.memory.unlimited') : formatBytes(Number(item.value));
    if (item.key === 'largeKeyBytes') return formatBytes(Number(item.value));
    if (item.key === 'defaultTtlSec') return item.value === 0 ? t('cache.ttl.none') : `${item.value}s`;
    if (typeof item.value === 'number') return formatCompact(item.value, locale);
    return String(item.value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('cache.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {groups.map((g) => (
        <div key={g} className="cache-config-group">
          <h4>{t(`cache.config.group.${g}`)}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                {data?.items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr key={i.key}>
                      <th>{t(`cache.config.key.${i.key}`)}</th>
                      <td>{i.sensitive ? <span className="pf-chip ov-tone-ok">{render(i)}</span> : <code>{render(i)}</code>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="pf-chart-note">{t('cache.config.note')}</p>
    </section>
  );
};
