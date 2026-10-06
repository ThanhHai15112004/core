import { Injectable } from '@nestjs/common';
import type { Job, JobType, Queue } from 'bullmq';
import { CronExpressionParser } from 'cron-parser';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from '@packages/redis/index.js';
import { QueueRegistry, schedulerKeys } from '@packages/queue/index.js';
import { MANUAL_RUN_PREFIX, MessagingConnectionService } from '@packages/messaging/index.js';
import {
  SchedulerOperationsService,
  type SchedulerOperationContext,
} from './scheduler-operations.service.js';
import type {
  ExecutionStatus,
  ExecutionTrigger,
  SchedulerOperationRecord,
} from '../contracts/scheduler.types.js';
import { SchedulerNotFoundException } from '../exceptions/scheduler-ops.exceptions.js';
import { liveQueues, readSchedulerHeartbeat, startOfDay, utcOffsetOf } from './scheduler-utils.js';
import type {
  ConcentrationDto,
  CronInspectDto,
  DownstreamDto,
  ExecutionDetailDto,
  ExecutionDto,
  ExecutionsListDto,
  FailuresDto,
  RunNowDto,
  ScheduleDto,
  SchedulerAlertDto,
  SchedulerConfigDto,
  SchedulerHealthDto,
  SchedulerInstanceDto,
  SchedulerMetric,
  SchedulerMetricsDto,
  SchedulerOperationDto,
  SchedulerOverviewDto,
  SchedulerRange,
  SchedulerReportDto,
  SchedulerSettingsDto,
  TaskDetailDto,
  TaskRowDto,
  TasksListDto,
  TimelineDto,
  UpcomingDto,
  UpcomingListDto,
} from '../responses/scheduler-ops.response.js';

