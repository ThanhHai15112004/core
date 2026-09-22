import React, { useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import type { RuntimeAction, RuntimeDetail, RuntimeId } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { usePolling } from '../../hooks/usePolling';
import { useRuntimeCommand } from '../../hooks/useRuntimeCommand';
import { useConsoleRoute } from '../../context/console-route-context';
import { DETAIL_TABS, RUNTIME_METRICS, type DetailTab } from '../../constants/runtime-metrics';
import { formatDurationMs, formatMb, formatMetric, formatUptime, NO_VALUE, percent } from '../../utils/runtime-format';
import { RuntimeStatusBadge } from '../../components/runtimes/RuntimeStatusBadge';
import { RuntimeActions } from '../../components/runtimes/RuntimeActions';
import { RuntimeActionModal, type ModalAction } from '../../components/runtimes/RuntimeActionModal';
import { RuntimePerformancePanel } from '../../components/runtimes/RuntimePerformancePanel';
import { RuntimeEventsList } from '../../components/runtimes/RuntimeEventsList';
import { RuntimeLogsPanel } from '../../components/runtimes/RuntimeLogsPanel';
import { RestartHistoryTable } from '../../components/runtimes/RestartHistoryTable';
import { RuntimeAlerts } from '../../components/runtimes/RuntimeAlerts';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';

interface Row {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}

const KeyValues: React.FC<{ title: string; rows: Row[] }> = ({ title, rows }) => (
  <section className="ov-card ov-section">
    <header className="ov-section-head">
      <h3>{title}</h3>
    </header>
    <dl className="rt-kv rt-kv-grid">
      {rows.map((row) => (
        <div key={row.label} className={row.warn ? 'is-warn' : ''}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

interface SchedulerTask {
  name: string;
  cron: string;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  failuresToday: number;
  runsToday: number;
  nextRunAt: string | null;
}

interface WorkerQueue {
  name: string;
  counts: Record<string, number> | null;
  consumed: boolean;
}

export const RuntimeDetailView: React.FC<{ id: RuntimeId; tab: DetailTab }> = ({ id, tab }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const { navigate } = useConsoleRoute();
  const now = useNow();
  const detail = usePolling(() => runtimesApi.detail(id), `runtime:${id}`);
  const events = usePolling(() => runtimesApi.events(50, id), `runtime-events:${id}`);
  const [modal, setModal] = useState<ModalAction | null>(null);
  const { run, pending } = useRuntimeCommand(() => {
    void detail.reload();
    void events.reload();
  });

  const d = detail.data;
  const r = d?.resources ?? null;
  const time = (iso: string | null | undefined) =>
    iso ? `${new Date(iso).toLocaleDateString()} ${formatTime(iso)} (${formatRelative(iso, now)})` : NO_VALUE;

  const handleAction = (action: RuntimeAction) => {
    if (action === 'start') void run(id, 'start');
    else setModal(action);
  };

  if (!d) {
    return (
      <div className="ov-page">
        <button type="button" className="rt-back" onClick={() => navigate('runtimes')}>
          <ArrowLeft size={14} /> {t('nav.runtimes')}
        </button>
        <p className="ov-empty-line">{detail.error ? detail.error.message : t('common.loading')}</p>
      </div>
    );
  }

  const specificRows = (detail: RuntimeDetail): Row[] =>
    RUNTIME_METRICS[detail.id].map((m) => {
      const value = detail.metrics[m.key];
      return {
        label: t(`rt.metric.${m.key}`),
        value: m.kind === 'time' ? (typeof value === 'string' ? time(value) : NO_VALUE) : formatMetric(value, m.unit),
      };
    });

  const tasks = (d.details['tasks'] as SchedulerTask[] | undefined) ?? [];
  const queues = (d.details['queues'] as WorkerQueue[] | undefined) ?? [];

  const renderTab = () => {
    switch (tab) {
      case 'metrics':
        return (
          <>
            <KeyValues
              title={t('rt.detail.resources')}
              rows={[
                { label: t('rt.metric.cpu'), value: r ? percent(r.cpuPercent) : NO_VALUE, warn: Boolean(r && r.cpuPercent >= d.thresholds.cpuPercent) },
                { label: t('rt.metric.rss'), value: formatMb(r?.rssMb) },
                {
                  label: t('rt.metric.memoryLimit'),
                  value: r ? `${formatMb(r.memoryLimitMb)} · ${t(`rt.memorySource.${r.memoryLimitSource}`)}` : NO_VALUE,
                },
                {
                  label: t('rt.metric.memoryPercent'),
                  value: r ? percent(r.memoryPercent) : NO_VALUE,
                  warn: Boolean(r?.memoryPercent && r.memoryPercent >= d.thresholds.memoryPercent),
                },
                { label: t('rt.metric.heap'), value: r ? `${formatMb(r.heapUsedMb)} / ${formatMb(r.heapTotalMb)}` : NO_VALUE },
                { label: t('rt.metric.external'), value: formatMb(r?.externalMb) },
                {
                  label: t('rt.metric.eventLoop'),
                  value: r ? `${r.eventLoopMeanMs} ms · p99 ${r.eventLoopP99Ms} ms` : NO_VALUE,
                  warn: Boolean(r && r.eventLoopP99Ms >= d.thresholds.eventLoopMs),
                },
                { label: t('rt.metric.gc'), value: r ? t('rt.metric.gcValue', { pause: r.gcPauseMs, count: r.gcCount }) : NO_VALUE },
                { label: t('rt.metric.handles'), value: r?.activeHandles ?? NO_VALUE },
              ]}
            />
            <RuntimePerformancePanel runtime={id} names={{ [id]: d.name }} />
          </>
        );
      case 'processes':
        return (
          <KeyValues
            title={t('rt.detail.process')}
            rows={[
              { label: 'PID', value: d.process?.pid ?? NO_VALUE },
              { label: 'PPID', value: d.process?.ppid ?? NO_VALUE },
              { label: t('rt.process.user'), value: d.process?.user ?? NO_VALUE },
              { label: t('rt.process.hostname'), value: d.process?.hostname ?? NO_VALUE },
              { label: t('rt.process.platform'), value: d.process ? `${d.process.platform} / ${d.process.arch}` : NO_VALUE },
              { label: t('rt.process.node'), value: d.process?.nodeVersion ?? NO_VALUE },
              { label: t('rt.process.execArgv'), value: d.process?.execArgv.length ? <code>{d.process.execArgv.join(' ')}</code> : NO_VALUE },
              { label: t('rt.process.startedAt'), value: time(d.startedAt) },
              { label: t('rt.process.restartCount'), value: d.restartCount },
              { label: t('rt.process.lastExitCode'), value: d.lastExitCode ?? NO_VALUE },
              { label: t('rt.process.supervisor'), value: d.supervisor ?? NO_VALUE },
            ]}
          />
        );
      case 'logs':
        return <RuntimeLogsPanel runtime={id} limit={200} onOpenLogViewer={() => navigate(`logs?runtime=${id}`)} />;
      case 'configuration': {
        const desc = d.descriptor;
        return (
          <>
            <KeyValues
              title={t('rt.detail.configuration')}
              rows={[
                { label: t('rt.config.type'), value: desc ? t(`rt.type.${desc.type}`) : NO_VALUE },
                { label: t('rt.config.framework'), value: desc?.framework ?? NO_VALUE },
                { label: t('rt.config.adapter'), value: desc?.adapter ?? NO_VALUE },
                { label: t('rt.config.port'), value: desc?.port ?? NO_VALUE },
                { label: t('rt.config.environment'), value: d.environment ?? NO_VALUE },
                {
                  label: t('rt.metric.memoryLimit'),
                  value: r ? `${formatMb(r.memoryLimitMb)} · ${t(`rt.memorySource.${r.memoryLimitSource}`)}` : NO_VALUE,
                },
                { label: t('rt.process.supervisor'), value: d.supervisor ?? NO_VALUE },
                ...Object.entries(desc?.details ?? {}).map(([k, v]) => ({ label: k, value: formatMetric(v) })),
              ]}
            />
            <KeyValues
              title={t('rt.detail.developer')}
              rows={[
                { label: t('rt.config.source'), value: desc ? <code>{desc.sourcePath}</code> : NO_VALUE },
                { label: t('rt.config.entrypoint'), value: desc ? <code>{desc.entrypoint}</code> : NO_VALUE },
              ]}
            />
            <KeyValues
              title={t('rt.detail.thresholds')}
              rows={[
                { label: t('rt.metric.memoryPercent'), value: `${d.thresholds.memoryPercent}%` },
                { label: t('rt.metric.cpu'), value: `${d.thresholds.cpuPercent}%` },
                { label: t('rt.metric.eventLoop'), value: `${d.thresholds.eventLoopMs} ms` },
              ]}
            />
          </>
        );
      }
      case 'events':
        return (
          <>
            <RuntimeEventsList events={events.data} title={t('rt.events.title')} showRuntime={false} />
            <RestartHistoryTable history={d.restartHistory} />
          </>
        );
      default:
        return (
          <>
            <RuntimeAlerts runtimes={[d]} now={now} onNavigate={navigate} />
            <div className="ov-kpi-grid">
              {[
                { key: 'cpu', value: r ? percent(r.cpuPercent) : NO_VALUE },
                { key: 'memory', value: formatMb(r?.rssMb) },
                { key: 'uptime', value: formatUptime(d.uptimeSec) },
                { key: 'restartCount', value: d.restartCount },
                ...RUNTIME_METRICS[id]
                  .filter((m) => m.card && m.kind !== 'time')
                  .slice(0, 2)
                  .map((m) => ({ key: m.key, value: formatMetric(d.metrics[m.key], m.unit) })),
              ].map((kpi) => (
                <div key={kpi.key} className="ov-card ov-kpi">
                  <span className="ov-kpi-label">{t(`rt.metric.${kpi.key}`)}</span>
                  <span className="ov-kpi-value">{kpi.value}</span>
                </div>
              ))}
            </div>
            <KeyValues title={t(`rt.detail.specific.${id}`)} rows={specificRows(d)} />

            {id === 'scheduler' && (
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('rt.tasks.title')}</h3>
                </header>
                {tasks.length === 0 ? (
                  <p className="ov-empty-line">{t('rt.tasks.empty')}</p>
                ) : (
                  <div className="scp-table-wrap">
                    <table className="scp-table">
                      <thead>
                        <tr>
                          <th>{t('rt.tasks.name')}</th>
                          <th>{t('rt.tasks.cron')}</th>
                          <th>{t('rt.tasks.state')}</th>
                          <th>{t('rt.tasks.lastRun')}</th>
                          <th>{t('rt.tasks.duration')}</th>
                          <th>{t('rt.tasks.nextRun')}</th>
                          <th>{t('rt.tasks.failures')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr key={task.name}>
                            <td className="cell-strong">{task.name}</td>
                            <td>
                              <code>{task.cron}</code>
                            </td>
                            <td>{task.running ? t('rt.tasks.running') : t('rt.tasks.idle')}</td>
                            <td>{task.lastRunAt ? formatRelative(task.lastRunAt, now) : t('rt.never')}</td>
                            <td>{formatDurationMs(task.lastDurationMs)}</td>
                            <td>{task.nextRunAt ? formatRelative(task.nextRunAt, now) : NO_VALUE}</td>
                            <td className={task.failuresToday > 0 ? 'rt-bad' : ''} title={task.lastError ?? undefined}>
                              {task.failuresToday} / {task.runsToday}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {id === 'worker' && (
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('rt.queues.title')}</h3>
                </header>
                <div className="scp-table-wrap">
                  <table className="scp-table">
                    <thead>
                      <tr>
                        <th>{t('rt.queues.name')}</th>
                        {['active', 'waiting', 'delayed', 'failed', 'completed'].map((c) => (
                          <th key={c}>{t(`rt.queues.${c}`)}</th>
                        ))}
                        <th>{t('rt.queues.consumed')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queues.map((q) => (
                        <tr key={q.name}>
                          <td className="cell-strong">
                            <code>{q.name}</code>
                          </td>
                          {['active', 'waiting', 'delayed', 'failed', 'completed'].map((c) => (
                            <td key={c}>{q.counts ? (q.counts[c] ?? 0) : NO_VALUE}</td>
                          ))}
                          <td>{q.consumed ? t('rt.queues.yes') : t('rt.queues.no')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <RuntimePerformancePanel runtime={id} names={{ [id]: d.name }} />
            <div className="ov-split">
              <RuntimeEventsList events={events.data?.slice(0, 8) ?? null} title={t('rt.events.recent')} showRuntime={false} />
              <RuntimeLogsPanel runtime={id} limit={15} onOpenLogViewer={() => navigate(`runtimes/${id}/logs`)} />
            </div>
          </>
        );
    }
  };

  return (
    <div className="ov-page">
      <button type="button" className="rt-back" onClick={() => navigate('runtimes')}>
        <ArrowLeft size={14} /> {t('nav.runtimes')}
      </button>

      <header className="rt-detail-head">
        <div>
          <div className="ov-page-title-row">
            <h1 className="ov-page-title">{d.name}</h1>
            <RuntimeStatusBadge status={d.status} />
          </div>
          <p className="ov-page-subtitle">
            PID {d.pid ?? NO_VALUE} · {t('rt.metric.uptime')} {formatUptime(d.uptimeSec)}
            {d.reasons[0] ? ` · ${d.reasons[0].message}` : ''}
          </p>
        </div>
        <div className="rt-detail-actions">
          <RuntimeActions runtime={d} pending={pending} variant="buttons" onAction={handleAction} />
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`runtimes/${id}/logs`)}>
            <FileText size={13} /> {t('rt.shortcut.logs')}
          </button>
        </div>
      </header>

      <nav className="rt-tabs" role="tablist" aria-label={d.name}>
        {DETAIL_TABS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            className={tab === tabId ? 'is-active' : ''}
            onClick={() => navigate(`runtimes/${id}/${tabId}`)}
          >
            {t(`rt.tab.${tabId}`)}
          </button>
        ))}
      </nav>

      {renderTab()}

      {modal && (
        <RuntimeActionModal
          runtime={d}
          action={modal}
          onCancel={() => setModal(null)}
          onConfirm={(options) => {
            setModal(null);
            void run(id, modal, options);
          }}
        />
      )}
    </div>
  );
};
