import { env } from './env.js';

export type RuntimeSupervisor = 'docker' | 'pm2' | 'systemd' | 'none';

const SUPERVISORS: RuntimeSupervisor[] = ['docker', 'pm2', 'systemd', 'none'];

const intEnv = (key: string, fallback: number, min: number, max: number): number => {
  const raw = env(key, false);
  if (raw === '') return fallback;
  const parsed = Math.trunc(env.number(key));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `[ConfigError] Environment variable "${key}" must be an integer between ${min} and ${max} (received: "${raw}").`,
    );
  }
  return parsed;
};

const boolEnv = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

const assertReplicaBounds = (target: 'API' | 'WORKER', min: number, max: number): void => {
  if (max < min) {
    throw new Error(
      `[ConfigError] AUTOSCALING_${target}_MAX_REPLICAS (${max}) must be greater than or equal to AUTOSCALING_${target}_MIN_REPLICAS (${min}).`,
    );
  }
};

/** Cấu hình giám sát, điều khiển & autoscaling runtime (API, Worker, Scheduler, CLI). */
export const runtimeConfig = () => {
  const supervisor = (
    env('RUNTIME_SUPERVISOR', false) || 'none'
  ).toLowerCase() as RuntimeSupervisor;
  const nodeEnv = (env('NODE_ENV', false) || 'development').toLowerCase();
  const defaultConcurrency = env.number('WORKER_CONCURRENCY', false) || 5;

  const apiMinReplicas = intEnv(
    'AUTOSCALING_API_MIN_REPLICAS',
    nodeEnv === 'production' ? 2 : 1,
    1,
    200,
  );
  const apiMaxReplicas = intEnv(
    'AUTOSCALING_API_MAX_REPLICAS',
    Math.max(10, apiMinReplicas),
    1,
    500,
  );
  assertReplicaBounds('API', apiMinReplicas, apiMaxReplicas);

  const workerMinReplicas = intEnv('AUTOSCALING_WORKER_MIN_REPLICAS', 1, 1, 200);
  const workerMaxReplicas = intEnv(
    'AUTOSCALING_WORKER_MAX_REPLICAS',
    Math.max(8, workerMinReplicas),
    1,
    500,
  );
  assertReplicaBounds('WORKER', workerMinReplicas, workerMaxReplicas);

  return {
    /** Tiến trình nào sẽ dựng lại runtime sau khi nó tự thoát (restart). */
    supervisor: SUPERVISORS.includes(supervisor) ? supervisor : 'none',
    heartbeatMs: env.number('RUNTIME_HEARTBEAT_MS', false) || 5000,
    /** Ring buffer log mỗi runtime (Redis) — cũng là phạm vi tìm kiếm của trang Logs. */
    logRetention: env.number('RUNTIME_LOG_RETENTION', false) || 5000,
    eventRetention: env.number('RUNTIME_EVENT_RETENTION', false) || 2000,
    thresholds: {
      memoryPercent: env.number('RUNTIME_MEMORY_WARN_PERCENT', false) || 85,
      cpuPercent: env.number('RUNTIME_CPU_WARN_PERCENT', false) || 85,
      eventLoopMs: env.number('RUNTIME_EVENT_LOOP_WARN_MS', false) || 100,
      restartStormCount: env.number('RUNTIME_RESTART_STORM_COUNT', false) || 3,
      restartStormWindowMin: env.number('RUNTIME_RESTART_STORM_WINDOW_MIN', false) || 10,
    },
    /** Cho phép restart/stop/start từ System Console (nên tắt ở production khi chưa có RBAC). */
    actionsEnabled: boolEnv('OPS_RUNTIME_ACTIONS_ENABLED', true),
    gracefulTimeoutMs: Math.max(1000, env.number('RUNTIME_GRACEFUL_TIMEOUT_MS', false) || 30000),
    /** Thời gian chờ (ms) sau khi chuyển readiness=503 để Load Balancer rút instance khỏi pool trước khi đóng kết nối. */
    drainDelayMs: (() => {
      const raw = env('RUNTIME_DRAIN_DELAY_MS', false);
      if (raw !== '') return Math.max(0, env.number('RUNTIME_DRAIN_DELAY_MS'));
      return nodeEnv === 'test' ? 0 : 5000;
    })(),
    /** Cấu hình mặc định cho Autoscaling (Phase 13.2 — có thể override động qua SettingRegistryService). */
    autoscaling: {
      enabled: boolEnv('AUTOSCALING_ENABLED', true),
      tolerancePercent: intEnv('AUTOSCALING_TOLERANCE_PERCENT', 10, 0, 50),
      api: {
        minReplicas: apiMinReplicas,
        maxReplicas: apiMaxReplicas,
        scaleUpCooldownSec: intEnv('AUTOSCALING_API_SCALE_UP_COOLDOWN_SEC', 60, 0, 3600),
        scaleDownCooldownSec: intEnv('AUTOSCALING_API_SCALE_DOWN_COOLDOWN_SEC', 300, 0, 7200),
        scaleUpMaxStep: intEnv('AUTOSCALING_API_SCALE_UP_MAX_STEP', 2, 1, 50),
        scaleDownMaxStep: intEnv('AUTOSCALING_API_SCALE_DOWN_MAX_STEP', 1, 1, 50),
        targetCpuPercent: intEnv('AUTOSCALING_API_TARGET_CPU_PERCENT', 70, 10, 95),
        targetMemoryPercent: intEnv('AUTOSCALING_API_TARGET_MEMORY_PERCENT', 75, 10, 95),
        targetInFlightPerInstance: intEnv('AUTOSCALING_API_TARGET_IN_FLIGHT', 100, 1, 100_000),
      },
      worker: {
        minReplicas: workerMinReplicas,
        maxReplicas: workerMaxReplicas,
        scaleUpCooldownSec: intEnv('AUTOSCALING_WORKER_SCALE_UP_COOLDOWN_SEC', 30, 0, 3600),
        scaleDownCooldownSec: intEnv('AUTOSCALING_WORKER_SCALE_DOWN_COOLDOWN_SEC', 300, 0, 7200),
        scaleUpMaxStep: intEnv('AUTOSCALING_WORKER_SCALE_UP_MAX_STEP', 2, 1, 50),
        scaleDownMaxStep: intEnv('AUTOSCALING_WORKER_SCALE_DOWN_MAX_STEP', 1, 1, 50),
        targetCpuPercent: intEnv('AUTOSCALING_WORKER_TARGET_CPU_PERCENT', 75, 10, 95),
        targetMemoryPercent: intEnv('AUTOSCALING_WORKER_TARGET_MEMORY_PERCENT', 80, 10, 95),
        targetBacklogPerInstance: intEnv('AUTOSCALING_WORKER_TARGET_BACKLOG', 50, 1, 1_000_000),
      },
      database: {
        maxConnectionsBudget: intEnv('AUTOSCALING_DB_MAX_CONNECTIONS_BUDGET', 150, 10, 100_000),
        warnUtilizationPercent: intEnv('AUTOSCALING_DB_WARN_UTILIZATION_PERCENT', 80, 10, 100),
      },
    },
    worker: {
      concurrency: defaultConcurrency,
      criticalConcurrency: env.number('WORKER_CRITICAL_CONCURRENCY', false) || 10,
      notificationsConcurrency: env.number('WORKER_NOTIFICATIONS_CONCURRENCY', false) || 8,
      heavyConcurrency: env.number('WORKER_HEAVY_CONCURRENCY', false) || 2,
      eventsConcurrency: env.number('WORKER_EVENTS_CONCURRENCY', false) || defaultConcurrency,
      jobTimeoutMs: env.number('WORKER_JOB_TIMEOUT_MS', false) || 60000,
    },
    scheduler: {
      maintenanceCron: env('SCHEDULER_MAINTENANCE_CRON', false) || '*/5 * * * *',
    },
  };
};

export type RuntimeConfig = ReturnType<typeof runtimeConfig>;