export const SCHEDULER_RANGES: Record<SchedulerRange, number> = {
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10_080,
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Số job tối đa đọc mỗi trạng thái mỗi queue (lịch sử chỉ là job còn giữ trên broker). */
const JOBS_PER_STATE = 500;
const CONCENTRATION_WINDOW_MS = 5 * MINUTE;
const STATE_OF: Record<string, ExecutionStatus> = {
  completed: 'success',
  failed: 'failed',
  active: 'running',
  delayed: 'scheduled',
  waiting: 'scheduled',
  prioritized: 'scheduled',
};
const READ_STATES: JobType[] = [
  'active',
  'completed',
  'failed',
  'delayed',
  'waiting',
  'prioritized',
];

interface TaskDefinition {
  id: string;
  queue: string;
  name?: string | undefined;
  description?: string | undefined;
  pattern?: string | undefined;
  every?: number | undefined;
  tz?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

interface LiveScheduler {
  next: number | null;
  iterations: number | null;
}

interface Snapshot {
  defs: Map<string, TaskDefinition>;
  disabled: Set<string>;
  schedulers: Map<string, LiveScheduler>;
  executions: ExecutionDto[];
  /** Broker đọc được (lịch sử có thể rỗng vì chưa chạy, không phải vì mất kết nối). */
  brokerUp: boolean;
}

const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
const percentile = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
    : null;

/** Task của một job: Job Scheduler gắn `repeatJobKey` = id lịch; Run Now dùng jobId `manual:<task>:<ts>`. */
function taskOfJob(job: Job): { taskId: string; trigger: ExecutionTrigger } | null {
  if (job.repeatJobKey) return { taskId: job.repeatJobKey, trigger: 'scheduled' };
  const id = job.id ?? '';
  if (!id.startsWith(MANUAL_RUN_PREFIX)) return null;
  const taskId = id.slice(MANUAL_RUN_PREFIX.length).split(':')[0];
  return taskId ? { taskId, trigger: 'manual' } : null;
}

/**
 * Scheduler (BullMQ Job Scheduler): danh sách task = định nghĩa + lịch trên broker; lịch sử thực thi = job của task còn
 * giữ trên broker (retention của queue); instance/health = heartbeat của scheduler runtime. Không có số đo tự lưu.
 */
@Injectable()
export class SchedulerOpsService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
    private readonly redis: RedisService,
    private readonly queueRegistry: QueueRegistry,
    private readonly operations: SchedulerOperationsService,
    private readonly connection: MessagingConnectionService,
  ) {}

  private get settings(): SchedulerSettingsDto {
    return { run: this.config.scheduler.run, toggle: this.config.scheduler.toggle };
  }

  // ─── Nguồn dữ liệu ───────────────────────────────────────────────────────

  private async snapshot(): Promise<Snapshot> {
    const keys = schedulerKeys(this.redis);
    const ready = this.redis.isReady();
    const [rawDefs, disabled] = await Promise.all([
      ready ? this.redis.client.hgetall(keys.definitions()).catch(() => ({})) : {},
      ready ? this.redis.client.smembers(keys.disabled()).catch(() => []) : [],
    ]);
    const defs = new Map<string, TaskDefinition>();
    for (const [id, raw] of Object.entries(rawDefs as Record<string, string>)) {
      try {
        defs.set(id, JSON.parse(raw) as TaskDefinition);
      } catch {
        // định nghĩa hỏng — bỏ qua
      }
    }
    const queues = liveQueues(this.queueRegistry, this.connection);
    const schedulers = new Map<string, LiveScheduler>();
    const executions: ExecutionDto[] = [];
    let brokerUp = queues.size > 0;
    for (const [queueName, queue] of queues) {
      try {
        const list = await this.queueRegistry.withTimeout(queue.getJobSchedulers());
        for (const s of list)
          schedulers.set(s.id ?? s.key, {
            next: s.next ?? null,
            iterations: s.iterationCount ?? null,
          });
        executions.push(...(await this.executionsOf(queue, queueName, defs)));
      } catch {
        brokerUp = false;
      }
    }
    executions.sort((a, b) => Date.parse(b.scheduledAt ?? '') - Date.parse(a.scheduledAt ?? ''));
    return { defs, disabled: new Set(disabled), schedulers, executions, brokerUp };
  }

  /** Job của task trên một queue — đọc theo từng trạng thái nên không cần gọi `getState()` từng job. */
  private async executionsOf(
    queue: Queue,
    queueName: string,
    defs: Map<string, TaskDefinition>,
  ): Promise<ExecutionDto[]> {
    const now = Date.now();
    const out: ExecutionDto[] = [];
    for (const state of READ_STATES) {
      const jobs = await this.queueRegistry.withTimeout(
        queue.getJobs([state], 0, JOBS_PER_STATE - 1, false),
      );
      for (const job of jobs) {
        if (!job) continue;
        const owner = taskOfJob(job);
        if (!owner) continue;
        const status = STATE_OF[state] ?? 'scheduled';
        const def = defs.get(owner.taskId);
        out.push({
          id: String(job.id),
          taskId: owner.taskId,
          taskName: def?.name ?? job.name,
          trigger: owner.trigger,
          status,
          // Job lặp: `timestamp` + `delay` = thời điểm lịch hẹn.
          scheduledAt: iso(job.timestamp + (job.delay ?? 0)),
          startedAt: iso(job.processedOn),
          finishedAt: iso(job.finishedOn),
          durationMs:
            job.processedOn && job.finishedOn
              ? Math.max(0, job.finishedOn - job.processedOn)
              : null,
          runningMs: status === 'running' && job.processedOn ? now - job.processedOn : null,
          attempts: job.attemptsMade,
          correlationId: String(job.id),
          error: job.failedReason
            ? {
                type: /^([A-Z]\w+):/.exec(job.failedReason)?.[1] ?? 'Error',
                message: job.failedReason,
              }
            : null,
          jobs: [{ id: String(job.id), queue: queueName, topic: job.name }],
        });
      }
    }
    return out;
  }

  private describe(def: TaskDefinition): ScheduleDto {
    const timezone = def.tz ?? this.config.scheduler.timezone;
    const expression = def.pattern ?? null;
    return {
      type: expression ? 'cron' : 'interval',
      expression,
      intervalMs: def.every ?? null,
      timezone,
      utcOffset: utcOffsetOf(timezone),
      description: expression
        ? this.describeCron(expression)
        : this.i18n.t('scheduler.schedule.everyNMs', { n: def.every ?? 0 }),
    };
  }

  /** Mô tả các mẫu cron phổ biến; còn lại hiện nguyên biểu thức. */
  private describeCron(expr: string): string {
    const f = expr.trim().split(/\s+/);
    if (f.length !== 5) return this.i18n.t('scheduler.schedule.custom', { expression: expr });
    const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
    const rest = dom === '*' && mon === '*' && dow === '*';
    const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    if (rest && hour === '*' && min === '*') return this.i18n.t('scheduler.schedule.everyMinute');
    const step = /^\*\/(\d+)$/.exec(min);
    if (rest && hour === '*' && step)
      return this.i18n.t('scheduler.schedule.everyNMinutes', { n: Number(step[1]) });
    if (rest && hour === '*' && /^\d+$/.test(min))
      return this.i18n.t('scheduler.schedule.hourlyAt', { minute: Number(min) });
    if (rest && /^\d+$/.test(hour) && /^\d+$/.test(min))
      return this.i18n.t('scheduler.schedule.daily', { time });
    return this.i18n.t('scheduler.schedule.custom', { expression: expr });
  }

  private taskRows(s: Snapshot): TaskRowDto[] {
    const now = Date.now();
    const rules = this.config.scheduler.rules;
    return [...s.defs.values()].map((def) => {
      const enabled = !s.disabled.has(def.id);
      const runs = s.executions.filter((e) => e.taskId === def.id);
      const done = runs.filter((e) => e.status === 'success' || e.status === 'failed');
      const last = done[0] ?? null;
      const lastSuccess = done.find((e) => e.status === 'success');
      let consecutive = 0;
      for (const e of done) {
        if (e.status !== 'failed') break;
        consecutive++;
      }
      const day = done.filter((e) => Date.parse(e.scheduledAt ?? '') >= now - DAY);
      const failed24h = day.filter((e) => e.status === 'failed').length;
      const durations = done.map((e) => e.durationMs).filter((d): d is number => d !== null);
      const running = runs.filter((e) => e.status === 'running').length;
      const live = s.schedulers.get(def.id);
      const health =
        consecutive >= rules.consecutiveFailuresCrit
          ? 'error'
          : consecutive >= rules.consecutiveFailuresWarn
            ? 'warning'
            : last
              ? 'healthy'
              : 'unknown';
      return {
        id: def.id,
        name: def.name ?? def.id,
        description: def.description ?? null,
        type: def.pattern ? 'cron' : 'interval',
        schedule: this.describe(def),
        enabled,
        running,
        status: !enabled ? 'disabled' : running ? 'running' : consecutive ? 'failing' : 'enabled',
        health,
        lastRunAt: last?.startedAt ?? last?.scheduledAt ?? null,
        lastStatus: last?.status ?? null,
        lastDurationMs: last?.durationMs ?? null,
        lastError: last?.error ?? null,
        lastExecutionId: last?.id ?? null,
        lastSuccessAt: lastSuccess?.finishedAt ?? null,
        nextRunAt: enabled ? iso(live?.next) : null,
        iterations: live?.iterations ?? null,
        consecutiveFailures: consecutive,
        executions24h: day.length,
        failures24h: failed24h,
        successRatePercent: day.length
          ? Math.round(((day.length - failed24h) / day.length) * 1000) / 10
          : null,
        avgDurationMs: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null,
        downstreamQueue: def.queue ?? null,
      };
    });
  }

  private report(list: ExecutionDto[]): SchedulerReportDto {
    const done = list.filter((e) => e.status === 'success' || e.status === 'failed');
    const failed = done.filter((e) => e.status === 'failed').length;
    const durations = done
      .map((e) => e.durationMs)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);
    return {
      executions: done.length,
      successful: done.length - failed,
      failed,
      successRatePercent: done.length
        ? Math.round(((done.length - failed) / done.length) * 1000) / 10
        : null,
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      p95DurationMs: percentile(durations, 95),
      manualRuns: list.filter((e) => e.trigger === 'manual').length,
    };
  }

  private inRange(list: ExecutionDto[], from: number, to = Date.now()) {
    return list.filter((e) => {
      const t = Date.parse(e.scheduledAt ?? '');
      return t >= from && t < to && e.status !== 'scheduled';
    });
  }

  private async health(): Promise<{
    health: SchedulerHealthDto;
    instance: SchedulerInstanceDto | null;
  }> {
    if (!this.redis.isReady())
      return {
        health: {
          status: 'unknown',
          reasons: [
            {
              code: 'storeUnavailable',
              message: this.i18n.t('scheduler.health.storeUnavailable'),
              taskId: null,
            },
          ],
          lastHeartbeatAt: null,
          heartbeatAgeSec: null,
        },
        instance: null,
      };
    const hb = await readSchedulerHeartbeat(this.redis);
    if (!hb)
      return {
        health: {
          status: 'down',
          reasons: [
            {
              code: 'neverStarted',
              message: this.i18n.t('scheduler.health.neverStarted'),
              taskId: null,
            },
          ],
          lastHeartbeatAt: null,
          heartbeatAgeSec: null,
        },
        instance: null,
      };
    const age = Math.max(0, Math.round((Date.now() - Date.parse(hb.at)) / 1000));
    const stale = age > this.config.scheduler.rules.heartbeatTimeoutSec;
    const paused = hb.state === 'paused';
    return {
      health: {
        status: stale ? 'down' : paused ? 'paused' : 'healthy',
        reasons: stale
          ? [
              {
                code: 'noHeartbeat',
                message: this.i18n.t('scheduler.health.noHeartbeat', { age: `${age}s` }),
                taskId: null,
              },
            ]
          : paused
            ? [{ code: 'paused', message: this.i18n.t('scheduler.health.paused'), taskId: null }]
            : [],
        lastHeartbeatAt: hb.at,
        heartbeatAgeSec: age,
      },
      instance: {
        instance: hb.instance,
        host: hb.process.hostname,
        pid: hb.process.pid,
        startedAt: hb.startedAt,
        lastSeenAt: hb.at,
        heartbeatAgeSec: age,
        uptimeSec: hb.uptimeSec,
        paused,
      },
    };
  }

  private alerts(tasks: TaskRowDto[], health: SchedulerHealthDto): SchedulerAlertDto[] {
    const rules = this.config.scheduler.rules;
    const now = new Date().toISOString();
    const out: SchedulerAlertDto[] = [];
    if (health.status === 'down' && health.heartbeatAgeSec !== null)
      out.push({
        id: 'HEARTBEAT_MISSING',
        rule: 'HEARTBEAT_MISSING',
        severity: 'critical',
        title: this.i18n.t('scheduler.alert.HEARTBEAT_MISSING.title'),
        message: this.i18n.t('scheduler.alert.HEARTBEAT_MISSING.message', {
          value: `${health.heartbeatAgeSec}s`,
          threshold: rules.heartbeatTimeoutSec,
        }),
        value: health.heartbeatAgeSec,
        threshold: rules.heartbeatTimeoutSec,
        unit: 's',
        since: health.lastHeartbeatAt ?? now,
        taskId: null,
        executionId: null,
        tab: 'overview',
      });
    for (const t of tasks.filter((x) => x.consecutiveFailures >= rules.consecutiveFailuresWarn))
      out.push({
        id: `CONSECUTIVE_FAILURES:${t.id}`,
        rule: 'CONSECUTIVE_FAILURES',
        severity: t.consecutiveFailures >= rules.consecutiveFailuresCrit ? 'critical' : 'warning',
        title: this.i18n.t('scheduler.alert.CONSECUTIVE_FAILURES.title'),
        message: this.i18n.t('scheduler.alert.CONSECUTIVE_FAILURES.message', {
          task: t.name,
          value: t.consecutiveFailures,
          threshold: rules.consecutiveFailuresWarn,
        }),
        value: t.consecutiveFailures,
        threshold: rules.consecutiveFailuresWarn,
        unit: '',
        since: t.lastRunAt ?? now,
        taskId: t.id,
        executionId: t.lastExecutionId,
        tab: 'tasks',
      });
    return out;
  }

  private async downstream(queueName: string): Promise<DownstreamDto> {
    const queues = liveQueues(this.queueRegistry, this.connection);
    if (!this.queueRegistry.isKnown(queueName))
      return {
        queue: queueName,
        state: null,
        reason: this.i18n.t('scheduler.downstream.notFound'),
      };
    if (!queues.size)
      return {
        queue: queueName,
        state: null,
        reason: this.i18n.t('scheduler.downstream.disconnected'),
      };
    const q = this.queueRegistry.get(queueName);
    const t = <T>(p: Promise<T>) => this.queueRegistry.withTimeout(p);
    try {
      const [counts, paused, workers] = await Promise.all([
        t(q.getJobCounts('waiting', 'active', 'delayed', 'failed')),
        t(q.isPaused()),
        t(q.getWorkers()).catch(() => null),
      ]);
      return {
        queue: queueName,
        state: {
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          failed: counts['failed'] ?? 0,
          paused,
          workers: workers ? workers.length : null,
        },
        reason: null,
      };
    } catch {
      return { queue: queueName, state: null, reason: this.i18n.t('scheduler.downstream.error') };
    }
  }

  // ─── API ─────────────────────────────────────────────────────────────────

  public async getTasks(): Promise<TasksListDto> {
    return { tasks: this.taskRows(await this.snapshot()), settings: this.settings };
  }

  public async getOverview(range: SchedulerRange): Promise<SchedulerOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [s, { health, instance }] = await Promise.all([this.snapshot(), this.health()]);
    const tasks = this.taskRows(s);
    const upcoming = this.upcoming(tasks, 24);
    const todayRuns = this.inRange(s.executions, today, now);
    const todayReport = this.report(todayRuns);
    const tz = this.config.scheduler.timezone;
    const failing = tasks.some((t) => t.health === 'error' || t.health === 'warning');
    const m = this.config.messaging;
    return {
      generatedAt: new Date(now).toISOString(),
      range,
      environment: this.config.app.env,
      timezone: {
        schedule: tz,
        scheduleOffset: utcOffsetOf(tz),
        runtime: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      health: health.status === 'healthy' && failing ? { ...health, status: 'degraded' } : health,
      instance,
      kpis: {
        registered: tasks.length,
        enabled: tasks.filter((t) => t.enabled).length,
        disabled: tasks.filter((t) => !t.enabled).length,
        running: s.executions.filter((e) => e.status === 'running').length,
        failedToday: todayReport.failed,
        executionsToday: todayReport.executions,
        successRatePercent: todayReport.successRatePercent,
        avgDurationMs: todayReport.avgDurationMs,
        p95DurationMs: todayReport.p95DurationMs,
        nextExecutionAt: upcoming.items[0]?.at ?? null,
        nextExecutionTask: upcoming.items[0]?.taskName ?? null,
      },
      alerts: this.alerts(tasks, health),
      upcoming: upcoming.items.slice(0, 10),
      concentration: upcoming.concentration,
      tasks,
      running: s.executions.filter((e) => e.status === 'running'),
      recent: this.inRange(s.executions, now - SCHEDULER_RANGES[range] * MINUTE).slice(0, 20),
      report: {
        today: todayReport,
        yesterday: this.report(this.inRange(s.executions, today - DAY, today)),
      },
      historyNote: { keepCompleted: m.keepCompleted, keepFailed: m.keepDeadLetter },
      settings: this.settings,
    };
  }

  /** Biểu đồ đếm từ job còn giữ trên broker, gom theo khoảng thời gian. */
  public async getMetrics(
    range: SchedulerRange,
    metric: SchedulerMetric,
    task: string | null,
  ): Promise<SchedulerMetricsDto> {
    const now = Date.now();
    const minutes = SCHEDULER_RANGES[range];
    const from = now - minutes * MINUTE;
    const bucketMs = Math.max(MINUTE, Math.ceil((minutes * MINUTE) / 60 / MINUTE) * MINUTE);
    const runs = this.inRange((await this.snapshot()).executions, from, now).filter(
      (e) => !task || e.taskId === task,
    );
    const buckets = new Map<number, ExecutionDto[]>();
    for (const e of runs) {
      const t = Math.floor(Date.parse(e.scheduledAt!) / bucketMs) * bucketMs;
      buckets.set(t, [...(buckets.get(t) ?? []), e]);
    }
    const times = [...buckets.keys()].sort((a, b) => a - b);
    const series = (id: string, unit: string, value: (list: ExecutionDto[]) => number | null) => ({
      id,
      label: this.i18n.t(`scheduler.series.${id}`),
      unit,
      points: times
        .map((t) => ({ t, value: value(buckets.get(t)!) }))
        .filter((p): p is { t: number; value: number } => p.value !== null),
    });
    const list =
      metric === 'duration'
        ? [series('durationAvg', 'ms', (l) => this.report(l).avgDurationMs)]
        : metric === 'failures'
          ? [series('failed', 'count', (l) => l.filter((e) => e.status === 'failed').length)]
          : [
              series('successful', 'count', (l) => l.filter((e) => e.status === 'success').length),
              series('failed', 'count', (l) => l.filter((e) => e.status === 'failed').length),
            ];
    const values = list[0]!.points.map((p) => p.value);
    return {
      metric,
      range,
      taskId: task,
      resolutionSec: values.length ? bucketMs / 1000 : null,
      unit: list[0]!.unit,
      series: list,
      stats: {
        current: values.at(-1) ?? null,
        peak: values.length ? Math.max(...values) : null,
        average: values.length
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
          : null,
      },
    };
  }

  public async getTask(id: string, range: SchedulerRange): Promise<TaskDetailDto> {
    const s = await this.snapshot();
    const task = this.taskRows(s).find((t) => t.id === id);
    if (!task) throw new SchedulerNotFoundException('scheduler.error.taskNotFound', { id });
    const now = Date.now();
    const runs = s.executions.filter((e) => e.taskId === id);
    const recent = this.inRange(runs, now - SCHEDULER_RANGES[range] * MINUTE);
    const report = this.report(recent);
    const def = s.defs.get(id)!;
    const health = await this.health();
    return {
      task,
      kpis: {
        executions: report.executions,
        successful: report.successful,
        failed: report.failed,
        successRatePercent: report.successRatePercent,
        avgDurationMs: report.avgDurationMs,
        p95DurationMs: report.p95DurationMs,
        failuresToday: this.inRange(runs, startOfDay(now)).filter((e) => e.status === 'failed')
          .length,
        sampled: recent.length,
      },
      consecutive: task.consecutiveFailures
        ? {
            count: task.consecutiveFailures,
            firstFailedAt:
              runs.filter((e) => e.status === 'failed')[task.consecutiveFailures - 1]?.finishedAt ??
              null,
            lastSuccessAt: task.lastSuccessAt,
          }
        : null,
      running: runs.filter((e) => e.status === 'running'),
      next: task.enabled ? this.nextRuns(def, 5) : [],
      downstream: def.queue ? await this.downstream(def.queue) : null,
      durations: recent
        .filter((e) => e.durationMs !== null)
        .map((e) => ({
          t: Date.parse(e.scheduledAt!),
          durationMs: e.durationMs!,
          status: e.status,
        }))
        .reverse(),
      recent: recent.slice(0, 20),
      alerts: this.alerts([task], health.health).filter((a) => a.taskId === id),
      settings: this.settings,
    };
  }

  public async getExecutions(filter: {
    range: SchedulerRange;
    taskId?: string | null;
    status?: ExecutionStatus[] | null;
    trigger?: ExecutionTrigger[] | null;
    limit?: number;
  }): Promise<ExecutionsListDto> {
    const limit = filter.limit ?? 50;
    const from = Date.now() - SCHEDULER_RANGES[filter.range] * MINUTE;
    const items = (await this.snapshot()).executions.filter(
      (e) =>
        (e.status === 'running' || Date.parse(e.scheduledAt ?? '') >= from) &&
        (!filter.taskId || e.taskId === filter.taskId) &&
        (!filter.status?.length || filter.status.includes(e.status)) &&
        (!filter.trigger?.length || filter.trigger.includes(e.trigger)),
    );
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }

  public async getExecution(id: string): Promise<ExecutionDetailDto> {
    const s = await this.snapshot();
    const execution = s.executions.find((e) => e.id === id);
    if (!execution)
      throw new SchedulerNotFoundException('scheduler.error.executionNotFound', { id });
    const task = this.taskRows(s).find((t) => t.id === execution.taskId) ?? null;
    const queue = execution.jobs[0]?.queue;
    return {
      execution,
      task,
      downstream: queue ? await this.downstream(queue) : null,
      settings: this.settings,
    };
  }

  private nextRuns(def: TaskDefinition, count: number): string[] {
    if (!def.pattern) return [];
    try {
      const it = CronExpressionParser.parse(def.pattern, {
        tz: def.tz ?? this.config.scheduler.timezone,
      });
      return Array.from({ length: count }, () => it.next().toDate().toISOString());
    } catch {
      return [];
    }
  }

  private upcoming(tasks: TaskRowDto[], hours: number): UpcomingListDto {
    const now = Date.now();
    const until = now + hours * 60 * MINUTE;
    const items: UpcomingDto[] = [];
    for (const task of tasks.filter((t) => t.enabled)) {
      const at = task.schedule.expression
        ? this.nextRuns(
            {
              id: task.id,
              queue: '',
              pattern: task.schedule.expression,
              tz: task.schedule.timezone,
            },
            50,
          )
        : task.nextRunAt
          ? [task.nextRunAt]
          : [];
      for (const a of at) {
        const t = Date.parse(a);
        if (t > until) break;
        items.push({
          taskId: task.id,
          taskName: task.name,
          at: a,
          inSec: Math.max(0, Math.round((t - now) / 1000)),
          expression: task.schedule.expression,
          description: task.schedule.description,
        });
      }
    }
    items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    // Dồn lịch: nhiều task khác nhau cùng một cửa sổ 5 phút.
    const windows = new Map<number, Set<string>>();
    for (const i of items) {
      const w = Math.floor(Date.parse(i.at) / CONCENTRATION_WINDOW_MS) * CONCENTRATION_WINDOW_MS;
      windows.set(w, (windows.get(w) ?? new Set()).add(i.taskName));
    }
    const concentration: ConcentrationDto[] = [...windows.entries()]
      .filter(([, names]) => names.size >= this.config.scheduler.rules.concentrationTasks)
      .map(([w, names]) => ({
        from: new Date(w).toISOString(),
        to: new Date(w + CONCENTRATION_WINDOW_MS).toISOString(),
        count: names.size,
        tasks: [...names],
      }));
    return { hours, items: items.slice(0, 100), concentration, truncated: items.length > 100 };
  }

  public async getUpcoming(hours: number): Promise<UpcomingListDto> {
    return this.upcoming(this.taskRows(await this.snapshot()), hours);
  }

  public async getTimeline(range: SchedulerRange): Promise<TimelineDto> {
    const now = Date.now();
    const s = await this.snapshot();
    const runs = this.inRange(s.executions, now - SCHEDULER_RANGES[range] * MINUTE);
    const lanes = new Map<string, TimelineDto['lanes'][number]>();
    for (const e of runs) {
      const lane = lanes.get(e.taskId) ?? {
        taskId: e.taskId,
        taskName: e.taskName,
        executions: [],
      };
      lane.executions.push(e);
      lanes.set(e.taskId, lane);
    }
    return {
      range,
      from: new Date(now - SCHEDULER_RANGES[range] * MINUTE).toISOString(),
      to: new Date(now).toISOString(),
      lanes: [...lanes.values()],
      upcoming: this.upcoming(this.taskRows(s), 6).items,
      truncated: false,
    };
  }

  public async getFailures(range: SchedulerRange): Promise<FailuresDto> {
    const s = await this.snapshot();
    const tasks = this.taskRows(s);
    const failed = this.inRange(s.executions, Date.now() - SCHEDULER_RANGES[range] * MINUTE).filter(
      (e) => e.status === 'failed',
    );
    const byType = new Map<string, ExecutionDto[]>();
    for (const e of failed) {
      const type = e.error?.type ?? 'Error';
      byType.set(type, [...(byType.get(type) ?? []), e]);
    }
    const health = await this.health();
    return {
      range,
      failed: failed.length,
      byType: [...byType.entries()].map(([type, list]) => ({
        type,
        count: list.length,
        tasks: [...new Set(list.map((e) => e.taskName))],
        lastAt: list[0]!.finishedAt ?? list[0]!.scheduledAt!,
        sampleExecutionId: list[0]!.id,
      })),
      byTask: tasks
        .map((t) => ({
          taskId: t.id,
          taskName: t.name,
          failed: failed.filter((e) => e.taskId === t.id).length,
          consecutive: t.consecutiveFailures,
        }))
        .filter((t) => t.failed > 0 || t.consecutive > 0),
      items: failed.slice(0, 100),
      truncated: failed.length > 100,
      alerts: this.alerts(tasks, health.health),
    };
  }

  public async getOperations(): Promise<SchedulerOperationDto[]> {
    return (await this.operations.getOperations()).map((op) => this.operationDto(op));
  }

  public async getConfig(): Promise<SchedulerConfigDto> {
    const s = await this.snapshot();
    const m = this.config.messaging;
    const r = this.config.scheduler.rules;
    return {
      items: [
        { group: 'core', key: 'timezone', value: this.config.scheduler.timezone },
        { group: 'core', key: 'runEnabled', value: this.config.scheduler.run },
        { group: 'core', key: 'toggleEnabled', value: this.config.scheduler.toggle },
        { group: 'history', key: 'keepCompletedJobs', value: m.keepCompleted },
        { group: 'history', key: 'keepFailedJobs', value: m.keepDeadLetter },
        { group: 'thresholds', key: 'heartbeatTimeoutSec', value: r.heartbeatTimeoutSec },
        { group: 'thresholds', key: 'consecutiveFailuresWarn', value: r.consecutiveFailuresWarn },
        { group: 'thresholds', key: 'consecutiveFailuresCrit', value: r.consecutiveFailuresCrit },
        { group: 'thresholds', key: 'concentrationTasks', value: r.concentrationTasks },
      ],
      tasks: [...s.defs.values()].map((d) => ({
        id: d.id,
        name: d.name ?? d.id,
        items: [
          { key: 'queue', value: d.queue },
          { key: 'pattern', value: d.pattern ?? null },
          { key: 'every', value: d.every ?? null },
          { key: 'timezone', value: d.tz ?? this.config.scheduler.timezone },
        ],
      })),
    };
  }

  public inspectCron(expression: string, timezone?: string | null): CronInspectDto {
    const tz = timezone || this.config.scheduler.timezone;
    try {
      const interval = CronExpressionParser.parse(expression, { tz });
      const next = Array.from({ length: 5 }, () => interval.next().toDate().toISOString());
      return {
        expression,
        timezone: tz,
        utcOffset: utcOffsetOf(tz),
        valid: true,
        error: null,
        description: this.describeCron(expression),
        next,
      };
    } catch (err: unknown) {
      return {
        expression,
        timezone: tz,
        utcOffset: utcOffsetOf(tz),
        valid: false,
        error: err instanceof Error ? err.message : String(err),
        description: null,
        next: [],
      };
    }
  }

  private operationDto(op: SchedulerOperationRecord): SchedulerOperationDto {
    return { ...op, at: new Date(op.at).toISOString() };
  }

  public async runNow(taskId: string, ctx: SchedulerOperationContext): Promise<RunNowDto> {
    const res = await this.operations.runNow(taskId, ctx);
    return { operation: this.operationDto(res.record), executionId: res.executionId };
  }

  public async enable(taskId: string, ctx: SchedulerOperationContext) {
    return this.operationDto(await this.operations.enable(taskId, ctx));
  }

  public async disable(taskId: string, ctx: SchedulerOperationContext) {
    return this.operationDto(await this.operations.disable(taskId, ctx));
  }
}
