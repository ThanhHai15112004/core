import type { SchedulerConfig } from '@packages/config/index.js';
import type { SchedulerSeverity } from '../responses/scheduler-ops.response.js';

export type SchedulerRule =
  | 'HEARTBEAT_MISSING'
  | 'MISCONFIGURED'
  | 'CONSECUTIVE_FAILURES'
  | 'RECENT_FAILURES'
  | 'LONG_RUNNING'
  | 'MISSED_RUN'
  | 'OVERDUE'
  | 'OVERLAP'
  | 'DUPLICATE_EXECUTION'
  | 'LOCK_UNAVAILABLE'
  | 'HIGH_DRIFT';

/** Tab mở khi bấm cảnh báo không gắn với một task (cảnh báo có task → mở Task Detail). */
export const RULE_TAB: Record<SchedulerRule, string> = {
  HEARTBEAT_MISSING: 'overview',
  MISCONFIGURED: 'tasks',
  CONSECUTIVE_FAILURES: 'failures',
  RECENT_FAILURES: 'failures',
  LONG_RUNNING: 'tasks',
  MISSED_RUN: 'failures',
  OVERDUE: 'tasks',
  OVERLAP: 'timeline',
  DUPLICATE_EXECUTION: 'history',
  LOCK_UNAVAILABLE: 'history',
  HIGH_DRIFT: 'history',
};

/** Alert id = rule hoặc `rule:taskId`. */
export const ruleOf = (alertId: string) => alertId.split(':')[0] as SchedulerRule;

export interface TaskRuleInput {
  id: string;
  enabled: boolean;
  error: string | null;
  consecutiveFailures: number;
  /** Lần chạy đang diễn ra (mọi instance). */
  running: { executionId: string; runningMs: number }[];
  /** Ngưỡng "chạy lâu bất thường" đã tính (khai báo, baseline × hệ số, hoặc TTL lock). */
  longRunningMs: number;
  /** Lần chạy bị lỡ trong 1 giờ qua. */
  missed: { count: number; executionId: string } | null;
  /** Một mốc lịch có hơn một lần chạy thật (lock / claim hỏng). */
  duplicate: { scheduledAt: number; count: number; instances: string[] } | null;
  /** Số lần bị bỏ qua vì không lấy được lock (Redis lỗi) trong 15 phút. */
  lockUnavailable: number;
  /** Lịch kế tiếp đã quá hạn bao lâu (giây) trong khi scheduler vẫn sống; null = không quá hạn. */
  overdueSec: number | null;
}

export interface SchedulerRuleInput {
  /** Có task đã đăng ký hoặc từng có instance — nếu không, scheduler chưa từng chạy. */
  known: boolean;
  aliveInstances: number;
  /** Tuổi heartbeat mới nhất (giây); null = chưa từng có. */
  heartbeatAgeSec: number | null;
  paused: boolean;
  tasks: TaskRuleInput[];
  recentFailures: { count: number; tasks: string[] };
  drift: { p95Ms: number | null; samples: number };
}

