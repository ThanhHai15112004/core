import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import type { StorageErrorKind, StorageOp, StorageRange, StorageTab } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { StorageEventList } from '../../components/storage/StorageEventList';
import { formatBytes, formatCompact, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const KINDS: StorageErrorKind[] = ['not_found', 'permission', 'timeout', 'connection', 'no_space', 'throttled', 'other'];
const OPS: StorageOp[] = ['put', 'get', 'delete', 'head', 'list'];

/** Lỗi theo loại & thao tác, bảng lỗi (→ log), dòng thời gian sự kiện. */
export const StorageErrorsView: React.FC<{
  range: StorageRange;
  paused: boolean;
  reloadKey: number;
  go: (tab: StorageTab) => void;
  navigate: (p: string) => void;
}> = ({ range, paused, reloadKey, go, navigate }) => {
  const { t, formatTime } = useLocale();
  const errors = usePolling(() => storageApi.errors(range), `errors:${range}`, undefined, paused);
  const events = usePolling(() => storageApi.events(range), `events:${range}:${reloadKey}`, undefined, paused);
  const d = errors.data;
  return (
    <>
      <div className="ov-kpi-grid st-error-kpis">
        {OPS.map((op) => (
          <div key={op} className={`ov-card ov-kpi ov-tone-${(d?.byOp[op] ?? 0) > 0 ? 'warn' : 'ok'}`}>
            <span className="ov-kpi-label">{t('storage.errors.opFailures', { op: op.toUpperCase() })}</span>
            <span className="ov-kpi-value">{d ? d.byOp[op] : NO_VALUE}</span>
          </div>
        ))}
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.errors.title')}</h3>
          <span className="ov-section-hint">
            {d
              ? KINDS.filter((k) => d.counts[k] > 0)
                  .map((k) => `${t(`storage.errors.kind.${k}`)} ${d.counts[k]}`)
                  .join(' · ') || t('storage.errors.hint')
              : ''}
          </span>
        </header>
        {d && d.items.length === 0 ? (
          <p className="ov-empty-line">{t('storage.errors.empty', { range: t(`tr.range.${range}`) })}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('storage.ops.op')}</th>
                  <th>{t('storage.object.key')}</th>
                  <th>{t('db.errors.type')}</th>
                  <th>{t('db.session.source')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d?.items.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{formatTime(Date.parse(e.at), true)}</td>
                    <td>{e.op.toUpperCase()}</td>
                    <td className="cache-key-cell">
                      <code>{e.key}</code>
                      <small className="pf-row-note">{e.message}</small>
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${e.kind === 'not_found' ? 'unknown' : 'warn'}`}>{t(`storage.errors.kind.${e.kind}`)}</span>
                      {(e.code || e.httpStatus) && <small className="pf-row-note">{[e.code, e.httpStatus].filter(Boolean).join(' · ')}</small>}
                    </td>
                    <td>{e.runtime ? t(`rt.name.${e.runtime}`) : NO_VALUE}</td>
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
          <h3>{t('storage.events.title')}</h3>
        </header>
        <StorageEventList events={events.data} onOpen={(tab) => go(tab)} emptyText={t('storage.events.empty')} />
      </section>
    </>
  );
};

/** Lịch sử thao tác quản trị (audit). */
export const StorageOperationsView: React.FC<{ paused: boolean; reloadKey: number }> = ({ paused, reloadKey }) => {
  const { t, formatTime } = useLocale();
  const { data } = usePolling(() => storageApi.operations(), `ops:${reloadKey}`, undefined, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('storage.audit.title')}</h3>
        <span className="ov-section-hint">{t('storage.audit.hint')}</span>
      </header>
      {data && data.length === 0 ? (
        <p className="ov-empty-line">{t('storage.audit.empty')}</p>
      ) : (
        <div className="scp-table-wrap">
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('db.errors.time')}</th>
                <th>{t('cache.ops.actor')}</th>
                <th>{t('cache.ops.action')}</th>
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
                  <td className="cache-key-cell">
                    {t(`storage.audit.kind.${o.action}`)} <code>{o.target}</code>
                    {o.detail && <small className="pf-row-note">{o.action === 'download' ? formatBytes(Number(o.detail)) : o.detail}</small>}
                  </td>
                  <td>
                    <span className={`pf-chip ov-tone-${o.result === 'success' ? 'ok' : 'crit'}`}>{t(`cache.ops.status.${o.result}`)}</span>{' '}
                    <small className="pf-row-note">{formatDuration(o.durationMs)}</small>
                    {o.error && <small className="pf-row-note">{o.error}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pf-chart-note">{t('storage.audit.note')}</p>
    </section>
  );
};

/** Cấu hình đang nạp — credentials chỉ hiện "đã cấu hình". */
export const StorageConfigView: React.FC = () => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => storageApi.config(), 'storage-config', 60_000);
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
    if (item.key === 'signedUrlMaxSec' || item.key === 'timeoutMs') return formatDuration(Number(item.value) * (item.key === 'timeoutMs' ? 1 : 1000));
    if (typeof item.value === 'number') return formatCompact(item.value, locale);
    return String(item.value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('storage.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {groups.map((g) => (
        <div key={g} className="cache-config-group">
          <h4>{t(`storage.config.group.${g}`)}</h4>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <tbody>
                {data?.items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr key={i.key}>
                      <th>{t(`storage.config.key.${i.key}`)}</th>
                      <td>{i.sensitive ? <span className="pf-chip ov-tone-ok">{render(i)}</span> : <code>{render(i)}</code>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="pf-chart-note">{t('storage.config.note')}</p>
    </section>
  );
};
