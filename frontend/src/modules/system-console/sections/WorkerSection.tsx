import React, { useState } from 'react';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { StatCard } from '../components/common/StatCard';
import { Layers, Cpu, Zap, CheckCircle, AlertTriangle } from 'lucide-react';

export const WorkerSection: React.FC = () => {
  const { addEvent, addToast } = useConsoleData();

  const [queues, setQueues] = useState([
    {
      name: 'core:notifications',
      domain: 'notification',
      status: 'healthy',
      waiting: 0,
      active: 1,
      completed: 1420,
      failed: 0,
      concurrency: 5,
    },
    {
      name: 'core:reports',
      domain: 'report',
      status: 'healthy',
      waiting: 2,
      active: 0,
      completed: 88,
      failed: 1,
      concurrency: 2,
    },
    {
      name: 'core:user',
      domain: 'user',
      status: 'healthy',
      waiting: 0,
      active: 0,
      completed: 512,
      failed: 0,
      concurrency: 3,
    },
  ]);

  const [isDispatching, setIsDispatching] = useState(false);

  const processors = [
    {
      name: 'NotificationProcessor',
      path: 'apps/worker/processors/notification/notification.processor.ts',
      queue: 'core:notifications',
      handlers: ['send_welcome_email', 'send_otp', 'push_notification'],
      status: 'active',
    },
    {
      name: 'ReportProcessor',
      path: 'apps/worker/processors/report/report.processor.ts',
      queue: 'core:reports',
      handlers: ['export_csv', 'generate_audit_log'],
      status: 'active',
    },
    {
      name: 'UserActivityProcessor',
      path: 'apps/worker/processors/user/user.processor.ts',
      queue: 'core:user',
      handlers: ['sync_user_profile', 'track_login_event'],
      status: 'active',
    },
  ];

  const handleDispatchTestJob = async (queueName: string) => {
    setIsDispatching(true);
    const jobId = `job-${Date.now()}`;
    addEvent('info', 'worker', `Enqueued job #${jobId} to queue [${queueName}] with payload { test: true }`);

    // simulate worker processing
    setTimeout(() => {
      setQueues((prev) =>
        prev.map((q) =>
          q.name === queueName ? { ...q, active: q.active + 1 } : q,
        ),
      );
    }, 400);

    setTimeout(() => {
      setQueues((prev) =>
        prev.map((q) =>
          q.name === queueName
            ? { ...q, active: Math.max(0, q.active - 1), completed: q.completed + 1 }
            : q,
        ),
      );
      addEvent('success', 'worker', `Job #${jobId} processed successfully by worker in 115ms`);
      addToast({
        type: 'success',
        title: 'Job Completed',
        message: `Job #${jobId} on queue [${queueName}] processed successfully.`,
      });
      setIsDispatching(false);
    }, 1800);
  };

  const totalWaiting = queues.reduce((acc, q) => acc + q.waiting, 0);
  const totalActive = queues.reduce((acc, q) => acc + q.active, 0);
  const totalCompleted = queues.reduce((acc, q) => acc + q.completed, 0);
  const totalFailed = queues.reduce((acc, q) => acc + q.failed, 0);

  return (
    <div>
      <SectionHeader
        title="Background Worker & Message Queue"
        description="Monitor BullMQ background queues, consumer concurrency, domain processors, and dead-letter queue health."
      />

      {/* 4 Stat Cards */}
      <div className="overview-grid-4">
        <StatCard
          title="Active Consumers"
          value="3 Processors"
          icon={<Cpu size={18} />}
          subtext="Total Concurrency: 10 threads"
        />
        <StatCard
          title="Jobs in Flight"
          value={totalActive}
          icon={<Zap size={18} />}
          subtext={<span>Waiting in queue: <strong>{totalWaiting}</strong></span>}
        />
        <StatCard
          title="Total Completed"
          value={totalCompleted.toLocaleString()}
          icon={<CheckCircle size={18} />}
          subtext={<span style={{ color: 'var(--scp-success)' }}>99.9% Success rate</span>}
        />
        <StatCard
          title="Dead Letter Queue"
          value={totalFailed}
          icon={<AlertTriangle size={18} />}
          subtext={<span>Failed retries: {totalFailed}</span>}
        />
      </div>

      {/* Queues Table */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Layers size={16} />
              <span>Managed Queues (Redis Transport)</span>
            </span>
          </h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="scp-table">
            <thead>
              <tr>
                <th>Queue Name</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Waiting</th>
                <th>Active</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Concurrency</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name}>
                  <td>
                    <span className="code-badge">{q.name}</span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{q.domain}</td>
                  <td>
                    <StatusPill status={q.status} />
                  </td>
                  <td>{q.waiting}</td>
                  <td style={{ color: q.active > 0 ? 'var(--scp-primary)' : 'inherit', fontWeight: q.active > 0 ? 700 : 400 }}>
                    {q.active}
                  </td>
                  <td style={{ color: 'var(--scp-success)' }}>{q.completed}</td>
                  <td style={{ color: q.failed > 0 ? 'var(--scp-danger)' : 'inherit' }}>{q.failed}</td>
                  <td>{q.concurrency} jobs</td>
                  <td>
                    <button
                      type="button"
                      className="scp-btn scp-btn-sm scp-btn-secondary"
                      disabled={isDispatching}
                      onClick={() => handleDispatchTestJob(q.name)}
                    >
                      {isDispatching ? 'Enqueuing...' : '+ Dispatch Test Job'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Processors Registry */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={16} />
              <span>Registered Domain Processors</span>
            </span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)', fontFamily: 'monospace' }}>
            apps/worker/processors/
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {processors.map((proc) => (
            <div
              key={proc.name}
              style={{
                padding: '1rem',
                borderRadius: '8px',
                border: '1px solid var(--scp-border-subtle)',
                backgroundColor: 'var(--scp-bg-surface-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <strong style={{ fontSize: '0.9rem', color: 'var(--scp-text-primary)' }}>{proc.name}</strong>
                <StatusPill status={proc.status} label="Active" />
              </div>
              <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-text-muted)', marginBottom: '0.75rem' }}>
                {proc.path}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-secondary)', marginBottom: '0.5rem' }}>
                Target Queue: <span className="code-badge">{proc.queue}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
                Registered Handlers:
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                  {proc.handlers.map((h) => (
                    <span key={h} className="code-badge" style={{ fontSize: '0.7rem' }}>
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
