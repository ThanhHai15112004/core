import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from '@packages/redis/index.js';
import { withVersion } from '@packages/runtime/index.js';
import { MessagingMonitoringService } from '@packages/messaging/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import { TELEMETRY_TIERS, type MetricBucket } from '@packages/telemetry/index.js';
import {
  SchedulerStore,
  describeSchedule,
  hasDst,
  isValidTimezone,
  nextRun,
  nextRuns,
  utcOffsetLabel,
  validateSchedule,
  type ExecutionRecord,
  type ExecutionStatus,
  type ExecutionTrigger,
  type ScheduledTaskMeta,
  type SchedulerEventRecord,
  type SchedulerInstanceRecord,
  type SchedulerOperationRecord,
  type TaskDisabledRecord,
  type TaskStateRecord,
} from '@packages/scheduler/index.js';
import { counterOf, mergedOf, meanOf, percentileOf, round } from '@modules/performance/index.js';
import {
  SchedulerMetricsService,
  schMetric,
  type MetricWindow,
} from './scheduler-metrics.service.js';
import { SchedulerMonitorService } from './scheduler-monitor.service.js';
import {
  SchedulerOperationsService,
  type SchedulerOperationContext,
} from './scheduler-operations.service.js';
import {
  RULE_TAB,
  longRunningThreshold,
  ruleOf,
  type SchedulerRule,
  type StoredSchedulerAlert,
} from './scheduler-rules.js';
import {
  DAY,
  HOUR,
  MINUTE,
  iso,
  liveness,
  overdueSec,
  readSchedulerHeartbeat,
  startOfDay,
} from './scheduler-utils.js';
import {
  SchedulerNotFoundException,
  SchedulerUnavailableException,
} from '../exceptions/scheduler-ops.exceptions.js';
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
  SchedulerEventDto,
  SchedulerHealthDto,
  SchedulerInstanceDto,
  SchedulerMetric,
  SchedulerMetricsDto,
  SchedulerOperationDto,
  SchedulerOverviewDto,
  SchedulerRange,
  SchedulerSeriesDto,
  SchedulerSettingsDto,
  SchedulerStatus,
  TaskDetailDto,
  TaskDisplayStatus,
  TaskHealth,
  TaskRowDto,
  TasksListDto,
  TimelineDto,
  TimezoneDto,
  TriggeredJobDto,
  UpcomingDto,
  UpcomingListDto,
} from '../responses/scheduler-ops.response.js';

export const SCHEDULER_RANGES: Record<SchedulerRange, number> = {
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10_080,
};
export const SCHEDULER_METRICS: SchedulerMetric[] = [
  'executions',
  'duration',
  'failures',
  'missed',
];

const MAX_POINTS = 120;
const OVERVIEW_UPCOMING = 8;
const OVERVIEW_RECENT = 10;
const OVERVIEW_EVENTS = 8;
const TASK_RECENT = 20;
/** Số lần chạy gần nhất dùng tính KPI / biểu đồ thời lượng của một task. */
const TASK_SAMPLE = 500;
const DURATION_POINTS = 100;
const UPCOMING_MAX = 300;
const TIMELINE_MAX = 3000;
const FAILURES_MAX = 300;
/** Task chạy dày hơn chừng này mỗi ngày trải đều tải — không tính vào cảnh báo dồn lịch. */
const CONCENTRATION_MAX_DAILY_RUNS = 96;
const CONCENTRATION_WINDOW_MS = 5 * MINUTE;

type Group = { t: number; b: MetricBucket[]; seconds: number };
type SeriesDef = { id: string; unit: string; value: (g: Group) => number | null };

/** Dữ liệu dùng chung của một lượt đọc. */
interface Ctx {
  now: number;
  tasks: Map<string, ScheduledTaskMeta>;
  states: Map<string, TaskStateRecord>;
  disabled: Map<string, TaskDisabledRecord>;
  instances: Map<string, SchedulerInstanceRecord>;
  running: ExecutionRecord[];
  alerts: Map<string, StoredSchedulerAlert>;
  live: ReturnType<typeof liveness>;
  /** Ngưỡng "chạy lâu bất thường" theo task. */
  longRunning: Map<string, { ms: number; source: 'configured' | 'baseline' | null }>;
}

const pct = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);

/**
 * Scheduler: khi nào công việc phải được kích hoạt — task nào đang bật, lần chạy gần nhất có thành công không,
 * lần kế tiếp khi nào, task nào chạy lâu / bị lỡ / chạy chồng / lỗi liên tục; lịch sử từng lần chạy và job nó tạo ra
 * (nối sang Worker & Queue). Không có số liệu giả: scheduler chưa chạy → nói rõ, không có task mẫu.
 */
@Injectable()
export class SchedulerOpsService {
  constructor(
    private readonly store: SchedulerStore,
    private readonly metrics: SchedulerMetricsService,
    private readonly monitor: SchedulerMonitorService,
    private readonly operations: SchedulerOperationsService,
    private readonly queues: QueueMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.scheduler;
  }

  private settings(): SchedulerSettingsDto {
    return { run: this.cfg.run, toggle: this.cfg.toggle };
  }

  private assertStore(): void {
    if (!this.store.isAvailable()) throw new SchedulerUnavailableException('STORE_UNAVAILABLE');
  }

