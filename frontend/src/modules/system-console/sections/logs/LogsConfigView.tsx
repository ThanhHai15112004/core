import React, { useState } from 'react';
import { Bug, RotateCcw, ShieldCheck } from 'lucide-react';
import type { LevelState, OverrideLevel } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { usePolling } from '../../hooks/usePolling';
import { ApiError } from '../../../../core/services/api';
import { DbActionModal } from '../../components/database/DbActionModal';
import { LEVEL_DURATIONS, OVERRIDE_LEVELS } from '../../constants/logs';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { logTime } from '../../utils/logs-format';
import { useLocale } from '../../../../core/i18n/index';

interface LevelRequest {
  state: LevelState;
  level: OverrideLevel;
}

/**
 * Configuration: backend log thật (Redis buffer — tìm kiếm lịch sử có giới hạn), level từng runtime + đổi tạm thời
 * (tự hết hạn, có thể chỉ cho vài module), dung lượng log ước tính, retention, redaction, quyền, ngưỡng cảnh báo.
 */
export const LogsConfigView: React.FC<{ reloadKey: number; onChanged: () => void; now: number }> = ({ reloadKey, onChanged, now }) => {
  const { t, locale, formatRelative } = useLocale();
  const { data, reload } = usePolling(() => logsApi.config(), `logs-config:${reloadKey}`, 15_000);
  const [req, setReq] = useState<LevelRequest | null>(null);
  const [duration, setDuration] = useState<number | null>(15);
  const [modules, setModules] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const n = (v: number | null) => formatCompact(v, locale);

  const open = (state: LevelState, level: OverrideLevel) => {
    setReq({ state, level });
    setDuration(15);
    setModules([]);
  };

  const confirm = async () => {
    if (!req) return;
    setBusy(true);
    try {
      await logsApi.setLevel({ runtime: req.state.runtime, level: req.level, durationMin: duration, modules });
      setMessage({ ok: true, text: t('logs.config.levelSet', { runtime: t(`rt.name.${req.state.runtime}`), level: req.level }) });
      setReq(null);
      await reload();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const revert = async (runtime: string) => {
    try {
      await logsApi.revertLevel(runtime);
      setMessage({ ok: true, text: t('logs.config.levelReverted', { runtime: t(`rt.name.${runtime}`) }) });
      await reload();
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const p = data?.permissions;
  const prod = data?.environment === 'production';
  return (
    <>
      {message && <p className={`scp-alert ${message.ok ? 'scp-alert-success' : 'scp-alert-danger'}`}>{message.text}</p>}

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.config.backendTitle')}</h3>
        </header>
        {data && (
          <dl className="rt-kv">
            <div>
              <dt>{t('logs.pipeline.backend')}</dt>
              <dd>{t('logs.backend.redis')}</dd>
            </div>
            <div>
              <dt>{t('logs.pipeline.history')}</dt>
              <dd>{t('logs.pipeline.limited', { count: n(data.backend.bufferSize) })}</dd>
            </div>
            <div>
              <dt>{t('logs.config.search')}</dt>
              <dd>{t('logs.config.searchScan')}</dd>
            </div>
            <div>
              <dt>{t('logs.config.format')}</dt>
              <dd>
                <code>{data.backend.consoleFormat}</code> <small className="pf-row-note">LOG_FORMAT</small>
              </dd>
            </div>
          </dl>
        )}
        <p className="pf-chart-note">{t('logs.config.backendNote')}</p>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.config.levelTitle')}</h3>
          <span className="ov-section-hint">{p && !p.levelChange ? t('logs.config.levelDisabled') : t('logs.config.levelHint')}</span>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('logs.config.runtime')}</th>
                <th>{t('logs.config.current')}</th>
                <th>{t('logs.config.temporary')}</th>
                <th>{t('logs.config.change')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.runtimes.map((r) => {
                const inst = r.instances[0];
                return (
                  <tr key={r.runtime}>
                    <td>
                      {t(`rt.name.${r.runtime}`)}
                      <small className="pf-row-note">
                        {r.running ? t('logs.config.instances', { count: r.instances.length }) : t('logs.config.notRunning')}
                      </small>
                    </td>
                    <td>
                      {inst ? <code className="code-badge">{inst.level}</code> : NO_VALUE}
                      {inst && inst.baseLevel !== inst.level && <small className="pf-row-note">{t('logs.config.base', { level: inst.baseLevel })}</small>}
                    </td>
                    <td>
                      {r.override ? (
                        <>
                          <span className="pf-chip ov-tone-warn">
                            {r.override.previous} → {r.override.level}
                          </span>
                          <small className="pf-row-note">
                            {r.override.until ? t('logs.config.until', { when: formatRelative(r.override.until, now) }) : t('logs.config.untilChanged')}
                            {r.override.modules.length > 0 && ` · ${r.override.modules.join(', ')}`}
                          </small>
                        </>
                      ) : (
                        <span className="ov-muted">{NO_VALUE}</span>
                      )}
                    </td>
                    <td>
                      <div className="lg-level-actions">
                        {OVERRIDE_LEVELS.map((l) => (
                          <button
                            key={l}
                            type="button"
                            className="scp-btn scp-btn-sm scp-btn-secondary"
                            disabled={!r.running || !p?.levelChange}
                            onClick={() => open(r, l)}
                          >
                            {l === 'DEBUG' && <Bug size={12} />} {l}
                          </button>
                        ))}
                        {r.override && (
                          <button
                            type="button"
                            className="scp-btn scp-btn-sm scp-btn-secondary"
                            onClick={() => void revert(r.runtime)}
                            disabled={!p?.levelChange}
                          >
                            <RotateCcw size={12} /> {t('logs.config.revert')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="pf-chart-note">{t('logs.config.levelNote')}</p>
      </section>

      <div className="lg-grid-2">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.config.pipelineTitle')}</h3>
          </header>
          <div className="scp-table-wrap">
            <table className="scp-table lg-mini-table">
              <thead>
                <tr>
                  <th>{t('logs.config.instance')}</th>
                  <th className="num">{t('logs.config.written')}</th>
                  <th className="num">{t('logs.config.dropped')}</th>
                  <th>{t('logs.config.lastWrite')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.runtimes.flatMap((r) =>
                  r.instances.map((i) => (
                    <tr key={i.instance}>
                      <td>
                        {t(`rt.name.${r.runtime}`)} <small className="pf-row-note">{i.instance}</small>
                      </td>
                      <td className="num">{n(i.written)}</td>
                      <td className={`num ${i.dropped > 0 ? 'lg-err' : ''}`}>{n(i.dropped)}</td>
                      <td>
                        {i.lastSuccessAt ? formatRelative(i.lastSuccessAt, now) : NO_VALUE}
                        {i.lastError && <small className="pf-row-note lg-err">{i.lastError}</small>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <h4 className="lg-sub">{t('logs.config.buffers')}</h4>
          <ul className="lg-modules">
            {data?.buffers.map((b) => (
              <li key={b.runtime}>
                <span>{t(`rt.name.${b.runtime}`)}</span>
                <span>
                  {n(b.entries)} / {n(b.capacity)}
                </span>
                <small className="ov-muted">{b.oldestAt ? t('logs.config.oldest', { time: logTime(b.oldestAt) }) : NO_VALUE}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.config.retentionTitle')}</h3>
          </header>
          <dl className="rt-kv">
            {data?.retention.map((r) => (
              <div key={r.key}>
                <dt>{t(`logs.config.retention.${r.key}`)}</dt>
                <dd>{t(`logs.config.retentionValue.${r.key}`, { value: r.value })}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <div className="lg-grid-2">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>
              <ShieldCheck size={15} /> {t('logs.config.redactionTitle')}
            </h3>
            <span className="pf-chip ov-tone-ok">{t('logs.pipeline.redactionOn')}</span>
          </header>
          <p className="lg-note">{t('logs.config.redactionNote')}</p>
          <div className="lg-chips">
            {data?.redaction.keys.map((k) => (
              <code key={k} className="lg-tag">
                {k}
              </code>
            ))}
          </div>
          <p className="lg-note">{t('logs.config.patterns', { list: data?.redaction.patterns.join(', ') ?? '' })}</p>
        </section>

        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.config.permissionsTitle')}</h3>
          </header>
          {p && (
            <dl className="rt-kv">
              {(['levelChange', 'levelPermanent', 'export', 'details', 'audit'] as const).map((k) => (
                <div key={k}>
                  <dt>{t(`logs.config.perm.${k}`)}</dt>
                  <dd>
                    <span className={`pf-chip ov-tone-${p[k] ? 'ok' : 'unknown'}`}>{p[k] ? t('db.config.yes') : t('db.config.no')}</span>
                  </dd>
                </div>
              ))}
              <div>
                <dt>{t('logs.config.perm.exportMax')}</dt>
                <dd>{p.exportMax.toLocaleString(locale)}</dd>
              </div>
            </dl>
          )}
          <h4 className="lg-sub">{t('logs.config.rulesTitle')}</h4>
          <dl className="rt-kv">
            {Object.entries(data?.rules ?? {}).map(([k, v]) => (
              <div key={k}>
                <dt>{t(`logs.config.rule.${k}`)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {req && (
        <DbActionModal
          title={t('logs.config.modalTitle', { runtime: t(`rt.name.${req.state.runtime}`) })}
          context={[
            { label: t('logs.config.change'), value: `${req.state.instances[0]?.level ?? NO_VALUE} → ${req.level}` },
            { label: t('logs.config.environment'), value: (data?.environment ?? '').toUpperCase() },
          ]}
          warning={req.level === 'DEBUG' ? t(prod ? 'logs.config.debugWarnProd' : 'logs.config.debugWarn') : t('logs.config.levelWarn')}
          confirmLabel={t('logs.config.apply', { level: req.level })}
          busy={busy}
          onCancel={() => setReq(null)}
          onConfirm={() => void confirm()}
        >
          <fieldset className="lg-modal-field">
            <legend>{t('logs.config.duration')}</legend>
            {LEVEL_DURATIONS.map((d) => (
              <label key={d}>
                <input type="radio" name="dur" checked={duration === d} onChange={() => setDuration(d)} /> {t('logs.config.minutes', { count: d })}
              </label>
            ))}
            <label title={p?.levelPermanent ? undefined : t('logs.config.permanentDisabled')}>
              <input type="radio" name="dur" checked={duration === null} disabled={!p?.levelPermanent} onChange={() => setDuration(null)} />{' '}
              {t('logs.config.untilChanged')}
            </label>
          </fieldset>
          <fieldset className="lg-modal-field">
            <legend>{t('logs.config.scope')}</legend>
            <select
              multiple
              size={Math.min(6, Math.max(3, data?.modules.length ?? 3))}
              value={modules}
              onChange={(e) => setModules([...e.target.selectedOptions].map((o) => o.value).slice(0, 10))}
              aria-label={t('logs.config.scope')}
            >
              {data?.modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <small className="ov-muted">{modules.length ? t('logs.config.scopeSome', { list: modules.join(', ') }) : t('logs.config.scopeAll')}</small>
          </fieldset>
        </DbActionModal>
      )}
    </>
  );
};
