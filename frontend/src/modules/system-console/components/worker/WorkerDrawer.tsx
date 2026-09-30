import React from 'react';
import { Activity, FileText } from 'lucide-react';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { WORKER_STATUS_TONE } from '../../constants/worker';
import { DbDrawer } from '../database/DbDrawer';
import { formatCompact } from '../../utils/database-format';
import { formatMb, formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { formatMs, instanceLabel } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Worker instance: tài nguyên, job đang xử lý, hoàn tất/lỗi hôm nay, queue tiêu thụ và phân bổ xử lý, lịch sử
 * restart. Restart/stop thuộc trang Runtime — ở đây chỉ dẫn sang.
 */
export const WorkerDrawer: React.FC<{
  id: string;
  onClose: () => void;
  onOpenQueue: (queue: string) => void;
  navigate: (path: string) => void;
}> = ({ id, onClose, onOpenQueue, navigate }) => {
  const { t, locale, formatTime } = useLocale();
  const { data, error } = usePolling(() => workerApi.worker(id), `worker:${id}`, 15_000);
  const w = data?.worker;
  const n = (v: number) => formatCompact(v, locale);
  return (
    <DbDrawer title={<code>{instanceLabel(id)}</code>} meta={t('wq.worker.drawerMeta')} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {w && data && (
        <>
          <p className={`msg-status-line ov-tone-${WORKER_STATUS_TONE[w.status]}`}>
            <span className={`pf-chip ov-tone-${WORKER_STATUS_TONE[w.status]}`}>{t(`wq.worker.statusOf.${w.status}`)}</span>
            <span>{t(`wq.worker.statusHint.${w.status}`)}</span>
          </p>
          <dl className="db-stat-grid">
            <div>
              <dt>PID</dt>
              <dd>{w.pid ?? NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('wq.worker.host')}</dt>
              <dd>
                <code>{w.host ?? NO_VALUE}</code>
              </dd>
            </div>
            <div>
              <dt>CPU</dt>
              <dd className={w.status === 'high_cpu' ? 'is-warn' : ''}>{w.cpuPercent === null ? NO_VALUE : `${w.cpuPercent}%`}</dd>
            </div>
            <div>
              <dt>{t('wq.worker.memory')}</dt>
              <dd className={w.status === 'high_memory' ? 'is-warn' : ''}>
                {formatMb(w.memoryMb)}
                {w.memoryLimitMb !== null && ` / ${formatMb(w.memoryLimitMb)}`}
              </dd>
            </div>
            <div>
              <dt>{t('wq.worker.uptime')}</dt>
              <dd>{formatUptime(w.uptimeSec)}</dd>
            </div>
            <div>
              <dt>{t('wq.worker.processing')}</dt>
              <dd>{t('wq.worker.processingValue', { active: w.active, concurrency: w.concurrency })}</dd>
            </div>
            <div>
              <dt>{t('wq.worker.completedToday')}</dt>
              <dd>{n(w.completedToday)}</dd>
            </div>
            <div>
              <dt>{t('wq.worker.failedToday')}</dt>
              <dd className={w.failedToday > 0 ? 'is-warn' : ''}>{n(w.failedToday)}</dd>
            </div>
            <div>
              <dt>{t('wq.processing.avg')}</dt>
              <dd>{formatMs(data.processing.avgMs)}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>{formatMs(data.processing.p95Ms)}</dd>
            </div>
          </dl>
          {data.runtimeAlerts.length > 0 && (
            <ul className="db-health-reasons">
              {data.runtimeAlerts.map((a) => (
                <li key={a.key} className="is-warn">
                  {t(`wq.worker.pressure.${a.key}`, { value: a.value, threshold: a.threshold })}
                </li>
              ))}
            </ul>
          )}
          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('runtimes/worker')}>
              <Activity size={13} /> {t('wq.worker.viewRuntime')}
            </button>
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('logs?runtime=worker')}>
              <FileText size={13} /> {t('wq.worker.viewLogs')}
            </button>
          </div>
          <h4>{t('wq.worker.consumes')}</h4>
          <ul className="cache-bars">
            {data.distribution.map((d) => (
              <li key={d.queue}>
                <button type="button" className="ov-link cache-bar-label" onClick={() => onOpenQueue(d.queue)}>
                  {d.queue}
                </button>
                <span className="cache-bar-track">
                  <span style={{ width: `${d.percent}%` }} />
                </span>
                <span className="cache-bar-value">
                  {n(d.completed)}
                  {d.failed > 0 && <small className="is-warn"> · {t('wq.worker.failedN', { count: d.failed })}</small>}
                </span>
              </li>
            ))}
          </ul>
          <p className="pf-chart-note">{t('wq.worker.processors', { list: w.processors.join(', ') || NO_VALUE })}</p>
          <h4>{t('wq.stability.title')}</h4>
          {data.stability.history.length === 0 ? (
            <p className="cache-ok-line">{t('wq.stability.none')}</p>
          ) : (
            <ul className="cache-key-list">
              {data.stability.history.map((h) => (
                <li key={h.at}>
                  <span>
                    {new Date(h.at).toLocaleDateString()} {formatTime(Date.parse(h.at))}
                  </span>
                  <span className={h.reasonCode === 'crash' || h.reasonCode === 'unexpected' ? 'is-warn' : ''}>{h.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DbDrawer>
  );
};
