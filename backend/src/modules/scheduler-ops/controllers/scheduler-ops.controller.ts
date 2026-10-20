import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, extractRequestContext, isPrintableString } from '@packages/http/index.js';
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

const idSchema = z.string().min(1).max(200).refine(isPrintableString);
/** Xác định dải thời gian truy vấn theo tham số yêu cầu */
const range = (fallback: SchedulerRange) =>
  z.enum(Object.keys(SCHEDULER_RANGES) as [SchedulerRange, ...SchedulerRange[]]).default(fallback);
/** Định dạng dữ liệu thành chuỗi tệp CSV */
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
    .enum(['executions', 'duration', 'failures'] as [SchedulerMetric, ...SchedulerMetric[]])
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
const upcomingSchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });
const timelineSchema = z.object({ range: range('6h') });
const cronSchema = z.object({
  expression: z.string().trim().min(1).max(120).refine(isPrintableString),
  timezone: z.string().trim().min(1).max(64).refine(isPrintableString).optional(),
});

/** Xác thực và ép kiểu dữ liệu đầu vào theo schema Zod */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchedulerValidationException(result.error.issues);
  return result.data;
}

/** Trích xuất thông tin ngữ cảnh yêu cầu (RequestContext) từ Fastify request */
const context = (req: FastifyRequest): SchedulerOperationContext => extractRequestContext(req);

/**
 * Scheduler — lịch chạy và vận hành task: tổng quan, task + chi tiết, lịch sử thực thi, lịch sắp tới, timeline,
 * lỗi / lỡ lịch, sự kiện, audit, cấu hình, Cron Inspector; và Run Now / Enable / Disable (bật tắt bằng env, audit).
 */
@Controller(R.PREFIX)
export class SchedulerOpsController {
  constructor(private readonly scheduler: SchedulerOpsService) {}

  /** Lấy dữ liệu tổng quan cho trang quản trị vận hành */
  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.scheduler.getOverview(parse(rangeSchema, q).range);
  }

  /** Lấy các chỉ số đo lường hiệu năng và vận hành */
  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric, task } = parse(metricsSchema, q);
    return this.scheduler.getMetrics(range, metric, task ?? null);
  }

  /** Lấy danh sách các scheduled task đã đăng ký */
  @Public()
  @Get(R.TASKS)
  public tasks() {
    return this.scheduler.getTasks();
  }

  /** Lấy thông tin chi tiết một scheduled task theo ID */
  @Public()
  @Get(R.TASK_DETAIL)
  public task(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.scheduler.getTask(parse(idSchema, id), parse(rangeSchema, q).range);
  }

  /** Lấy lịch sử các lần thực thi của scheduled task */
  @Public()
  @Get(R.EXECUTIONS)
  public executions(@Query() q: Record<string, string>) {
    const { range, task, status, trigger, limit } = parse(executionsSchema, q);
    return this.scheduler.getExecutions({ range, taskId: task ?? null, status, trigger, limit });
  }

  /** Lấy chi tiết một lần thực thi của scheduled task */
  @Public()
  @Get(R.EXECUTION_DETAIL)
  public execution(@Param('id') id: string) {
    return this.scheduler.getExecution(parse(idSchema, id));
  }

  /** Lấy danh sách các lần thực thi dự kiến sắp tới */
  @Public()
  @Get(R.UPCOMING)
  public upcoming(@Query() q: Record<string, string>) {
    return this.scheduler.getUpcoming(parse(upcomingSchema, q).hours);
  }

  /** Lấy dữ liệu dòng thời gian thực thi của các tác vụ */
  @Public()
  @Get(R.TIMELINE)
  public timeline(@Query() q: Record<string, string>) {
    return this.scheduler.getTimeline(parse(timelineSchema, q).range);
  }

  /** Lấy danh sách các lần thực thi hoặc job bị thất bại */
  @Public()
  @Get(R.FAILURES)
  public failures(@Query() q: Record<string, string>) {
    return this.scheduler.getFailures(parse(rangeSchema, q).range);
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.scheduler.getOperations();
  }

  /** Lấy thông tin cấu hình hiện tại của dịch vụ */
  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.scheduler.getConfig();
  }

  /** Phân tích cú pháp biểu thức Cron và tính toán các mốc chạy tiếp theo */
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

  /** Kích hoạt một tác vụ hoặc module trong hệ thống */
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
