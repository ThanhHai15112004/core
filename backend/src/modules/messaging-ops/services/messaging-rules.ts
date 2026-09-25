import type { MessagingConfig } from '@packages/config/index.js';
import type { MessagingConnectionState } from '@packages/messaging/index.js';
import type { MessagingSeverity } from '../responses/messaging-ops.response.js';

export type MessagingRule =
  | 'BROKER_UNAVAILABLE'
  | 'NO_CONSUMER'
  | 'CONSUMER_PAUSED'
  | 'LAG_HIGH'
  | 'LAG_GROWING'
  | 'FAILURE_RATE'
  | 'PUBLISH_FAILURES'
  | 'SLOW_CONSUMER'
  | 'DEAD_LETTER'
  | 'LARGE_MESSAGE';

export const RULE_TAB: Record<MessagingRule, string> = {
  BROKER_UNAVAILABLE: 'overview',
  NO_CONSUMER: 'consumers',
  CONSUMER_PAUSED: 'consumers',
  LAG_HIGH: 'channels',
  LAG_GROWING: 'channels',
  FAILURE_RATE: 'errors',
  PUBLISH_FAILURES: 'errors',
  SLOW_CONSUMER: 'consumers',
  DEAD_LETTER: 'dead-letter',
  LARGE_MESSAGE: 'channels',
};

/** Alert id = rule hoặc `rule:đối tượng` (vd. `NO_CONSUMER:system.notifications`). */
export const ruleOf = (alertId: string) => alertId.split(':')[0] as MessagingRule;

export interface QueueRuleInput {
  name: string;
  waiting: number;
  failed: number;
  /** Kết nối worker trên broker; null = broker không cho biết. */
  workers: number | null;
  /** Consumer đã đăng ký (không tính paused) / tổng. */
  activeConsumers: number;
  registeredConsumers: number;
  oldestWaitingMin: number | null;
}

export interface MessagingRuleInput {
  connection: MessagingConnectionState;
  queues: QueueRuleInput[] | null;
  lag: { now: number | null; ago15m: number | null };
  consume: { ops: number; failureRatePercent: number | null; p95Ms: number | null };
  publish: { ops: number; failures: number };
  deadLetter: number | null;
  largestMessage: { bytes: number; channel: string | null } | null;
}

export type MessagingRuleConfig = MessagingConfig['rules'] & { largeMessageBytes: number };

export interface MessagingViolation {
  id: string;
  rule: MessagingRule;
  severity: MessagingSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

/** Rule cảnh báo messaging theo ngưỡng cấu hình. Không đủ dữ liệu → không kết luận. */
export function evaluateMessagingRules(
  input: MessagingRuleInput,
  cfg: MessagingRuleConfig,
): MessagingViolation[] {
  const out: MessagingViolation[] = [];
  const add = (
    rule: MessagingRule,
    subject: string | null,
    severity: MessagingSeverity,
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
    if (q.waiting > 0 && q.workers === 0) {
      const old = q.oldestWaitingMin ?? 0;
      add(
        'NO_CONSUMER',
        q.name,
        old >= cfg.oldestWaitingMin ? 'critical' : 'warning',
        q.waiting,
        0,
        '',
        {
          oldestMin: Math.round(old),
        },
      );
    } else if (q.waiting > 0 && q.registeredConsumers > 0 && q.activeConsumers === 0)
      add('CONSUMER_PAUSED', q.name, 'warning', q.waiting, 0, '');
    if (q.waiting >= cfg.lagWarn)
      add(
        'LAG_HIGH',
        q.name,
        q.waiting >= cfg.lagCrit ? 'critical' : 'warning',
        q.waiting,
        q.waiting >= cfg.lagCrit ? cfg.lagCrit : cfg.lagWarn,
        '',
      );
  }

  const { now, ago15m } = input.lag;
  if (now !== null && ago15m !== null && now - ago15m >= cfg.lagGrowthMin && now >= ago15m * 2)
    add('LAG_GROWING', null, 'warning', now, ago15m, '', { ago: Math.round(ago15m) });

  const c = input.consume;
  if (c.ops >= cfg.minOps && (c.failureRatePercent ?? 0) >= cfg.failureRatePercent)
    add(
      'FAILURE_RATE',
      null,
      c.failureRatePercent! >= cfg.failureRatePercent * 4 ? 'critical' : 'warning',
      c.failureRatePercent!,
      cfg.failureRatePercent,
      '%',
    );
  if (c.ops >= cfg.minOps && (c.p95Ms ?? 0) >= cfg.processingP95Ms)
    add('SLOW_CONSUMER', null, 'warning', c.p95Ms!, cfg.processingP95Ms, 'ms');

  const p = input.publish;
  const pubTotal = p.ops + p.failures;
  if (p.failures > 0 && pubTotal > 0) {
    const rate = (p.failures / pubTotal) * 100;
    if (rate >= cfg.failureRatePercent)
      add('PUBLISH_FAILURES', null, 'warning', rate, cfg.failureRatePercent, '%', {
        failures: p.failures,
      });
  }

  if (input.deadLetter !== null && input.deadLetter >= cfg.deadLetterWarn)
    add('DEAD_LETTER', null, 'warning', input.deadLetter, cfg.deadLetterWarn, '');

  if (input.largestMessage && input.largestMessage.bytes >= cfg.largeMessageBytes)
    add('LARGE_MESSAGE', null, 'info', input.largestMessage.bytes, cfg.largeMessageBytes, 'B', {
      channel: input.largestMessage.channel ?? '',
    });

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface StoredMessagingAlert {
  since: number;
  severity: MessagingSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

export function diffMessagingAlerts(
  violations: readonly MessagingViolation[],
  active: ReadonlyMap<string, StoredMessagingAlert>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredMessagingAlert>(
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
