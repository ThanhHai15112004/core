import type { PerformanceConfig, RuleLevel } from '@packages/config/index.js';
import type { ComponentId, PerfSeverity, RuleKey } from '../responses/performance.response.js';

/** Số đo đầu vào của rule engine (cửa sổ hiện tại + baseline). */
export interface RuleSnapshot {
  api: {
    requests: number;
    p95: number | null;
    p99: number | null;
    errorRate: number;
    baselineP95: number | null;
    baselineP99: number | null;
    baselineErrorRate: number | null;
  };
  runtimes: {
    id: string;
    /** CPU theo bucket 10s trong khoảng `cpuSustainMin` gần nhất. */
    cpuRecent: number[];
    cpuBaseline: number | null;
    memoryPercent: number | null;
    memoryBaseline: number | null;
    eventLoopP99: number | null;
    eventLoopBaseline: number | null;
    gcPauseMsPerMin: number | null;
    gcBaseline: number | null;
    memoryTrend: { changeMb: number; increasingRatio: number; spanMin: number } | null;
  }[];
  db: {
    queries: number;
    p95: number | null;
    baselineP95: number | null;
    poolPercent: number | null;
  };
  queue: { waiting: number | null; baseline: number | null };
  worker: { completed: number; failed: number; baselineFailedPercent: number | null };
}

export interface Violation {
  id: string;
  rule: RuleKey;
  component: ComponentId | 'runtime';
  runtime: string | null;
  severity: PerfSeverity;
  value: number;
  threshold: number;
  unit: string;
  baseline: number | null;
}

/** Tỷ lệ tối thiểu bước tăng để coi là "tăng liên tục". */
export const GROWTH_RATIO = 0.8;
const SAMPLES_PER_MIN = 6;

export function severityOf(value: number | null, level: RuleLevel): PerfSeverity | null {
  if (value === null) return null;
  if (value >= level.crit) return 'critical';
  if (value >= level.warn) return 'warning';
  return null;
}

type Rules = PerformanceConfig['rules'];

/**
 * Rule engine đơn giản theo ngưỡng (cấu hình qua env `PERF_*`). Không đủ mẫu → không kết luận.
 * Trả về danh sách vi phạm, nghiêm trọng trước.
 */
export function evaluateRules(s: RuleSnapshot, rules: Rules): Violation[] {
  const out: Violation[] = [];
  const push = (
    rule: RuleKey,
    component: Violation['component'],
    runtime: string | null,
    value: number | null,
    level: RuleLevel,
    unit: string,
    baseline: number | null,
  ) => {
    const severity = severityOf(value, level);
    if (!severity || value === null) return;
    out.push({
      id: runtime ? `${rule}:${runtime}` : rule,
      rule,
      component,
      runtime,
      severity,
      value: Number(value.toFixed(2)),
      threshold: severity === 'critical' ? level.crit : level.warn,
      unit,
      baseline: baseline === null ? null : Number(baseline.toFixed(2)),
    });
  };

  if (s.api.requests >= rules.minRequests) {
    push('API_LATENCY_P95', 'api', null, s.api.p95, rules.apiP95Ms, 'ms', s.api.baselineP95);
    push('API_LATENCY_P99', 'api', null, s.api.p99, rules.apiP99Ms, 'ms', s.api.baselineP99);
    push(
      'API_ERROR_RATE',
      'api',
      null,
      s.api.errorRate,
      rules.errorRatePercent,
      '%',
      s.api.baselineErrorRate,
    );
  }

  for (const r of s.runtimes) {
    // CPU chỉ tính khi vượt ngưỡng liên tục đủ lâu, không phải một đỉnh nhất thời.
    const needed = Math.max(1, rules.cpuSustainMin * SAMPLES_PER_MIN - 1);
    if (r.cpuRecent.length >= needed) {
      const sustained = Math.min(...r.cpuRecent);
      const avg = r.cpuRecent.reduce((a, b) => a + b, 0) / r.cpuRecent.length;
      const severity = severityOf(sustained, rules.cpuPercent);
      if (severity)
        out.push({
          id: `CPU_HIGH:${r.id}`,
          rule: 'CPU_HIGH',
          component: 'runtime',
          runtime: r.id,
          severity,
          value: Number(avg.toFixed(1)),
          threshold: severity === 'critical' ? rules.cpuPercent.crit : rules.cpuPercent.warn,
          unit: '%',
          baseline: r.cpuBaseline === null ? null : Number(r.cpuBaseline.toFixed(1)),
        });
    }
    push(
      'MEMORY_HIGH',
      'runtime',
      r.id,
      r.memoryPercent,
      rules.memoryPercent,
      '%',
      r.memoryBaseline,
    );
    push(
      'EVENT_LOOP_LAG',
      'runtime',
      r.id,
      r.eventLoopP99,
      rules.eventLoopP99Ms,
      'ms',
      r.eventLoopBaseline,
    );
    push(
      'GC_PRESSURE',
      'runtime',
      r.id,
      r.gcPauseMsPerMin,
      rules.gcPauseMsPerMin,
      'ms/min',
      r.gcBaseline,
    );

    const trend = r.memoryTrend;
    if (
      trend &&
      trend.spanMin >= rules.memoryGrowthWindowMin * 0.9 &&
      trend.increasingRatio >= GROWTH_RATIO &&
      trend.changeMb >= rules.memoryGrowthMinMb
    ) {
      out.push({
        id: `MEMORY_GROWTH:${r.id}`,
        rule: 'MEMORY_GROWTH',
        component: 'runtime',
        runtime: r.id,
        severity: 'warning',
        value: Number(trend.changeMb.toFixed(1)),
        threshold: rules.memoryGrowthMinMb,
        unit: 'MB',
        baseline: null,
      });
    }
  }

  if (s.db.queries >= rules.minQueries)
    push('DB_LATENCY', 'database', null, s.db.p95, rules.dbP95Ms, 'ms', s.db.baselineP95);
  push('DB_POOL', 'database', null, s.db.poolPercent, rules.dbPoolPercent, '%', null);
  push(
    'QUEUE_BACKLOG',
    'worker',
    null,
    s.queue.waiting,
    rules.queueWaiting,
    'jobs',
    s.queue.baseline,
  );

  const jobs = s.worker.completed + s.worker.failed;
  if (jobs >= rules.minRequests) {
    const failedPercent = (s.worker.failed / jobs) * 100;
    push(
      'WORKER_FAILURES',
      'worker',
      null,
      failedPercent,
      rules.workerFailedPercent,
      '%',
      s.worker.baselineFailedPercent,
    );
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

/** Mức tổng của hệ thống: nặng nhất trong các vi phạm. */
export function overallLevel(violations: readonly Violation[]): 'normal' | 'degraded' | 'critical' {
  if (violations.some((v) => v.severity === 'critical')) return 'critical';
  return violations.length > 0 ? 'degraded' : 'normal';
}
