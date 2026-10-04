import { Injectable } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { QueueRegistry } from '@packages/queue/index.js';
import {
  SchedulerOperationsService,
  type SchedulerOperationContext,
} from './scheduler-operations.service.js';
import { type ExecutionStatus, type ExecutionTrigger } from '../contracts/scheduler.types.js';
import { SchedulerNotFoundException } from '../exceptions/scheduler-ops.exceptions.js';
import type {
  CronInspectDto,
  ExecutionDetailDto,
  ExecutionDto,
  ExecutionsListDto,
  FailuresDto,
  RunNowDto,
  SchedulerAlertDto,
  SchedulerConfigDto,
  SchedulerEventDto,
  SchedulerInstanceDto,
  SchedulerMetric,
  SchedulerMetricsDto,
  SchedulerOperationDto,
  SchedulerOverviewDto,
  SchedulerRange,
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

export const SCHEDULER_METRICS = ['executions', 'duration', 'failures', 'missed'] as const;

interface TaskDefinitionJson {
  id: string;
  queue: string;
  name?: string | undefined;
  description?: string | undefined;
  pattern?: string | undefined;
  every?: number | undefined;
  tz?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

@Injectable()
export class SchedulerOpsService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly queueRegistry: QueueRegistry,
    private readonly operations: SchedulerOperationsService,
  ) {}

  private get settings(): SchedulerSettingsDto {
    return {
      run: this.config.scheduler.run,
      toggle: this.config.scheduler.toggle,
    };
  }

  public async getTasks(): Promise<TasksListDto> {
    const disabledSet = new Set<string>();
    if (this.redis.isReady()) {
      const disabled = await this.redis.client.smembers('scheduler:disabled');
      for (const d of disabled) disabledSet.add(d);
    }

    const defsMap = new Map<string, TaskDefinitionJson>();
    if (this.redis.isReady()) {
      const allDefs = await this.redis.client.hgetall('scheduler:definitions');
      for (const [id, raw] of Object.entries(allDefs)) {
        try {
          defsMap.set(id, JSON.parse(raw) as TaskDefinitionJson);
        } catch {
          // ignore corrupted JSON
        }
      }
    }

    // Đọc BullMQ schedulers từ mọi queue đã đăng ký
    const queues = this.queueRegistry.getQueues();
    const liveSchedulers: Array<{
      queueName: string;
      id: string;
      name: string;
      pattern?: string | undefined;
      every?: number | undefined;
      tz?: string | undefined;
      next?: number | undefined;
    }> = [];

    for (const [queueName, queue] of queues.entries()) {
      try {
        const schedulers = await queue.getJobSchedulers();
        for (const s of schedulers) {
          const sId = s.id ?? s.key;
          liveSchedulers.push({
            queueName,
            id: sId,
            name: s.name,
            pattern: s.pattern,
            every: s.every,
            tz: s.tz,
            next: s.next,
          });

          if (!defsMap.has(sId)) {
            defsMap.set(sId, {
              id: sId,
              queue: queueName,
              name: s.name,
              pattern: s.pattern,
              every: s.every,
              tz: s.tz,
            });
          }
        }
      } catch {
        // queue getJobSchedulers failed
      }
    }

    const tasks: TaskRowDto[] = [];
    for (const [id, def] of defsMap.entries()) {
      const isEnabled = !disabledSet.has(id);
      const live = liveSchedulers.find((s) => s.id === id);
      const nextRunAt = live?.next ? new Date(live.next).toISOString() : null;

      const scheduleType = def.pattern ? 'cron' : def.every ? 'interval' : 'one_time';
      const timezone = def.tz ?? this.config.scheduler.timezone;

      tasks.push({
        id,
        name: def.name ?? id,
        description: def.description ?? null,
        group: 'system',
        type: scheduleType,
        schedule: {
          type: scheduleType,
          expression: def.pattern ?? null,
          intervalMs: def.every ?? null,
          runAt: null,
          timezone,
          utcOffset: '+00:00',
          description: def.pattern
            ? `Cron: ${def.pattern}`
            : def.every
              ? `Every ${def.every}ms`
              : 'One time',
        },
        enabled: isEnabled,
        disabledAt: null,
        disabledBy: null,
        running: 0,
        status: isEnabled ? 'enabled' : 'disabled',
        health: 'healthy',
        lastRunAt: null,
        lastStatus: null,
        lastDurationMs: null,
        lastError: null,
        lastExecutionId: null,
        lastSuccessAt: null,
        nextRunAt,
        consecutiveFailures: 0,
        executions24h: 0,
        failures24h: 0,
        successRatePercent: 100,
        avgDurationMs: null,
        overlap: 'skip',
        misfire: 'run_once',
        expectedDurationMs: null,
        downstreamQueue: def.queue ?? null,
        error: null,
      });
    }

    return {
      tasks,
      settings: this.settings,
    };
  }

  public async getOverview(range: SchedulerRange): Promise<SchedulerOverviewDto> {
    const tasksRes = await this.getTasks();
    const tasks = tasksRes.tasks;
    const executionsRes = await this.getExecutions({ range, limit: 20 });
    const upcomingRes = await this.getUpcoming(24);

    const registered = tasks.length;
    const enabled = tasks.filter((t) => t.enabled).length;
    const disabled = tasks.filter((t) => !t.enabled).length;

    const nextUpcoming = upcomingRes.items[0];

    const instances: SchedulerInstanceDto[] = [
      {
        instance: 'scheduler:1',
        host: 'localhost',
        pid: process.pid,
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
        lastSeenAt: new Date().toISOString(),
        heartbeatAgeSec: 0,
        uptimeSec: 3600,
        alive: true,
        paused: false,
        tasks: registered,
        running: 0,
        timezone: this.config.scheduler.timezone,
      },
    ];

    const alerts: SchedulerAlertDto[] = [];

    return {
      generatedAt: new Date().toISOString(),
      range,
      environment: this.config.app.env,
      timezone: {
        schedule: this.config.scheduler.timezone,
        scheduleOffset: '+00:00',
        runtime: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dst: false,
      },
      health: {
        status: 'healthy',
        reasons: [],
        lastHeartbeatAt: new Date().toISOString(),
        heartbeatAgeSec: 0,
        aliveInstances: 1,
      },
      kpis: {
        registered,
        enabled,
        disabled,
        running: 0,
        failedToday: 0,
        executionsToday: executionsRes.items.length,
        successRatePercent: 100,
        avgDurationMs: null,
        p95DurationMs: null,
        missedToday: 0,
        skippedToday: 0,
        nextExecutionAt: nextUpcoming?.at ?? null,
        nextExecutionTask: nextUpcoming?.taskName ?? null,
      },
      drift: { avgMs: 0, p95Ms: 0 },
      runtime: {
        instances,
        strategy: 'distributed_lock',
        lockProvider: 'redis',
        runtimeState: 'running',
        uptimeSec: 3600,
      },
      alerts,
      upcoming: upcomingRes.items.slice(0, 10),
      concentration: upcomingRes.concentration,
      tasks,
      running: [],
      recent: executionsRes.items,
      events: [],
      report: {
        today: {
          executions: executionsRes.items.length,
          successful: executionsRes.items.filter((e) => e.status === 'success').length,
          failed: executionsRes.items.filter((e) => e.status === 'failed').length,
          skipped: 0,
          missed: 0,
          successRatePercent: 100,
          avgDurationMs: null,
          p95DurationMs: null,
          manualRuns: executionsRes.items.filter((e) => e.trigger === 'manual').length,
        },
        yesterday: {
          executions: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
          missed: 0,
          successRatePercent: null,
          avgDurationMs: null,
          p95DurationMs: null,
          manualRuns: 0,
        },
      },
      settings: this.settings,
    };
  }

  public async getMetrics(
    range: SchedulerRange,
    metric: SchedulerMetric,
    task: string | null,
  ): Promise<SchedulerMetricsDto> {
    return {
      metric,
      range,
      taskId: task,
      resolutionSec: 60,
      unit: metric === 'duration' ? 'ms' : 'count',
      series: [
        {
          id: 'series-1',
          label: metric,
          unit: metric === 'duration' ? 'ms' : 'count',
          points: [],
        },
      ],
      stats: { current: 0, peak: 0, average: 0 },
    };
  }

  public async getTask(id: string, range: SchedulerRange): Promise<TaskDetailDto> {
    const tasksRes = await this.getTasks();
    const task = tasksRes.tasks.find((t) => t.id === id);
    if (!task) {
      throw new SchedulerNotFoundException('scheduler.error.taskNotFound', { id });
    }

    const execs = await this.getExecutions({ range, taskId: id, limit: 10 });
    const upcoming = await this.getUpcoming(24);
    const taskUpcoming = upcoming.items.filter((u) => u.taskId === id);

    return {
      task,
      className: task.name,
      sourcePath: null,
      registeredAt: new Date(Date.now() - 3600_000).toISOString(),
      lockTtlMs: 600_000,
      kpis: {
        executions: execs.items.length,
        successful: execs.items.filter((e) => e.status === 'success').length,
        failed: execs.items.filter((e) => e.status === 'failed').length,
        skipped: 0,
        missed: 0,
        successRatePercent: 100,
        avgDurationMs: null,
        p95DurationMs: null,
        failuresToday: 0,
        sampled: execs.items.length,
      },
      consecutive: null,
      expected: { durationMs: null, source: null },
      running: [],
      next: taskUpcoming.slice(0, 5).map((u) => u.at),
      lock: {
        strategy: 'distributed_lock',
        provider: 'redis',
        ttlMs: 600_000,
        owner: null,
      },
      downstream: task.downstreamQueue
        ? {
            queue: task.downstreamQueue,
            state: { waiting: 0, active: 0, delayed: 0, failed: 0, paused: false, workers: 1 },
            reason: null,
          }
        : null,
      durations: [],
      recent: execs.items,
      alerts: [],
      events: [],
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
    const queues = this.queueRegistry.getQueues();
    const items: ExecutionDto[] = [];

    for (const [queueName, queue] of queues.entries()) {
      try {
        const jobs = await queue.getJobs(
          ['completed', 'failed', 'active', 'delayed', 'waiting'],
          0,
          limit,
        );

        for (const j of jobs) {
          if (!j) continue;
          const isAct = await j.isActive();
          const isComp = await j.isCompleted();
          const isFail = await j.isFailed();

          const status: ExecutionStatus = isAct
            ? 'running'
            : isComp
              ? 'success'
              : isFail
                ? 'failed'
                : 'running';

          const triggeredBy = (j.data as Record<string, unknown>)?._triggeredBy;
          const trigger: ExecutionTrigger = triggeredBy === 'manual' ? 'manual' : 'scheduled';

          const exec: ExecutionDto = {
            id: String(j.id),
            taskId: j.name,
            taskName: j.name,
            trigger,
            status,
            scheduledAt: j.timestamp ? new Date(j.timestamp).toISOString() : null,
            startedAt: j.processedOn ? new Date(j.processedOn).toISOString() : null,
            finishedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
            durationMs: j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
            runningMs: null,
            driftMs: null,
            instance: 'worker',
            correlationId: String(j.id),
            error: j.failedReason ? { type: 'JobFailed', message: j.failedReason } : null,
            reason: null,
            missedCount: null,
            missedUntil: null,
            jobs: [{ id: String(j.id), queue: queueName, topic: j.name }],
            actor: null,
            blockedBy: null,
            longRunning: false,
          };

          if (filter.taskId && exec.taskId !== filter.taskId) continue;
          if (filter.status && filter.status.length && !filter.status.includes(exec.status))
            continue;
          if (filter.trigger && filter.trigger.length && !filter.trigger.includes(exec.trigger))
            continue;

          items.push(exec);
        }
      } catch {
        // queue query error
      }
    }

    items.sort((a, b) => {
      const ta = a.scheduledAt ? Date.parse(a.scheduledAt) : 0;
      const tb = b.scheduledAt ? Date.parse(b.scheduledAt) : 0;
      return tb - ta;
    });

    return {
      items: items.slice(0, limit),
      truncated: items.length > limit,
    };
  }

  public async getExecution(id: string): Promise<ExecutionDetailDto> {
    const queues = this.queueRegistry.getQueues();
    for (const [queueName, queue] of queues.entries()) {
      try {
        const j = await queue.getJob(id);
        if (j) {
          const isAct = await j.isActive();
          const isComp = await j.isCompleted();
          const isFail = await j.isFailed();

          const status: ExecutionStatus = isAct
            ? 'running'
            : isComp
              ? 'success'
              : isFail
                ? 'failed'
                : 'running';

          const triggeredBy = (j.data as Record<string, unknown>)?._triggeredBy;
          const trigger: ExecutionTrigger = triggeredBy === 'manual' ? 'manual' : 'scheduled';

          const execution: ExecutionDto = {
            id: String(j.id),
            taskId: j.name,
            taskName: j.name,
            trigger,
            status,
            scheduledAt: j.timestamp ? new Date(j.timestamp).toISOString() : null,
            startedAt: j.processedOn ? new Date(j.processedOn).toISOString() : null,
            finishedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
            durationMs: j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
            runningMs: null,
            driftMs: null,
            instance: 'worker',
            correlationId: String(j.id),
            error: j.failedReason ? { type: 'JobFailed', message: j.failedReason } : null,
            reason: null,
            missedCount: null,
            missedUntil: null,
            jobs: [{ id: String(j.id), queue: queueName, topic: j.name }],
            actor: null,
            blockedBy: null,
            longRunning: false,
          };

          return {
            execution,
            task: null,
            jobs: [
              {
                id: String(j.id),
                queue: queueName,
                topic: j.name,
                status,
                attempts: j.attemptsMade,
                finishedAt: execution.finishedAt,
                error: j.failedReason ?? null,
              },
            ],
            jobsReason: null,
            downstream: {
              queue: queueName,
              state: { waiting: 0, active: 0, delayed: 0, failed: 0, paused: false, workers: 1 },
              reason: null,
            },
            blocking: null,
            settings: this.settings,
          };
        }
      } catch {
        // next queue
      }
    }

    throw new SchedulerNotFoundException('scheduler.error.executionNotFound', { id });
  }

  public async getUpcoming(hours: number): Promise<UpcomingListDto> {
    const tasksRes = await this.getTasks();
    const items: UpcomingDto[] = [];
    const limitDate = Date.now() + hours * 3600_000;

    for (const task of tasksRes.tasks) {
      if (!task.enabled) continue;
      if (task.schedule.expression) {
        try {
          const interval = CronExpressionParser.parse(task.schedule.expression, {
            tz: task.schedule.timezone,
          });
          for (let i = 0; i < 20; i++) {
            const next = interval.next().toDate();
            if (next.getTime() > limitDate) break;
            items.push({
              taskId: task.id,
              taskName: task.name,
              at: next.toISOString(),
              inSec: Math.max(0, Math.round((next.getTime() - Date.now()) / 1000)),
              expression: task.schedule.expression,
              description: task.schedule.description,
            });
          }
        } catch {
          // cron parse error
        }
      } else if (task.nextRunAt) {
        const nextTime = Date.parse(task.nextRunAt);
        if (nextTime <= limitDate) {
          items.push({
            taskId: task.id,
            taskName: task.name,
            at: task.nextRunAt,
            inSec: Math.max(0, Math.round((nextTime - Date.now()) / 1000)),
            expression: null,
            description: task.schedule.description,
          });
        }
      }
    }

    items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return {
      hours,
      items: items.slice(0, 100),
      concentration: [],
      truncated: items.length > 100,
    };
  }

  public async getTimeline(range: SchedulerRange): Promise<TimelineDto> {
    const execs = await this.getExecutions({ range, limit: 100 });
    const upcoming = await this.getUpcoming(6);

    const laneMap = new Map<
      string,
      { taskId: string; taskName: string; executions: ExecutionDto[] }
    >();
    for (const e of execs.items) {
      const existing = laneMap.get(e.taskId) ?? {
        taskId: e.taskId,
        taskName: e.taskName,
        executions: [],
      };
      existing.executions.push(e);
      laneMap.set(e.taskId, existing);
    }

    const lanes = [...laneMap.values()];

    return {
      range,
      from: new Date(Date.now() - (SCHEDULER_RANGES[range] ?? 60) * 60_000).toISOString(),
      to: new Date().toISOString(),
      lanes,
      upcoming: upcoming.items,
      truncated: execs.truncated,
    };
  }

  public async getFailures(range: SchedulerRange): Promise<FailuresDto> {
    const execs = await this.getExecutions({ range, status: ['failed'], limit: 100 });
    return {
      range,
      failed: execs.items.length,
      missed: 0,
      byType: [],
      byTask: [],
      items: execs.items,
      truncated: execs.truncated,
      alerts: [],
    };
  }

  public async getEvents(
    _range: SchedulerRange,
    _task: string | null,
  ): Promise<SchedulerEventDto[]> {
    return [];
  }

  public async getOperations(): Promise<SchedulerOperationDto[]> {
    const ops = await this.operations.getOperations();
    return ops.map((op) => ({
      id: op.id,
      at: new Date(op.at).toISOString(),
      action: op.action,
      target: op.target,
      result: op.result,
      detail: op.detail,
      durationMs: op.durationMs,
      actor: op.actor,
      ip: op.ip,
      error: op.error,
      executionId: op.executionId,
    }));
  }

  public getConfig(): SchedulerConfigDto {
    return {
      items: [
        { group: 'core', key: 'timezone', value: this.config.scheduler.timezone },
        { group: 'core', key: 'runEnabled', value: this.config.scheduler.run },
        { group: 'core', key: 'toggleEnabled', value: this.config.scheduler.toggle },
        {
          group: 'history',
          key: 'historyRetentionDays',
          value: this.config.scheduler.historyRetentionDays,
        },
      ],
      tasks: [],
    };
  }

  public inspectCron(expression: string, timezone?: string | null): CronInspectDto {
    const tz = timezone || this.config.scheduler.timezone;
    try {
      const interval = CronExpressionParser.parse(expression, { tz });
      const next: string[] = [];
      for (let i = 0; i < 5; i++) {
        next.push(interval.next().toDate().toISOString());
      }
      return {
        expression,
        timezone: tz,
        utcOffset: '+00:00',
        valid: true,
        error: null,
        description: `Cron pattern "${expression}" evaluated in ${tz}`,
        next,
      };
    } catch (err: unknown) {
      return {
        expression,
        timezone: tz,
        utcOffset: '+00:00',
        valid: false,
        error: err instanceof Error ? err.message : String(err),
        description: null,
        next: [],
      };
    }
  }

  public async runNow(taskId: string, ctx: SchedulerOperationContext): Promise<RunNowDto> {
    const res = await this.operations.runNow(taskId, ctx);
    return {
      operation: {
        id: res.record.id,
        at: new Date(res.record.at).toISOString(),
        action: res.record.action,
        target: res.record.target,
        result: res.record.result,
        detail: res.record.detail,
        durationMs: res.record.durationMs,
        actor: res.record.actor,
        ip: res.record.ip,
        error: res.record.error,
        executionId: res.record.executionId,
      },
      executionId: res.executionId,
      instance: res.instance,
    };
  }

  public async enable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationDto> {
    const op = await this.operations.enable(taskId, ctx);
    return {
      id: op.id,
      at: new Date(op.at).toISOString(),
      action: op.action,
      target: op.target,
      result: op.result,
      detail: op.detail,
      durationMs: op.durationMs,
      actor: op.actor,
      ip: op.ip,
      error: op.error,
      executionId: op.executionId,
    };
  }

  public async disable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationDto> {
    const op = await this.operations.disable(taskId, ctx);
    return {
      id: op.id,
      at: new Date(op.at).toISOString(),
      action: op.action,
      target: op.target,
      result: op.result,
      detail: op.detail,
      durationMs: op.durationMs,
      actor: op.actor,
      ip: op.ip,
      error: op.error,
      executionId: op.executionId,
    };
  }
}
