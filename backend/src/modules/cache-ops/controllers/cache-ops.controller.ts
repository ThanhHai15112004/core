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
import { Public } from '@packages/http/index.js';
import { maskIp } from '@packages/traffic/utils/capture.js';
import type { OperationContext } from '@packages/cache/index.js';
import { CACHE_OPS_ROUTES as R } from '../routes/cache-ops.routes.js';
import { CACHE_METRICS, CACHE_RANGES, CacheOpsService } from '../services/cache-ops.service.js';
import { CacheValidationException } from '../exceptions/cache-ops.exceptions.js';
import type { CacheMetric, CacheRange } from '../responses/cache-ops.response.js';

const rangeEnum = z.enum(Object.keys(CACHE_RANGES) as [CacheRange, ...CacheRange[]]);
const rangeSchema = z.object({ range: rangeEnum.default('1h') });
const metricsSchema = rangeSchema.extend({
  metric: z.enum(CACHE_METRICS as [CacheMetric, ...CacheMetric[]]).default('hitRate'),
});
/** Không có ký tự điều khiển (xuống dòng, NUL…) trong key/pattern. */
const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
/** Key tương đối vùng cache (không gồm prefix). */
const keySchema = z.string().min(1).max(1024).refine(printable);
/** Tên namespace: không chứa ký tự glob. */
const namespaceSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => printable(s) && !/[*?[\]]/.test(s));
const keysSchema = z.object({
  match: z.string().max(256).refine(printable).default(''),
  type: z
    .string()
    .regex(/^[a-z]{1,16}$/)
    .optional(),
  ttl: z.enum(['any', 'persistent', 'expiring', 'lt1m']).default('any'),
  namespace: namespaceSchema.optional(),
  cursor: z
    .string()
    .regex(/^\d{1,20}$/)
    .default('0'),
  count: z.coerce.number().int().min(10).max(500).default(100),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CacheValidationException(result.error.issues);
  return result.data;
}

const context = (req: FastifyRequest): OperationContext => ({ ip: maskIp(req.ip), actor: null });

/**
 * Cache Monitor — hiệu quả, keyspace/namespace/TTL, bộ nhớ, kết nối, lỗi & sự kiện, thao tác.
 * Thao tác xoá yêu cầu body xác nhận và có thể tắt bằng env; chỉ tác động vùng cache của core.
 */
@Controller(R.PREFIX)
export class CacheOpsController {
  constructor(private readonly cache: CacheOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.cache.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.cache.getMetrics(range, metric);
  }

  @Public()
  @Get(R.NAMESPACES)
  public namespaces(@Query() q: Record<string, string>) {
    return this.cache.getNamespaces(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.NAMESPACE_DETAIL)
  public namespace(@Param('name') name: string, @Query() q: Record<string, string>) {
    return this.cache.getNamespaceDetail(parse(namespaceSchema, name), parse(rangeSchema, q).range);
  }

  @Public()
  @Post(R.NAMESPACE_CLEAR)
  @HttpCode(HttpStatus.OK)
  public clearNamespace(
    @Param('name') name: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const ns = parse(namespaceSchema, name);
    // Xác nhận bằng cách gõ lại đúng tên namespace.
    parse(z.object({ confirm: z.literal(ns) }), body ?? {});
    return this.cache.clearNamespace(ns, context(req));
  }

  @Public()
  @Get(R.KEYS)
  public keys(@Query() q: Record<string, string>) {
    const { cursor, count, match, type, ttl, namespace } = parse(keysSchema, q);
    return this.cache.getKeys(
      { match, type: type ?? null, ttl, namespace: namespace ?? null },
      cursor,
      count,
    );
  }

  @Public()
  @Get(R.KEY_DETAIL)
  public key(@Query('key') key: string) {
    return this.cache.getKeyDetail(parse(keySchema, key));
  }

  @Public()
  @Delete(R.KEYS)
  @HttpCode(HttpStatus.OK)
  public deleteKey(@Query('key') key: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    parse(z.object({ confirm: z.literal('DELETE') }), body ?? {});
    return this.cache.deleteKey(parse(keySchema, key), context(req));
  }

  @Public()
  @Get(R.MEMORY)
  public memory(@Query() q: Record<string, string>) {
    return this.cache.getMemory(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.TTL)
  public ttl() {
    return this.cache.getTtl();
  }

  @Public()
  @Get(R.CLIENTS)
  public clients() {
    return this.cache.getClients();
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.cache.getEvents(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    return this.cache.getErrors(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.cache.getOperations();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.cache.getConfig();
  }

  @Public()
  @Get(R.FLUSH_IMPACT)
  public flushImpact() {
    return this.cache.getFlushImpact();
  }

  @Public()
  @Post(R.FLUSH)
  @HttpCode(HttpStatus.OK)
  public flush(@Body() body: unknown, @Req() req: FastifyRequest) {
    parse(z.object({ confirm: z.literal('FLUSH CACHE') }), body ?? {});
    return this.cache.flush(context(req));
  }

  @Public()
  @Post(R.PING)
  @HttpCode(HttpStatus.OK)
  public ping() {
    return this.cache.testConnection();
  }
}
