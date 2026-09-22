import React, { useState } from 'react';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { FlaskConical, Play } from 'lucide-react';

interface CronTask {
  id: string;
  name: string;
  cronExpr: string;
  domain: string;
  path: string;
  description: string;
  lastRun?: string;
  nextRun: string;
}

export const SchedulerSection: React.FC = () => {
  const { addEvent, addToast } = useConsoleData();

  const [tasks, setTasks] = useState<CronTask[]>([
    {
      id: 'task-clean',
      name: 'DatabaseCleanupTask',
      cronExpr: '0 2 * * *',
      domain: 'system',
      path: 'apps/scheduler/tasks/system/cleanup.task.ts',
      description: 'Prunes expired tokens, soft-deleted sessions and old temp uploads.',
      lastRun: 'Today, 02:00 UTC',
      nextRun: 'Tomorrow, 02:00 UTC',
    },
    {
      id: 'task-prune',
      name: 'NotificationPruneTask',
      cronExpr: '*/30 * * * *',
      domain: 'notification',
      path: 'apps/scheduler/tasks/notification/prune.task.ts',
      description: 'Archives sent push notifications older than 30 days.',
      lastRun: '12 minutes ago',
      nextRun: 'In 18 minutes',
    },
    {
      id: 'task-metrics',
      name: 'MetricsAggregationTask',
      cronExpr: '*/10 * * * *',
      domain: 'system',
      path: 'apps/scheduler/tasks/system/metrics.task.ts',
      description: 'Calculates roll-up traffic metrics and saves hourly system summaries.',
      lastRun: '3 minutes ago',
      nextRun: 'In 7 minutes',
    },
    {
      id: 'task-digest',
      name: 'UserActivityDigestTask',
      cronExpr: '0 9 * * 1',
      domain: 'user',
      path: 'apps/scheduler/tasks/user/digest.task.ts',
      description: 'Generates weekly summary digests for active workspace operators.',
      lastRun: 'Monday, 09:00 UTC',
      nextRun: 'Next Monday, 09:00 UTC',
    },
  ]);

  const [testExpr, setTestExpr] = useState('*/15 * * * *');
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const translateCron = (expr: string) => {
    switch (expr.trim()) {
      case '0 2 * * *':
        return 'Every day at 02:00 AM UTC';
      case '*/30 * * * *':
        return 'Every 30 minutes';
      case '*/10 * * * *':
        return 'Every 10 minutes';
      case '*/15 * * * *':
        return 'Every 15 minutes';
      case '0 9 * * 1':
        return 'Every Monday at 09:00 AM UTC';
      case '0 0 * * *':
        return 'Every day at midnight (00:00 UTC)';
      default:
        return 'Custom interval scheduled via NestJS cron engine';
    }
  };

  const handleTriggerTask = async (task: CronTask) => {
    setRunningTaskId(task.id);
    addEvent('info', 'scheduler', `Manually dispatched cron task [${task.name}]`);

    setTimeout(() => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, lastRun: 'Just now' } : t,
        ),
      );
      addEvent('success', 'scheduler', `Cron task [${task.name}] completed execution successfully in 84ms`);
      addToast({
        type: 'success',
        title: 'Task Executed',
        message: `Task [${task.name}] executed manually.`,
      });
      setRunningTaskId(null);
    }, 1000);
  };

  return (
    <div>
      <SectionHeader
        title="Cron Scheduler & Periodic Jobs"
        description="Inspect registered cron schedules, examine execution frequencies, and manually trigger periodic background tasks."
      />

      {/* Scheduled Tasks List */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span>⏱️ Active Scheduled Tasks</span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)', fontFamily: 'monospace' }}>
            apps/scheduler/tasks/
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="scp-table">
            <thead>
              <tr>
                <th>Task Name & Domain</th>
                <th>Cron Expression</th>
                <th>Schedule Description</th>
                <th>Last Executed</th>
                <th>Next Run</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const isRunning = runningTaskId === task.id;
                return (
                  <tr key={task.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--scp-text-primary)' }}>
                        {task.name}
                      </div>
                      <div style={{ fontSize: '0.725rem', color: 'var(--scp-text-muted)', fontFamily: 'monospace' }}>
                        domain: {task.domain}
                      </div>
                    </td>
                    <td>
                      <span className="code-badge" style={{ fontWeight: 700 }}>
                        {task.cronExpr}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--scp-text-secondary)' }}>
                      {translateCron(task.cronExpr)}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--scp-text-muted)' }}>
                      {task.lastRun || 'Never'}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--scp-primary-text)', fontWeight: 600 }}>
                      {task.nextRun}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="scp-btn scp-btn-sm scp-btn-secondary"
                        disabled={isRunning}
                        onClick={() => handleTriggerTask(task)}
                      >
                        {isRunning ? (
                          'Running...'
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Play size={12} />
                            <span>Trigger Now</span>
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cron Expression Helper */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <FlaskConical size={16} />
              <span>Interactive Cron Expression Tester</span>
            </span>
          </h3>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--scp-text-secondary)' }}>
              Expression:
            </label>
            <input
              type="text"
              value={testExpr}
              onChange={(e) => setTestExpr(e.target.value)}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--scp-border-subtle)',
                backgroundColor: 'var(--scp-bg-surface-subtle)',
                color: 'var(--scp-text-primary)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                width: '180px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--scp-text-primary)' }}>
            Schedule interpretation:{' '}
            <strong style={{ color: 'var(--scp-primary)' }}>{translateCron(testExpr)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
