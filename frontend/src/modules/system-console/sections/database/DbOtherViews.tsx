import React, { useState } from 'react';
import { Check, Copy, FileText, Play } from 'lucide-react';
import type { DbRange, DbTab } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { DB_CONFIRM } from '../../constants/database';
import { DbActionModal } from '../../components/database/DbActionModal';
import { DbEventList } from '../../components/database/DbEventList';
import { formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useConsoleData } from '../../context/console-data-context';
import { ApiError } from '../../../../core/services/api';
import { useLocale } from '../../../../core/i18n/index';

/** Migrations: applied/pending, lần chạy gần nhất, Run Migrations (gõ MIGRATE; ẩn khi tắt bằng env). */
export const DbMigrationsView: React.FC<{ paused: boolean }> = ({ paused }) => {
  const { t, formatTime } = useLocale();
  const { addToast } = useConsoleData();
  const { data, error, reload } = usePolling(() => databaseApi.migrations(), 'migrations', 30_000, paused);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (typed: string) => {
    setBusy(true);
    try {
      const result = await databaseApi.runMigrations(typed);
      addToast({
        type: result?.status === 'completed' ? 'success' : 'error',
        title: result?.status === 'completed' ? t('db.migrations.done', { count: result.executed.length }) : t('db.migrations.runFailed'),
        ...(result?.error ? { message: result.error } : {}),
      });
      setConfirming(false);
      await reload();
    } catch (err) {
      addToast({
        type: 'error',
        title: t('db.migrations.runFailed'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="scp-alert scp-alert-danger">{error instanceof ApiError ? error.message : String(error)}</p>;
  if (!data) return <p className="ov-empty-line">{t('common.loading')}</p>;
  return (
    <>
      <div className="ov-kpi-grid">
        {[
          ['applied', data.applied, 'ok'],
          ['pending', data.pending, data.pending > 0 ? 'warn' : 'ok'],
          ['failed', data.lastRun?.status === 'failed' ? 1 : 0, data.lastRun?.status === 'failed' ? 'crit' : 'ok'],
          ['lastRun', data.lastRun ? `${new Date(data.lastRun.at).toLocaleDateString()} ${formatTime(Date.parse(data.lastRun.at))}` : NO_VALUE, 'unknown'],
        ].map(([key, value, tone]) => (
          <div key={String(key)} className={`ov-card ov-kpi ov-tone-${tone}`}>
            <span className="ov-kpi-label">{t(`db.migrations.${key}`)}</span>
            <span className="ov-kpi-value">{value}</span>
          </div>
        ))}
      </div>
      {data.pending > 0 && data.environment === 'production' && (
        <p className="scp-alert scp-alert-warning">{t('db.migrations.pendingProd', { count: data.pending })}</p>
      )}
      {data.lastRun?.status === 'failed' && <p className="scp-alert scp-alert-danger">{t('db.migrations.lastFailed', { error: data.lastRun.error ?? '' })}</p>}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.migrations.title')}</h3>
          {data.enabled ? (
            <button type="button" className="scp-btn scp-btn-sm scp-btn-danger" disabled={data.pending === 0} onClick={() => setConfirming(true)}>
              <Play size={13} /> {t('db.migrations.run', { count: data.pending })}
            </button>
          ) : (
            <span className="ov-section-hint">{t('db.migrations.disabled')}</span>
          )}
        </header>
        {data.items.length === 0 ? (
          <p className="ov-empty-line">{t('db.migrations.empty', { table: data.tableName })}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.migrations.name')}</th>
                  <th>{t('db.migrations.status')}</th>
                  <th>{t('db.migrations.created')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.name}>
                    <td>
                      <code>{m.name}</code>
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${m.status === 'applied' ? 'ok' : 'warn'}`}>{t(`db.migrations.state.${m.status}`)}</span>
                    </td>
                    <td>{m.timestamp ? new Date(m.timestamp).toLocaleString() : NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pf-chart-note">{t('db.migrations.note', { table: data.tableName })}</p>
      </section>
      {confirming && (
        <DbActionModal
          title={t('db.modal.migrate.title', { count: data.pending })}
          context={[
            {
              label: t('db.modal.migrate.environment'),
              value: <strong>{data.environment.toUpperCase()}</strong>,
            },
            {
              label: t('db.modal.migrate.database'),
              value: <code>{data.database}</code>,
            },
            {
              label: t('db.modal.migrate.backup'),
              value: t('db.modal.migrate.backupUnknown'),
            },
            {
              label: t('db.modal.migrate.pending'),
              value: data.items
                .filter((m) => m.status === 'pending')
                .map((m) => m.name)
                .join(', '),
            },
          ]}
          warning={t('db.modal.migrate.warning')}
          confirmLabel={t('db.modal.migrate.confirm')}
          confirmWord={DB_CONFIRM.migrate}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={(typed) => void run(typed)}
        />
      )}
    </>
  );
};

/** Lỗi query theo loại + sự kiện database. */
export const DbErrorsView: React.FC<{
  range: DbRange;
  paused: boolean;
  go: (tab: DbTab, id?: string | null) => void;
  navigate: (path: string) => void;
}> = ({ range, paused, go, navigate }) => {
  const { t, formatTime } = useLocale();
  const errors = usePolling(() => databaseApi.errors(range), `errors:${range}`, undefined, paused);
  const events = usePolling(() => databaseApi.events(range), `events:${range}`, undefined, paused);
  const d = errors.data;
  return (
    <>
      <div className="ov-kpi-grid">
        {(['query', 'timeout', 'connection', 'deadlock', 'lock_timeout', 'cancelled'] as const).map((k) => (
          <div key={k} className={`ov-card ov-kpi ov-tone-${(d?.counts[k] ?? 0) > 0 ? (k === 'cancelled' ? 'unknown' : 'warn') : 'ok'}`}>
            <span className="ov-kpi-label">{t(`db.errors.kind.${k}`)}</span>
            <span className="ov-kpi-value">{d ? d.counts[k] : NO_VALUE}</span>
          </div>
        ))}
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.errors.title')}</h3>
          <span className="ov-section-hint">{t('db.errors.hint')}</span>
        </header>
        {d && d.items.length === 0 ? (
          <p className="ov-empty-line">{t('db.errors.empty', { range: t(`tr.range.${range}`) })}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('db.errors.time')}</th>
                  <th>{t('db.errors.type')}</th>
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
                      <span className={`pf-chip ov-tone-${e.kind === 'cancelled' ? 'unknown' : 'warn'}`}>{t(`db.errors.kind.${e.kind}`)}</span>
                      {e.code && <small className="pf-row-note">{e.code}</small>}
                    </td>
                    <td>{e.runtime ? t(`rt.name.${e.runtime}`) : NO_VALUE}</td>
                    <td className="db-sql-cell">
                      <span>{e.message}</span>
                      <code>{e.sql}</code>
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
          <h3>{t('db.events.title')}</h3>
        </header>
        <DbEventList events={events.data} onOpen={(tab) => go(tab)} emptyText={t('db.events.empty')} />
      </section>
    </>
  );
};

/** Cấu hình đã nạp (tham khảo) — mật khẩu chỉ hiện "đã cấu hình". */
export const DbConfigView: React.FC = () => {
  const { t } = useLocale();
  const { data } = usePolling(() => databaseApi.config(), 'config', 60_000);
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
    if (item.key.endsWith('Ms') && typeof item.value === 'number') return formatDuration(item.value);
    return item.value === null ? NO_VALUE : String(item.value);
  };
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('db.config.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
        </button>
      </header>
      {data?.items.some((i) => i.key === 'synchronize' && i.value === true) && (
        <p className="scp-alert scp-alert-danger">
          <strong>{t('db.config.syncWarningTitle')}</strong> {t('db.config.syncWarning')}
        </p>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table tr-kv-table">
          <tbody>
            {data?.items.map((i) => (
              <tr key={i.key}>
                <th>{t(`db.config.key.${i.key}`)}</th>
                <td>{i.sensitive ? <span className="pf-chip ov-tone-ok">{render(i)}</span> : <code>{render(i)}</code>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pf-chart-note">{t('db.config.note')}</p>
    </section>
  );
};
