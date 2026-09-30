import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';
import { SCHEDULER_OPS_ROUTES, SchedulerMonitorService } from '@modules/scheduler-ops/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  SchedulerStore,
  type ExecutionRecord,
  type ScheduledTaskMeta,
  type TaskStateRecord,
} from '@packages/scheduler/index.js';

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const base = `/${SCHEDULER_OPS_ROUTES.PREFIX}`;
const now = Date.now();

const meta = (over: Partial<ScheduledTaskMeta>): ScheduledTaskMeta => ({
  id: 'report.daily',
  name: 'DailyReport',
  description: null,
  group: 'reports',
  type: 'cron',
  cron: '*/5 * * * *',
  intervalMs: null,
  runAt: null,
  timezone: 'UTC',
  overlap: 'skip',
  misfire: 'run_once',
  expectedDurationMs: null,
  lockTtlMs: 600_000,
  downstreamQueue: 'system.events',
  className: 'DailyReportTask',
  sourcePath: null,
  error: null,
  registeredAt: now - 3600_000,
  ...over,
});

const exec = (over: Partial<ExecutionRecord>): ExecutionRecord => ({
  id: 'sch_ok1',
  taskId: 'report.daily',
  trigger: 'scheduled',
  status: 'success',
  scheduledAt: now - 600_000,
  startedAt: now - 599_800,
  finishedAt: now - 599_000,
  durationMs: 800,
  driftMs: 200,
  instance: 'host:1',
  correlationId: 'sch_ok1',
  error: null,
  reason: null,
  missedCount: null,
  missedUntil: null,
  jobs: [{ id: 'job_1', queue: 'system.events', topic: 'report.generate' }],
  actor: null,
  ip: null,
  blockedBy: null,
  ...over,
});

const state = (over: Partial<TaskStateRecord>): TaskStateRecord => ({
  nextRunAt: now + 120_000,
  lastScheduledAt: now - 300_000,
  lastRunAt: now - 299_900,
  lastFinishedAt: now - 295_000,
  lastStatus: 'failed',
  lastExecutionId: 'sch_fail1',
  lastDurationMs: 4200,
  lastError: { type: 'StorageTimeout', message: 'Unable to upload generated report' },
  lastSuccessAt: now - 599_000,
  lastFailureAt: now - 295_000,
  consecutiveFailures: 3,
  completed: false,
  updatedAt: now,
  ...over,
});

/**
 * Scheduler API trên dữ liệu runtime đã ghi vào Redis (ioredis-mock): tổng quan, task, lịch sử, lỗi, Cron Inspector,
 * Enable / Disable có audit; Run Now bị chặn rõ ràng khi không có scheduler nhận lệnh; monitor phát hiện mất heartbeat.
 */
