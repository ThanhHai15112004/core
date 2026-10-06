import type { QueueConfig } from '@packages/config/index.js';
import type { MessagingConnectionState } from '@packages/messaging/index.js';
import type { WorkerSeverity } from '../responses/worker-ops.response.js';

export type WorkerRule =
  | 'BROKER_UNAVAILABLE'
  | 'NO_WORKER'
  | 'QUEUE_PAUSED'
  | 'BACKLOG'
  | 'OLDEST_WAITING'
  | 'FAILURE_RATE'
  | 'SLOW_PROCESSING'
  | 'STALLED_JOBS'
  | 'RETRY_STORM'
  | 'CAPACITY';

/** Tab mở khi bấm cảnh báo (cảnh báo có `target` là queue → mở thẳng Queue Detail). */
export const RULE_TAB: Record<WorkerRule, string> = {
  BROKER_UNAVAILABLE: 'overview',
  NO_WORKER: 'workers',
  QUEUE_PAUSED: 'queues',
  BACKLOG: 'queues',
  OLDEST_WAITING: 'queues',
  FAILURE_RATE: 'failures',
  SLOW_PROCESSING: 'queues',
  STALLED_JOBS: 'failures',
  RETRY_STORM: 'failures',
  CAPACITY: 'workers',
};

/** Rule có đối tượng là queue (target = tên queue). */
export const QUEUE_RULES = new Set<WorkerRule>([
  'NO_WORKER',
  'QUEUE_PAUSED',
  'BACKLOG',
  'OLDEST_WAITING',
  'FAILURE_RATE',
  'SLOW_PROCESSING',
  'CAPACITY',
]);

/** Alert id = rule hoặc `rule:đối tượng` (vd. `BACKLOG:system.events`). */
export const ruleOf = (alertId: string) => alertId.split(':')[0] as WorkerRule;

export interface QueueRuleInput {
  name: string;
  waiting: number;
  active: number;
  paused: boolean;
  /** Kết nối worker trên broker; null = provider không cho biết. */
  workers: number | null;
  /** Concurrency đã cấu hình của các worker đang tiêu thụ queue (0 = không rõ). */
  concurrency: number;
  oldestWaitingMin: number | null;
  /** Job đã chạy xong/lỗi trong cửa sổ đánh giá. */
  ops: number;
  failureRatePercent: number | null;
  p95Ms: number | null;
}

export interface WorkerRuleInput {
  connection: MessagingConnectionState;
  queues: QueueRuleInput[] | null;
  /** Job active chạy lâu hơn ngưỡng stalled. */
  stalled: { count: number; oldestMin: number; queue: string } | null;
  retries: { perMin: number; queue: string | null; error: string | null };
}

export type WorkerRuleConfig = QueueConfig['rules'];

export interface WorkerViolation {
  id: string;
  rule: WorkerRule;
  severity: WorkerSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

/** Rule cảnh báo công việc nền theo ngưỡng cấu hình. Không đủ dữ liệu → không kết luận. */
export function evaluateWorkerRules(
  input: WorkerRuleInput,
  cfg: WorkerRuleConfig,
): WorkerViolation[] {
  const out: WorkerViolation[] = [];
  const add = (
    rule: WorkerRule,
    subject: string | null,
    severity: WorkerSeverity,
    value: number,
    threshold: number,
    unit: string,
    extra: Record<string, string | number> = {},
  ) =>
    out.push({
      id: subject ? `${rule}:${subject}` : rule,
      rule,
      severity,
      value: Number(value.toFixed(2)),
      threshold,
      unit,
      extra: subject ? { target: subject, ...extra } : extra,
    });

  if (input.connection === 'unavailable' || input.connection === 'reconnecting') {
    add('BROKER_UNAVAILABLE', null, 'critical', 0, 0, '');
    return out;
  }

  for (const q of input.queues ?? []) {
    const oldest = q.oldestWaitingMin ?? 0;
    if (q.waiting > 0 && q.workers === 0) {
      add(
        'NO_WORKER',
        q.name,
        oldest >= cfg.oldestWaitingMin ? 'critical' : 'warning',
        q.waiting,
        0,
        '',
        { oldestMin: Math.round(oldest) },
      );
    } else if (q.waiting > 0 && q.paused) {
      add('QUEUE_PAUSED', q.name, 'warning', q.waiting, 0, '');
    } else if (oldest >= cfg.oldestWaitingMin) {
      // Có worker nhưng job vẫn chờ lâu — queue đang không theo kịp.
      add('OLDEST_WAITING', q.name, 'warning', Math.round(oldest), cfg.oldestWaitingMin, 'min');
    }
    if (q.waiting >= cfg.backlogWarn)
      add(
        'BACKLOG',
        q.name,
        q.waiting >= cfg.backlogCrit ? 'critical' : 'warning',
        q.waiting,
        q.waiting >= cfg.backlogCrit ? cfg.backlogCrit : cfg.backlogWarn,
        '',
      );
    if (q.ops >= cfg.minOps && (q.failureRatePercent ?? 0) >= cfg.failureRatePercent)
      add(
        'FAILURE_RATE',
        q.name,
        q.failureRatePercent! >= cfg.failureRatePercent * 4 ? 'critical' : 'warning',
        q.failureRatePercent!,
        cfg.failureRatePercent,
        '%',
      );
    if (q.ops >= cfg.minOps && (q.p95Ms ?? 0) >= cfg.processingP95Ms)
      add('SLOW_PROCESSING', q.name, 'warning', q.p95Ms!, cfg.processingP95Ms, 'ms');
    if (q.concurrency > 0 && q.waiting > 0 && !q.paused) {
      const pct = (q.active / q.concurrency) * 100;
      if (pct >= cfg.concurrencyPercent)
        add('CAPACITY', q.name, 'warning', pct, cfg.concurrencyPercent, '%', {
          active: q.active,
          concurrency: q.concurrency,
        });
    }
  }

  if (input.stalled && input.stalled.count > 0)
    add('STALLED_JOBS', null, 'warning', input.stalled.count, cfg.stalledMin, 'min', {
      oldestMin: Math.round(input.stalled.oldestMin),
      queue: input.stalled.queue,
    });

  const r = input.retries;
  if (r.perMin >= cfg.retryStormPerMin)
    add(
      'RETRY_STORM',
      null,
      r.perMin >= cfg.retryStormPerMin * 4 ? 'critical' : 'warning',
      r.perMin,
      cfg.retryStormPerMin,
      '/min',
      { queue: r.queue ?? '', error: r.error ?? '' },
    );

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface StoredWorkerAlert {
  since: number;
  severity: WorkerSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

export function diffWorkerAlerts(
  violations: readonly WorkerViolation[],
  active: ReadonlyMap<string, StoredWorkerAlert>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredWorkerAlert>(
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
