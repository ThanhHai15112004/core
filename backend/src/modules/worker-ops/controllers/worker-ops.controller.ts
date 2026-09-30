import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { WORKER_OPS_ROUTES as R } from '../routes/worker-ops.routes.js';
import { WORKER_METRICS, WORKER_RANGES, WorkerOpsService } from '../services/worker-ops.service.js';
import { WorkerValidationException } from '../exceptions/worker-ops.exceptions.js';
import type { WorkerMetric, WorkerRange } from '../responses/worker-ops.response.js';

const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export const nameSchema = z.string().min(1).max(256).refine(printable);
export const rangeSchema = z.object({
  range: z.enum(Object.keys(WORKER_RANGES) as [WorkerRange, ...WorkerRange[]]).default('1h'),
});
export const metricsSchema = rangeSchema.extend({
  metric: z.enum(WORKER_METRICS as [WorkerMetric, ...WorkerMetric[]]).default('throughput'),
});
const queueFilter = z.object({ queue: nameSchema.optional() });

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new WorkerValidationException(result.error.issues);
  return result.data;
}

/**
 * Worker & Queue — nhìn theo worker: tổng quan background processing, worker instance, lỗi & retry,
 * job hẹn giờ, sự kiện, audit thao tác, cấu hình. Chỉ đọc.
 */
@Controller(R.PREFIX)
export class WorkerOpsController {
  constructor(private readonly workers: WorkerOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.workers.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric, queue } = parse(metricsSchema.merge(queueFilter), q);
    return this.workers.getMetrics(range, metric, queue ?? null);
  }

  @Public()
  @Get(R.FAILURES)
  public failures(@Query() q: Record<string, string>) {
    const { range, queue } = parse(rangeSchema.merge(queueFilter), q);
    return this.workers.getFailures(range, queue ?? null);
  }

  @Public()
  @Get(R.DELAYED)
  public delayed(@Query() q: Record<string, string>) {
    return this.workers.getDelayed(parse(queueFilter, q).queue ?? null);
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    const { range, queue } = parse(rangeSchema.merge(queueFilter), q);
    return this.workers.getEvents(range, queue ?? null);
  }

  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.workers.getOperations();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.workers.getConfig();
  }

  @Public()
  @Get(R.LIST)
  public list() {
    return this.workers.getWorkers();
  }

  @Public()
  @Get(R.DETAIL)
  public detail(@Param('id') id: string) {
    return this.workers.getWorker(parse(nameSchema, id));
  }
}
