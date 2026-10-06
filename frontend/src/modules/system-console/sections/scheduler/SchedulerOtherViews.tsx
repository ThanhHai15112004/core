import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { CronInspector } from '../../components/scheduler/CronInspector';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Audit mọi thao tác (Run Now / Enable / Disable: ai, khi nào, task, kết quả). */
export const SchedulerEventsView: React.FC<{
  paused: boolean;
  reloadKey: number;
  openExecution: (id: string) => void;
}> = ({ paused, reloadKey, openExecution }) => {
  const { t, formatTime } = useLocale();
  const ops = usePolling(() => schedulerApi.operations(), `sch-ops:${reloadKey}`, undefined, paused);
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.audit.title')}</h3>
          <span className="ov-section-hint">{t('sch.audit.hint')}</span>
        </header>
        {ops.data && ops.data.length === 0 ? (
          <p className="ov-empty-line">{t('sch.audit.empty')}</p>
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
                {ops.data?.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {new Date(o.at).toLocaleDateString()} {formatTime(Date.parse(o.at), true)}
                    </td>
                    <td>
                      {o.actor ?? t('cache.ops.anonymous')}
                      {o.ip && <small className="pf-row-note">{o.ip}</small>}
                    </td>
                    <td className="cache-key-cell">
                      {t(`sch.audit.kind.${o.action}`)} <code>{o.target}</code>
                      {o.detail && <small className="pf-row-note">{o.detail}</small>}
                    </td>
                    <td>
                      <span className={`pf-chip ov-tone-${o.result === 'success' ? 'ok' : 'crit'}`}>{t(`cache.ops.status.${o.result}`)}</span>{' '}
                      <small className="pf-row-note">{formatDuration(o.durationMs)}</small>
                      {o.executionId && (
                        <button type="button" className="ov-link" onClick={() => openExecution(o.executionId!)}>
                          <code>{o.executionId}</code>
                        </button>
                      )}
                      {o.error && <small className="pf-row-note">{o.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pf-chart-note">{t('sch.audit.note')}</p>
      </section>
    </>
  );
};

const MS_KEYS = new Set(['lockTtlMs', 'driftP95Ms', 'expectedDurationMs']);
/** Giá trị liệt kê → nhãn đã dịch. */
const ENUM_PREFIX: Record<string, string> = {
  strategy: 'sch.detail.lock',
  defaultOverlap: 'sch.overlap',
  overlap: 'sch.overlap',
  defaultMisfire: 'sch.misfire',
  misfire: 'sch.misfire',
  type: 'sch.type',
};

/** Configuration: provider, múi giờ (runtime vs lịch), chạy nhiều instance, lưu lịch sử, ngưỡng, quyền thao tác; cấu hình từng task; Cron Inspector. */
export const SchedulerConfigView: React.FC<{ now: number; defaultTimezone: string; openTask: (taskId: string) => void }> = ({ now, defaultTimezone, openTask }) => {
  const { t, locale } = useLocale();
  const { data } = usePolling(() => schedulerApi.config(), 'sch-config', 60_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!data) return;
    void navigator.clipboard?.writeText(JSON.stringify(Object.fromEntries(data.items.map((i) => [i.key, i.value])), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const render = (key: string, value: string | number | boolean | null) => {
    if (typeof value === 'boolean') return value ? t('db.config.yes') : t('db.config.no');
    if (value === null) return NO_VALUE;
    if (MS_KEYS.has(key)) return formatMs(Number(value));
    if (ENUM_PREFIX[key]) return t(`${ENUM_PREFIX[key]}.${value}`);
    if (typeof value === 'number') return formatCompact(value, locale);
    return String(value);
  };
  const groups = [...new Set(data?.items.map((i) => i.group) ?? [])];
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.config.title')}</h3>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy} disabled={!data}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.config.copy')}
          </button>
        </header>
        {groups.map((g) => (
          <div key={g} className="cache-config-group">
            <h4>{t(`sch.config.group.${g}`)}</h4>
            <div className="scp-table-wrap">
              <table className="scp-table tr-kv-table">
                <tbody>
                  {data?.items
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <tr key={i.key}>
                        <th>{t(`sch.config.key.${i.key}`)}</th>
                        <td>
                          <code>{render(i.key, i.value)}</code>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="pf-chart-note">{t('sch.config.note')}</p>
      </section>

      {data && data.tasks.length > 0 && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.config.tasksTitle')}</h3>
          </header>
          {data.tasks.map((task) => (
            <div key={task.id} className="cache-config-group">
              <h4>
                <button type="button" className="ov-link" onClick={() => openTask(task.id)}>
                  {task.name}
                </button>
              </h4>
              <div className="scp-table-wrap">
                <table className="scp-table tr-kv-table">
                  <tbody>
                    {task.items.map((i) => (
                      <tr key={i.key}>
                        <th>{t(`sch.config.key.${i.key}`)}</th>
                        <td>
                          <code>{i.key === 'expectedDurationMs' && i.value === null ? t('sch.config.derived') : render(i.key, i.value)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="pf-chart-note">{t('sch.config.editNote')}</p>
        </section>
      )}

      <CronInspector defaultTimezone={defaultTimezone} now={now} />
    </>
  );
};
