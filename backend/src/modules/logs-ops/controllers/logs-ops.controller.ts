import { Body, Controller, Delete, Get, Param, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { maskIp } from '@packages/traffic/utils/capture.js';
import { LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
import { LOGS_OPS_ROUTES as R } from '../routes/logs-ops.routes.js';
import {
  LEVEL_DURATIONS_MIN,
  LOGS_RANGES,
  LogsOpsService,
  OVERRIDE_LEVELS,
  type ExportFormat,
  type OperationContext,
  type OverrideLevel,
} from '../services/logs-ops.service.js';
import { LogAuditService } from '../services/log-audit.service.js';
import {
  EMPTY_LOG_FILTER,
  LOG_ID_FIELDS,
  parseLogQuery,
  parseStatus,
  type LogFilter,
} from '../services/log-query.js';
import {
  LogsActionRejectedException,
  LogsUnavailableException,
  LogsValidationException,
} from '../exceptions/logs-ops.exceptions.js';
import type { AuditDomain, LogsRange } from '../responses/logs-ops.response.js';

const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const text = (max: number) => z.string().max(max).refine(printable);
/** Query rỗng (`?level=`) = không lọc. */
const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), s.optional());
const rangeSchema = z.object({
  range: z.enum(Object.keys(LOGS_RANGES) as [LogsRange, ...LogsRange[]]).default('1h'),
});
/** Cửa sổ thời gian của Explorer (phút). */
const WINDOWS = { '5m': 5, '15m': 15, '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 } as const;
type LogWindowKey = keyof typeof WINDOWS;
const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)));
const filterSchema = z.object({
  q: optional(text(500)),
  level: optional(text(100)),
  runtime: optional(text(100)),
  module: optional(text(200)),
  correlationId: optional(text(256)),
  requestId: optional(text(256)),
  jobId: optional(text(256)),
  messageId: optional(text(256)),
  executionId: optional(text(256)),
  userId: optional(text(256)),
  id: optional(text(256)),
  status: optional(text(8)),
  endpoint: optional(text(300)),
  errorType: optional(text(200)),
  instance: optional(text(200)),
  fingerprint: optional(z.string().regex(/^[0-9a-f]{6,40}$/)),
  window: optional(z.enum(Object.keys(WINDOWS) as [LogWindowKey, ...LogWindowKey[]])),
  from: optional(isoDate),
  to: optional(isoDate),
});
const searchSchema = filterSchema.extend({
  cursor: optional(z.string().max(500)),
  limit: z.coerce.number().int().min(10).max(500).default(100),
});
const tailSchema = filterSchema.extend({
  after: optional(z.string().max(500)),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const exportSchema = filterSchema.extend({
  format: z.enum(['json', 'csv', 'ndjson']).default('json'),
  limit: z.coerce.number().int().min(1).max(100_000).default(10_000),
});
const errorsSchema = rangeSchema.extend({ q: optional(text(200)) });
const AUDIT_DOMAINS: AuditDomain[] = [
  'cache',
  'storage',
  'queue',
  'messaging',
  'scheduler',
  'jobs',
  'database',
  'runtime',
  'logs',
];
const auditSchema = z.object({
  window: optional(z.enum(Object.keys(WINDOWS) as [LogWindowKey, ...LogWindowKey[]])),
  domain: optional(z.enum(AUDIT_DOMAINS as [AuditDomain, ...AuditDomain[]])),
  result: optional(z.enum(['success', 'failed'])),
  q: optional(text(200)),
  cursor: optional(z.string().max(300)),
  limit: z.coerce.number().int().min(10).max(200).default(50),
});
const levelSchema = z.object({
  runtime: z.enum(LONG_RUNNING_RUNTIMES as unknown as [string, ...string[]]),
  level: z.enum(OVERRIDE_LEVELS as unknown as [OverrideLevel, ...OverrideLevel[]]),
  /** Phút; `null` = tới khi đổi lại (cần bật OPS_LOGS_LEVEL_PERMANENT_ENABLED). */
  durationMin: z.union([
    z.literal(null),
    z.coerce
      .number()
      .int()
      .refine((v) => (LEVEL_DURATIONS_MIN as readonly number[]).includes(v)),
  ]),
  modules: z.array(z.string().min(1).max(120).refine(printable)).max(10).default([]),
});
const idParam = z.string().min(1).max(256).refine(printable);

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LogsValidationException(result.error.issues);
  return result.data;
}

const context = (req: FastifyRequest): OperationContext => ({ ip: maskIp(req.ip), actor: null });

/** Query → bộ lọc log (ô tìm kiếm có cú pháp `level:error jobId:…` + các ô lọc riêng). */
export function toFilter(f: z.infer<typeof filterSchema>, now = Date.now()): LogFilter {
  const base: LogFilter = {
    ...EMPTY_LOG_FILTER,
    ids: {},
    levels: f.level ? (f.level.split(',').filter(Boolean) as LogFilter['levels']) : null,
    runtimes: f.runtime ? f.runtime.split(',').filter(Boolean) : null,
    module: f.module ?? null,
    anyId: f.id ?? null,
    status: f.status ? parseStatus(f.status) : null,
    endpoint: f.endpoint ?? null,
    errorType: f.errorType ?? null,
    instance: f.instance ?? null,
    fingerprint: f.fingerprint ?? null,
    from: f.from ? Date.parse(f.from) : f.window ? now - WINDOWS[f.window] * 60_000 : null,
    to: f.to ? Date.parse(f.to) : null,
  };
  for (const k of LOG_ID_FIELDS) if (f[k]) base.ids[k] = f[k];
  return f.q ? parseLogQuery(f.q, base) : base;
}

function summary(f: z.infer<typeof filterSchema>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')
    .slice(0, 300);
}

/**
 * Logs — Investigation Center: tổng quan, Explorer (tìm / lọc / cursor), live tail, chi tiết log, nhóm lỗi, trace theo
 * correlation, audit hợp nhất, báo cáo; đổi log level tạm thời và export theo bộ lọc (bật tắt bằng env, có audit).
 */
@Controller(R.PREFIX)
export class LogsOpsController {
  constructor(
    private readonly logs: LogsOpsService,
    private readonly audit: LogAuditService,
  ) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.logs.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    return this.logs.getSeries(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.TAIL)
  public tail(@Query() q: Record<string, string>) {
    const f = parse(tailSchema, q);
    return this.logs.tail(toFilter(f), f.after ?? null, f.limit);
  }

  @Public()
  @Get(R.EXPORT)
  public async export(
    @Query() q: Record<string, string>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const f = parse(exportSchema, q);
    const { format, limit, ...rest } = f;
    const out = await this.logs.exportLogs(
      toFilter(f),
      format as ExportFormat,
      limit,
      summary(rest),
      context(req),
    );
    return reply
      .header('content-type', out.contentType)
      .header('content-disposition', `attachment; filename="${out.fileName}"`)
      .header('x-export-count', String(out.count))
      .send(out.body);
  }

  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    const { range, q: search } = parse(errorsSchema, q);
    return this.logs.getErrors(range, search ?? null);
  }

  @Public()
  @Get(R.ERROR_GROUP)
  public errorGroup(@Param('fingerprint') fingerprint: string, @Query() q: Record<string, string>) {
    return this.logs.getErrorGroup(
      parse(z.string().regex(/^[0-9a-f]{6,40}$/), fingerprint),
      parse(rangeSchema, q).range,
    );
  }

  @Public()
  @Get(R.TRACE)
  public trace(@Param('id') id: string) {
    return this.logs.getTrace(parse(idParam, id));
  }

  @Public()
  @Get(R.AUDIT)
  public auditLog(@Query() q: Record<string, string>) {
    if (!this.logs.auditEnabled) throw new LogsActionRejectedException('AUDIT_DISABLED', {}, 403);
    if (!this.logs.available) throw new LogsUnavailableException();
    const a = parse(auditSchema, q);
    return this.audit.list({
      from: a.window ? Date.now() - WINDOWS[a.window] * 60_000 : null,
      to: null,
      domain: a.domain ?? null,
      result: a.result ?? null,
      q: a.q ?? null,
      cursor: a.cursor ?? null,
      limit: a.limit,
    });
  }

  @Public()
  @Get(R.REPORT)
  public report() {
    return this.logs.getReport();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.logs.getConfig();
  }

  @Public()
  @Put(R.LEVEL)
  public setLevel(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parse(levelSchema, body);
    return this.logs.setLevel(
      { runtime: b.runtime, level: b.level, durationMin: b.durationMin, modules: b.modules },
      context(req),
    );
  }

  @Public()
  @Delete(R.LEVEL_REVERT)
  public revertLevel(@Param('runtime') runtime: string, @Req() req: FastifyRequest) {
    return this.logs.revertLevel(
      parse(z.enum(LONG_RUNNING_RUNTIMES as unknown as [string, ...string[]]), runtime),
      context(req),
    );
  }

  @Public()
  @Get(R.ENTRY)
  public entry(@Param('id') id: string) {
    return this.logs.getEntry(parse(idParam, id));
  }

  @Public()
  @Get(R.SEARCH)
  public search(@Query() q: Record<string, string>) {
    const f = parse(searchSchema, q);
    return this.logs.search(toFilter(f), f.cursor ?? null, f.limit);
  }
}