  private async context(now = Date.now()): Promise<Ctx> {
    if (!this.store.isAvailable()) {
      return {
        now,
        tasks: new Map(),
        states: new Map(),
        disabled: new Map(),
        instances: new Map(),
        running: [],
        alerts: new Map(),
        live: liveness(new Map(), now, this.cfg.rules.heartbeatTimeoutSec),
        longRunning: new Map(),
      };
    }
    const [tasks, states, disabled, instances, running, alerts] = await Promise.all([
      this.store.tasks(),
      this.store.states(),
      this.store.disabled(),
      this.store.instances(),
      this.store.running(),
      this.monitor.activeAlerts().catch(() => new Map<string, StoredSchedulerAlert>()),
    ]);
    const baselines = await this.monitor.baselines([...tasks.keys()], now).catch(() => new Map());
    const longRunning = new Map(
      [...tasks.values()].map((m) => [
        m.id,
        longRunningThreshold(
          m.expectedDurationMs,
          baselines.get(m.id) ?? null,
          m.lockTtlMs,
          this.cfg.rules,
        ),
      ]),
    );
    const live = liveness(instances, now, this.cfg.rules.heartbeatTimeoutSec);
    return { now, tasks, states, disabled, instances, running, alerts, live, longRunning };
  }

  private rangeWindow(range: SchedulerRange, now: number) {
    return this.metrics.window(now - SCHEDULER_RANGES[range] * MINUTE, now, now);
  }

  // ─── Mô tả lịch ───────────────────────────────────────────────────────────

