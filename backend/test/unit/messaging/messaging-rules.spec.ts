import { describe, it, expect } from '@jest/globals';
import {
  diffMessagingAlerts,
  evaluateMessagingRules,
  queueRuleInputs,
  ruleOf,
  type MessagingRuleConfig,
  type MessagingRuleInput,
  type QueueRuleInput,
} from '@modules/messaging-ops/index.js';
import type { ConsumerRegistration, QueueSnapshot } from '@packages/messaging/index.js';

const cfg: MessagingRuleConfig = {
  lagWarn: 1000,
  lagCrit: 10_000,
  lagGrowthMin: 100,
  failureRatePercent: 5,
  minOps: 20,
  processingP95Ms: 5000,
  deadLetterWarn: 100,
  oldestWaitingMin: 10,
  largeMessageBytes: 256 * 1024,
};

const base = (patch: Partial<MessagingRuleInput> = {}): MessagingRuleInput => ({
  connection: 'connected',
  queues: [],
  lag: { now: 0, ago15m: 0 },
  consume: { ops: 0, failureRatePercent: null, p95Ms: null },
  publish: { ops: 0, failures: 0 },
  deadLetter: 0,
  largestMessage: null,
  ...patch,
});

const queue = (patch: Partial<QueueRuleInput> = {}): QueueRuleInput => ({
  name: 'system.events',
  waiting: 0,
  failed: 0,
  workers: 1,
  activeConsumers: 1,
  registeredConsumers: 1,
  oldestWaitingMin: null,
  ...patch,
});

describe('evaluateMessagingRules', () => {
  it('broker mất kết nối → chỉ một cảnh báo critical', () => {
    const v = evaluateMessagingRules(base({ connection: 'unavailable', deadLetter: 500 }), cfg);
    expect(v.map((x) => x.id)).toEqual(['BROKER_UNAVAILABLE']);
    expect(v[0]!.severity).toBe('critical');
  });

  it('không đủ dữ liệu → không kết luận', () => {
    expect(evaluateMessagingRules(base({ queues: null, deadLetter: null }), cfg)).toEqual([]);
  });

  it('queue có message nhưng không có worker → NO_CONSUMER theo từng queue; chờ lâu → critical', () => {
    const v = evaluateMessagingRules(
      base({
        queues: [
          queue({
            name: 'system.notifications',
            waiting: 42,
            workers: 0,
            registeredConsumers: 0,
            activeConsumers: 0,
            oldestWaitingMin: 18,
          }),
          queue({ name: 'system.events', waiting: 3 }),
        ],
      }),
      cfg,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      id: 'NO_CONSUMER:system.notifications',
      rule: 'NO_CONSUMER',
      severity: 'critical',
      value: 42,
      extra: { target: 'system.notifications', oldestMin: 18 },
    });
    expect(ruleOf(v[0]!.id)).toBe('NO_CONSUMER');
  });

  it('mọi consumer đều pause → CONSUMER_PAUSED; lag vượt ngưỡng → LAG_HIGH', () => {
    const v = evaluateMessagingRules(
      base({ queues: [queue({ waiting: 12_000, activeConsumers: 0, registeredConsumers: 2 })] }),
      cfg,
    );
    expect(v.map((x) => [x.id, x.severity])).toEqual([
      ['LAG_HIGH:system.events', 'critical'],
      ['CONSUMER_PAUSED:system.events', 'warning'],
    ]);
  });

  it('lag tăng mạnh trong 15 phút → LAG_GROWING; tăng ít → không', () => {
    expect(evaluateMessagingRules(base({ lag: { now: 900, ago15m: 100 } }), cfg)[0]?.id).toBe(
      'LAG_GROWING',
    );
    expect(evaluateMessagingRules(base({ lag: { now: 150, ago15m: 100 } }), cfg)).toEqual([]);
  });

  it('tỷ lệ lỗi, consumer chậm, publish lỗi, dead letter, message lớn', () => {
    const v = evaluateMessagingRules(
      base({
        consume: { ops: 100, failureRatePercent: 25, p95Ms: 8000 },
        publish: { ops: 10, failures: 5 },
        deadLetter: 120,
        largestMessage: { bytes: 3 * 1024 * 1024, channel: null },
      }),
      cfg,
    );
    expect(v.map((x) => x.id)).toEqual([
      'FAILURE_RATE',
      'SLOW_CONSUMER',
      'PUBLISH_FAILURES',
      'DEAD_LETTER',
      'LARGE_MESSAGE',
    ]);
    expect(v[0]!.severity).toBe('critical');
    expect(v.at(-1)!.severity).toBe('info');
  });

  it('ít lượt xử lý (< minOps) → không kết luận tỷ lệ lỗi/độ chậm', () => {
    const v = evaluateMessagingRules(
      base({ consume: { ops: 5, failureRatePercent: 60, p95Ms: 9000 } }),
      cfg,
    );
    expect(v).toEqual([]);
  });
});

describe('diffMessagingAlerts / queueRuleInputs', () => {
  it('giữ thời điểm bắt đầu, tách cảnh báo mới và đã phục hồi', () => {
    const active = new Map([
      [
        'DEAD_LETTER',
        { since: 1000, severity: 'warning' as const, value: 1, threshold: 1, unit: '', extra: {} },
      ],
      [
        'LAG_HIGH:q',
        { since: 2000, severity: 'warning' as const, value: 1, threshold: 1, unit: '', extra: {} },
      ],
    ]);
    const { started, set, recovered } = diffMessagingAlerts(
      [
        {
          id: 'DEAD_LETTER',
          rule: 'DEAD_LETTER',
          severity: 'warning',
          value: 150,
          threshold: 100,
          unit: '',
          extra: {},
        },
        {
          id: 'FAILURE_RATE',
          rule: 'FAILURE_RATE',
          severity: 'warning',
          value: 9,
          threshold: 5,
          unit: '%',
          extra: {},
        },
      ],
      active,
      5000,
    );
    expect(started.map((s) => s.id)).toEqual(['FAILURE_RATE']);
    expect(set.get('DEAD_LETTER')?.since).toBe(1000);
    expect(set.get('FAILURE_RATE')?.since).toBe(5000);
    expect(recovered).toEqual([expect.objectContaining({ id: 'LAG_HIGH:q', durationMs: 3000 })]);
  });

  it('gộp consumer đã đăng ký theo queue', () => {
    const snap: QueueSnapshot = {
      name: 'system.events',
      counts: { waiting: 5, active: 1, delayed: 0, failed: 0, completed: 9, prioritized: 2 },
      paused: false,
      workers: [{ name: 'worker', addr: null, ageSec: 1, idleSec: 0 }],
      oldestWaitingAt: 0,
    };
    const reg = (paused: boolean): ConsumerRegistration => ({
      consumer: 'SystemProcessor',
      queue: 'system.events',
      runtime: 'worker',
      instance: 'worker@a',
      concurrency: 5,
      paused,
      idempotent: true,
      startedAt: 0,
      inFlight: 0,
    });
    expect(queueRuleInputs([snap], [reg(false), reg(true)], 120_000)).toEqual([
      {
        name: 'system.events',
        waiting: 7,
        failed: 0,
        workers: 1,
        activeConsumers: 1,
        registeredConsumers: 2,
        oldestWaitingMin: 2,
      },
    ]);
  });
});
