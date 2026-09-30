import { describe, it, expect } from '@jest/globals';
import {
  diffSchedulerAlerts,
  evaluateSchedulerRules,
  findDuplicate,
  longRunningThreshold,
  type SchedulerRuleInput,
  type TaskRuleInput,
} from '@modules/scheduler-ops/index.js';

const cfg = {
  heartbeatTimeoutSec: 30,
  consecutiveFailuresWarn: 2,
  consecutiveFailuresCrit: 5,
  recentFailuresWarn: 3,
  longRunningFactor: 3,
  longRunningMinSec: 60,
  driftP95Ms: 5000,
  concentrationTasks: 5,
};

const task = (over: Partial<TaskRuleInput> = {}): TaskRuleInput => ({
  id: 'daily-report',
  enabled: true,
  error: null,
  consecutiveFailures: 0,
  running: [],
  longRunningMs: 120_000,
  missed: null,
  duplicate: null,
  lockUnavailable: 0,
  overdueSec: null,
  ...over,
});

const input = (over: Partial<SchedulerRuleInput> = {}): SchedulerRuleInput => ({
  known: true,
  aliveInstances: 1,
  heartbeatAgeSec: 2,
  paused: false,
  tasks: [task()],
  recentFailures: { count: 0, tasks: [] },
  drift: { p95Ms: 100, samples: 50 },
  ...over,
});

