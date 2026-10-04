import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { maskIp } from '@packages/traffic/utils/capture.js';
import {
  EXECUTION_STATUSES,
  EXECUTION_TRIGGERS,
  type ExecutionStatus,
  type ExecutionTrigger,
} from '../contracts/scheduler.types.js';
import { SCHEDULER_OPS_ROUTES as R } from '../routes/scheduler-ops.routes.js';
import { SCHEDULER_RANGES, SchedulerOpsService } from '../services/scheduler-ops.service.js';
import type { SchedulerOperationContext } from '../services/scheduler-operations.service.js';
import { SchedulerValidationException } from '../exceptions/scheduler-ops.exceptions.js';
import type { SchedulerMetric, SchedulerRange } from '../responses/scheduler-ops.response.js';

const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const idSchema = z.string().min(1).max(200).refine(printable);
const range = (fallback: SchedulerRange) =>
  z.enum(Object.keys(SCHEDULER_RANGES) as [SchedulerRange, ...SchedulerRange[]]).default(fallback);
const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : null))
    .pipe(
      z
        .array(z.enum(values as [T, ...T[]]))
        .min(1)
        .nullable(),
    );

const rangeSchema = z.object({ range: range('24h') });
const metricsSchema = z.object({
  range: range('24h'),
  metric: z
    .enum(['executions', 'duration', 'failures', 'missed'] as [
      SchedulerMetric,
      ...SchedulerMetric[],
    ])
    .default('executions'),
  task: idSchema.optional(),
});
const executionsSchema = z.object({
  range: range('24h'),
  task: idSchema.optional(),
  status: csv<ExecutionStatus>(EXECUTION_STATUSES),
  trigger: csv<ExecutionTrigger>(EXECUTION_TRIGGERS),
  limit: z.coerce.number().int().min(10).max(500).default(100),
});
const eventsSchema = z.object({ range: range('24h'), task: idSchema.optional() });
const upcomingSchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
const timelineSchema = z.object({ range: range('6h') });
const cronSchema = z.object({
  expression: z.string().trim().min(1).max(120).refine(printable),
  timezone: z.string().trim().min(1).max(64).refine(printable).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchedulerValidationException(result.error.issues);
  return result.data;
}

const context = (req: FastifyRequest): SchedulerOperationContext => ({
  ip: maskIp(req.ip),
  actor: null,
});

/**
 * Scheduler — lịch chạy và vận hành task: tổng quan, task + chi tiết, lịch sử thực thi, lịch sắp tới, timeline,
 * lỗi / lỡ lịch, sự kiện, audit, cấu hình, Cron Inspector; và Run Now / Enable / Disable (bật tắt bằng env, audit).
 */
@Controller(R.PREFIX)
export class SchedulerOpsController {
  constructor(private readonly scheduler: SchedulerOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.scheduler.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric, task } = parse(metricsSchema, q);
    return this.scheduler.getMetrics(range, metric, task ?? null);
  }

  @Public()
  @Get(R.TASKS)
  public tasks() {
    return this.scheduler.getTasks();
  }

  @Public()
  @Get(R.TASK_DETAIL)
  public task(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.scheduler.getTask(parse(idSchema, id), parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.TASK_EXECUTIONS)
  public taskExecutions(@Param('id') id: string, @Query() q: Record<string, string>) {
    const { range, status, trigger, limit } = parse(executionsSchema, q);
    return this.scheduler.getExecutions({
      range,
      taskId: parse(idSchema, id),
      status,
      trigger,
      limit,
    });
  }

  @Public()
  @Get(R.EXECUTIONS)
  public executions(@Query() q: Record<string, string>) {
    const { range, task, status, trigger, limit } = parse(executionsSchema, q);
    return this.scheduler.getExecutions({ range, taskId: task ?? null, status, trigger, limit });
  }

  @Public()
  @Get(R.EXECUTION_DETAIL)
  public execution(@Param('id') id: string) {
    return this.scheduler.getExecution(parse(idSchema, id));
  }

  @Public()
  @Get(R.UPCOMING)
  public upcoming(@Query() q: Record<string, string>) {
    return this.scheduler.getUpcoming(parse(upcomingSchema, q).hours);
  }

  @Public()
  @Get(R.TIMELINE)
  public timeline(@Query() q: Record<string, string>) {
    return this.scheduler.getTimeline(parse(timelineSchema, q).range);
  }

  @Public()
  @Get(R.FAILURES)
  public failures(@Query() q: Record<string, string>) {
    return this.scheduler.getFailures(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    const { range, task } = parse(eventsSchema, q);
    return this.scheduler.getEvents(range, task ?? null);
  }

  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.scheduler.getOperations();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.scheduler.getConfig();
  }

  @Public()
  @Get(R.CRON)
  public cron(@Query() q: Record<string, string>) {
    const { expression, timezone } = parse(cronSchema, q);
    return this.scheduler.inspectCron(expression, timezone ?? null);
  }

  /** Chạy ngay ngoài lịch (trigger = manual); task đang chạy với overlap Prevent → 409. */
  @Public()
  @Post(R.TASK_RUN)
  @HttpCode(HttpStatus.OK)
  public run(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.scheduler.runNow(parse(idSchema, id), context(req));
  }

  @Public()
  @Post(R.TASK_ENABLE)
  @HttpCode(HttpStatus.OK)
  public enable(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.scheduler.enable(parse(idSchema, id), context(req));
  }

  /** Không trigger theo lịch nữa; lần đang chạy (nếu có) không bị huỷ; định nghĩa task giữ nguyên. */
  @Public()
  @Post(R.TASK_DISABLE)
  @HttpCode(HttpStatus.OK)
  public disable(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.scheduler.disable(parse(idSchema, id), context(req));
  }
}
