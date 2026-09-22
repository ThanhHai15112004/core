import { env } from './env.js';

export type RuntimeSupervisor = 'docker' | 'pm2' | 'systemd' | 'none';

const SUPERVISORS: RuntimeSupervisor[] = ['docker', 'pm2', 'systemd', 'none'];

/** Cấu hình giám sát & điều khiển runtime (API, Worker, Scheduler, CLI). */
export const runtimeConfig = () => {
  const supervisor = (
    env('RUNTIME_SUPERVISOR', false) || 'none'
  ).toLowerCase() as RuntimeSupervisor;

  return {
    /** Tiến trình nào sẽ dựng lại runtime sau khi nó tự thoát (restart). */
    supervisor: SUPERVISORS.includes(supervisor) ? supervisor : 'none',
    heartbeatMs: env.number('RUNTIME_HEARTBEAT_MS', false) || 5000,
    sampleIntervalMs: env.number('RUNTIME_SAMPLE_INTERVAL_MS', false) || 15000,
    /** Số mẫu time-series giữ lại cho mỗi runtime (mặc định 24h với mẫu 15s). */
    sampleRetention: env.number('RUNTIME_SAMPLE_RETENTION', false) || 5760,
    logRetention: env.number('RUNTIME_LOG_RETENTION', false) || 1000,
    eventRetention: env.number('RUNTIME_EVENT_RETENTION', false) || 2000,
    thresholds: {
      memoryPercent: env.number('RUNTIME_MEMORY_WARN_PERCENT', false) || 85,
      cpuPercent: env.number('RUNTIME_CPU_WARN_PERCENT', false) || 85,
      eventLoopMs: env.number('RUNTIME_EVENT_LOOP_WARN_MS', false) || 100,
      restartStormCount: env.number('RUNTIME_RESTART_STORM_COUNT', false) || 3,
      restartStormWindowMin: env.number('RUNTIME_RESTART_STORM_WINDOW_MIN', false) || 10,
    },
    /** Cho phép restart/stop/start từ System Console (nên tắt ở production khi chưa có RBAC). */
    actionsEnabled: env('OPS_RUNTIME_ACTIONS_ENABLED', false)
      ? env.boolean('OPS_RUNTIME_ACTIONS_ENABLED')
      : true,
    gracefulTimeoutMs: env.number('RUNTIME_GRACEFUL_TIMEOUT_MS', false) || 30000,
    worker: {
      concurrency: env.number('WORKER_CONCURRENCY', false) || 5,
    },
    scheduler: {
      maintenanceCron: env('SCHEDULER_MAINTENANCE_CRON', false) || '*/5 * * * *',
    },
  };
};

export type RuntimeConfig = ReturnType<typeof runtimeConfig>;
