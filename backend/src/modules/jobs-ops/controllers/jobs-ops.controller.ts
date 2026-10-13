import {
  Body,
  Controller,
  Delete,
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
import { Public, maskIp } from '@packages/http/index.js';
import { JOB_SOURCE_KINDS, type JobSourceKind } from '@packages/messaging/index.js';
import {
  JOB_STATUSES,
  type JobOperationContext,
  type JobPriorityLevel,
  type JobStatus,
} from '@packages/queue/index.js';
import { JOBS_OPS_ROUTES as R } from '../routes/jobs-ops.routes.js';
import { JOBS_RANGES, JobsOpsService } from '../services/jobs-ops.service.js';
import { JobsValidationException } from '../exceptions/jobs-ops.exceptions.js';
import type { JobsRange } from '../responses/jobs-ops.response.js';

/** Định dạng chuỗi ký tự hiển thị an toàn không chứa ký tự điều khiển */
const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const idSchema = z.string().min(1).max(256).refine(printable);
/** Query rỗng (`?status=`) = không lọc. */
const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), s.optional());
const rangeSchema = z.object({
  range: z.enum(Object.keys(JOBS_RANGES) as [JobsRange, ...JobsRange[]]).default('1h'),
});
const queueSchema = z.object({ queue: optional(idSchema) });
/** Cửa sổ thời gian cho job đã kết thúc. */
const WINDOWS = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 } as const;
const searchSchema = z.object({
  status: optional(z.enum(JOB_STATUSES as [JobStatus, ...JobStatus[]])),
  queue: optional(idSchema),
  type: optional(z.string().max(200)),
  search: optional(z.string().max(256).refine(printable)),
  window: optional(
    z.enum(Object.keys(WINDOWS) as [keyof typeof WINDOWS, ...(keyof typeof WINDOWS)[]]),
  ),
  worker: optional(z.string().max(200)),
  source: optional(z.enum(JOB_SOURCE_KINDS as [JobSourceKind, ...JobSourceKind[]])),
  minAttempts: optional(z.coerce.number().int().min(0).max(1000)),
  minDurationMs: optional(z.coerce.number().int().min(0)),
  errorType: optional(z.string().max(200)),
  priority: optional(
    z.enum(['critical', 'high', 'normal', 'low'] as [JobPriorityLevel, ...JobPriorityLevel[]]),
  ),
  cursor: optional(z.string().max(4000)),
  limit: z.coerce.number().int().min(10).max(200).default(50),
});
const cancelSchema = z.object({
  queue: optional(idSchema),
  reason: z.string().max(200).optional(),
});
const retrySchema = z.object({ queue: optional(idSchema) });
const bulkSchema = z.object({
  jobs: z
    .array(z.object({ queue: idSchema, id: idSchema }))
    .min(1)
    .max(500),
});

/** Xác thực và ép kiểu dữ liệu đầu vào theo schema Zod */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new JobsValidationException(result.error.issues);
  return result.data;
}

/** Trích xuất thông tin ngữ cảnh yêu cầu (RequestContext) từ Fastify request */
const context = (req: FastifyRequest): JobOperationContext => ({ ip: maskIp(req.ip), actor: null });

/**
 * Jobs — Job Explorer + Job Operations: tổng quan, tìm job (cursor), chi tiết (vòng đời, lần thử, lỗi, log, nguồn),
 * lỗi theo nhóm, báo cáo theo loại job; retry / huỷ / xoá bản ghi bật tắt bằng env, có audit.
 */
@Controller(R.PREFIX)
export class JobsOpsController {
  constructor(private readonly jobs: JobsOpsService) {}

  /** Lấy dữ liệu tổng quan cho trang quản trị vận hành */
  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.jobs.getOverview(parse(rangeSchema, q).range);
  }

  /** Tìm kiếm các bản ghi theo từ khóa hoặc tiêu chí lọc */
  @Public()
  @Get(R.SEARCH)
  public search(@Query() q: Record<string, string>) {
    const f = parse(searchSchema, q);
    return this.jobs.search(
      {
        status: f.status ?? null,
        queue: f.queue ?? null,
        type: f.type ?? null,
        typeContains: null,
        from: f.window ? Date.now() - WINDOWS[f.window] * 60_000 : null,
        to: null,
        worker: f.worker ?? null,
        source: f.source ?? null,
        minAttempts: f.minAttempts ?? null,
        minDurationMs: f.minDurationMs ?? null,
        errorType: f.errorType ?? null,
        priority: f.priority ?? null,
      },
      f.search ?? null,
      f.cursor ?? null,
      f.limit,
    );
  }

  /** Lấy danh sách các lần thực thi hoặc job bị thất bại */
  @Public()
  @Get(R.FAILURES)
  public failures(@Query() q: Record<string, string>) {
    const { range, queue } = parse(rangeSchema.merge(queueSchema), q);
    return this.jobs.getFailures(range, queue ?? null);
  }

  /** Tạo báo cáo chi tiết về tình trạng hoạt động của dịch vụ */
  @Public()
  @Get(R.REPORT)
  public report(@Query() q: Record<string, string>) {
    return this.jobs.getReport(parse(rangeSchema, q).range);
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.jobs.getEvents(parse(rangeSchema, q).range);
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.jobs.getOperations();
  }

  /** Lấy thông tin cấu hình hiện tại của dịch vụ */
  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.jobs.getConfig();
  }

  /** Retry các job lỗi đã chọn (tối đa `OPS_JOBS_BULK_RETRY_MAX`). */
  @Public()
  @Post(R.BULK_RETRY)
  @HttpCode(HttpStatus.OK)
  public bulkRetry(@Body() body: unknown, @Req() req: FastifyRequest) {
    return this.jobs.bulkRetry(parse(bulkSchema, body ?? {}).jobs, context(req));
  }

  /** Lấy thông tin chi tiết theo mã định danh */
  @Public()
  @Get(R.DETAIL)
  public detail(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.jobs.getJob(parse(idSchema, id), parse(queueSchema, q).queue ?? null);
  }

  /** Payload đã che field nhạy cảm — quyền riêng (`OPS_JOBS_PAYLOAD_ENABLED`), có audit. */
  @Public()
  @Get(R.PAYLOAD)
  public payload(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: FastifyRequest,
  ) {
    return this.jobs.payload(
      parse(idSchema, id),
      parse(queueSchema, q).queue ?? null,
      context(req),
    );
  }

  /** Thực hiện thử lại một tác vụ hoặc job thất bại */
  @Public()
  @Post(R.RETRY)
  @HttpCode(HttpStatus.OK)
  public retry(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { queue } = parse(retrySchema, body ?? {});
    return this.jobs.retry(parse(idSchema, id), queue ?? null, context(req));
  }

  /** Hủy bỏ tác vụ hoặc truy vấn đang thực thi */
  @Public()
  @Post(R.CANCEL)
  @HttpCode(HttpStatus.OK)
  public cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { queue, reason } = parse(cancelSchema, body ?? {});
    return this.jobs.cancel(parse(idSchema, id), queue ?? null, reason ?? null, context(req));
  }

  /** Xoá bản ghi job đã kết thúc — không hoàn tác nghiệp vụ (`OPS_JOBS_REMOVE_ENABLED`, mặc định tắt). */
  @Public()
  @Delete(R.REMOVE)
  public remove(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: FastifyRequest,
  ) {
    return this.jobs.remove(parse(idSchema, id), parse(queueSchema, q).queue ?? null, context(req));
  }
}
