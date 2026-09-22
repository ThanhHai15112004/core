import type { RuntimeId } from '../types/runtime.types';

/**
 * Metric riêng của từng runtime (key khớp `collectMetrics()` của contributor phía backend).
 * `card: true` → hiện trên runtime card; còn lại hiện ở trang chi tiết.
 */
export interface RuntimeMetricDef {
  key: string;
  unit?: string;
  card?: boolean;
  /** Giá trị là thời điểm ISO → hiển thị dạng tương đối. */
  kind?: 'time';
}

export const RUNTIME_METRICS: Record<RuntimeId, RuntimeMetricDef[]> = {
  api: [
    { key: 'requestsPerSecond', unit: 'req/s', card: true },
    { key: 'p95LatencyMs', unit: 'ms', card: true },
    { key: 'errorRatePercent', unit: '%', card: true },
    { key: 'activeRequests', card: true },
    { key: 'openConnections' },
    { key: 'totalRequests' },
    { key: 'errorCount' },
  ],
  worker: [
    { key: 'activeJobs', card: true },
    { key: 'waitingJobs', card: true },
    { key: 'jobsPerMinute', card: true },
    { key: 'failedJobs', card: true },
    { key: 'delayedJobs' },
    { key: 'completedJobs' },
    { key: 'avgJobDurationMs', unit: 'ms' },
    { key: 'consumers' },
    { key: 'concurrency' },
  ],
  scheduler: [
    { key: 'registeredTasks', card: true },
    { key: 'runningTasks', card: true },
    { key: 'failedToday', card: true },
    { key: 'nextTaskAt', card: true, kind: 'time' },
    { key: 'runsToday' },
    { key: 'nextTaskName' },
    { key: 'lastFailedTask' },
    { key: 'lastFailedAt', kind: 'time' },
  ],
};

/** Nút phụ trên card: dẫn tới tab liên quan (đường dẫn console). */
export const RUNTIME_SHORTCUTS: Record<RuntimeId, Array<{ key: string; path: (id: RuntimeId) => string }>> = {
  api: [{ key: 'logs', path: (id) => `runtimes/${id}/logs` }],
  worker: [
    { key: 'queues', path: () => 'worker' },
    { key: 'logs', path: (id) => `runtimes/${id}/logs` },
  ],
  scheduler: [
    { key: 'tasks', path: (id) => `runtimes/${id}/overview` },
    { key: 'logs', path: (id) => `runtimes/${id}/logs` },
  ],
};

/** Ngữ cảnh hiển thị trong modal Restart/Stop (metric "đang bận"). */
export const BUSY_METRICS: Record<RuntimeId, string[]> = {
  api: ['activeRequests'],
  worker: ['activeJobs', 'waitingJobs'],
  scheduler: ['runningTasks'],
};

/** Tab của trang chi tiết runtime (`runtimes/<id>/<tab>`). */
export const DETAIL_TABS = ['overview', 'metrics', 'processes', 'logs', 'configuration', 'events'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
