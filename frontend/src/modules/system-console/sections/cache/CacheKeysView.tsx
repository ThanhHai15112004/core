import React, { useEffect, useRef, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import type { CacheTab, KeyFilter, KeyRow } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { KEY_PAGE_SIZE, KEY_TYPES } from '../../constants/cache';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatTtl } from '../../utils/cache-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  driver: string;
  filter: KeyFilter;
  setFilter: (f: Partial<KeyFilter>) => void;
  actionsEnabled: boolean;
  reloadKey: number;
  go: (tab: CacheTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;
  onDelete: (row: KeyRow) => void;
}

/**
 * Key Explorer: duyệt theo cursor SCAN (không `KEYS *`) — mỗi lần tải một trang, "Tải thêm" để quét tiếp.
 * Lọc theo pattern, type, TTL, namespace. Không tự làm mới để không quét Redis liên tục.
 */
export const CacheKeysView: React.FC<Props> = ({ driver, filter, setFilter, actionsEnabled, reloadKey, go, onDelete }) => {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [cursor, setCursor] = useState('0');
  const [done, setDone] = useState(false);
  const [examined, setExamined] = useState(0);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<Awaited<ReturnType<typeof cacheApi.keys>>['keys'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState(filter.match);
  const seq = useRef(0);

  const load = async (from: string, reset: boolean) => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await cacheApi.keys(filter, from, KEY_PAGE_SIZE);
      if (id !== seq.current) return;
      setSection(res.keys);
      setError(null);
      if (res.keys.available) {
        const page = res.keys.data;
        setRows((prev) => {
          const seen = new Set(reset ? [] : prev.map((r) => r.key));
          return [...(reset ? [] : prev), ...page.filter((r) => !seen.has(r.key))];
        });
      }
      setCursor(res.cursor);
      setDone(res.done);
      setExamined((e) => (reset ? res.examined : e + res.examined));
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    setMatch(filter.match);
    void load('0', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.match, filter.type, filter.ttl, filter.namespace, reloadKey]);

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('cache.keys.title')}</h3>
        <span className="ov-section-hint">{t('cache.keys.hint')}</span>
      </header>
      <form
        className="cache-key-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ match: match.trim() });
        }}
      >
        <label className="cache-search">
          <Search size={14} />
          <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder={t('cache.keys.searchPlaceholder')} aria-label={t('cache.keys.search')} />
        </label>
        <select value={filter.type} onChange={(e) => setFilter({ type: e.target.value })} aria-label={t('cache.key.type')} disabled={driver !== 'redis'}>
          <option value="">{t('cache.keys.anyType')}</option>
          {KEY_TYPES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={filter.ttl} onChange={(e) => setFilter({ ttl: e.target.value as KeyFilter['ttl'] })} aria-label={t('cache.key.ttl')}>
          {(['any', 'expiring', 'persistent', 'lt1m'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`cache.keys.ttl.${k}`)}
            </option>
          ))}
        </select>
        {filter.namespace && (
          <button
            type="button"
            className="pf-chip ov-tone-unknown cache-chip-btn"
            onClick={() => setFilter({ namespace: '' })}
            title={t('cache.keys.clearNamespace')}
          >
            {t('cache.key.namespace')}: <code>{filter.namespace}</code> ✕
          </button>
        )}
        <button type="submit" className="scp-btn scp-btn-sm scp-btn-secondary">
          {t('cache.keys.apply')}
        </button>
      </form>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      <SectionState section={section} driver={driver} scope="cache" onRetry={() => void load('0', true)}>
        {() =>
          rows.length === 0 && !loading ? (
            <p className="ov-empty-line">
              {filter.match || filter.namespace || filter.type || filter.ttl !== 'any' ? t('cache.keys.noMatch') : t('cache.empty.title')}
            </p>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table cache-key-table">
                <thead>
                  <tr>
                    <th>{t('cache.key.key')}</th>
                    <th>{t('cache.key.type')}</th>
                    <th>{t('cache.key.size')}</th>
                    <th>{t('cache.key.ttl')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="is-clickable" onClick={() => go('keys', r.key)}>
                      <td className="cache-key-cell">
                        <code>{r.key}</code>
                        <small className="pf-row-note">{r.namespace}</small>
                      </td>
                      <td>{r.type ?? '--'}</td>
                      <td>{formatBytes(r.bytes)}</td>
                      <td className={r.ttlMs !== null && r.ttlMs < 60_000 ? 'is-warn' : ''}>{r.ttlMs === null ? t('cache.ttl.none') : formatTtl(r.ttlMs)}</td>
                      <td className="db-actions-cell">
                        <button
                          type="button"
                          className="rt-icon-btn is-danger"
                          disabled={!actionsEnabled}
                          title={actionsEnabled ? t('cache.key.delete') : t('cache.action.disabled')}
                          aria-label={t('cache.key.delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(r);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </SectionState>
      <footer className="cache-keys-foot">
        <span className="ov-section-hint">
          {t('cache.keys.showing', { count: formatCompact(rows.length, locale), examined: formatCompact(examined, locale) })}
        </span>
        {!done ? (
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" disabled={loading} onClick={() => void load(cursor, false)}>
            {loading ? t('common.loading') : t('cache.keys.loadMore')}
          </button>
        ) : (
          rows.length > 0 && <span className="ov-section-hint">{t('cache.keys.end')}</span>
        )}
      </footer>
    </section>
  );
};