  private formatDate(at: number, tz: string): string {
    const locale = this.i18n.getCurrentLocale() === 'vi' ? 'vi-VN' : 'en-GB';
    return new Intl.DateTimeFormat(locale, {
      timeZone: isValidTimezone(tz) ? tz : 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(at);
  }

  private describe(
    spec: Pick<ScheduledTaskMeta, 'type' | 'cron' | 'intervalMs' | 'runAt' | 'timezone'>,
  ) {
    const d = describeSchedule(spec);
    const params: Record<string, string | number> = { ...d.params };
    if (d.days) params['days'] = d.days.map((x) => this.i18n.t(`scheduler.day.${x}`)).join(', ');
    if (d.key === 'yearly') params['month'] = this.i18n.t(`scheduler.month.${d.params['month']}`);
    if (d.key === 'once') params['at'] = this.formatDate(Number(d.params['at']), spec.timezone);
    return this.i18n.t(`scheduler.schedule.${d.key}`, params);
  }

  private schedule(m: ScheduledTaskMeta): ScheduleDto {
    return {
      type: m.type,
      expression: m.cron,
      intervalMs: m.intervalMs,
      runAt: iso(m.runAt),
      timezone: m.timezone,
      utcOffset: utcOffsetLabel(m.timezone),
      description: this.describe(m),
    };
  }

  // ─── Dòng task / lần chạy ─────────────────────────────────────────────────

  private taskAlerts(ctx: Ctx, taskId: string) {
    return [...ctx.alerts.entries()].filter(([, a]) => a.extra['task'] === taskId);
  }

  private isActive(ctx: Ctx, m: ScheduledTaskMeta): boolean {
    const s = ctx.states.get(m.id);
    return !ctx.disabled.has(m.id) && !m.error && !(m.type === 'one_time' && s?.completed);
  }

  /** Lần chạy kế tiếp: runtime đã lên lịch; runtime không chạy → tính theo lịch (để biết lẽ ra sẽ chạy khi nào). */
  private nextRunOf(ctx: Ctx, m: ScheduledTaskMeta): number | null {
    if (!this.isActive(ctx, m) || ctx.live.paused) return null;
    const stored = ctx.states.get(m.id)?.nextRunAt ?? null;
    if (stored !== null && ctx.live.alive.length > 0) return stored;
    return nextRun(m, ctx.now);
  }

  private taskRow(ctx: Ctx, m: ScheduledTaskMeta, day: MetricWindow | null): TaskRowDto {
    const s = ctx.states.get(m.id);
    const off = ctx.disabled.get(m.id);
    const running = ctx.running.filter((r) => r.taskId === m.id).length;
    const failures = s?.consecutiveFailures ?? 0;
    const overdue =
      ctx.live.alive.length > 0 && !ctx.live.paused && !off ? overdueSec(s, ctx.now) : null;
    const status: TaskDisplayStatus = m.error
      ? 'misconfigured'
      : off
        ? 'disabled'
        : running > 0
          ? 'running'
          : failures > 0
            ? 'failing'
            : overdue !== null
              ? 'overdue'
              : m.type === 'one_time' && s?.completed
                ? 'completed'
                : 'enabled';
    const alerts = this.taskAlerts(ctx, m.id);
    const health: TaskHealth =
      m.error ||
      failures >= this.cfg.rules.consecutiveFailuresCrit ||
      alerts.some(([, a]) => a.severity === 'critical')
        ? 'error'
        : failures > 0 || overdue !== null || alerts.some(([, a]) => a.severity === 'warning')
          ? 'warning'
          : 'healthy';
    const ok = this.metrics.count(day, 'ok', m.id);
    const failed = this.metrics.count(day, 'fail', m.id);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      group: m.group,
      type: m.type,
      schedule: this.schedule(m),
      enabled: !off,
      disabledAt: iso(off?.at),
      disabledBy: off ? (off.actor ?? null) : null,
      running,
      status,
      health,
      lastRunAt: iso(s?.lastRunAt),
      lastStatus: s?.lastStatus ?? null,
      lastDurationMs: s?.lastDurationMs ?? null,
      lastError: s?.lastError ?? null,
      lastExecutionId: s?.lastExecutionId ?? null,
      lastSuccessAt: iso(s?.lastSuccessAt),
      nextRunAt: iso(this.nextRunOf(ctx, m)),
      consecutiveFailures: failures,
      executions24h: this.metrics.count(day, 'run', m.id),
      failures24h: failed,
      successRatePercent: pct(ok, ok + failed),
      avgDurationMs: this.metrics.duration(day, m.id).avgMs,
      overlap: m.overlap,
      misfire: m.misfire,
      expectedDurationMs: m.expectedDurationMs,
      downstreamQueue: m.downstreamQueue,
      error: m.error,
    };
  }

  private taskRows(ctx: Ctx, day: MetricWindow | null): TaskRowDto[] {
    const rank: Record<TaskHealth, number> = { error: 0, warning: 1, unknown: 2, healthy: 3 };
    return [...ctx.tasks.values()]
      .map((m) => this.taskRow(ctx, m, day))
      .sort((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name));
  }

  private execution(
    ctx: Pick<Ctx, 'now' | 'tasks' | 'longRunning'>,
    r: ExecutionRecord,
  ): ExecutionDto {
    const runningMs =
      r.status === 'running' && r.startedAt !== null ? Math.max(0, ctx.now - r.startedAt) : null;
    const threshold = ctx.longRunning.get(r.taskId)?.ms ?? null;
    return {
      id: r.id,
      taskId: r.taskId,
      taskName: ctx.tasks.get(r.taskId)?.name ?? r.taskId,
      trigger: r.trigger,
      status: r.status,
      scheduledAt: iso(r.scheduledAt),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      durationMs: r.durationMs,
      runningMs,
      driftMs: r.driftMs,
      instance: r.instance,
      correlationId: r.correlationId,
      error: r.error,
      reason: r.reason,
      missedCount: r.missedCount,
      missedUntil: iso(r.missedUntil),
      jobs: r.jobs,
      actor: r.actor,
      blockedBy: r.blockedBy,
      longRunning: runningMs !== null && threshold !== null && runningMs > threshold,
    };
  }

  private runningDtos(ctx: Ctx, taskId?: string): ExecutionDto[] {
    return ctx.running
      .filter((r) => !taskId || r.taskId === taskId)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
      .map((r) => this.execution(ctx, r));
  }

  // ─── Sức khoẻ / cảnh báo ──────────────────────────────────────────────────

  private fmtMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s >= 10 ? 0 : 1)}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  private alertMessage(
    rule: SchedulerRule,
    p: Record<string, unknown>,
    tasks: Map<string, ScheduledTaskMeta>,
  ) {
    const value = Number(p['value'] ?? 0);
    const threshold = Number(p['threshold'] ?? 0);
    const task = typeof p['task'] === 'string' ? (tasks.get(p['task'])?.name ?? p['task']) : '';
    const names = String(p['tasks'] ?? '')
      .split(', ')
      .filter(Boolean)
      .map((id) => tasks.get(id)?.name ?? id)
      .join(', ');
    return this.i18n.t(`scheduler.alert.${rule}.message`, {
      value: rule === 'HEARTBEAT_MISSING' || rule === 'OVERDUE' ? this.fmtMs(value * 1000) : value,
      threshold,
      duration: this.fmtMs(value),
      expected: this.fmtMs(threshold),
      task,
      tasks: names || '—',
      instances: String(p['instances'] ?? '—'),
      error: String(p['error'] ?? '—'),
      at: typeof p['scheduledAt'] === 'number' ? new Date(p['scheduledAt']).toISOString() : '',
    });
  }

  private alertDtos(ctx: Ctx): SchedulerAlertDto[] {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...ctx.alerts.entries()]
      .map(([id, s]) => {
        const rule = ruleOf(id);
        const taskId = typeof s.extra['task'] === 'string' ? s.extra['task'] : null;
        return {
          id,
          rule,
          severity: s.severity,
          title: this.i18n.t(`scheduler.alert.${rule}.title`),
          message: this.alertMessage(
            rule,
            { ...s.extra, value: s.value, threshold: s.threshold },
            ctx.tasks,
          ),
          value: s.value,
          threshold: s.threshold,
          unit: s.unit,
          since: new Date(s.since).toISOString(),
          taskId,
          executionId: typeof s.extra['execution'] === 'string' ? s.extra['execution'] : null,
          tab: RULE_TAB[rule] ?? 'overview',
        };
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private health(ctx: Ctx, alerts: SchedulerAlertDto[]): SchedulerHealthDto {
    const base = {
      lastHeartbeatAt: iso(ctx.live.lastAt),
      heartbeatAgeSec: ctx.live.ageSec,
      aliveInstances: ctx.live.alive.length,
    };
    const reason = (code: string, params: Record<string, string | number> = {}) => ({
      code,
      message: this.i18n.t(`scheduler.health.${code}`, params),
      taskId: null,
    });
    if (!this.store.isAvailable())
      return { ...base, status: 'unknown', reasons: [reason('storeUnavailable')] };
    if (ctx.live.alive.length === 0) {
      return {
        ...base,
        status: 'down',
        reasons: [
          ctx.live.lastAt === null
            ? reason('neverStarted')
            : reason('noHeartbeat', { age: this.fmtMs((ctx.live.ageSec ?? 0) * 1000) }),
        ],
      };
    }
    const problems = alerts.filter((a) => a.severity !== 'info');
    const reasons = problems.map((a) => ({
      code: a.rule,
      message: `${a.title}: ${a.message}`,
      taskId: a.taskId,
    }));
    let status: SchedulerStatus = problems.length ? 'degraded' : 'healthy';
    if (ctx.live.paused) {
      status = 'paused';
      reasons.unshift(reason('paused'));
    }
    return { ...base, status, reasons };
  }

  private instanceDtos(ctx: Ctx): SchedulerInstanceDto[] {
    const timeout = this.cfg.rules.heartbeatTimeoutSec;
    return ctx.live.all
      .map((i) => ({
        instance: i.instance,
        host: i.host,
        pid: i.pid,
        startedAt: new Date(i.startedAt).toISOString(),
        lastSeenAt: new Date(i.at).toISOString(),
        heartbeatAgeSec: Math.max(0, Math.round((ctx.now - i.at) / 1000)),
        uptimeSec: Math.max(0, Math.round((i.at - i.startedAt) / 1000)),
        alive: ctx.now - i.at <= timeout * 1000,
        paused: i.paused,
        tasks: i.tasks,
        running: i.running,
        timezone: i.timezone,
      }))
      .filter((i) => i.alive || ctx.now - Date.parse(i.lastSeenAt) < DAY)
      .sort((a, b) => Number(b.alive) - Number(a.alive) || a.instance.localeCompare(b.instance));
  }

  private async timezone(): Promise<TimezoneDto> {
    const hb = await readSchedulerHeartbeat(this.redis);
    const runtimeTz = hb?.descriptor.details?.['timezone'];
    return {
      schedule: this.cfg.timezone,
      scheduleOffset: utcOffsetLabel(this.cfg.timezone),
      runtime: typeof runtimeTz === 'string' ? runtimeTz : null,
      dst: hasDst(this.cfg.timezone),
    };
  }

  // ─── Lịch sắp tới ─────────────────────────────────────────────────────────

  /** `perTask`: chỉ lần kế tiếp của mỗi task (Overview) thay vì mọi mốc trong khoảng. */
  private upcoming(
    ctx: Ctx,
    untilMs: number,
    limit: number,
    perTask = false,
  ): { items: UpcomingDto[]; truncated: boolean } {
    if (ctx.live.paused) return { items: [], truncated: false };
    const all: UpcomingDto[] = [];
    for (const m of ctx.tasks.values()) {
      if (!this.isActive(ctx, m)) continue;
      const first = this.nextRunOf(ctx, m);
      if (first === null || first > untilMs) continue;
      const description = this.describe(m);
      for (const at of perTask ? [first] : [first, ...nextRuns(m, first, limit, untilMs)])
        all.push({
          taskId: m.id,
          taskName: m.name,
          at: new Date(at).toISOString(),
          inSec: Math.max(0, Math.round((at - ctx.now) / 1000)),
          expression: m.cron,
          description,
        });
    }
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.taskName.localeCompare(b.taskName));
    return { items: all.slice(0, limit), truncated: all.length > limit };
  }

  /** Cửa sổ 5 phút có nhiều task (không tính task chạy dày) cùng tới hạn trong 24 giờ tới. */
  private concentration(ctx: Ctx): ConcentrationDto[] {
    const windows = new Map<number, Set<string>>();
    const until = ctx.now + DAY;
    for (const m of ctx.tasks.values()) {
      if (!this.isActive(ctx, m)) continue;
      const runs = nextRuns(m, ctx.now, CONCENTRATION_MAX_DAILY_RUNS + 1, until);
      if (runs.length > CONCENTRATION_MAX_DAILY_RUNS) continue;
      for (const at of runs) {
        const w = Math.floor(at / CONCENTRATION_WINDOW_MS) * CONCENTRATION_WINDOW_MS;
        windows.set(w, (windows.get(w) ?? new Set()).add(m.name));
      }
    }
    return [...windows.entries()]
      .filter(([, t]) => t.size >= this.cfg.rules.concentrationTasks)
      .sort((a, b) => b[1].size - a[1].size || a[0] - b[0])
      .slice(0, 5)
      .map(([w, t]) => ({
        from: new Date(w).toISOString(),
        to: new Date(w + CONCENTRATION_WINDOW_MS).toISOString(),
        count: t.size,
        tasks: [...t].sort(),
      }));
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: SchedulerRange): Promise<SchedulerOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [ctx, win, dayWin, todayWin, yesterdayWin, driftWin, recent, events, timezone, hb] =
      await Promise.all([
        this.context(now),
        this.rangeWindow(range, now),
        this.metrics.window(now - DAY, now, now),
        this.metrics.window(today, now, now),
        this.metrics.window(today - DAY, today, now),
        this.metrics.window(now - HOUR, now, now),
        this.store.isAvailable()
          ? this.store.executions({ from: 0, to: now, limit: OVERVIEW_RECENT }).catch(() => null)
          : Promise.resolve(null),
        this.eventsSince(now - DAY, null),
        this.timezone(),
        readSchedulerHeartbeat(this.redis),
      ]);
    const tasks = this.taskRows(ctx, dayWin);
    const alerts = this.alertDtos(ctx);
    const next = tasks
      .filter((t) => t.nextRunAt)
      .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))[0];
    const todayReport = this.metrics.report(todayWin);
    const duration = this.metrics.duration(win);
    return {
      generatedAt: new Date(now).toISOString(),
      range,
      environment: this.config.app.env,
      timezone,
      health: this.health(ctx, alerts),
      kpis: {
        registered: tasks.length,
        enabled: tasks.filter((t) => t.enabled).length,
        disabled: tasks.filter((t) => !t.enabled).length,
        running: ctx.running.length,
        failedToday: todayReport.failed,
        executionsToday: todayReport.executions,
        successRatePercent: todayReport.successRatePercent,
        avgDurationMs: duration.avgMs,
        p95DurationMs: duration.p95Ms,
        missedToday: todayReport.missed,
        skippedToday: todayReport.skipped,
        nextExecutionAt: next?.nextRunAt ?? null,
        nextExecutionTask: next?.id ?? null,
      },
      drift: (({ avgMs, p95Ms }) => ({ avgMs, p95Ms }))(this.metrics.drift(driftWin)),
      runtime: {
        instances: this.instanceDtos(ctx),
        strategy: 'distributed_lock',
        lockProvider: 'Redis',
        runtimeState: hb?.state ?? null,
        uptimeSec: hb?.uptimeSec ?? null,
      },
      alerts,
      upcoming: this.upcoming(ctx, now + DAY, OVERVIEW_UPCOMING, true).items,
      concentration: this.concentration(ctx),
      tasks,
      running: this.runningDtos(ctx),
      recent: (recent?.items ?? []).map((r) => this.execution(ctx, r)),
      events: events.slice(0, OVERVIEW_EVENTS),
      report: { today: todayReport, yesterday: this.metrics.report(yesterdayWin) },
      settings: this.settings(),
    };
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────

  public async getTasks(): Promise<TasksListDto> {
    const now = Date.now();
    const [ctx, dayWin] = await Promise.all([
      this.context(now),
      this.metrics.window(now - DAY, now, now),
    ]);
    return { tasks: this.taskRows(ctx, dayWin), settings: this.settings() };
  }

  private requireTask(ctx: Ctx, id: string): ScheduledTaskMeta {
    this.assertStore();
    const m = ctx.tasks.get(id);
    if (!m) throw new SchedulerNotFoundException('scheduler.error.taskNotFound', { id });
    return m;
  }

  private async downstream(queue: string | null): Promise<DownstreamDto | null> {
    if (!queue) return null;
    const section = await this.queues.section(null, () => this.queues.queues());
    if (!section.available)
      return { queue, state: null, reason: this.i18n.t(`scheduler.downstream.${section.reason}`) };
    const q = section.data.find((x) => x.name === queue);
    if (!q) return { queue, state: null, reason: this.i18n.t('scheduler.downstream.notFound') };
    return {
      queue,
      state: {
        waiting: q.counts.waiting + q.counts.prioritized,
        active: q.counts.active,
        delayed: q.counts.delayed,
        failed: q.counts.failed,
        paused: q.paused,
        workers: q.workers?.length ?? null,
      },
      reason: null,
    };
  }

  public async getTask(id: string, range: SchedulerRange): Promise<TaskDetailDto> {
    const now = Date.now();
    const ctx = await this.context(now);
    const m = this.requireTask(ctx, id);
    const from = now - SCHEDULER_RANGES[range] * MINUTE;
    const [dayWin, sample, todayCount, events, downstream, lockValue] = await Promise.all([
      this.metrics.window(now - DAY, now, now),
      this.store.executions({ from, to: now, limit: TASK_SAMPLE, taskId: id }),
      this.store.executions({
        from: startOfDay(now),
        to: now,
        limit: TASK_SAMPLE,
        taskId: id,
        filter: (r) => r.status === 'failed',
      }),
      this.eventsSince(now - 7 * DAY, id),
      this.downstream(m.downstreamQueue),
      this.store.client.get(this.store.keys.lock(id)),
    ]);
    const items = sample.items;
    const count = (s: ExecutionStatus) => items.filter((r) => r.status === s).length;
    const done = items.filter(
      (r) => r.durationMs !== null && (r.status === 'success' || r.status === 'failed'),
    );
    const durations = done.map((r) => r.durationMs!).sort((a, b) => a - b);
    const p95 = durations.length
      ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)]!
      : null;
    const s = ctx.states.get(id);
    const successful = count('success');
    const failed = count('failed');
    const firstFail =
      s && s.consecutiveFailures > 0
        ? items
            .filter((r) => r.status === 'failed' && (r.startedAt ?? 0) > (s.lastSuccessAt ?? 0))
            .at(-1)
        : undefined;
    const [lockExec, lockInstance] = lockValue ? lockValue.split('|') : [];
    const threshold = ctx.longRunning.get(id) ?? { ms: m.lockTtlMs, source: null };
    return {
      task: this.taskRow(ctx, m, dayWin),
      className: m.className,
      sourcePath: m.sourcePath,
      registeredAt: new Date(m.registeredAt).toISOString(),
      lockTtlMs: m.lockTtlMs,
      kpis: {
        executions: successful + failed,
        successful,
        failed,
        skipped: count('skipped'),
        missed: items
          .filter((r) => r.status === 'missed')
          .reduce((sum, r) => sum + (r.missedCount ?? 1), 0),
        successRatePercent: pct(successful, successful + failed),
        avgDurationMs: durations.length
          ? round(durations.reduce((a, b) => a + b, 0) / durations.length, 1)
          : null,
        p95DurationMs: p95,
        failuresToday: todayCount.items.length,
        sampled: items.length,
      },
      consecutive:
        s && s.consecutiveFailures > 0
          ? {
              count: s.consecutiveFailures,
              firstFailedAt: iso(firstFail?.startedAt ?? s.lastFailureAt),
              lastSuccessAt: iso(s.lastSuccessAt),
            }
          : null,
      expected: {
        durationMs: threshold.source ? threshold.ms : m.expectedDurationMs,
        source: threshold.source,
      },
      running: this.runningDtos(ctx, id),
      next: this.isActive(ctx, m)
        ? (() => {
            const first = this.nextRunOf(ctx, m);
            return first === null
              ? []
              : [first, ...nextRuns(m, first, 4)].map((t) => new Date(t).toISOString());
          })()
        : [],
      lock: {
        strategy: m.overlap === 'skip' ? 'distributed_lock' : 'none',
        provider: m.overlap === 'skip' ? 'Redis' : null,
        ttlMs: m.lockTtlMs,
        owner: lockExec ? { executionId: lockExec, instance: lockInstance ?? '' } : null,
      },
      downstream,
      durations: done
        .slice(0, DURATION_POINTS)
        .reverse()
        .map((r) => ({ t: r.startedAt!, durationMs: r.durationMs!, status: r.status })),
      recent: items.slice(0, TASK_RECENT).map((r) => this.execution(ctx, r)),
      alerts: this.alertDtos(ctx).filter((a) => a.taskId === id),
      events: events.slice(0, 20),
      settings: this.settings(),
    };
  }

  // ─── Lịch sử thực thi ─────────────────────────────────────────────────────

  public async getExecutions(q: {
    range: SchedulerRange;
    taskId: string | null;
    status: ExecutionStatus[] | null;
    trigger: ExecutionTrigger[] | null;
    limit: number;
  }): Promise<ExecutionsListDto> {
    this.assertStore();
    const ctx = await this.context();
    if (q.taskId) this.requireTask(ctx, q.taskId);
    const statuses = q.status ? new Set(q.status) : null;
    const triggers = q.trigger ? new Set(q.trigger) : null;
    const problemsOnly =
      statuses !== null && [...statuses].every((s) => s === 'failed' || s === 'missed');
    const res = await this.store.executions({
      from: ctx.now - SCHEDULER_RANGES[q.range] * MINUTE,
      to: ctx.now,
      limit: q.limit,
      taskId: q.taskId,
      problemsOnly,
      ...(statuses || triggers
        ? {
            filter: (r: ExecutionRecord) =>
              (!statuses || statuses.has(r.status)) && (!triggers || triggers.has(r.trigger)),
          }
        : {}),
    });
    return { items: res.items.map((r) => this.execution(ctx, r)), truncated: res.truncated };
  }

  public async getExecution(id: string): Promise<ExecutionDetailDto> {
    this.assertStore();
    const ctx = await this.context();
    const r = await this.store.execution(id);
    if (!r) throw new SchedulerNotFoundException('scheduler.error.executionNotFound', { id });
    const meta = ctx.tasks.get(r.taskId);
    const [dayWin, blocking, jobs, downstream] = await Promise.all([
      meta ? this.metrics.window(ctx.now - DAY, ctx.now, ctx.now) : Promise.resolve(null),
      r.blockedBy ? this.store.execution(r.blockedBy) : Promise.resolve(null),
      this.jobs(r),
      this.downstream(meta?.downstreamQueue ?? r.jobs[0]?.queue ?? null),
    ]);
    return {
      execution: this.execution(ctx, r),
      task: meta ? this.taskRow(ctx, meta, dayWin) : null,
      jobs: jobs.items,
      jobsReason: jobs.reason,
      downstream,
      blocking: blocking ? this.execution(ctx, blocking) : null,
      settings: this.settings(),
    };
  }

  /** Trạng thái hiện tại của job do lần chạy tạo ra (đọc từ broker). */
  private async jobs(
    r: ExecutionRecord,
  ): Promise<{ items: TriggeredJobDto[]; reason: string | null }> {
    const blank = (j: (typeof r.jobs)[number]): TriggeredJobDto => ({
      ...j,
      status: null,
      attempts: null,
      finishedAt: null,
      error: null,
    });
    if (r.jobs.length === 0) return { items: [], reason: null };
    if (!this.messaging.usable())
      return { items: r.jobs.map(blank), reason: this.i18n.t('scheduler.downstream.disconnected') };
    const items = await Promise.all(
      r.jobs.map(async (j) => {
        const m = await this.messaging.provider.message(j.id, j.queue).catch(() => null);
        return m
          ? {
              ...j,
              status: m.status,
              attempts: m.attempts,
              finishedAt: iso(m.finishedAt),
              error: m.error,
            }
          : blank(j);
      }),
    );
    return { items, reason: null };
  }

  // ─── Upcoming / Timeline ──────────────────────────────────────────────────

  public async getUpcoming(hours: number): Promise<UpcomingListDto> {
    const ctx = await this.context();
    const res = this.upcoming(ctx, ctx.now + hours * HOUR, UPCOMING_MAX);
    return {
      hours,
      items: res.items,
      truncated: res.truncated,
      concentration: this.concentration(ctx),
    };
  }

  public async getTimeline(range: SchedulerRange): Promise<TimelineDto> {
    this.assertStore();
    const ctx = await this.context();
    const span = SCHEDULER_RANGES[range] * MINUTE;
    const from = ctx.now - span;
    const res = await this.store.executions({ from, to: ctx.now, limit: TIMELINE_MAX });
    const lanes = new Map<string, ExecutionDto[]>();
    for (const m of ctx.tasks.values()) lanes.set(m.id, []);
    for (const r of [
      ...res.items,
      ...ctx.running.filter((x) => !res.items.some((y) => y.id === x.id)),
    ])
      lanes.set(r.taskId, [...(lanes.get(r.taskId) ?? []), this.execution(ctx, r)]);
    return {
      range,
      from: new Date(from).toISOString(),
      to: new Date(ctx.now).toISOString(),
      lanes: [...lanes.entries()]
        .map(([taskId, executions]) => ({
          taskId,
          taskName: ctx.tasks.get(taskId)?.name ?? taskId,
          executions: executions.sort(
            (a, b) =>
              Date.parse(a.startedAt ?? a.scheduledAt ?? '') -
              Date.parse(b.startedAt ?? b.scheduledAt ?? ''),
          ),
        }))
        .sort((a, b) => a.taskName.localeCompare(b.taskName)),
      upcoming: this.upcoming(ctx, ctx.now + Math.max(HOUR, span / 6), UPCOMING_MAX).items,
      truncated: res.truncated,
    };
  }

  // ─── Failures ─────────────────────────────────────────────────────────────

  public async getFailures(range: SchedulerRange): Promise<FailuresDto> {
    this.assertStore();
    const ctx = await this.context();
    const res = await this.store.executions({
      from: ctx.now - SCHEDULER_RANGES[range] * MINUTE,
      to: ctx.now,
      limit: FAILURES_MAX,
      problemsOnly: true,
    });
    const byType = new Map<string, FailuresDto['byType'][number]>();
    const byTask = new Map<string, FailuresDto['byTask'][number]>();
    for (const r of res.items) {
      const type = r.status === 'missed' ? 'MissedSchedule' : (r.error?.type ?? 'Unknown');
      const at = new Date(r.startedAt ?? r.scheduledAt ?? r.finishedAt ?? ctx.now).toISOString();
      const name = ctx.tasks.get(r.taskId)?.name ?? r.taskId;
      const t = byType.get(type);
      if (!t)
        byType.set(type, { type, count: 1, tasks: [name], lastAt: at, sampleExecutionId: r.id });
      else {
        t.count++;
        if (!t.tasks.includes(name)) t.tasks.push(name);
      }
      const k = byTask.get(r.taskId) ?? {
        taskId: r.taskId,
        taskName: name,
        failed: 0,
        missed: 0,
        consecutive: ctx.states.get(r.taskId)?.consecutiveFailures ?? 0,
      };
      if (r.status === 'missed') k.missed += r.missedCount ?? 1;
      else k.failed++;
      byTask.set(r.taskId, k);
    }
    return {
      range,
      failed: res.items.filter((r) => r.status === 'failed').length,
      missed: res.items
        .filter((r) => r.status === 'missed')
        .reduce((s, r) => s + (r.missedCount ?? 1), 0),
      byType: [...byType.values()].sort((a, b) => b.count - a.count),
      byTask: [...byTask.values()].sort(
        (a, b) => b.consecutive - a.consecutive || b.failed - a.failed,
      ),
      items: res.items.map((r) => this.execution(ctx, r)),
      truncated: res.truncated,
      alerts: this.alertDtos(ctx).filter((a) =>
        [
          'CONSECUTIVE_FAILURES',
          'RECENT_FAILURES',
          'MISSED_RUN',
          'LOCK_UNAVAILABLE',
          'DUPLICATE_EXECUTION',
        ].includes(a.rule),
      ),
    };
  }

  // ─── Events / Operations / Config ─────────────────────────────────────────

  public async getEvents(
    range: SchedulerRange,
    taskId: string | null,
  ): Promise<SchedulerEventDto[]> {
    return this.eventsSince(Date.now() - SCHEDULER_RANGES[range] * MINUTE, taskId);
  }

  private async eventsSince(from: number, taskId: string | null): Promise<SchedulerEventDto[]> {
    if (!this.store.isAvailable()) return [];
    const [records, tasks] = await Promise.all([
      this.store.events().catch(() => [] as SchedulerEventRecord[]),
      this.store.tasks().catch(() => new Map<string, ScheduledTaskMeta>()),
    ]);
    return records
      .filter((e) => e.at >= from && (!taskId || e.taskId === taskId))
      .map((e) => this.eventDto(e, tasks));
  }

  private eventDto(
    e: SchedulerEventRecord,
    tasks: Map<string, ScheduledTaskMeta>,
  ): SchedulerEventDto {
    const alertId = typeof e.params['rule'] === 'string' ? e.params['rule'] : null;
    const rule = alertId ? ruleOf(alertId) : null;
    const task = e.taskId ? (tasks.get(e.taskId)?.name ?? e.taskId) : '';
    const title = rule ? this.i18n.t(`scheduler.alert.${rule}.title`) : '';
    const fmt = (v: unknown) =>
      typeof v === 'number' ? new Date(v).toISOString() : String(v ?? '');
    const message =
      (e.type === 'alert_started' || e.type === 'duplicate_execution') && rule
        ? `${title}: ${this.alertMessage(rule, e.params, tasks)}`
        : this.i18n.t(`scheduler.event.${e.type}`, {
            ...e.params,
            task,
            alert: task && title ? `${title} (${task})` : title,
            actor: String(e.params['actor'] ?? this.i18n.t('scheduler.event.anonymous')),
            reason: e.params['reason'] ? this.i18n.t(`scheduler.reason.${e.params['reason']}`) : '',
            from: fmt(e.params['from']),
            until: fmt(e.params['until']),
            policy: e.params['policy']
              ? this.i18n.t(`scheduler.misfire.${e.params['policy']}`)
              : '',
          });
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      taskId: e.taskId,
      executionId: e.executionId,
    };
  }

  public async getOperations(): Promise<SchedulerOperationDto[]> {
    if (!this.store.isAvailable()) return [];
    const ops = await this.store.operations().catch(() => [] as SchedulerOperationRecord[]);
    return ops.map((o) => this.operationDto(o));
  }

  private operationDto(o: SchedulerOperationRecord): SchedulerOperationDto {
    return { ...o, at: new Date(o.at).toISOString() };
  }

  public async getConfig(): Promise<SchedulerConfigDto> {
    const ctx = await this.context();
    const [tz] = await Promise.all([this.timezone()]);
    const c = this.cfg;
    const r = c.rules;
    return {
      items: [
        { group: 'provider', key: 'engine', value: 'Core Scheduler' },
        { group: 'provider', key: 'library', value: withVersion('cron', 'cron') },
        { group: 'provider', key: 'store', value: 'Redis' },
        {
          group: 'timezone',
          key: 'scheduleTimezone',
          value: `${tz.schedule} (${tz.scheduleOffset})`,
        },
        { group: 'timezone', key: 'runtimeTimezone', value: tz.runtime },
        { group: 'timezone', key: 'dst', value: tz.dst },
        { group: 'execution', key: 'instances', value: ctx.live.alive.length },
        { group: 'execution', key: 'strategy', value: 'distributed_lock' },
        { group: 'execution', key: 'lockProvider', value: 'Redis' },
        { group: 'execution', key: 'lockTtlMs', value: c.lockTtlMs },
        { group: 'execution', key: 'defaultOverlap', value: 'skip' },
        { group: 'execution', key: 'defaultMisfire', value: 'run_once' },
        { group: 'history', key: 'retentionDays', value: c.historyRetentionDays },
        { group: 'history', key: 'maxPerTask', value: c.historyMaxPerTask },
        {
          group: 'history',
          key: 'metricsRetentionDays',
          value: Math.round(TELEMETRY_TIERS.h1.ttlSec / 86400),
        },
        { group: 'thresholds', key: 'heartbeatTimeoutSec', value: r.heartbeatTimeoutSec },
        { group: 'thresholds', key: 'consecutiveFailuresWarn', value: r.consecutiveFailuresWarn },
        { group: 'thresholds', key: 'consecutiveFailuresCrit', value: r.consecutiveFailuresCrit },
        { group: 'thresholds', key: 'recentFailuresWarn', value: r.recentFailuresWarn },
        { group: 'thresholds', key: 'longRunningFactor', value: r.longRunningFactor },
        { group: 'thresholds', key: 'longRunningMinSec', value: r.longRunningMinSec },
        { group: 'thresholds', key: 'driftP95Ms', value: r.driftP95Ms },
        { group: 'thresholds', key: 'concentrationTasks', value: r.concentrationTasks },
        { group: 'actions', key: 'run', value: c.run },
        { group: 'actions', key: 'toggle', value: c.toggle },
        { group: 'actions', key: 'editSchedule', value: false },
      ],
      tasks: [...ctx.tasks.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({
          id: m.id,
          name: m.name,
          items: [
            { key: 'taskId', value: m.id },
            { key: 'className', value: m.className },
            { key: 'type', value: m.type },
            {
              key: 'schedule',
              value: m.cron ?? (m.intervalMs !== null ? `${m.intervalMs}ms` : iso(m.runAt)),
            },
            { key: 'timezone', value: m.timezone },
            { key: 'overlap', value: m.overlap },
            { key: 'misfire', value: m.misfire },
            { key: 'expectedDurationMs', value: m.expectedDurationMs },
            { key: 'lockTtlMs', value: m.lockTtlMs },
            { key: 'downstreamQueue', value: m.downstreamQueue },
            { key: 'sourcePath', value: m.sourcePath },
          ],
        })),
    };
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  private async series(range: SchedulerRange, defs: SeriesDef[]) {
    const now = Date.now();
    const win = await this.rangeWindow(range, now);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const size = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));
    const groups: Group[] = [];
    for (let i = 0; i < buckets.length; i += size) {
      const b = buckets.slice(i, i + size);
      groups.push({
        t: b[0]!.start,
        b,
        seconds: Math.max(1, Math.min(b.length * tierSec, (now - b[0]!.start) / 1000)),
      });
    }
    return {
      resolutionSec: win ? tierSec * size : null,
      series: defs.map((d): SchedulerSeriesDto => ({
        id: d.id,
        label: this.i18n.t(`scheduler.series.${d.id}`),
        unit: d.unit,
        points: groups
          .map((g) => ({ t: g.t, value: d.value(g) }))
          .filter(
            (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
          )
          .map((p) => ({ t: p.t, value: round(p.value, 3) })),
      })),
    };
  }

  public async getMetrics(
    range: SchedulerRange,
    metric: SchedulerMetric,
    taskId: string | null,
  ): Promise<SchedulerMetricsDto> {
    if (taskId) this.requireTask(await this.context(), taskId);
    const key = (kind: string) => schMetric(kind, taskId);
    const perMin = (kind: string) => (g: Group) => counterOf(g.b, key(kind)) / (g.seconds / 60);
    const total = (kind: string) => (g: Group) => counterOf(g.b, key(kind));
    const defs: Record<SchedulerMetric, SeriesDef[]> = {
      executions: [
        { id: 'executions', unit: '/min', value: perMin('run') },
        { id: 'failed', unit: '/min', value: perMin('fail') },
        { id: 'skipped', unit: '/min', value: perMin('skip') },
      ],
      duration: [
        { id: 'durationAvg', unit: 'ms', value: (g) => meanOf(mergedOf(g.b, key('dur'))) },
        {
          id: 'durationP95',
          unit: 'ms',
          value: (g) => percentileOf(mergedOf(g.b, key('dur')), 95),
        },
        ...(taskId
          ? []
          : [
              {
                id: 'driftP95',
                unit: 'ms',
                value: (g: Group) => percentileOf(mergedOf(g.b, 'sch.drift'), 95),
              },
            ]),
      ],
      failures: [
        { id: 'failed', unit: 'runs', value: total('fail') },
        { id: 'successful', unit: 'runs', value: total('ok') },
      ],
      missed: [
        { id: 'missed', unit: 'runs', value: total('miss') },
        { id: 'skipped', unit: 'runs', value: total('skip') },
      ],
    };
    const { series, resolutionSec } = await this.series(range, defs[metric]);
    const first = series[0]?.points ?? [];
    const values = first.map((p) => p.value);
    return {
      metric,
      range,
      taskId,
      resolutionSec,
      unit: series[0]?.unit ?? '',
      series: series.filter((s, i) => i === 0 || s.points.some((p) => p.value > 0)),
      stats: {
        current: values.at(-1) ?? null,
        peak: values.length ? Math.max(...values) : null,
        average: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null,
      },
    };
  }

  // ─── Cron Inspector ───────────────────────────────────────────────────────

  public inspectCron(expression: string, timezone: string | null): CronInspectDto {
    const tz = timezone ?? this.cfg.timezone;
    const spec = {
      type: 'cron' as const,
      cron: expression,
      intervalMs: null,
      runAt: null,
      timezone: tz,
    };
    const error = validateSchedule(spec);
    return {
      expression,
      timezone: tz,
      utcOffset: isValidTimezone(tz) ? utcOffsetLabel(tz) : '',
      valid: error === null,
      error,
      description: error ? null : this.describe(spec),
      next: error ? [] : nextRuns(spec, Date.now(), 5).map((t) => new Date(t).toISOString()),
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public async runNow(taskId: string, ctx: SchedulerOperationContext): Promise<RunNowDto> {
    const r = await this.operations.runNow(taskId, ctx);
    return {
      operation: this.operationDto(r.record),
      executionId: r.executionId,
      instance: r.instance,
    };
  }

  public async enable(taskId: string, ctx: SchedulerOperationContext) {
    return this.operationDto(await this.operations.enable(taskId, ctx));
  }

  public async disable(taskId: string, ctx: SchedulerOperationContext) {
    return this.operationDto(await this.operations.disable(taskId, ctx));
  }
}
