import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Download, Filter, GitBranch, Pause, Play, Radio, Search, SearchX, X } from 'lucide-react';
import type { ExportFormat, LogFilters, LogRow, LogSearchResult, LogsWindow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { ApiError } from '../../../../core/services/api';
import { LogTable } from '../../components/logs/LogTable';
import {
  DEFAULT_LIVE_BUFFER,
  DEFAULT_LOGS_WINDOW,
  FILTER_KEYS,
  LIVE_BUFFER_SIZES,
  LIVE_POLL_MS,
  LOGS_WINDOWS,
  MORE_FILTER_KEYS,
  RUNTIMES,
} from '../../constants/logs';
import { browserTimeZone, contextPath, logTime } from '../../utils/logs-format';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  filters: LogFilters;
  explore: (f: LogFilters) => void;
  openLog: (id: string | null) => void;
  openTrace: (id: string) => void;
  navigate: (path: string) => void;
  now: number;
  selectedId: string | null;
}

const LEVEL_PRESETS = ['', 'error,fatal', 'warn,error,fatal', 'warn', 'info', 'debug,verbose'] as const;
const PAGE = 200;

/** Có bộ lọc thời gian tuyệt đối → không live (xem một khoảng cố định). */
const isFixedRange = (f: LogFilters) => Boolean(f.from || f.to);

/**
 * Log Explorer: ô tìm có cú pháp (`level:error jobId:…`, dán ID), bộ lọc thời gian / level / runtime / module + More
 * Filters, bảng log gọn (metadata xem khi bấm), live tail với rolling buffer (không render vô hạn), Pause vẫn đếm log
 * mới, Load older theo cursor, export theo bộ lọc.
 */
