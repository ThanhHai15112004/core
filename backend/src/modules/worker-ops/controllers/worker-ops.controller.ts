import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public, isPrintableString } from '@packages/http/index.js';
import { WORKER_OPS_ROUTES as R } from '../routes/worker-ops.routes.js';
import { WORKER_METRICS, WORKER_RANGES, WorkerOpsService } from '../services/worker-ops.service.js';
import { WorkerValidationException } from '../exceptions/worker-ops.exceptions.js';
import type { WorkerMetric, WorkerRange } from '../responses/worker-ops.response.js';

export const nameSchema = z.string().min(1).max(256).refine(isPrintableString);
export const rangeSchema = z.object({
  range: z.enum(Object.keys(WORKER_RANGES) as [WorkerRange, ...WorkerRange[]]).default('1h'),
});
export const metricsSchema = rangeSchema.extend({
  metric: z.enum(WORKER_METRICS as [WorkerMetric, ...WorkerMetric[]]).default('throughput'),
});

/** Xác thực và ép kiểu dữ liệu đầu vào theo schema Zod */
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

  /** Lấy dữ liệu tổng quan cho trang quản trị vận hành */
  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.workers.getOverview(parse(rangeSchema, q).range);
  }

  /** Lấy các chỉ số đo lường hiệu năng và vận hành */
  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.workers.getMetrics(range, metric, null);
  }

  /** Lấy danh sách các lần thực thi hoặc job bị thất bại */
  @Public()
  @Get(R.FAILURES)
  public failures(@Query() q: Record<string, string>) {
    return this.workers.getFailures(parse(rangeSchema, q).range, null);
  }

  /** Lấy danh sách các job đang ở trạng thái trì hoãn */
  @Public()
  @Get(R.DELAYED)
  public delayed() {
    return this.workers.getDelayed();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.workers.getEvents(parse(rangeSchema, q).range);
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.workers.getOperations();
  }

  /** Lấy thông tin cấu hình hiện tại của dịch vụ */
  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.workers.getConfig();
  }

  /** Lấy danh sách các phần tử theo điều kiện truy vấn */
  @Public()
  @Get(R.LIST)
  public list() {
    return this.workers.getWorkers();
  }

  /** Lấy thông tin chi tiết theo mã định danh */
  @Public()
  @Get(R.DETAIL)
  public detail(@Param('id') id: string) {
    return this.workers.getWorker(parse(nameSchema, id));
  }
}
