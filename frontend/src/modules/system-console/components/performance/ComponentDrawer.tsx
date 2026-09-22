import React, { useEffect } from 'react';
import { ArrowRight, FileText, X } from 'lucide-react';
import type { ComponentId, PerfRange } from '../../types/performance.types';
import { performanceApi } from '../../services/performance.api';
import { usePolling } from '../../hooks/usePolling';
import { COMPONENT_TONE } from '../../constants/performance';
import { formatUnit, trendOf } from '../../utils/performance-format';
import { shortRoute } from '../../utils/traffic-format';
import { ConsolePortal } from '../common/ConsolePortal';
import { useLocale } from '../../../../core/i18n/index';

interface ComponentDrawerProps {
  id: ComponentId;
  range: PerfRange;
  paused: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}

const HIGHER_IS_WORSE = new Set(['p50', 'p95', 'p99', 'avg', 'errorRate', 'errors', 'poolWaiting', 'maxOp', 'avgJob', 'p95Job', 'failed', 'queueWaiting']);

/** Tóm tắt hiệu năng của một thành phần + đường dẫn sang màn chuyên sâu. Không có thao tác nguy hiểm. */
export const ComponentDrawer: React.FC<ComponentDrawerProps> = ({ id, range, paused, onClose, navigate }) => {
  const { t, formatTime } = useLocale();
  const { data, error } = usePolling(() => performanceApi.component(id, range), `${id}:${range}`, undefined, paused);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <ConsolePortal>
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <aside className="detail-drawer tr-drawer" role="dialog" aria-modal="true" aria-label={t(`perf.component.${id}`)}>
          <div className="drawer-header">
            <div className="tr-drawer-title">
              <strong>{t('perf.drawer.title', { name: t(`perf.component.${id}`) })}</strong>
              {data && (
                <span className={`pf-chip ov-tone-${COMPONENT_TONE[data.status]}`}>
                  <span className="ov-dot" aria-hidden="true" />
                  {t(`perf.componentStatus.${data.status}`)}
                </span>
              )}
            </div>
            <button type="button" className="rt-icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
          <div className="drawer-body">
            {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
            {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
            {data && (
              <div className="tr-drawer-content">
                {data.note && <p className="tr-note">{data.note}</p>}
                <table className="scp-table tr-kv-table pf-detail-metrics">
                  <thead>
                    <tr>
                      <th>{t('perf.drawer.metric')}</th>
                      <th>{t('perf.drawer.current', { range: t(`tr.range.${range}`) })}</th>
                      <th>{t('perf.drawer.previous')}</th>
                      <th>{t('perf.drawer.change')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.metrics.map((m) => {
                      const trend = trendOf(m.changePercent, HIGHER_IS_WORSE.has(m.key) ? true : null);
                      return (
                        <tr key={m.key}>
                          <th>{m.label}</th>
                          <td>{formatUnit(m.value, m.unit)}</td>
                          <td>{formatUnit(m.baseline, m.unit)}</td>
                          <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {data.bottlenecks.length > 0 && (
                  <>
                    <h4 className="pf-drawer-h">{t('perf.bottlenecks.title')}</h4>
                    <ul className="pf-drawer-list">
                      {data.bottlenecks.map((b) => (
                        <li key={b.id} className={`ov-tone-${b.severity === 'critical' ? 'crit' : 'warn'}`}>
                          <strong>{b.title}</strong>
                          <span>{b.message}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {data.endpoints.length > 0 && (
                  <>
                    <h4 className="pf-drawer-h">{t('perf.drawer.slowEndpoints')}</h4>
                    <table className="scp-table">
                      <tbody>
                        {data.endpoints.map((e) => (
                          <tr key={e.routeId} className="is-clickable" onClick={() => navigate(`http-traffic/endpoints/${e.routeId}`)}>
                            <td>
                              <code>
                                {e.method} {shortRoute(e.route)}
                              </code>
                            </td>
                            <td>P95 {formatUnit(e.p95Ms, 'ms')}</td>
                            <td>{t('perf.drawer.requests', { count: e.requests })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {id === 'database' && (
                  <>
                    <h4 className="pf-drawer-h">{t('perf.drawer.slowQueries')}</h4>
                    {data.slowQueries.length === 0 ? (
                      <p className="ov-empty-line">{t('perf.drawer.noSlowQueries')}</p>
                    ) : (
                      <ul className="pf-slow-queries">
                        {data.slowQueries.map((q) => (
                          <li key={`${q.at}-${q.sql}`}>
                            <span className="tr-drawer-meta">
                              {formatTime(q.at, true)} · <strong>{formatUnit(q.durationMs, 'ms')}</strong>
                              {q.failed && ` · ${t('perf.drawer.failed')}`}
                            </span>
                            <pre className="tr-code-block">{q.sql}</pre>
                            {q.correlationId && (
                              <button
                                type="button"
                                className="ov-link"
                                onClick={() => navigate(`logs?runtime=${q.instance.split('@')[0]}&correlationId=${encodeURIComponent(q.correlationId!)}`)}
                              >
                                <FileText size={12} /> {t('perf.drawer.openLogs')}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}

                {data.target !== `performance/components/${id}` && (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary pf-drawer-open" onClick={() => navigate(data.target)}>
                    {t(`perf.drawer.openTarget.${id}`)} <ArrowRight size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </>
    </ConsolePortal>
  );
};
