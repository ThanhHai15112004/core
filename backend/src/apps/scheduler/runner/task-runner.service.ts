import * as os from 'node:os';
import {
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import {
  SCHEDULER_COMMAND_TTL_SEC,
  SchedulerStore,
  classifyTaskError,
  nextRun,
  recordSchedulerEvent,
  runsBetween,
  schedulerId,
  validateSchedule,
  type ExecutionReason,
  type ExecutionRecord,
  type ExecutionTrigger,
  type ScheduledTaskMeta,
  type SchedulerCommand,
  type SchedulerCommandResult,
  type SchedulerInstanceRecord,
  type TaskStateRecord,
} from '@packages/scheduler/index.js';
import {
  ScheduledTaskRegistry,
  type ScheduledTaskDefinition,
  type TaskExecutionContext,
} from '../registry/scheduled-task.registry.js';

/** Lịch trễ hơn chừng này lúc khởi động (scheduler ngừng khi tới hạn) → coi là bị lỡ. */
const MISFIRE_GRACE_MS = 30_000;
const HEARTBEAT_MS = 5000;
/** Một mốc lịch chỉ một instance nhận (các instance tới mốc gần như cùng lúc). */
const SLOT_TTL_MS = 5 * 60_000;
const COMMAND_CLAIM_MS = 60_000;
/** setTimeout tối đa ~24.8 ngày — chờ lâu hơn thì hẹn lại từng đoạn. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const DRAIN_POLL_MS = 200;
/** Sự kiện "bị bỏ qua" của một task tối đa một lần trong khoảng này (task chạy dày không làm ngập log sự kiện). */
const SKIP_EVENT_EVERY_MS = 10 * 60_000;
const REDIS_BOOT_WAIT_MS = 5000;

export interface TaskRuntime {
  def: ScheduledTaskDefinition;
  meta: ScheduledTaskMeta;
  timer: NodeJS.Timeout | null;
  nextRunAt: number | null;
  /** Execution đang chạy trên instance này. */
  running: Map<string, number>;
  state: TaskStateRecord;
  runsToday: number;
  failuresToday: number;
  lastSkipEventAt: number;
}

type Acquired =
  | { ok: true; lock: string | null }
  | { ok: false; reason: ExecutionReason; blockedBy: string | null };

/** Trạng thái task cho Runtime Monitor (giữ tương thích trang Runtimes). */
export interface TaskState {
  name: string;
  cron: string;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastFailedAt: string | null;
  failuresToday: number;
  runsToday: number;
  nextRunAt: string | null;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

export const emptyTaskState = (): TaskStateRecord => ({
  nextRunAt: null,
  lastScheduledAt: null,
  lastRunAt: null,
  lastFinishedAt: null,
  lastStatus: null,
  lastExecutionId: null,
  lastDurationMs: null,
  lastError: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  completed: false,
  updatedAt: Date.now(),
});

/**
 * Scheduler runtime: lên lịch task (cron theo múi giờ / interval căn mốc / một lần), ghi lịch sử từng lần chạy,
 * chống chạy chồng bằng lock Redis (kể cả nhiều instance), mỗi mốc lịch chỉ một instance nhận, phát hiện lịch bị
 * lỡ khi khởi động và áp dụng misfire policy, nhận lệnh Run Now / Enable / Disable từ System Console.
 */
@Injectable()
export class TaskRunnerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('SchedulerRunner');
  private readonly tasks = new Map<string, TaskRuntime>();
  private readonly instance = `${os.hostname()}:${process.pid}`;
  private readonly startedAt = Date.now();
  private disabled = new Set<string>();
  private paused = false;
  private started = false;
  private registered = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private subscriber: Redis | null = null;
  private day = new Date().toDateString();

  constructor(
    private readonly registry: ScheduledTaskRegistry,
    private readonly store: SchedulerStore,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    private readonly context: RequestContextService,
    @Optional() private readonly recorder?: MetricRecorder,
  ) {}

  private meta(def: ScheduledTaskDefinition, now: number): ScheduledTaskMeta {
    const spec = {
      type: def.type,
      cron: def.type === 'cron' ? (def.cron ?? null) : null,
      intervalMs: def.type === 'interval' ? (def.intervalMs ?? null) : null,
      runAt:
        def.type === 'one_time' && def.runAt !== undefined
          ? def.runAt instanceof Date
            ? def.runAt.getTime()
            : def.runAt
          : null,
      timezone: def.timezone ?? this.config.scheduler.timezone,
    };
    return {
      ...spec,
      id: def.id,
      name: def.name,
      description: def.description ?? null,
      group: def.group ?? 'default',
      overlap: def.overlap ?? 'skip',
      misfire: def.misfire ?? 'run_once',
      expectedDurationMs: def.expectedDurationMs ?? null,
      lockTtlMs: def.lockTtlMs ?? this.config.scheduler.lockTtlMs,
      downstreamQueue: def.downstreamQueue ?? null,
      className: def.className,
      sourcePath: def.sourcePath ?? null,
      error: validateSchedule(spec),
      registeredAt: now,
    };
  }

  // ─── Vòng đời ─────────────────────────────────────────────────────────────

  public async onApplicationBootstrap(): Promise<void> {
    const now = Date.now();
    for (const def of this.registry.list()) {
      const meta = this.meta(def, now);
      if (meta.error) this.logger.error(`Task ${def.id} is misconfigured: ${meta.error}`);
      this.tasks.set(def.id, {
        def,
        meta,
        timer: null,
        nextRunAt: null,
        running: new Map(),
        state: emptyTaskState(),
        runsToday: 0,
        failuresToday: 0,
        lastSkipEventAt: 0,
      });
    }
    this.started = true;
    await this.subscribe();
    // Redis chưa sẵn sàng: vẫn lên lịch, phần đăng ký / kiểm tra lịch lỡ làm lại ở heartbeat kế tiếp.
    if (await this.redis.waitUntilReady(REDIS_BOOT_WAIT_MS)) await this.register();
    else for (const rt of this.tasks.values()) this.schedule(rt);
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
    await this.beat();
    this.logger.log(`Scheduler started with ${this.tasks.size} task(s) on ${this.instance}`);
  }

  public async beforeApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const rt of this.tasks.values()) this.clearTimer(rt);
    await this.safe(() => this.store.client.hdel(this.store.keys.instances(), this.instance));
    await recordSchedulerEvent(this.redis, {
      type: 'instance_stopped',
      severity: 'warning',
      params: { instance: this.instance, running: this.runningCount() },
    });
    await this.safe(async () => {
      await this.subscriber?.quit();
    });
    this.subscriber = null;
  }

  /** Công bố registry, nạp trạng thái / task bị tắt, kiểm tra lịch bị lỡ rồi lên lịch — đúng một lần. */
  private async register(): Promise<void> {
    if (this.registered || !this.redis.isReady()) return;
    const ok = await this.safe(async () => {
      await this.store.publishTasks([...this.tasks.values()].map((t) => t.meta));
      const [states, disabled] = await Promise.all([this.store.states(), this.store.disabled()]);
      this.disabled = new Set(disabled.keys());
      for (const [id, rt] of this.tasks) {
        const stored = states.get(id);
        if (stored) rt.state = { ...emptyTaskState(), ...stored };
      }
      return true;
    });
    if (!ok) return;
    this.registered = true;
    await recordSchedulerEvent(this.redis, {
      type: 'instance_started',
      severity: 'info',
      params: { instance: this.instance, tasks: this.tasks.size },
    });
    const recoveries: Array<() => Promise<unknown>> = [];
    const now = Date.now();
    for (const rt of this.tasks.values()) {
      const recover = await this.checkMissed(rt, now);
      if (recover) recoveries.push(recover);
      this.schedule(rt);
      await this.persist(rt);
    }
    for (const r of recoveries) void r();
  }

  private async beat(): Promise<void> {
    if (!this.started || !this.redis.isReady()) return;
    if (!this.registered) await this.register();
    this.rollDay();
    const record: SchedulerInstanceRecord = {
      instance: this.instance,
      host: os.hostname(),
      pid: process.pid,
      startedAt: this.startedAt,
      at: Date.now(),
      paused: this.paused,
      timezone: this.config.scheduler.timezone,
      tasks: this.tasks.size,
      running: this.runningCount(),
    };
    await this.safe(async () => {
      await this.store.client.hset(
        this.store.keys.instances(),
        this.instance,
        JSON.stringify(record),
      );
      // Redis bị làm trống (restart không persist) → công bố lại registry.
      if ((await this.store.client.hlen(this.store.keys.tasks())) === 0)
        await this.store.publishTasks([...this.tasks.values()].map((t) => t.meta));
    });
    await this.reloadDisabled();
  }

  // ─── Lên lịch ─────────────────────────────────────────────────────────────

  private isActive(rt: TaskRuntime): boolean {
    return (
      this.started &&
      !this.paused &&
      !this.disabled.has(rt.meta.id) &&
      !rt.meta.error &&
      !(rt.meta.type === 'one_time' && rt.state.completed)
    );
  }

  private clearTimer(rt: TaskRuntime): void {
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = null;
    rt.nextRunAt = null;
  }

  private schedule(rt: TaskRuntime, from = Date.now()): void {
    this.clearTimer(rt);
    if (!this.isActive(rt)) return;
    rt.nextRunAt = nextRun(rt.meta, from);
    if (rt.nextRunAt !== null) this.arm(rt, rt.nextRunAt);
  }

  private arm(rt: TaskRuntime, at: number): void {
    rt.timer = setTimeout(
      () => {
        if (Date.now() < at) return this.arm(rt, at);
        void this.fire(rt, at);
      },
      Math.min(Math.max(0, at - Date.now()), MAX_TIMER_MS),
    );
  }

  private async fire(rt: TaskRuntime, scheduledAt: number): Promise<void> {
    rt.timer = null;
    // Lên lịch lần kế tiếp trước khi chạy: task chạy lâu không làm trễ lịch sau.
    this.schedule(rt, Math.max(scheduledAt, Date.now()));
    await this.persist(rt);
    await this.execute(rt, 'scheduled', scheduledAt);
  }

  /**
   * Lịch đã lưu (của process trước) đã qua mà chưa chạy. Trễ ít (restart nhanh) → chạy ngay như lịch thường
   * (độ trễ hiện ở drift). Trễ quá `MISFIRE_GRACE_MS` → ghi một bản ghi `missed` (gộp số lần lỡ) và, với misfire
   * policy `run_once`, trả về lần chạy bù để chạy sau khi lên lịch xong.
   */
  private async checkMissed(
    rt: TaskRuntime,
    now: number,
  ): Promise<(() => Promise<unknown>) | null> {
    if (!this.isActive(rt)) return null;
    const s = rt.state;
    const since =
      s.nextRunAt ?? (rt.meta.type === 'one_time' && s.lastRunAt === null ? rt.meta.runAt : null);
    if (since === null || since >= now) return null;
    if (s.lastScheduledAt !== null && s.lastScheduledAt >= since) return null;
    if (since >= now - MISFIRE_GRACE_MS) return () => this.execute(rt, 'scheduled', since);
    const claimed = await this.safe(() =>
      this.store.client.set(
        this.store.keys.missCheck(rt.meta.id, since),
        this.instance,
        'PX',
        3600_000,
        'NX',
      ),
    );
    if (claimed !== 'OK') return null;
    const slots = [since, ...runsBetween(rt.meta, since, now)];
    const last = slots[slots.length - 1]!;
    const record: ExecutionRecord = {
      ...this.blank(rt, schedulerId('sch'), 'scheduled', since),
      status: 'missed',
      reason: 'runtime_down',
      missedCount: slots.length,
      missedUntil: last,
    };
    await this.safe(() => this.store.saveExecution(record));
    this.recorder?.count('sch.miss', slots.length);
    this.recorder?.count(`sch.t.${rt.meta.id}.miss`, slots.length);
    const recover = rt.meta.misfire === 'run_once';
    await recordSchedulerEvent(this.redis, {
      type: 'run_missed',
      severity: 'warning',
      taskId: rt.meta.id,
      executionId: record.id,
      params: { count: slots.length, from: since, until: last, policy: rt.meta.misfire },
    });
    this.logger.warn(
      `Task ${rt.meta.id} missed ${slots.length} scheduled run(s) since ${new Date(since).toISOString()}` +
        (recover ? ' — running once now (misfire policy run_once)' : ''),
    );
    if (!recover) return null;
    return async () => {
      const exec = await this.execute(rt, 'recovery', last);
      if (exec)
        await recordSchedulerEvent(this.redis, {
          type: 'run_recovered',
          severity: 'info',
          taskId: rt.meta.id,
          executionId: exec.id,
          params: { count: slots.length },
        });
    };
  }

  // ─── Thực thi ─────────────────────────────────────────────────────────────

  private blank(
    rt: TaskRuntime,
    id: string,
    trigger: ExecutionTrigger,
    scheduledAt: number | null,
  ): ExecutionRecord {
    return {
      id,
      taskId: rt.meta.id,
      trigger,
      status: 'running',
      scheduledAt,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      driftMs: null,
      instance: this.instance,
      correlationId: null,
      error: null,
      reason: null,
      missedCount: null,
      missedUntil: null,
      jobs: [],
      actor: null,
      ip: null,
      blockedBy: null,
    };
  }

  /** Lock chống chạy chồng (chỉ với overlap `skip`). */
  private async acquire(rt: TaskRuntime, executionId: string): Promise<Acquired> {
    if (rt.meta.overlap === 'allow') return { ok: true, lock: null };
    const local = rt.running.keys().next();
    if (!local.done) return { ok: false, reason: 'previous_running', blockedBy: local.value };
    const value = `${executionId}|${this.instance}`;
    const key = this.store.keys.lock(rt.meta.id);
    const got = await this.store.client
      .set(key, value, 'PX', rt.meta.lockTtlMs, 'NX')
      .catch(() => undefined);
    if (got === undefined) return { ok: false, reason: 'lock_unavailable', blockedBy: null };
    if (got === 'OK') return { ok: true, lock: value };
    const holder = await this.store.client.get(key).catch(() => null);
    return { ok: false, reason: 'previous_running', blockedBy: holder?.split('|')[0] ?? null };
  }

  private async release(rt: TaskRuntime, lock: string | null): Promise<void> {
    if (!lock) return;
    const key = this.store.keys.lock(rt.meta.id);
    await this.safe(async () => {
      if ((await this.store.client.get(key)) === lock) await this.store.client.del(key);
    });
  }

  /** Nhận mốc lịch, lấy lock rồi chạy; bị chặn thì ghi lần chạy `skipped`. Trả về bản ghi (null = instance khác nhận). */
  public async execute(
    rt: TaskRuntime,
    trigger: ExecutionTrigger,
    scheduledAt: number | null,
  ): Promise<ExecutionRecord | null> {
    if (trigger === 'scheduled' && scheduledAt !== null) {
      const claimed = await this.store.client
        .set(this.store.keys.slot(rt.meta.id, scheduledAt), this.instance, 'PX', SLOT_TTL_MS, 'NX')
        .catch(() => 'unavailable');
      if (claimed === null) return null;
    }
    const id = schedulerId('sch');
    const acquired = await this.acquire(rt, id);
    if (!acquired.ok)
      return this.skip(rt, id, trigger, scheduledAt, acquired.reason, acquired.blockedBy);
    return this.run(rt, id, trigger, scheduledAt, acquired.lock, null, null);
  }

  private async skip(
    rt: TaskRuntime,
    id: string,
    trigger: ExecutionTrigger,
    scheduledAt: number | null,
    reason: ExecutionReason,
    blockedBy: string | null,
  ): Promise<ExecutionRecord> {
    const record: ExecutionRecord = {
      ...this.blank(rt, id, trigger, scheduledAt),
      status: 'skipped',
      finishedAt: Date.now(),
      reason,
      blockedBy,
    };
    this.logger.warn(`Task ${rt.meta.id} skipped: ${reason}${blockedBy ? ` (${blockedBy})` : ''}`);
    await this.safe(() => this.store.saveExecution(record));
    this.recorder?.count('sch.skip');
    this.recorder?.count(`sch.t.${rt.meta.id}.skip`);
    const now = Date.now();
    if (now - rt.lastSkipEventAt >= SKIP_EVENT_EVERY_MS) {
      rt.lastSkipEventAt = now;
      await recordSchedulerEvent(this.redis, {
        type: 'run_skipped',
        severity: reason === 'lock_unavailable' ? 'warning' : 'info',
        taskId: rt.meta.id,
        executionId: id,
        params: { reason, blockedBy: blockedBy ?? '' },
      });
    }
    return record;
  }

  private async run(
    rt: TaskRuntime,
    id: string,
    trigger: ExecutionTrigger,
    scheduledAt: number | null,
    lock: string | null,
    actor: string | null,
    ip: string | null,
  ): Promise<ExecutionRecord> {
    this.rollDay();
    const startedAt = Date.now();
    const record: ExecutionRecord = {
      ...this.blank(rt, id, trigger, scheduledAt),
      startedAt,
      driftMs:
        trigger === 'scheduled' && scheduledAt !== null
          ? Math.max(0, startedAt - scheduledAt)
          : null,
      correlationId: id,
      actor,
      ip,
    };
    rt.running.set(id, startedAt);
    await this.safe(() => this.store.saveExecution(record));
    const refresh = lock
      ? setInterval(
          () =>
            void this.store.client
              .pexpire(this.store.keys.lock(rt.meta.id), rt.meta.lockTtlMs)
              .catch(() => undefined),
          Math.max(1000, Math.floor(rt.meta.lockTtlMs / 3)),
        )
      : null;
    refresh?.unref();
    const ctx: TaskExecutionContext = {
      executionId: id,
      taskId: rt.meta.id,
      trigger,
      scheduledAt,
      correlationId: id,
      recordJob: (job) => record.jobs.push(job),
    };
    try {
      await this.context.run({ correlationId: id }, () =>
        Promise.resolve().then(() => rt.def.handler(ctx)),
      );
      record.status = 'success';
    } catch (err) {
      record.status = 'failed';
      record.error = classifyTaskError(err);
      this.logger.error(
        `Task ${rt.meta.id} failed (${record.error.type}): ${record.error.message}`,
      );
    } finally {
      if (refresh) clearInterval(refresh);
      rt.running.delete(id);
    }
    record.finishedAt = Date.now();
    record.durationMs = record.finishedAt - startedAt;
    await this.release(rt, lock);
    await this.safe(() => this.store.saveExecution(record));
    this.measure(rt, record);
    await this.updateState(rt, record);
    return record;
  }

  private measure(rt: TaskRuntime, r: ExecutionRecord): void {
    const t = (kind: string) => `sch.t.${rt.meta.id}.${kind}`;
    const ok = r.status === 'success';
    this.recorder?.count('sch.run');
    this.recorder?.count(ok ? 'sch.ok' : 'sch.fail');
    this.recorder?.count(t('run'));
    this.recorder?.count(t(ok ? 'ok' : 'fail'));
    if (r.trigger === 'manual') this.recorder?.count('sch.manual');
    if (r.durationMs !== null) {
      this.recorder?.timing('sch.dur', r.durationMs);
      this.recorder?.timing(t('dur'), r.durationMs);
    }
    if (r.driftMs !== null) this.recorder?.timing('sch.drift', r.driftMs);
    rt.runsToday++;
    if (!ok) rt.failuresToday++;
  }

  private async updateState(rt: TaskRuntime, r: ExecutionRecord): Promise<void> {
    const s = rt.state;
    const prevFailures = s.consecutiveFailures;
    s.lastRunAt = r.startedAt;
    s.lastFinishedAt = r.finishedAt;
    s.lastStatus = r.status;
    s.lastExecutionId = r.id;
    s.lastDurationMs = r.durationMs;
    if (r.trigger !== 'manual' && r.scheduledAt !== null)
      s.lastScheduledAt = Math.max(s.lastScheduledAt ?? 0, r.scheduledAt);
    if (r.status === 'success') {
      s.lastSuccessAt = r.finishedAt;
      s.consecutiveFailures = 0;
      s.lastError = null;
    } else {
      s.lastFailureAt = r.finishedAt;
      s.consecutiveFailures++;
      s.lastError = r.error;
    }
    if (rt.meta.type === 'one_time' && r.trigger !== 'manual') {
      s.completed = true;
      this.schedule(rt);
    }
    await this.persist(rt);
    if (r.status === 'failed' && prevFailures === 0)
      await recordSchedulerEvent(this.redis, {
        type: 'task_failed',
        severity: 'warning',
        taskId: rt.meta.id,
        executionId: r.id,
        params: { error: r.error?.type ?? '', message: r.error?.message ?? '' },
      });
    if (r.status === 'success' && prevFailures > 0)
      await recordSchedulerEvent(this.redis, {
        type: 'task_recovered',
        severity: 'success',
        taskId: rt.meta.id,
        executionId: r.id,
        params: { failures: prevFailures },
      });
  }

  private async persist(rt: TaskRuntime): Promise<void> {
    rt.state.nextRunAt = rt.nextRunAt;
    rt.state.updatedAt = Date.now();
    await this.safe(() => this.store.setState(rt.meta.id, rt.state));
  }

  // ─── Lệnh từ System Console ───────────────────────────────────────────────

  private async subscribe(): Promise<void> {
    const channel = this.store.keys.commandChannel();
    const subscriber = this.redis.createSubscriber();
    subscriber.on('message', (ch: string, raw: string) => {
      if (ch !== channel) return;
      try {
        void this.handleCommand(JSON.parse(raw) as SchedulerCommand);
      } catch {
        this.logger.warn(`Ignored malformed scheduler command: ${raw}`);
      }
    });
    this.subscriber = subscriber;
    await this.safe(() => subscriber.subscribe(channel));
  }

  public async handleCommand(cmd: SchedulerCommand): Promise<void> {
    if (cmd.action === 'refresh') return this.reloadDisabled();
    const rt = cmd.taskId ? this.tasks.get(cmd.taskId) : undefined;
    // Instance chạy phiên bản không có task này → để instance khác nhận lệnh.
    if (!rt || !this.started) return;
    const claimed = await this.safe(() =>
      this.store.client.set(
        this.store.keys.commandClaim(cmd.id),
        this.instance,
        'PX',
        COMMAND_CLAIM_MS,
        'NX',
      ),
    );
    if (claimed !== 'OK') return;
    const executionId = cmd.executionId ?? schedulerId('sch');
    const reply = (status: SchedulerCommandResult['status'], code: string | null, params = {}) =>
      this.safe(() =>
        this.store.client.set(
          this.store.keys.commandResult(cmd.id),
          JSON.stringify({
            id: cmd.id,
            status,
            code,
            instance: this.instance,
            executionId: status === 'accepted' ? executionId : null,
            params,
            at: Date.now(),
          } satisfies SchedulerCommandResult),
          'EX',
          SCHEDULER_COMMAND_TTL_SEC,
        ),
      );
    if (this.paused) {
      await reply('rejected', 'RUNTIME_PAUSED');
      return;
    }
    const acquired = await this.acquire(rt, executionId);
    if (!acquired.ok) {
      await reply(
        'rejected',
        acquired.reason === 'lock_unavailable' ? 'LOCK_UNAVAILABLE' : 'TASK_RUNNING',
        {
          blockedBy: acquired.blockedBy ?? '',
        },
      );
      return;
    }
    await reply('accepted', null);
    await this.run(rt, executionId, 'manual', null, acquired.lock, cmd.actor, cmd.ip);
  }

  /** Đồng bộ task bị tắt (Console ghi vào Redis rồi phát `refresh`; heartbeat cũng đọc lại phòng khi lỡ tin). */
  private async reloadDisabled(): Promise<void> {
    if (!this.redis.isReady() || !this.registered) return;
    const disabled = await this.safe(() => this.store.disabled());
    if (!disabled) return;
    const next = new Set(disabled.keys());
    const changed = [...this.tasks.values()].filter(
      (rt) => this.disabled.has(rt.meta.id) !== next.has(rt.meta.id),
    );
    this.disabled = next;
    for (const rt of changed) {
      this.schedule(rt);
      await this.persist(rt);
      this.logger.log(`Task ${rt.meta.id} ${next.has(rt.meta.id) ? 'disabled' : 'enabled'}`);
    }
  }

  // ─── Runtime Monitor (pause / resume / drain) ─────────────────────────────

  public list(): TaskState[] {
    this.rollDay();
    return [...this.tasks.values()].map((rt) => ({
      name: rt.meta.id,
      cron:
        rt.meta.cron ??
        (rt.meta.intervalMs ? `every ${rt.meta.intervalMs / 1000}s` : (iso(rt.meta.runAt) ?? '')),
      running: rt.running.size > 0,
      lastRunAt: iso(rt.state.lastRunAt),
      lastDurationMs: rt.state.lastDurationMs,
      lastError: rt.state.lastError?.message ?? null,
      lastFailedAt: iso(rt.state.lastFailureAt),
      failuresToday: rt.failuresToday,
      runsToday: rt.runsToday,
      nextRunAt: iso(rt.nextRunAt),
    }));
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public pause(): void {
    this.paused = true;
    for (const rt of this.tasks.values()) {
      this.clearTimer(rt);
      void this.persist(rt);
    }
  }

  public resume(): void {
    this.paused = false;
    for (const rt of this.tasks.values()) {
      this.schedule(rt);
      void this.persist(rt);
    }
  }

  /** Ngừng lên lịch và chờ các task đang chạy hoàn tất. */
  public async drain(): Promise<void> {
    this.pause();
    while (this.runningCount() > 0) await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
  }

  private runningCount(): number {
    return [...this.tasks.values()].reduce((s, rt) => s + rt.running.size, 0);
  }

  private rollDay(): void {
    const today = new Date().toDateString();
    if (today === this.day) return;
    this.day = today;
    for (const rt of this.tasks.values()) {
      rt.runsToday = 0;
      rt.failuresToday = 0;
    }
  }

  /** Lệnh Redis thất bại (mất kết nối) không được làm hỏng scheduler. */
  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  }

  /** Cho test / chẩn đoán. */
  public runtime(id: string): TaskRuntime | undefined {
    return this.tasks.get(id);
  }
}
