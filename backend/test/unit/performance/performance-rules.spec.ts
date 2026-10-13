import { describe, it, expect } from '@jest/globals';
import { performanceConfig } from '@packages/config/index.js';
import {
  diffBottlenecks,
  evaluateRules,
  overallLevel,
  type RuleSnapshot,
} from '@modules/performance/index.js';

const rules = performanceConfig().rules;

const snapshot = (patch: Partial<RuleSnapshot> = {}): RuleSnapshot => ({
  api: {
    requests: 100,
    p95: 100,
    p99: 200,
    errorRate: 0,
    baselineP95: null,
    baselineP99: null,
    baselineErrorRate: null,
  },
  runtimes: [],
  db: { queries: 0, avgMs: null, baselineAvgMs: null, poolPercent: null },
  queue: { waiting: null, baseline: null },
  worker: { completed: 0, failed: 0, baselineFailedPercent: null },
  ...patch,
});

const runtime = (patch: Partial<RuleSnapshot['runtimes'][number]> = {}) => ({
  id: 'api',
  cpuSustained: null,
  cpuAvg: null,
  cpuBaseline: null,
  memoryPercent: null,
  memoryBaseline: null,
  eventLoopP99: null,
  eventLoopBaseline: null,
  gcPauseMsPerMin: null,
  gcBaseline: null,
  memoryTrend: null,
  ...patch,
});

describe('evaluateRules', () => {
  it('không có số liệu / ít request → không kết luận', () => {
    expect(
      evaluateRules(snapshot({ api: { ...snapshot().api, requests: 3, p95: 9999 } }), rules),
    ).toEqual([]);
    expect(overallLevel([])).toBe('normal');
  });

  it('CPU chỉ tính khi vượt ngưỡng liên tục (giá trị thấp nhất trong cửa sổ)', () => {
    const spike = evaluateRules(
      snapshot({ runtimes: [runtime({ cpuSustained: 20, cpuAvg: 70 })] }),
      rules,
    );
    expect(spike).toEqual([]);
    const sustained = evaluateRules(
      snapshot({ runtimes: [runtime({ cpuSustained: 92, cpuAvg: 95, cpuBaseline: 30 })] }),
      rules,
    );
    expect(sustained).toEqual([
      expect.objectContaining({
        id: 'CPU_HIGH:api',
        severity: 'critical',
        value: 95,
        threshold: rules.cpuPercent.crit,
        baseline: 30,
      }),
    ]);
  });

  it('DB dùng thời gian trung bình; pool, queue, worker theo ngưỡng; nghiêm trọng trước', () => {
    const v = evaluateRules(
      snapshot({
        db: { queries: 100, avgMs: 400, baselineAvgMs: 50, poolPercent: 96 },
        queue: { waiting: 600, baseline: 10 },
        worker: { completed: 10, failed: 90, baselineFailedPercent: 1 },
      }),
      rules,
    );
    expect(v.map((x) => [x.id, x.severity])).toEqual([
      ['DB_POOL', 'critical'],
      ['WORKER_FAILURES', 'critical'],
      ['DB_LATENCY', 'warning'],
      ['QUEUE_BACKLOG', 'warning'],
    ]);
    expect(overallLevel(v)).toBe('critical');
  });
});

describe('diffBottlenecks', () => {
  it('tách bắt đầu, nặng thêm, hồi phục; giữ thời điểm bắt đầu', () => {
    const active = new Map([
      ['API_LATENCY_P95', { since: 1000, severity: 'warning' as const }],
      ['DB_POOL', { since: 2000, severity: 'warning' as const }],
    ]);
    const violations = evaluateRules(
      snapshot({
        api: { ...snapshot().api, p95: 5000 },
        queue: { waiting: 600, baseline: null },
      }),
      rules,
    );
    const { started, escalated, next, recovered } = diffBottlenecks(violations, active, 5000);
    expect(started.map((v) => v.id)).toEqual(['QUEUE_BACKLOG']);
    expect(escalated.map((v) => v.id)).toEqual(['API_LATENCY_P95']);
    expect(next.get('API_LATENCY_P95')).toEqual({ since: 1000, severity: 'critical' });
    expect(recovered).toEqual([{ id: 'DB_POOL', durationMs: 3000, severity: 'warning' }]);
  });
});