export const LogsExplorerView: React.FC<Props> = ({ filters, explore, openLog, openTrace, navigate, selectedId }) => {
  const { t, locale } = useLocale();
  const win: LogsWindow = filters.window ?? DEFAULT_LOGS_WINDOW;
  const effective = useMemo<LogFilters>(() => (isFixedRange(filters) ? filters : { ...filters, window: win }), [filters, win]);
  const key = JSON.stringify(effective);

  const [query, setQuery] = useState(filters.q ?? '');
  const [showMore, setShowMore] = useState(() => MORE_FILTER_KEYS.some((k) => filters[k]));
  const [draft, setDraft] = useState<LogFilters>(filters);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [meta, setMeta] = useState<LogSearchResult | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive] = useState(!isFixedRange(filters));
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState<LogRow[]>([]);
  const [pendingMore, setPendingMore] = useState(false);
  const [bufferSize, setBufferSize] = useState<number>(DEFAULT_LIVE_BUFFER);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<string | null>(null);
  latestRef.current = latest;
  const rowsRef = useRef<LogRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    setQuery(filters.q ?? '');
    setDraft(filters);
  }, [filters]);

  // Bộ lọc đổi → tải lại trang đầu.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPending([]);
    setPendingMore(false);
    logsApi
      .search(effective, null, PAGE)
      .then((res) => {
        if (!alive) return;
        setRows(res.items);
        setMeta(res);
        setCursor(res.nextCursor);
        setLatest(null);
        setFresh(new Set());
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const cap = useCallback((list: LogRow[]) => (list.length > bufferSize ? list.slice(0, bufferSize) : list), [bufferSize]);

  // Live tail: hỏi log mới hơn log mới nhất đang có; Pause chỉ dừng hiển thị (vẫn nhận, đếm).
  useEffect(() => {
    if (!live || loading || error) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await logsApi.tail(effective, latestRef.current ?? cursorOfNewest(rowsRef.current), 500);
        if (!alive) return;
        setLatest(res.latestCursor);
        if (!res.items.length) return;
        if (paused) {
          setPending((p) => cap([...res.items, ...p]));
          if (res.more) setPendingMore(true);
          return;
        }
        setRows((r) => cap([...res.items.filter((x) => !r.some((y) => y.id === x.id)), ...r]));
        setFresh(new Set(res.items.map((x) => x.id)));
        if (autoScroll) wrapRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        // Lần sau thử lại; lỗi kết nối đã hiện ở header.
      }
    };
    const id = setInterval(() => void tick(), LIVE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, paused, loading, error, key, autoScroll, cap]);

  const resume = () => {
    setRows((r) => cap([...pending, ...r]));
    setFresh(new Set(pending.map((x) => x.id)));
    setPending([]);
    setPendingMore(false);
    setPaused(false);
    wrapRef.current?.scrollTo({ top: 0 });
  };

  const loadOlder = async () => {
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const res = await logsApi.search(effective, cursor, PAGE);
      setRows((r) => [...r, ...res.items.filter((x) => !r.some((y) => y.id === x.id))]);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoadingOlder(false);
    }
  };

  const apply = (next: LogFilters) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== '')) as LogFilters;
    explore(clean);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    apply({ ...draft, q: query.trim() || undefined });
  };
  const remove = (k: keyof LogFilters) => apply({ ...filters, [k]: undefined });

  const doExport = async () => {
    setExporting(true);
    setExported(null);
    try {
      const count = await logsApi.exportFile(effective, exportFormat, 10_000);
      setExported(t('logs.export.done', { count: formatCompact(count, locale) }));
    } catch (e) {
      setExported(e instanceof ApiError ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const levelLabel = (l: string) => {
    if (!l) return t('logs.filter.all');
    const k = `logs.levelPreset.${l.replace(/,/g, '_')}`;
    const v = t(k);
    return v === k ? l.toUpperCase() : v;
  };
  const chips = FILTER_KEYS.filter((k) => filters[k] && k !== 'window');
  const resolved = meta?.resolved;
  const oldest = meta?.coverage.filter((c) => c.oldestAt).map((c) => `${c.runtime} ${logTime(c.oldestAt!)}`);

  return (
    <>
      <section className="ov-card ov-section lg-search">
        <form className="lg-search-row" onSubmit={submit}>
          <label className="lg-search-box">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('logs.explorer.placeholder')}
              aria-label={t('logs.explorer.placeholder')}
              spellCheck={false}
            />
          </label>
          <button type="submit" className="scp-btn scp-btn-sm scp-btn-primary">
            {t('logs.explorer.search')}
          </button>
        </form>
        <p className="lg-hint">{t('logs.explorer.syntax')}</p>

        <div className="lg-filter-row">
          <label>
            <span>{t('logs.filter.time')}</span>
            <select
              value={isFixedRange(filters) ? 'custom' : win}
              onChange={(e) =>
                e.target.value === 'custom' ? setShowMore(true) : apply({ ...filters, from: undefined, to: undefined, window: e.target.value as LogsWindow })
              }
            >
              {LOGS_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {t(`logs.window.${w}`)}
                </option>
              ))}
              <option value="custom">{t('logs.window.custom')}</option>
            </select>
          </label>
          <label>
            <span>{t('logs.filter.level')}</span>
            <select value={filters.level ?? ''} onChange={(e) => apply({ ...filters, level: e.target.value || undefined })}>
              {[...LEVEL_PRESETS, ...(filters.level && !(LEVEL_PRESETS as readonly string[]).includes(filters.level) ? [filters.level] : [])].map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('logs.filter.runtime')}</span>
            <select value={filters.runtime ?? ''} onChange={(e) => apply({ ...filters, runtime: e.target.value || undefined })}>
              <option value="">{t('logs.filter.all')}</option>
              {RUNTIMES.map((r) => (
                <option key={r} value={r}>
                  {t(`rt.name.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('logs.filter.module')}</span>
            <input
              value={draft.module ?? ''}
              placeholder={t('logs.filter.all')}
              onChange={(e) => setDraft({ ...draft, module: e.target.value || undefined })}
              onBlur={() => draft.module !== filters.module && apply({ ...filters, module: draft.module })}
              onKeyDown={(e) => e.key === 'Enter' && apply({ ...filters, module: draft.module })}
            />
          </label>
          <button type="button" className={`scp-btn scp-btn-sm ${showMore ? 'scp-btn-primary' : 'scp-btn-secondary'}`} onClick={() => setShowMore((s) => !s)}>
            <Filter size={13} /> {t('logs.filter.more')}
          </button>
        </div>

        {showMore && (
          <form
            className="lg-more"
            onSubmit={(e) => {
              e.preventDefault();
              apply({ ...draft, q: query.trim() || undefined });
            }}
          >
            {MORE_FILTER_KEYS.map((k) => (
              <label key={k}>
                <span>{t(`logs.filter.${k}`)}</span>
                <input value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value || undefined })} spellCheck={false} />
              </label>
            ))}
            <label>
              <span>{t('logs.filter.from')}</span>
              <input type="datetime-local" value={toLocalInput(draft.from)} onChange={(e) => setDraft({ ...draft, from: fromLocalInput(e.target.value) })} />
            </label>
            <label>
              <span>{t('logs.filter.to')}</span>
              <input type="datetime-local" value={toLocalInput(draft.to)} onChange={(e) => setDraft({ ...draft, to: fromLocalInput(e.target.value) })} />
            </label>
            <div className="lg-more-actions">
              <small className="ov-muted">{t('logs.filter.timezone', { tz: browserTimeZone() })}</small>
              <button type="submit" className="scp-btn scp-btn-sm scp-btn-primary">
                {t('logs.filter.apply')}
              </button>
            </div>
          </form>
        )}

        {chips.length > 0 && (
          <div className="lg-chips">
            {chips.map((k) => (
              <span key={k} className="tr-filter-chip">
                {t(`logs.filter.${k}`)}: <code>{filters[k]}</code>
                <button type="button" className="rt-icon-btn" aria-label={t('common.close')} onClick={() => remove(k)}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <button type="button" className="ov-link" onClick={() => explore({})}>
              {t('logs.filter.clear')}
            </button>
          </div>
        )}
      </section>

      {resolved && resolved.kinds.length > 0 && (
        <div className="scp-alert scp-alert-info lg-resolved">
          <span>{t('logs.explorer.resolved', { id: resolved.id })}</span>
          {resolved.kinds.includes('job') && (
            <button type="button" className="ov-link" onClick={() => navigate(contextPath('job', resolved.id, resolved.queue))}>
              {t('logs.detail.openJob')}
            </button>
          )}
          {resolved.kinds.includes('request') && (
            <button type="button" className="ov-link" onClick={() => navigate(contextPath('request', resolved.id))}>
              {t('logs.detail.openRequest')}
            </button>
          )}
          {resolved.kinds.includes('execution') && (
            <button type="button" className="ov-link" onClick={() => navigate(contextPath('execution', resolved.id))}>
              {t('logs.detail.openExecution')}
            </button>
          )}
          <button type="button" className="ov-link" onClick={() => openTrace(resolved.id)}>
            <GitBranch size={12} /> {t('logs.detail.viewTrace')}
          </button>
        </div>
      )}

      <section className="ov-card ov-section">
        <header className="ov-section-head lg-results-head">
          <div className="lg-live-controls">
            {isFixedRange(filters) ? (
              <span className="pf-chip">{t('logs.live.fixed')}</span>
            ) : (
              <>
                <button
                  type="button"
                  className={`scp-btn scp-btn-sm ${live ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                  onClick={() => setLive((l) => !l)}
                  aria-pressed={live}
                >
                  <Radio size={13} /> {live ? t('logs.live.on') : t('logs.live.off')}
                </button>
                {live && (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => (paused ? resume() : setPaused(true))}>
                    {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('logs.live.resume') : t('logs.live.pause')}
                  </button>
                )}
                {live && (
                  <label className="lg-inline-check">
                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> {t('logs.live.autoScroll')}
                  </label>
                )}
              </>
            )}
            <label className="lg-inline-select">
              {t('logs.live.buffer')}
              <select value={bufferSize} onChange={(e) => setBufferSize(Number(e.target.value))}>
                {LIVE_BUFFER_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="lg-export">
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)} aria-label={t('logs.export.format')}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="ndjson">NDJSON</option>
            </select>
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void doExport()} disabled={exporting || !meta?.matched}>
              <Download size={13} /> {t('logs.export.button', { count: formatCompact(Math.min(meta?.matched ?? 0, 10_000), locale) })}
            </button>
          </div>
        </header>

        {exported && <p className="lg-note">{exported}</p>}

        {paused && (pending.length > 0 || pendingMore) && (
          <div className="scp-alert scp-alert-info lg-pending">
            <span>
              <Pause size={13} /> {t('logs.live.pending', { count: `${pending.length}${pendingMore ? '+' : ''}` })}
            </span>
            <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={resume}>
              <ArrowDownToLine size={13} /> {t('logs.live.jump')}
            </button>
          </div>
        )}

        <p className="lg-note">
          {meta &&
            t('logs.explorer.summary', {
              shown: formatCompact(rows.length, locale),
              matched: formatCompact(meta.matched, locale),
              scanned: formatCompact(meta.scanned, locale),
            })}{' '}
          {live && !isFixedRange(filters) && t('logs.explorer.rolling', { size: bufferSize })} · {t('logs.filter.timezone', { tz: browserTimeZone() })}
        </p>

        {error && <p className="scp-alert scp-alert-danger">{error}</p>}
        {loading && !rows.length && <p className="ov-empty-line">{t('common.loading')}</p>}
        {!loading && !error && rows.length === 0 && (
          <div className="lg-empty">
            <SearchX size={26} />
            <strong>{t('logs.empty.title')}</strong>
            <span>{t('logs.empty.text')}</span>
            <ul>
              <li>{t('logs.empty.tip1')}</li>
              <li>{t('logs.empty.tip2')}</li>
            </ul>
          </div>
        )}
        {rows.length > 0 && (
          <div ref={wrapRef} className="lg-scroll">
            <LogTable rows={rows} onOpen={openLog} selectedId={selectedId} freshIds={fresh} />
          </div>
        )}
        {cursor && (
          <div className="lg-older">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {t('logs.explorer.older')}
            </button>
          </div>
        )}
        {!cursor && rows.length > 0 && oldest && oldest.length > 0 && (
          <p className="pf-chart-note">{t('logs.explorer.coverage', { oldest: oldest.join(' · '), count: meta?.coverage[0]?.capacity ?? 0 })}</p>
        )}
      </section>
    </>
  );
};

/** Cursor của log mới nhất đang hiển thị (lần tail đầu tiên). */
function cursorOfNewest(rows: LogRow[]): string | null {
  const r = rows[0];
  if (!r) return null;
  return btoa(JSON.stringify({ t: Date.parse(r.at), id: r.id }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