describe('Scheduler rules', () => {
  it('mọi thứ bình thường → không cảnh báo', () => {
    expect(evaluateSchedulerRules(input(), cfg)).toEqual([]);
  });

  it('không instance nào sống → chỉ một cảnh báo critical (mất heartbeat), không kết luận gì thêm', () => {
    const v = evaluateSchedulerRules(
      input({ aliveInstances: 0, heartbeatAgeSec: 134, tasks: [task({ consecutiveFailures: 9 })] }),
      cfg,
    );
    expect(v).toEqual([
      expect.objectContaining({ id: 'HEARTBEAT_MISSING', severity: 'critical', value: 134 }),
    ]);
  });

  it('scheduler chưa từng chạy (không task, không instance) → không báo mất heartbeat', () => {
    expect(
      evaluateSchedulerRules(input({ known: false, aliveInstances: 0, tasks: [] }), cfg),
    ).toEqual([]);
  });

  it('lỗi liên tiếp: warning từ ngưỡng warn, critical từ ngưỡng crit', () => {
    expect(
      evaluateSchedulerRules(input({ tasks: [task({ consecutiveFailures: 1 })] }), cfg),
    ).toEqual([]);
    expect(
      evaluateSchedulerRules(input({ tasks: [task({ consecutiveFailures: 3 })] }), cfg)[0],
    ).toMatchObject({
      id: 'CONSECUTIVE_FAILURES:daily-report',
      severity: 'warning',
      value: 3,
      threshold: 2,
    });
    expect(
      evaluateSchedulerRules(input({ tasks: [task({ consecutiveFailures: 5 })] }), cfg)[0],
    ).toMatchObject({
      severity: 'critical',
      threshold: 5,
    });
  });

  it('chạy lâu hơn ngưỡng → LONG_RUNNING; hai lần chạy cùng lúc → OVERLAP', () => {
    const v = evaluateSchedulerRules(
      input({
        tasks: [
          task({
            running: [
              { executionId: 'sch_a', runningMs: 1_122_000 },
              { executionId: 'sch_b', runningMs: 10_000 },
            ],
          }),
        ],
      }),
      cfg,
    );
    expect(v.map((x) => x.rule).sort()).toEqual(['LONG_RUNNING', 'OVERLAP']);
    expect(v.find((x) => x.rule === 'LONG_RUNNING')?.extra).toMatchObject({ execution: 'sch_a' });
  });

  it('lỡ lịch, chạy trùng, lock lỗi, quá hạn, cấu hình sai', () => {
    const v = evaluateSchedulerRules(
      input({
        tasks: [
          task({
            missed: { count: 3, executionId: 'sch_m' },
            duplicate: { scheduledAt: 1000, count: 2, instances: ['a:1', 'b:2'] },
            lockUnavailable: 2,
            overdueSec: 240,
          }),
          task({ id: 'broken', error: 'Field value (61) is out of range' }),
        ],
      }),
      cfg,
    );
    expect(v.map((x) => x.id).sort()).toEqual([
      'DUPLICATE_EXECUTION:daily-report',
      'LOCK_UNAVAILABLE:daily-report',
      'MISCONFIGURED:broken',
      'MISSED_RUN:daily-report',
      'OVERDUE:daily-report',
    ]);
  });

  it('quá hạn không tính khi scheduler đang pause hoặc task đang tắt', () => {
    expect(
      evaluateSchedulerRules(input({ paused: true, tasks: [task({ overdueSec: 300 })] }), cfg),
    ).toEqual([]);
    expect(
      evaluateSchedulerRules(input({ tasks: [task({ enabled: false, overdueSec: 300 })] }), cfg),
    ).toEqual([]);
  });

  it('nhiều lần chạy lỗi trong 1 giờ → degraded; drift cao chỉ khi đủ mẫu', () => {
    const v = evaluateSchedulerRules(
      input({
        recentFailures: { count: 3, tasks: ['a', 'b'] },
        drift: { p95Ms: 18_000, samples: 40 },
      }),
      cfg,
    );
    expect(v.map((x) => x.id).sort()).toEqual(['HIGH_DRIFT', 'RECENT_FAILURES']);
    expect(evaluateSchedulerRules(input({ drift: { p95Ms: 18_000, samples: 2 } }), cfg)).toEqual(
      [],
    );
  });

  it('tìm lần chạy trùng mốc (bỏ qua skipped / manual)', () => {
    expect(
      findDuplicate([
        { trigger: 'scheduled', status: 'success', scheduledAt: 1, instance: 'a' },
        { trigger: 'scheduled', status: 'skipped', scheduledAt: 1, instance: 'b' },
        { trigger: 'manual', status: 'success', scheduledAt: null, instance: 'b' },
      ]),
    ).toBeNull();
    expect(
      findDuplicate([
        { trigger: 'scheduled', status: 'success', scheduledAt: 1, instance: 'a' },
        { trigger: 'scheduled', status: 'failed', scheduledAt: 1, instance: 'b' },
      ]),
    ).toEqual({ scheduledAt: 1, count: 2, instances: ['a', 'b'] });
  });

  it('ngưỡng chạy lâu: khai báo > baseline × hệ số (tối thiểu) > TTL lock', () => {
    expect(longRunningThreshold(300_000, 1000, 600_000, cfg)).toEqual({
      ms: 300_000,
      source: 'configured',
    });
    expect(longRunningThreshold(null, 1000, 600_000, cfg)).toEqual({
      ms: 60_000,
      source: 'baseline',
    });
    expect(longRunningThreshold(null, 40_000, 600_000, cfg)).toEqual({
      ms: 120_000,
      source: 'baseline',
    });
    expect(longRunningThreshold(null, null, 600_000, cfg)).toEqual({ ms: 600_000, source: null });
  });

  it('diff cảnh báo giữ thời điểm bắt đầu, báo hồi phục', () => {
    const [v] = evaluateSchedulerRules(input({ tasks: [task({ consecutiveFailures: 3 })] }), cfg);
    const first = diffSchedulerAlerts([v!], new Map(), 1000);
    expect(first.started).toHaveLength(1);
    const second = diffSchedulerAlerts([v!], first.set, 5000);
    expect(second.started).toHaveLength(0);
    expect(second.set.get(v!.id)?.since).toBe(1000);
    const third = diffSchedulerAlerts([], second.set, 9000);
    expect(third.recovered).toEqual([expect.objectContaining({ id: v!.id, durationMs: 8000 })]);
  });
});
