import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ObjectFilter, ObjectRow, StorageObjects, StorageTab } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { OBJECT_AGES, OBJECT_KINDS, OBJECT_PAGE_SIZE } from '../../constants/storage';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  product: string;
  filter: ObjectFilter;
  setFilter: (f: Partial<ObjectFilter>) => void;
  reloadKey: number;
  go: (tab: StorageTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;
}

/**
 * Object Explorer: phân trang theo cursor (continuation token / key cuối) — không bao giờ liệt kê toàn bộ
 * storage một lượt. Lọc theo container, prefix, loại, kích thước, tuổi. Không tự làm mới.
 */
export const StorageObjectsView: React.FC<Props> = ({ product, filter, setFilter, reloadKey, go }) => {
  const { t, locale, formatRelative } = useLocale();
  const [rows, setRows] = useState<ObjectRow[]>([]);
  const [cursor, setCursor] = useState('');
  const [done, setDone] = useState(false);
  const [examined, setExamined] = useState(0);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<StorageObjects['objects'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState(filter.prefix);
  const seq = useRef(0);
  const now = Date.now();
  const containerList = usePolling(() => storageApi.containers('1h'), 'object-containers', 60_000);
  const containers = containerList.data?.containers.map((c) => c.name) ?? [];

  const load = async (from: string, reset: boolean) => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await storageApi.objects(filter, from, OBJECT_PAGE_SIZE);
      if (id !== seq.current) return;
      setSection(res.objects);
      setError(null);
      if (res.objects.available) {
        const page = res.objects.data;
        setRows((prev) => (reset ? page : [...prev, ...page.filter((r) => !prev.some((p) => p.key === r.key))]));
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
    setPrefix(filter.prefix);
    void load('', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.container, filter.prefix, filter.kind, filter.age, filter.minSizeMb, reloadKey]);

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('storage.objects.title')}</h3>
        <span className="ov-section-hint">{t('storage.objects.hint')}</span>
      </header>
      <form
        className="cache-key-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ prefix: prefix.trim() });
        }}
      >
        <select value={filter.container} onChange={(e) => setFilter({ container: e.target.value })} aria-label={t('storage.object.container')}>
          <option value="">{t('storage.objects.allContainers')}</option>
          {containers.map((c) => (
            <option key={c} value={c}>
              {c === '(root)' ? t('storage.container.root') : `${c}/`}
            </option>
          ))}
        </select>
        <label className="cache-search">
          <Search size={14} />
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder={t('storage.objects.prefixPlaceholder')}
            aria-label={t('storage.objects.prefix')}
          />
        </label>
        <select value={filter.kind} onChange={(e) => setFilter({ kind: e.target.value as ObjectFilter['kind'] })} aria-label={t('storage.objects.kind')}>
          <option value="">{t('storage.objects.anyKind')}</option>
          {OBJECT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`storage.kind.${k}`)}
            </option>
          ))}
        </select>
        <select value={filter.age} onChange={(e) => setFilter({ age: e.target.value as ObjectFilter['age'] })} aria-label={t('storage.objects.age')}>
          <option value="">{t('storage.objects.anyAge')}</option>
          {OBJECT_AGES.map((a) => (
            <option key={a} value={a}>
              {t(`storage.objects.ageOpt.${a}`)}
            </option>
          ))}
        </select>
        <select value={filter.minSizeMb} onChange={(e) => setFilter({ minSizeMb: e.target.value })} aria-label={t('storage.objects.size')}>
          <option value="">{t('storage.objects.anySize')}</option>
          {['1', '10', '100', '1024'].map((s) => (
            <option key={s} value={s}>
              ≥ {formatBytes(Number(s) * 1024 * 1024)}
            </option>
          ))}
        </select>
        <button type="submit" className="scp-btn scp-btn-sm scp-btn-secondary">
          {t('cache.keys.apply')}
        </button>
      </form>
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      <SectionState section={section} driver={product} scope="storage" onRetry={() => void load('', true)}>
        {() =>
          rows.length === 0 && !loading ? (
            <p className="ov-empty-line">
              {filter.container || filter.prefix || filter.kind || filter.age || filter.minSizeMb ? t('storage.objects.noMatch') : t('storage.empty')}
            </p>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table cache-key-table">
                <thead>
                  <tr>
                    <th>{t('storage.object.key')}</th>
                    <th>{t('storage.objects.kind')}</th>
                    <th>{t('storage.object.size')}</th>
                    <th>{t('storage.object.modified')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="is-clickable" onClick={() => go('objects', r.key)}>
                      <td className="cache-key-cell">
                        <code>{r.key}</code>
                      </td>
                      <td>{t(`storage.kind.${r.kind}`)}</td>
                      <td>{formatBytes(r.size)}</td>
                      <td>{r.lastModified ? formatRelative(new Date(r.lastModified), now) : '--'}</td>
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
          {t('storage.objects.showing', { count: formatCompact(rows.length, locale), examined: formatCompact(examined, locale) })}
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
