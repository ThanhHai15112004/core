import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import {
  SchedulerStore,
  TaskError,
  type SchedulerCommandResult,
  type TaskStateRecord,
} from '@packages/scheduler/index.js';
import {
  ScheduledTaskRegistry,
  type ScheduledTaskDefinition,
  type TaskExecutionContext,
} from '@apps/scheduler/registry/scheduled-task.registry.js';
import { TaskRunnerService, emptyTaskState } from '@apps/scheduler/runner/task-runner.service.js';

const waitFor = async (check: () => Promise<boolean> | boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};

describe('Scheduler runtime — TaskRunnerService', () => {
  let redis: RedisService;
  let store: SchedulerStore;
  let registry: ScheduledTaskRegistry;
  let runner: TaskRunnerService;
  let calls: TaskExecutionContext[];
  let fail: Error | null;

  const task = (over: Partial<ScheduledTaskDefinition> = {}): ScheduledTaskDefinition => ({
    id: 'report.daily',
    name: 'DailyReport',
    type: 'cron',
    cron: '*/5 * * * *',
    className: 'DailyReportTask',
    downstreamQueue: 'reports',
    handler: async (ctx) => {
      calls.push(ctx);
      if (fail) throw fail;
      ctx.recordJob({ id: `job_${calls.length}`, queue: 'reports', topic: 'report.generate' });
    },
    ...over,
  });

  const boot = async (
    defs: ScheduledTaskDefinition[],
    state?: Record<string, Partial<TaskStateRecord>>,
  ) => {
    for (const d of defs) registry.register(d);
    for (const [id, s] of Object.entries(state ?? {}))
      await store.setState(id, { ...emptyTaskState(), ...s });
    const config = new CoreConfigService();
    runner = new TaskRunnerService(registry, store, redis, config, new RequestContextService());
    await runner.onApplicationBootstrap();
  };

  beforeEach(async () => {
    applyTestEnv({ SCHEDULER_TIMEZONE: 'UTC' });
    const config = new CoreConfigService();
    redis = new RedisService(config, mockRedisFactory);
    await redis.client.flushall();
    store = new SchedulerStore(redis, config);
    registry = new ScheduledTaskRegistry();
    calls = [];
    fail = null;
  });

  afterEach(async () => {
    await runner?.beforeApplicationShutdown();
  });

  it('khởi động: công bố registry, instance, lên lịch; task cấu hình sai không được lên lịch', async () => {
    await boot([task(), task({ id: 'broken', name: 'Broken', cron: '61 * * * *' })]);
    const tasks = await store.tasks();
    expect(tasks.get('report.daily')).toMatchObject({
      type: 'cron',
      timezone: 'UTC',
      overlap: 'skip',
      misfire: 'run_once',
      error: null,
    });
    expect(tasks.get('broken')?.error).toMatch(/out of range/);
    const states = await store.states();
    expect(states.get('report.daily')?.nextRunAt).toBeGreaterThan(Date.now());
    expect(states.get('broken')?.nextRunAt).toBeNull();
    expect((await store.instances()).size).toBe(1);
    expect((await store.events()).map((e) => e.type)).toContain('instance_started');
  });

  it('một lần chạy thành công: lịch sử, drift, job đã tạo, correlation ID; mỗi mốc lịch chỉ chạy một lần', async () => {
    await boot([task()]);
    const rt = runner.runtime('report.daily')!;
    const slot = Date.now() - 50;
    const rec = await runner.execute(rt, 'scheduled', slot);
    expect(rec).toMatchObject({
      status: 'success',
      trigger: 'scheduled',
      scheduledAt: slot,
      correlationId: rec!.id,
    });
    expect(rec!.driftMs).toBeGreaterThanOrEqual(50);
    expect(rec!.jobs).toEqual([{ id: 'job_1', queue: 'reports', topic: 'report.generate' }]);
    expect(calls[0]).toMatchObject({ trigger: 'scheduled', correlationId: rec!.id });
    expect(await store.execution(rec!.id)).toMatchObject({ status: 'success' });
    expect(await store.running()).toEqual([]);
    expect(await runner.execute(rt, 'scheduled', slot)).toBeNull();
    expect(calls).toHaveLength(1);
    expect((await store.states()).get('report.daily')).toMatchObject({
      lastStatus: 'success',
      consecutiveFailures: 0,
    });
  });

  it('lỗi liên tiếp được đếm, sự kiện chỉ khi chuyển trạng thái; thành công lại → hồi phục', async () => {
    await boot([task()]);
    const rt = runner.runtime('report.daily')!;
    fail = new TaskError('StorageTimeout', 'Unable to upload generated report');
    const r1 = await runner.execute(rt, 'scheduled', 1000);
    await runner.execute(rt, 'scheduled', 2000);
    expect(r1).toMatchObject({ status: 'failed', error: { type: 'StorageTimeout' } });
    expect((await store.states()).get('report.daily')?.consecutiveFailures).toBe(2);
    fail = null;
    await runner.execute(rt, 'scheduled', 3000);
    const types = (await store.events()).map((e) => e.type);
    expect(types.filter((t) => t === 'task_failed')).toHaveLength(1);
    expect(types).toContain('task_recovered');
    expect((await store.states()).get('report.daily')?.consecutiveFailures).toBe(0);
    const problems = await store.executions({
      from: 0,
      to: Date.now(),
      limit: 10,
      problemsOnly: true,
    });
    expect(problems.items).toHaveLength(2);
  });

  it('overlap Prevent: lần trước còn giữ lock → bỏ qua và ghi "skipped" kèm lần đang chặn', async () => {
    await boot([task()]);
    await redis.client.set(store.keys.lock('report.daily'), 'sch_prev|other:1', 'PX', 60_000);
    const rec = await runner.execute(runner.runtime('report.daily')!, 'scheduled', 5000);
    expect(rec).toMatchObject({
      status: 'skipped',
      reason: 'previous_running',
      blockedBy: 'sch_prev',
    });
    expect(calls).toHaveLength(0);
  });

  it('khởi động sau khi ngừng 2 giờ: ghi một bản ghi "missed" gộp và chạy bù đúng một lần (run_once)', async () => {
    const since = Date.now() - 2 * 3600_000;
    await boot([task()], {
      'report.daily': { nextRunAt: since, lastScheduledAt: since - 300_000 },
    });
    await waitFor(() => calls.length === 1);
    expect(calls[0]!.trigger).toBe('recovery');
    const all = await store.executions({ from: 0, to: Date.now() + 1, limit: 10 });
    const missed = all.items.find((r) => r.status === 'missed')!;
    expect(missed.missedCount).toBeGreaterThanOrEqual(24);
    expect(missed.reason).toBe('runtime_down');
    const types = (await store.events()).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['run_missed']));
    await waitFor(async () => (await store.events()).some((e) => e.type === 'run_recovered'));
  });

  it('misfire "skip": ghi lỡ lịch nhưng không chạy bù', async () => {
    const since = Date.now() - 3600_000;
    await boot([task({ misfire: 'skip' })], { 'report.daily': { nextRunAt: since } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    const all = await store.executions({ from: 0, to: Date.now() + 1, limit: 10 });
    expect(all.items.map((r) => r.status)).toEqual(['missed']);
  });

  it('Run Now: chạy với trigger manual; task đang chạy (Prevent) → từ chối, không chạy chồng', async () => {
    await boot([task()]);
    await runner.handleCommand({
      id: 'cmd1',
      action: 'run',
      taskId: 'report.daily',
      executionId: 'sch_manual1',
      actor: null,
      ip: '10.0.0.x',
      requestedAt: Date.now(),
    });
    const ok = JSON.parse(
      (await redis.client.get(store.keys.commandResult('cmd1')))!,
    ) as SchedulerCommandResult;
    expect(ok).toMatchObject({ status: 'accepted', executionId: 'sch_manual1' });
    expect(await store.execution('sch_manual1')).toMatchObject({
      trigger: 'manual',
      status: 'success',
      ip: '10.0.0.x',
    });

    await redis.client.set(store.keys.lock('report.daily'), 'sch_long|other:1', 'PX', 60_000);
    await runner.handleCommand({
      id: 'cmd2',
      action: 'run',
      taskId: 'report.daily',
      executionId: 'sch_manual2',
      actor: null,
      ip: null,
      requestedAt: Date.now(),
    });
    const rejected = JSON.parse(
      (await redis.client.get(store.keys.commandResult('cmd2')))!,
    ) as SchedulerCommandResult;
    expect(rejected).toMatchObject({
      status: 'rejected',
      code: 'TASK_RUNNING',
      params: { blockedBy: 'sch_long' },
    });
    expect(calls).toHaveLength(1);
  });

  it('Disable (Console ghi Redis + refresh): ngừng lên lịch; Enable: lên lịch lại', async () => {
    await boot([task()]);
    await redis.client.hset(
      store.keys.disabled(),
      'report.daily',
      JSON.stringify({ at: Date.now(), actor: null, ip: null }),
    );
    await runner.handleCommand({
      id: 'r1',
      action: 'refresh',
      taskId: 'report.daily',
      executionId: null,
      actor: null,
      ip: null,
      requestedAt: Date.now(),
    });
    expect((await store.states()).get('report.daily')?.nextRunAt).toBeNull();
    await redis.client.hdel(store.keys.disabled(), 'report.daily');
    await runner.handleCommand({
      id: 'r2',
      action: 'refresh',
      taskId: 'report.daily',
      executionId: null,
      actor: null,
      ip: null,
      requestedAt: Date.now(),
    });
    expect((await store.states()).get('report.daily')?.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('Stop runtime (pause) không bị tính là lỡ lịch khi khởi động lại', async () => {
    await boot([task()]);
    runner.pause();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.states()).get('report.daily')?.nextRunAt).toBeNull();
  });
});
