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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { maskIp } from '@packages/traffic/utils/capture.js';
import {
  OBJECT_KINDS,
  type ObjectFilter,
  type ObjectKind,
  type OperationContext,
} from '@packages/storage/index.js';
import { STORAGE_OPS_ROUTES as R } from '../routes/storage-ops.routes.js';
import {
  STORAGE_METRICS,
  STORAGE_RANGES,
  StorageOpsService,
} from '../services/storage-ops.service.js';
import { StorageValidationException } from '../exceptions/storage-ops.exceptions.js';
import type { StorageMetric, StorageRange } from '../responses/storage-ops.response.js';

const DAY = 86_400_000;
const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const rangeSchema = z.object({
  range: z.enum(Object.keys(STORAGE_RANGES) as [StorageRange, ...StorageRange[]]).default('1h'),
});
const metricsSchema = rangeSchema.extend({
  metric: z.enum(STORAGE_METRICS as [StorageMetric, ...StorageMetric[]]).default('upload'),
});
/** Key tương đối (kiểm tra kỹ ở tầng storage: không `..`, không `/` đầu). */
const keySchema = z.string().min(1).max(1024).refine(printable);
const containerSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => printable(s) && !s.includes('/'));
/** Tuổi object → khoảng [minAge, maxAge] theo lastModified. */
const AGES: Record<string, [number | null, number | null]> = {
  lt1d: [null, DAY],
  '1to7d': [DAY, 7 * DAY],
  '7to30d': [7 * DAY, 30 * DAY],
  gt30d: [30 * DAY, null],
  gt90d: [90 * DAY, null],
};
const objectsSchema = z.object({
  container: containerSchema.optional(),
  prefix: z.string().max(512).refine(printable).default(''),
  kind: z.enum(OBJECT_KINDS as [ObjectKind, ...ObjectKind[]]).optional(),
  minSize: z.coerce.number().int().min(0).optional(),
  maxSize: z.coerce.number().int().min(0).optional(),
  age: z.enum(Object.keys(AGES) as [string, ...string[]]).optional(),
  cursor: z.string().max(2048).refine(printable).default(''),
  count: z.coerce.number().int().min(10).max(500).default(100),
});
const signedUrlSchema = z.object({
  key: keySchema,
  ttlSec: z
    .number()
    .int()
    .min(1)
    .max(7 * 86_400),
});
const abortSchema = z.object({
  key: keySchema,
  uploadId: z.string().min(1).max(1024).refine(printable),
  confirm: z.literal('ABORT'),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StorageValidationException(result.error.issues);
  return result.data;
}

const context = (req: FastifyRequest): OperationContext => ({ ip: maskIp(req.ip), actor: null });
/** Tên file an toàn cho Content-Disposition. */
const fileName = (key: string) =>
  (key.split('/').pop() ?? 'download').replace(/[^\w.\-() ]+/g, '_');

/**
 * Storage Monitor — health, capacity, traffic, container, object, upload, lifecycle, lỗi & sự kiện, thao tác.
 * Thao tác (xoá, tải, signed URL, preview, huỷ upload) bật/tắt bằng env, có xác nhận và audit.
 */
@Controller(R.PREFIX)
export class StorageOpsController {
  constructor(private readonly storage: StorageOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.storage.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.storage.getMetrics(range, metric);
  }

  @Public()
  @Get(R.TRAFFIC)
  public traffic(@Query() q: Record<string, string>) {
    return this.storage.getTraffic(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.USAGE)
  public usage() {
    return this.storage.getUsage();
  }

  @Public()
  @Get(R.CONTAINERS)
  public containers(@Query() q: Record<string, string>) {
    return this.storage.getContainers(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.CONTAINER_DETAIL)
  public container(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.storage.getContainerDetail(parse(containerSchema, id), parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.OBJECTS)
  public objects(@Query() q: Record<string, string>) {
    const o = parse(objectsSchema, q);
    const [minAgeMs, maxAgeMs] = o.age ? AGES[o.age]! : [null, null];
    const filter: ObjectFilter = {
      container: o.container ?? null,
      prefix: o.prefix,
      kind: o.kind ?? null,
      minSize: o.minSize ?? null,
      maxSize: o.maxSize ?? null,
      minAgeMs,
      maxAgeMs,
    };
    return this.storage.getObjects(filter, o.cursor, o.count);
  }

  @Public()
  @Get(R.OBJECT_DETAIL)
  public object(@Query('key') key: string) {
    return this.storage.getObjectDetail(parse(keySchema, key));
  }

  @Public()
  @Delete(R.OBJECTS)
  @HttpCode(HttpStatus.OK)
  public delete(
    @Query() q: Record<string, string>,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const { key, versionId } = parse(
      z.object({ key: keySchema, versionId: z.string().max(1024).optional() }),
      q,
    );
    // Xoá bản hiện tại: gõ DELETE; xoá vĩnh viễn một version: gõ lại đúng key.
    parse(z.object({ confirm: z.literal(versionId ? key : 'DELETE') }), body ?? {});
    return this.storage.deleteObject(key, versionId ?? null, context(req));
  }

  @Public()
  @Get(R.OBJECT_DOWNLOAD)
  public async download(
    @Query('key') key: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { stream, detail } = await this.storage.download(parse(keySchema, key), context(req));
    void reply
      .header('content-type', detail.contentType ?? 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${fileName(detail.key)}"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
    if (stream.size !== null) void reply.header('content-length', String(stream.size));
    return reply.send(stream.body);
  }

  @Public()
  @Get(R.OBJECT_PREVIEW)
  public preview(@Query('key') key: string, @Req() req: FastifyRequest) {
    return this.storage.preview(parse(keySchema, key), context(req));
  }

  @Public()
  @Post(R.OBJECT_SIGNED_URL)
  @HttpCode(HttpStatus.OK)
  public signedUrl(@Body() body: unknown, @Req() req: FastifyRequest) {
    const { key, ttlSec } = parse(signedUrlSchema, body ?? {});
    return this.storage.signedUrl(key, ttlSec, context(req));
  }

  @Public()
  @Get(R.UPLOADS)
  public uploads(@Query() q: Record<string, string>) {
    return this.storage.getUploads(parse(rangeSchema, q).range);
  }

  @Public()
  @Post(R.UPLOAD_ABORT)
  @HttpCode(HttpStatus.OK)
  public abort(@Body() body: unknown, @Req() req: FastifyRequest) {
    const { key, uploadId } = parse(abortSchema, body ?? {});
    return this.storage.abortUpload(key, uploadId, context(req));
  }

  @Public()
  @Get(R.LIFECYCLE)
  public lifecycle() {
    return this.storage.getLifecycle();
  }

  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    return this.storage.getErrors(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.storage.getEvents(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.storage.getOperations();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.storage.getConfig();
  }

  @Public()
  @Post(R.TEST)
  @HttpCode(HttpStatus.OK)
  public test(@Req() req: FastifyRequest) {
    return this.storage.test(context(req));
  }
}
