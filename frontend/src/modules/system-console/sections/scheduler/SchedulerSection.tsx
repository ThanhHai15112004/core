import React, { useCallback, useState } from 'react';
import { Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { Execution, SchedulerAlert, SchedulerTab } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { useSchedulerRoute } from '../../hooks/useSchedulerRoute';
import { useSchedulerActions, type TaskAction } from '../../hooks/useSchedulerActions';
import { SCHEDULER_RANGES, SCHEDULER_TABS } from '../../constants/scheduler';
import { SchedulerHealthBanner } from '../../components/scheduler/SchedulerHealthBanner';
import { ExecutionDrawer } from '../../components/scheduler/ExecutionDrawer';
import { SchedulerOverviewView } from './SchedulerOverviewView';
import { SchedulerTasksView } from './SchedulerTasksView';
import { TaskDetailView } from './TaskDetailView';
import { SchedulerHistoryView, SchedulerFailuresView } from './SchedulerHistoryViews';
import { SchedulerTimelineView } from './SchedulerTimelineView';
import { SchedulerConfigView, SchedulerEventsView } from './SchedulerOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-messaging.css';
import '../../styles/console-worker.css';
import '../../styles/console-scheduler.css';

/**
 * Scheduler: `scheduler/<tab>/<taskId>/<sub>?exec=` — khi nào công việc phải được kích hoạt: task nào đang bật, lần chạy
 * gần nhất ra sao, lần tới khi nào, task nào lỗi liên tục / chạy lâu / lỡ lịch / chạy chồng; lịch sử từng lần chạy và
 * job nó tạo ra (→ Worker & Queue). Khác Worker & Queue (công việc nền có được xử lý tốt không) và Jobs (một lần thực thi
 * cụ thể). Không có task mẫu: scheduler chưa chạy / chưa đăng ký task → nói rõ.
 */
export const SchedulerSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, taskId, sub, range, exec, go, openTask, setExec, setRange, navigate } = useSchedulerRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => schedulerApi.overview(range), `scheduler:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const data = overview.data;
  const onDone = useCallback(
    (action: TaskAction, _task: unknown, executionId?: string) => {
      bump();
      if (action === 'run' && executionId) setExec(executionId);
    },
    [bump, setExec],
  );
  const actions = useSchedulerActions(data?.settings, data?.environment ?? '', onDone);

  const openExecution = (e: Pick<Execution, 'id'>) => setExec(e.id);
  const openAlert = (a: SchedulerAlert) => (a.taskId ? openTask(a.taskId) : go(a.tab as SchedulerTab));

  const renderTab = () => {
    const common = { range, paused, reloadKey, now };
    switch (tab) {
      case 'tasks':
        return taskId ? (
          <TaskDetailView
            key={taskId}
            {...common}
            taskId={taskId}
            sub={sub}
            onSub={(s) => openTask(taskId, s)}
            onBack={() => go('tasks')}
            onAction={actions.request}
            openExecution={openExecution}
            navigate={navigate}
          />
        ) : (
          <SchedulerTasksView {...common} openTask={openTask} onAction={actions.request} canRun={actions.canRun} />
        );
      case 'history':
        return <SchedulerHistoryView {...common} tasks={data?.tasks ?? []} openExecution={openExecution} />;
      case 'timeline':
        return <SchedulerTimelineView {...common} openExecution={openExecution} openTask={openTask} />;
      case 'failures':
        return <SchedulerFailuresView {...common} openExecution={openExecution} openTask={openTask} openAlert={openAlert} />;
      case 'events':
        return <SchedulerEventsView paused={paused} reloadKey={reloadKey} openExecution={(id) => setExec(id)} />;
      case 'configuration':
        return <SchedulerConfigView now={now} defaultTimezone={data?.timezone.schedule ?? 'UTC'} openTask={openTask} />;
      default:
        return (
          <SchedulerOverviewView
            data={data}
            {...common}
            go={go}
            openTask={openTask}
            openAlert={openAlert}
            openExecution={openExecution}
            onAction={actions.request}
            canRun={actions.canRun}
            navigate={navigate}
          />
        );
    }
  };

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const failing = data?.tasks.filter((x) => x.consecutiveFailures > 0).length ?? 0;
  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.scheduler')}</h1>
          <p className="ov-page-subtitle">{t('sch.subtitle')}</p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
            <RefreshCw size={13} /> {t('cache.refresh')}
          </button>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      {overview.error && !data ? (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      ) : (
        data && <SchedulerHealthBanner data={data} now={now} onOpenTask={openTask} onInspectRuntime={() => navigate('runtimes/scheduler')} />
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.scheduler')}>
          {SCHEDULER_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`sch.tab.${x}`)}
              {x === 'overview' && problems > 0 && <span className="ov-count">{problems}</span>}
              {x === 'failures' && failing > 0 && <span className="ov-count">{failing}</span>}
            </button>
          ))}
        </nav>
        {tab !== 'timeline' && tab !== 'configuration' && (
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
            {SCHEDULER_RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {renderTab()}

      {exec && (
        <ExecutionDrawer
          key={exec}
          id={exec}
          onClose={() => setExec(null)}
          onOpenTask={(id) => openTask(id)}
          onAction={actions.request}
          navigate={navigate}
        />
      )}
      {actions.modal}
    </div>
  );
};