export interface SchedulerViolation {
  id: string;
  rule: SchedulerRule;
  severity: SchedulerSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

/** Số lần bắt đầu tối thiểu trong 15 phút để kết luận về độ trễ lịch. */
const MIN_DRIFT_SAMPLES = 5;

/** Rule cảnh báo Scheduler theo ngưỡng cấu hình. Không đủ dữ liệu → không kết luận. */
export function evaluateSchedulerRules(
  input: SchedulerRuleInput,
  cfg: SchedulerConfig['rules'],
): SchedulerViolation[] {
  const out: SchedulerViolation[] = [];
  const add = (
    rule: SchedulerRule,
    task: string | null,
    severity: SchedulerSeverity,
    value: number,
    threshold: number,
    unit: string,
    extra: Record<string, string | number> = {},
  ) =>
    out.push({
      id: task ? `${rule}:${task}` : rule,
      rule,
      severity,
      value: Number(value.toFixed(2)),
      threshold,
      unit,
      extra: task ? { task, ...extra } : extra,
    });

  if (input.known && input.aliveInstances === 0) {
    add(
      'HEARTBEAT_MISSING',
      null,
      'critical',
      input.heartbeatAgeSec ?? 0,
      cfg.heartbeatTimeoutSec,
      's',
    );
    return out;
  }

  for (const t of input.tasks) {
    if (t.error) {
      add('MISCONFIGURED', t.id, 'warning', 0, 0, '', { error: t.error });
      continue;
    }
    if (t.consecutiveFailures >= cfg.consecutiveFailuresWarn)
      add(
        'CONSECUTIVE_FAILURES',
        t.id,
        t.consecutiveFailures >= cfg.consecutiveFailuresCrit ? 'critical' : 'warning',
        t.consecutiveFailures,
        t.consecutiveFailures >= cfg.consecutiveFailuresCrit
          ? cfg.consecutiveFailuresCrit
          : cfg.consecutiveFailuresWarn,
        '',
      );
    const longest = [...t.running].sort((a, b) => b.runningMs - a.runningMs)[0];
    if (longest && longest.runningMs > t.longRunningMs)
      add('LONG_RUNNING', t.id, 'warning', longest.runningMs, t.longRunningMs, 'ms', {
        execution: longest.executionId,
      });
    if (t.running.length > 1)
      add('OVERLAP', t.id, 'warning', t.running.length, 1, '', {
        execution: t.running[0]!.executionId,
      });
    if (t.missed)
      add('MISSED_RUN', t.id, 'warning', t.missed.count, 0, '', {
        execution: t.missed.executionId,
      });
    if (t.duplicate)
      add('DUPLICATE_EXECUTION', t.id, 'warning', t.duplicate.count, 1, '', {
        scheduledAt: t.duplicate.scheduledAt,
        instances: t.duplicate.instances.join(', '),
      });
    if (t.lockUnavailable > 0) add('LOCK_UNAVAILABLE', t.id, 'warning', t.lockUnavailable, 0, '');
    if (t.enabled && !input.paused && t.overdueSec !== null)
      add('OVERDUE', t.id, 'warning', t.overdueSec, 0, 's');
  }

  const f = input.recentFailures;
  if (f.count >= cfg.recentFailuresWarn)
    add('RECENT_FAILURES', null, 'warning', f.count, cfg.recentFailuresWarn, '', {
      tasks: f.tasks.join(', '),
    });

  if (input.drift.samples >= MIN_DRIFT_SAMPLES && (input.drift.p95Ms ?? 0) >= cfg.driftP95Ms)
    add('HIGH_DRIFT', null, 'warning', input.drift.p95Ms!, cfg.driftP95Ms, 'ms');

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface StoredSchedulerAlert {
  since: number;
  severity: SchedulerSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

export function diffSchedulerAlerts(
  violations: readonly SchedulerViolation[],
  active: ReadonlyMap<string, StoredSchedulerAlert>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredSchedulerAlert>(
    violations.map((v) => [
      v.id,
      {
        since: active.get(v.id)?.since ?? now,
        severity: v.severity,
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
        extra: v.extra,
      },
    ]),
  );
  const recovered = [...active.entries()]
    .filter(([id]) => !violations.some((v) => v.id === id))
    .map(([id, s]) => ({ id, alert: s, durationMs: now - s.since }));
  return { started, set, recovered };
}

/** Một mốc lịch có hơn một lần chạy thật (không tính skipped / missed / chạy thủ công). */
export function findDuplicate(
  executions: readonly {
    trigger: string;
    status: string;
    scheduledAt: number | null;
    instance: string | null;
  }[],
): { scheduledAt: number; count: number; instances: string[] } | null {
  const bySlot = new Map<number, string[]>();
  for (const e of executions) {
    if (e.trigger !== 'scheduled' || e.scheduledAt === null) continue;
    if (e.status === 'skipped' || e.status === 'missed') continue;
    bySlot.set(e.scheduledAt, [...(bySlot.get(e.scheduledAt) ?? []), e.instance ?? '?']);
  }
  let worst: { scheduledAt: number; count: number; instances: string[] } | null = null;
  for (const [scheduledAt, instances] of bySlot)
    if (instances.length > 1 && (!worst || scheduledAt > worst.scheduledAt))
      worst = { scheduledAt, count: instances.length, instances: [...new Set(instances)] };
  return worst;
}

/** Ngưỡng "chạy lâu bất thường": khai báo → baseline p95 × hệ số (tối thiểu vài chục giây) → TTL lock. */
export function longRunningThreshold(
  expectedMs: number | null,
  baselineP95Ms: number | null,
  lockTtlMs: number,
  cfg: SchedulerConfig['rules'],
): { ms: number; source: 'configured' | 'baseline' | null } {
  if (expectedMs !== null) return { ms: expectedMs, source: 'configured' };
  if (baselineP95Ms !== null)
    return {
      ms: Math.max(baselineP95Ms * cfg.longRunningFactor, cfg.longRunningMinSec * 1000),
      source: 'baseline',
    };
  return { ms: lockTtlMs, source: null };
}
