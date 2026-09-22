import { describe, it, expect } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  diffRules,
  evaluateRules,
  linearTrend,
  type RuleSnapshot,
} from '@modules/performance/index.js';

applyTestEnv();
const rules = new CoreConfigService().performance.rules;

const runtime = (
  o: Partial<RuleSnapshot['runtimes'][number]> = {},
): RuleSnapshot['runtimes'][number] => ({
  id: 'worker',
  cpuRecent: [],
  cpuBaseline: null,
  memoryPercent: 40,
  memoryBaseline: 40,
  eventLoopP99: 5,
  eventLoopBaseline: 5,
  gcPauseMsPerMin: 10,
  gcBaseline: 10,
  memoryTrend: null,
  ...o,
});

const snapshot = (o: Partial<RuleSnapshot> = {}): RuleSnapshot => ({
  api: {
    requests: 100,
    p95: 80,
    p99: 150,
    errorRate: 0,
    baselineP95: 70,
    baselineP99: 120,
    baselineErrorRate: 0,
  },
  runtimes: [runtime()],
  db: { queries: 0, p95: null, baselineP95: null, poolPercent: null },
  queue: { waiting: 0, baseline: 0 },
  worker: { completed: 0, failed: 0, baselineFailedPercent: null },
  ...o,
});

describe('evaluateRules', () => {
  it('hệ thống khỏe → không có vi phạm', () => {
    expect(evaluateRules(snapshot(), rules)).toEqual([]);
  });

  it('API P95 vượt ngưỡng warn/crit, kèm baseline', () => {
    const warn = evaluateRules(snapshot({ api: { ...snapshot().api, p95: 700 } }), rules);
    expect(warn).toEqual([
      expect.objectContaining({
        rule: 'API_LATENCY_P95',
        severity: 'warning',
        threshold: 500,
        baseline: 70,
      }),
    ]);
    const crit = evaluateRules(
      snapshot({ api: { ...snapshot().api, p95: 1500, p99: 2500 } }),
      rules,
    );
    expect(crit.map((v) => [v.rule, v.severity])).toEqual([
      ['API_LATENCY_P95', 'critical'],
      ['API_LATENCY_P99', 'critical'],
    ]);
  });

  it('không kết luận khi quá ít request / query', () => {
    const s = snapshot({
      api: { ...snapshot().api, requests: 3, p95: 5000 },
      db: { queries: 2, p95: 5000, baselineP95: null, poolPercent: null },
    });
    expect(evaluateRules(s, rules)).toEqual([]);
  });

  it('CPU chỉ tính khi vượt ngưỡng liên tục đủ lâu', () => {
    const spike = [20, 20, 95, 20, 20, 20, 20, 20, 20, 20, 20, 20];
    expect(evaluateRules(snapshot({ runtimes: [runtime({ cpuRecent: spike })] }), rules)).toEqual(
      [],
    );
    const sustained = new Array(12).fill(80);
    expect(
      evaluateRules(snapshot({ runtimes: [runtime({ cpuRecent: sustained })] }), rules),
    ).toEqual([expect.objectContaining({ id: 'CPU_HIGH:worker', severity: 'warning', value: 80 })]);
  });

  it('memory growth: tăng đều đủ lâu và đủ lớn mới cảnh báo', () => {
    const growing = { changeMb: 180, increasingRatio: 0.95, spanMin: 30 };
    expect(
      evaluateRules(snapshot({ runtimes: [runtime({ memoryTrend: growing })] }), rules),
    ).toEqual([expect.objectContaining({ rule: 'MEMORY_GROWTH', runtime: 'worker', value: 180 })]);
    const noisy = { changeMb: 180, increasingRatio: 0.5, spanMin: 30 };
    expect(evaluateRules(snapshot({ runtimes: [runtime({ memoryTrend: noisy })] }), rules)).toEqual(
      [],
    );
  });

  it('database, queue, worker failures', () => {
    const v = evaluateRules(
      snapshot({
        db: { queries: 100, p95: 400, baselineP95: 40, poolPercent: 96 },
        queue: { waiting: 600, baseline: 10 },
        worker: { completed: 80, failed: 20, baselineFailedPercent: 1 },
      }),
      rules,
    );
    expect(v.map((x) => [x.rule, x.severity])).toEqual([
      ['DB_POOL', 'critical'],
      ['WORKER_FAILURES', 'critical'],
      ['DB_LATENCY', 'warning'],
      ['QUEUE_BACKLOG', 'warning'],
    ]);
  });
});

describe('linearTrend', () => {
  it('tính mức tăng theo hồi quy và tỷ lệ bước tăng', () => {
    const points = Array.from({ length: 31 }, (_, i) => ({ t: i * 60_000, value: 400 + i * 5 }));
    const trend = linearTrend(points)!;
    expect(trend.changeMb).toBeCloseTo(150, 5);
    expect(trend.increasingRatio).toBe(1);
    expect(trend.spanMin).toBe(30);
    expect(linearTrend(points.slice(0, 2))).toBeNull();
  });
});

describe('diffRules', () => {
  const violation = evaluateRules(snapshot({ api: { ...snapshot().api, p95: 700 } }), rules)[0]!;

  it('bắt đầu → nặng lên → hồi phục', () => {
    const first = diffRules([violation], new Map(), 1000);
    expect(first.events.map((e) => e.type)).toEqual(['started']);
    expect(first.next.set.get('API_LATENCY_P95')).toEqual({ since: 1000, severity: 'warning' });

    const worse = { ...violation, severity: 'critical' as const };
    const second = diffRules([worse], first.next.set, 2000);
    expect(second.events.map((e) => e.type)).toEqual(['escalated']);
    expect(second.next.set.get('API_LATENCY_P95')!.since).toBe(1000);

    const same = diffRules([worse], second.next.set, 3000);
    expect(same.events).toEqual([]);

    const recovered = diffRules([], second.next.set, 61_000);
    expect(recovered.next.removed).toEqual(['API_LATENCY_P95']);
    expect(recovered.events[0]).toMatchObject({ type: 'recovered', durationMs: 60_000 });
  });
});
