import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public, extractRequestContext } from '@packages/http/index.js';
import { JOB_STATES, type JobState, type QueueOperationContext } from '@packages/queue/index.js';
import { QUEUE_OPS_ROUTES as R } from '../routes/worker-ops.routes.js';
import { WorkerOpsService } from '../services/worker-ops.service.js';
import { metricsSchema, nameSchema, parse, rangeSchema } from './worker-ops.controller.js';

const jobsSchema = z.object({
  state: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : JOB_STATES))
    .pipe(z.array(z.enum(JOB_STATES as [JobState, ...JobState[]])).min(1)),
  limit: z.coerce.number().int().min(10).max(200).default(50),
});
const retrySchema = z.object({ count: z.coerce.number().int().min(1) });
const drainSchema = z.object({
  confirm: z.literal('DRAIN'),
  includeDelayed: z.boolean().default(false),
});

/** Trích xuất thông tin ngữ cảnh yêu cầu (RequestContext) từ Fastify request */
const context = (req: FastifyRequest): QueueOperationContext => extractRequestContext(req);

/**
 * Worker & Queue — nhìn theo queue: bảng queue, chi tiết, job, lỗi, số đo theo thời gian; và thao tác
 * queue (pause / resume / retry job lỗi / drain) bật tắt bằng env, có xác nhận và audit.
 */
@Controller(R.PREFIX)
export class QueueOpsController {
  constructor(private readonly workers: WorkerOpsService) {}

  /** Lấy danh sách các phần tử theo điều kiện truy vấn */
  @Public()
  @Get(R.LIST)
  public list(@Query() q: Record<string, string>) {
    return this.workers.getQueues(parse(rangeSchema, q).range);
  }

  /** Lấy thông tin chi tiết theo mã định danh */
  @Public()
  @Get(R.DETAIL)
  public detail(@Param('name') name: string, @Query() q: Record<string, string>) {
    return this.workers.getQueue(parse(nameSchema, name), parse(rangeSchema, q).range);
  }

  /** Lấy các chỉ số đo lường hiệu năng và vận hành */
  @Public()
  @Get(R.METRICS)
  public metrics(@Param('name') name: string, @Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.workers.getMetrics(range, metric, parse(nameSchema, name));
  }

  /** Lấy danh sách các job trong hàng đợi */
  @Public()
  @Get(R.JOBS)
  public jobs(@Param('name') name: string, @Query() q: Record<string, string>) {
    const { state, limit } = parse(jobsSchema, q);
    return this.workers.getQueueJobs(parse(nameSchema, name), state, limit);
  }

  /** Lấy danh sách các lần thực thi hoặc job bị thất bại */
  @Public()
  @Get(R.FAILURES)
  public failures(@Param('name') name: string, @Query() q: Record<string, string>) {
    return this.workers.getFailures(parse(rangeSchema, q).range, parse(nameSchema, name));
  }

  /** Tạm dừng tiếp nhận và xử lý các tác vụ mới */
  @Public()
  @Post(R.PAUSE)
  @HttpCode(HttpStatus.OK)
  public pause(@Param('name') name: string, @Req() req: FastifyRequest) {
    return this.workers.pause(parse(nameSchema, name), context(req));
  }

  /** Tiếp tục tiếp nhận và xử lý tác vụ sau khi tạm dừng */
  @Public()
  @Post(R.RESUME)
  @HttpCode(HttpStatus.OK)
  public resume(@Param('name') name: string, @Req() req: FastifyRequest) {
    return this.workers.resume(parse(nameSchema, name), context(req));
  }

  /** Retry tối đa `count` job lỗi (cũ nhất trước); vượt `OPS_QUEUE_RETRY_FAILED_MAX` → từ chối. */
  @Public()
  @Post(R.RETRY_FAILED)
  @HttpCode(HttpStatus.OK)
  public retryFailed(
    @Param('name') name: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const { count } = parse(retrySchema, body ?? {});
    return this.workers.retryFailed(parse(nameSchema, name), count, context(req));
  }

  /** Xoá job đang chờ — phải gõ DRAIN để xác nhận (và bật `OPS_QUEUE_DRAIN_ENABLED`). */
  @Public()
  @Post(R.DRAIN)
  @HttpCode(HttpStatus.OK)
  public drain(@Param('name') name: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { includeDelayed } = parse(drainSchema, body ?? {});
    return this.workers.drain(parse(nameSchema, name), includeDelayed, context(req));
  }
}
