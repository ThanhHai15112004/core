import React from 'react';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { UptimeCounter } from '../components/common/UptimeCounter';

export const RuntimeSection: React.FC = () => {
  const { health } = useConsoleData();

  const runtimes = [
    {
      id: 'api',
      name: 'HTTP API Gateway (Fastify)',
      path: 'backend/src/apps/api/',
      status: health.status,
      port: 3005,
      type: 'HTTP / Inbound',
      framework: 'NestJS 11 + Fastify',
      memoryLimit: '768 MB',
      memoryReservation: '384 MB',
      uptime: health.uptime,
      description: 'High-throughput inbound REST/JSON API gateway with Zod validation, Pino correlation tracing, and Swagger.',
      features: [
        'Fastify performance-focused adapter',
        'Zod schema validation pipe',
        'Global exception filter & standard response envelope',
        'Swagger UI at /docs',
      ],
    },
    {
      id: 'worker',
      name: 'Message Queue Worker',
      path: 'backend/src/apps/worker/',
      status: 'healthy',
      port: 'N/A (Consumer)',
      type: 'Asynchronous / BullMQ',
      framework: 'NestJS + BullMQ + Redis',
      memoryLimit: '512 MB',
      memoryReservation: '256 MB',
      uptime: health.uptime,
      description: 'Distributed background job consumer listening on Redis queues for heavy asynchronous workloads.',
      features: [
        'Domain-grouped processors: notification, report, user',
        'Exponential backoff retry policy',
        'Dead-letter queue (DLQ) support',
        'Graceful shutdown lifecycle hook',
      ],
    },
    {
      id: 'scheduler',
      name: 'Cron Tasks Scheduler',
      path: 'backend/src/apps/scheduler/',
      status: 'healthy',
      port: 'N/A (Timer)',
      type: 'Periodic / Cron Engine',
      framework: 'NestJS @nestjs/schedule',
      memoryLimit: '256 MB',
      memoryReservation: '128 MB',
      uptime: health.uptime,
      description: 'Deterministic cron schedule runner executing periodic maintenance, report generation, and system cleanups.',
      features: [
        'Standard 5-field cron syntax',
        'Domain-grouped tasks: user, notification, system',
        'Execution overlap prevention locks',
        'Heartbeat & run logging',
      ],
    },
    {
      id: 'cli',
      name: 'CLI Management Tool',
      path: 'backend/src/apps/cli/',
      status: 'idle',
      port: 'N/A (Console)',
      type: 'On-Demand / Command Line',
      framework: 'Nest Commander',
      memoryLimit: '256 MB',
      memoryReservation: '128 MB',
      uptime: 0,
      description: 'Command line runner for DevOps and developers: schema migration, database seeding, cache clearing, data export.',
      features: [
        'Commands grouped by domain: database, user, maintenance',
        'Dry-run simulation flags',
        'Interactive and headless CI/CD modes',
        'Direct Kernel DI context bootstrap',
      ],
    },
  ];

  return (
    <div>
      <SectionHeader
        title="Multi-Runtime Execution Monitor"
        description="Inspect the 4 independent entrypoints of the Core Framework architecture: API Gateway, Worker, Scheduler, and CLI."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
        {runtimes.map((rt) => (
          <div key={rt.id} className="scp-panel" style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
            <div className="scp-panel-header">
              <div>
                <h3 className="scp-panel-title">{rt.name}</h3>
                <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-text-muted)' }}>
                  {rt.path}
                </span>
              </div>
              <StatusPill status={rt.status} />
            </div>

            <p style={{ fontSize: '0.825rem', color: 'var(--scp-text-secondary)', lineHeight: 1.5, margin: '0 0 1rem', flex: 1 }}>
              {rt.description}
            </p>

            {/* Config & Metrics Table */}
            <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', overflow: 'hidden', marginBottom: '1rem' }}>
              <table className="scp-table">
                <tbody>
                  <tr>
                    <td style={{ width: '45%', color: 'var(--scp-text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>RUNTIME TYPE</td>
                    <td style={{ fontWeight: 600, fontSize: '0.75rem' }}>{rt.type}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--scp-text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>FRAMEWORK / ENGINE</td>
                    <td style={{ fontSize: '0.75rem' }}>{rt.framework}</td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--scp-text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>MEMORY LIMIT / RESV</td>
                    <td style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {rt.memoryLimit} / {rt.memoryReservation}
                    </td>
                  </tr>
                  {rt.uptime > 0 && (
                    <tr>
                      <td style={{ color: 'var(--scp-text-muted)', fontSize: '0.75rem', fontWeight: 600 }}>RUNTIME UPTIME</td>
                      <td style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-success)' }}>
                        <UptimeCounter uptimeSeconds={rt.uptime} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Key Capabilities */}
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                Capabilities & Bootstrap
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.78rem', color: 'var(--scp-text-secondary)', lineHeight: 1.6 }}>
                {rt.features.map((feat, i) => (
                  <li key={i}>{feat}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