describe('Scheduler (/ops/scheduler)', () => {
  let context: TestAppContext;
  let store: SchedulerStore;
  let redis: RedisService;

  const call = async <T>(method: 'GET' | 'POST', url: string) => {
    const res = await context.app.inject({ method, url, headers: { 'accept-language': 'en' } });
    return { status: res.statusCode, body: res.json<Envelope<T>>() };
  };

  beforeAll(async () => {
    context = await createTestApp();
    redis = context.app.get(RedisService);
    store = context.app.get(SchedulerStore);
    await store.publishTasks([
      meta({}),
      meta({
        id: 'scheduler.history-prune',
        name: 'SchedulerHistoryPrune',
        type: 'interval',
        cron: null,
        intervalMs: 3600_000,
        downstreamQueue: null,
      }),
    ]);
    await store.setState('report.daily', state({}));
    await store.setState(
      'scheduler.history-prune',
      state({ lastStatus: 'success', consecutiveFailures: 0, lastError: null }),
    );
    await redis.client.hset(
      store.keys.instances(),
      'host:1',
      JSON.stringify({
        instance: 'host:1',
        host: 'host',
        pid: 1,
        startedAt: now - 3600_000,
        at: now,
        paused: false,
        timezone: 'UTC',
        tasks: 2,
        running: 0,
      }),
    );
    await store.saveExecution(exec({}));
    await store.saveExecution(
      exec({
        id: 'sch_fail1',
        status: 'failed',
        scheduledAt: now - 300_000,
        startedAt: now - 299_900,
        finishedAt: now - 295_000,
        durationMs: 4200,
        error: { type: 'StorageTimeout', message: 'Unable to upload generated report' },
        jobs: [],
      }),
    );
    await store.saveExecution(
      exec({
        id: 'sch_miss1',
        status: 'missed',
        scheduledAt: now - 900_000,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        driftMs: null,
        reason: 'runtime_down',
        missedCount: 3,
        missedUntil: now - 800_000,
        jobs: [],
      }),
    );
  });

  afterAll(async () => {
    await context.close();
  });

  it('overview: task đã đăng ký, mô tả lịch cho người đọc, lịch sắp tới, lần chạy gần đây', async () => {
    await context.app.get(SchedulerMonitorService).tick();
    const { status, body } = await call<{
      health: { status: string; aliveInstances: number };
      kpis: {
        registered: number;
        enabled: number;
        running: number;
        nextExecutionTask: string | null;
      };
      tasks: {
        id: string;
        status: string;
        health: string;
        schedule: { description: string };
        consecutiveFailures: number;
      }[];
      upcoming: { taskId: string; description: string }[];
      recent: { id: string }[];
      alerts: { rule: string; taskId: string | null }[];
      runtime: { instances: { alive: boolean }[]; strategy: string };
      settings: { run: boolean; toggle: boolean };
    }>('GET', `${base}/overview?range=24h`);
    expect(status).toBe(200);
    const d = body.data;
    expect(d.kpis).toMatchObject({
      registered: 2,
      enabled: 2,
      running: 0,
      nextExecutionTask: 'report.daily',
    });
    const report = d.tasks.find((t) => t.id === 'report.daily')!;
    expect(report).toMatchObject({ status: 'failing', health: 'warning', consecutiveFailures: 3 });
    expect(report.schedule.description).toBe('Every 5 minutes');
    expect(d.tasks.find((t) => t.id === 'scheduler.history-prune')!.schedule.description).toBe(
      'Hourly',
    );
    expect(d.upcoming[0]).toMatchObject({ taskId: 'report.daily', description: 'Every 5 minutes' });
    expect(d.recent.map((r) => r.id)).toEqual(expect.arrayContaining(['sch_ok1', 'sch_fail1']));
    expect(d.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'CONSECUTIVE_FAILURES', taskId: 'report.daily' }),
        expect.objectContaining({ rule: 'MISSED_RUN', taskId: 'report.daily' }),
      ]),
    );
    expect(d.health).toMatchObject({ status: 'degraded', aliveInstances: 1 });
    expect(d.runtime.strategy).toBe('distributed_lock');
    expect(d.settings).toEqual({ run: true, toggle: true });
  });

  it('task detail: KPI từ lịch sử, lỗi liên tiếp, lock, downstream queue; task không tồn tại → 404', async () => {
    const { status, body } = await call<{
      kpis: { executions: number; successful: number; failed: number; missed: number };
      consecutive: { count: number } | null;
      lock: { strategy: string; provider: string | null };
      downstream: { queue: string; state: unknown; reason: string | null } | null;
      next: string[];
    }>('GET', `${base}/tasks/report.daily?range=24h`);
    expect(status).toBe(200);
    expect(body.data.kpis).toMatchObject({ executions: 2, successful: 1, failed: 1, missed: 3 });
    expect(body.data.consecutive?.count).toBe(3);
    expect(body.data.lock).toMatchObject({ strategy: 'distributed_lock', provider: 'Redis' });
    // Queue backend không kết nối trong test → nói rõ lý do, không có số liệu giả.
    expect(body.data.downstream).toMatchObject({ queue: 'system.events', state: null });
    expect(body.data.downstream?.reason).toBeTruthy();
    expect(body.data.next).toHaveLength(5);
    const missing = await call('GET', `${base}/tasks/nope`);
    expect(missing.status).toBe(404);
  });

  it('history: lọc theo trạng thái; execution detail kèm job đã tạo', async () => {
    const failed = await call<{ items: { id: string }[] }>(
      'GET',
      `${base}/executions?status=failed&range=24h`,
    );
    expect(failed.body.data.items.map((i) => i.id)).toEqual(['sch_fail1']);
    const manual = await call<{ items: unknown[] }>(
      'GET',
      `${base}/tasks/report.daily/executions?trigger=manual`,
    );
    expect(manual.body.data.items).toEqual([]);
    const detail = await call<{
      execution: { id: string; status: string };
      jobs: { id: string; status: string | null }[];
      jobsReason: string | null;
    }>('GET', `${base}/executions/sch_ok1`);
    expect(detail.body.data.execution).toMatchObject({ id: 'sch_ok1', status: 'success' });
    expect(detail.body.data.jobs).toEqual([expect.objectContaining({ id: 'job_1', status: null })]);
    expect(detail.body.data.jobsReason).toBeTruthy();
    expect((await call('GET', `${base}/executions/sch_none`)).status).toBe(404);
    expect((await call('GET', `${base}/executions?status=bogus`)).status).toBe(400);
  });

  it('failures: gộp theo loại lỗi (lỡ lịch là một loại riêng)', async () => {
    const { body } = await call<{
      failed: number;
      missed: number;
      byType: { type: string; count: number }[];
    }>('GET', `${base}/failures?range=24h`);
    expect(body.data).toMatchObject({ failed: 1, missed: 3 });
    expect(body.data.byType.map((t) => t.type).sort()).toEqual([
      'MissedSchedule',
      'StorageTimeout',
    ]);
  });

  it('Cron Inspector: mô tả + các lần chạy kế tiếp theo múi giờ; biểu thức sai → valid=false', async () => {
    const ok = await call<{
      valid: boolean;
      description: string;
      next: string[];
      utcOffset: string;
    }>(
      'GET',
      `${base}/cron?expression=${encodeURIComponent('0 2 * * *')}&timezone=Asia/Ho_Chi_Minh`,
    );
    expect(ok.body.data).toMatchObject({
      valid: true,
      description: 'Every day at 02:00',
      utcOffset: 'UTC+7',
    });
    expect(ok.body.data.next).toHaveLength(5);
    expect(new Date(ok.body.data.next[0]!).getUTCHours()).toBe(19);
    const bad = await call<{ valid: boolean; error: string }>(
      'GET',
      `${base}/cron?expression=${encodeURIComponent('61 * * * *')}`,
    );
    expect(bad.body.data.valid).toBe(false);
  });

  it('Disable / Enable: ghi Redis, audit, sự kiện; tắt hai lần → 409', async () => {
    const off = await call<{ action: string; result: string }>(
      'POST',
      `${base}/tasks/report.daily/disable`,
    );
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ action: 'disable', result: 'success' });
    expect(await redis.client.hexists(store.keys.disabled(), 'report.daily')).toBe(1);
    const again = await call('POST', `${base}/tasks/report.daily/disable`);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('SCHEDULER_ALREADY_DISABLED');
    const tasks = await call<{ tasks: { id: string; enabled: boolean; status: string }[] }>(
      'GET',
      `${base}/tasks`,
    );
    expect(tasks.body.data.tasks.find((t) => t.id === 'report.daily')).toMatchObject({
      enabled: false,
      status: 'disabled',
    });
    expect((await call('POST', `${base}/tasks/report.daily/enable`)).status).toBe(200);
    const ops = await call<{ action: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data.map((o) => o.action)).toEqual(['enable', 'disable']);
    const events = await call<{ type: string }[]>('GET', `${base}/events?range=1h`);
    expect(events.body.data.map((e) => e.type)).toEqual(
      expect.arrayContaining(['task_enabled', 'task_disabled']),
    );
  });

  it('Run Now: không scheduler nào nhận lệnh → 503 rõ ràng (không giả lập chạy), có audit', async () => {
    const res = await call('POST', `${base}/tasks/report.daily/run`);
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('SCHEDULER_RUNTIME_DOWN');
    const ops = await call<{ action: string; result: string }[]>('GET', `${base}/operations`);
    expect(ops.body.data[0]).toMatchObject({ action: 'run', result: 'failed' });
  });

  it('monitor: instance ngừng heartbeat → Scheduler down; lần chạy dở dang → Interrupted', async () => {
    await redis.client.hset(
      store.keys.instances(),
      'host:1',
      JSON.stringify({
        instance: 'host:1',
        host: 'host',
        pid: 1,
        startedAt: now - 3600_000,
        at: Date.now() - 300_000,
        paused: false,
        timezone: 'UTC',
        tasks: 2,
        running: 1,
      }),
    );
    await store.saveExecution(
      exec({
        id: 'sch_run1',
        status: 'running',
        startedAt: Date.now() - 120_000,
        finishedAt: null,
        durationMs: null,
        jobs: [],
      }),
    );
    // Lượt monitor trước còn giữ lock chu kỳ.
    await redis.client.del(store.keys.monitorLock());
    await context.app.get(SchedulerMonitorService).tick(Date.now());
    const { body } = await call<{
      health: { status: string; reasons: { code: string }[] };
      alerts: { rule: string; severity: string }[];
      running: unknown[];
    }>('GET', `${base}/overview`);
    expect(body.data.health.status).toBe('down');
    expect(body.data.health.reasons[0]!.code).toBe('noHeartbeat');
    expect(body.data.alerts).toEqual([
      expect.objectContaining({ rule: 'HEARTBEAT_MISSING', severity: 'critical' }),
    ]);
    expect(body.data.running).toEqual([]);
    const interrupted = await call<{
      execution: { status: string; reason: string; error: { type: string } };
    }>('GET', `${base}/executions/sch_run1`);
    expect(interrupted.body.data.execution).toMatchObject({
      status: 'failed',
      reason: 'interrupted',
      error: { type: 'Interrupted' },
    });
  });
});
