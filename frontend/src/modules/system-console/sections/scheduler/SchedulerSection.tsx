import React from 'react';
import { ArrowRight, Clock, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { PageHeader, PageTabs, StatusBanner, type PageTab } from '@core/ui/blocks';
import { schedulerApi } from '../../services/scheduler.api';
import { SCHEDULER_TABS, SCHEDULER_TONE, type SchedulerPageTab } from '../../constants/scheduler';
import { ExecutionSheet } from '../../components/scheduler/ExecutionSheet';
import { useSchedulerPage } from './useSchedulerPage';
import { useTaskActions } from './useTaskActions';
import { schedulerKeys } from './scheduler-keys';
import { SchedulerOverviewTab } from './SchedulerOverviewTab';
import { SchedulerTasksTab } from './SchedulerTasksTab';
import { SchedulerHistoryTab } from './SchedulerHistoryTab';
import { SchedulerTimelineTab } from './SchedulerTimelineTab';
import { TaskDetailPage } from './TaskDetailPage';
import { SchedulerConfigSheet } from './SchedulerConfigSheet';

const KNOWN_ENVS = ['production', 'staging', 'development'];

/**
 * Scheduler — khi nào công việc nền được kích hoạt: Tổng quan · Tasks · Lịch sử · Timeline; trang task
 * `tasks/<id>`; lần chạy mở drawer (`?exec=`) ở mọi tab; cấu hình + Cron Inspector mở bằng ⚙.
 * Scheduler chưa chạy / chưa đăng ký task → nói rõ, không hiện dữ liệu mẫu.
 */
export const SchedulerSection: React.FC = () => {
  const { t } = useLocale();
  const page = useSchedulerPage();
  const overview = useLiveQuery(schedulerKeys.overview(page.range), () => schedulerApi.overview(page.range));
  const data = overview.data;
  const actions = useTaskActions({ settings: data?.settings, environment: data?.environment ?? '', onRun: page.openExec });

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const failing = data?.tasks.filter((x) => x.consecutiveFailures > 0).length ?? 0;
  const tabs: PageTab<SchedulerPageTab>[] = SCHEDULER_TABS.map((id) => ({
    id,
    label: t(`sch.tab.${id}`),
    ...(id === 'overview' ? { count: problems, countTone: 'crit' as const } : id === 'tasks' ? { count: failing, countTone: 'warn' as const } : {}),
  }));

  const health = data?.health;
  const tz = data?.timezone;
  const env = data ? (KNOWN_ENVS.includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment) : null;

  const renderTab = () => {
    switch (page.tab) {
      case 'tasks':
        return page.taskId ? (
          <TaskDetailPage key={page.taskId} page={page} taskId={page.taskId} actions={actions} />
        ) : (
          <SchedulerTasksTab page={page} actions={actions} />
        );
      case 'history':
        return <SchedulerHistoryTab page={page} tasks={data?.tasks ?? []} />;
      case 'timeline':
        return <SchedulerTimelineTab page={page} />;
      default:
        return <SchedulerOverviewTab page={page} query={overview} />;
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.scheduler')}
        icon={Clock}
        status={health ? { tone: SCHEDULER_TONE[health.status], label: t(`sch.health.${health.status}`) } : undefined}
        actions={
          data && tz ? (
            <>
              {env && <Badge variant="outline">{env}</Badge>}
              <Hint content={tz.runtime && tz.runtime !== tz.schedule ? t('sch.tz.runtimeHint', { tz: tz.runtime }) : t('sch.tz.label')}>
                <Badge variant="outline" className="hidden font-mono sm:inline-flex">
                  {tz.schedule} ({tz.scheduleOffset})
                </Badge>
              </Hint>
            </>
          ) : undefined
        }
        onSettings={() => page.setSettings(true)}
      />

      {overview.isError && !data && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          description={overview.error instanceof Error ? overview.error.message : undefined}
          actions={
            <Button size="xs" onClick={() => void overview.refetch()}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}
      {health && health.status !== 'healthy' && (
        <StatusBanner
          tone={SCHEDULER_TONE[health.status] === 'unknown' ? 'info' : SCHEDULER_TONE[health.status]}
          title={t(`sch.health.${health.status}`)}
          reasons={health.reasons.map((r) => ({ id: `${r.code}-${r.message}`, text: r.message, onClick: r.taskId ? () => page.openTask(r.taskId!) : undefined }))}
          actions={
            health.status === 'down' || health.status === 'paused' || health.status === 'unknown' ? (
              <Button size="xs" variant="secondary" onClick={() => page.navigate('runtimes/scheduler')}>
                {t('sch.health.inspectRuntime')}
                <ArrowRight />
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.tasks.length === 0 && (
        <StatusBanner tone="info" title={t('sch.empty.title')} description={t(data.instance !== null ? 'sch.empty.noTasks' : 'sch.empty.noRuntime')} />
      )}

      {!page.taskId && <PageTabs tabs={tabs} value={page.tab} onChange={(tab) => page.go(tab)} />}
      {renderTab()}

      <ExecutionSheet id={page.execId} onClose={() => page.openExec(null)} onOpenTask={(id) => page.openTask(id)} onAction={actions.request} navigate={page.navigate} />
      <SchedulerConfigSheet open={page.settingsOpen} onOpenChange={page.setSettings} defaultTimezone={tz?.schedule ?? ''} openTask={page.openTask} />
      {actions.dialog}
    </div>
  );
};
