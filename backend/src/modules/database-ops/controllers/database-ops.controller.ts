import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { DATABASE_OPS_ROUTES as R } from '../routes/database-ops.routes.js';
import { DB_METRICS, DB_RANGES, DatabaseOpsService } from '../services/database-ops.service.js';
import { DatabaseValidationException } from '../exceptions/database-ops.exceptions.js';
import type { DbMetric, DbRange } from '../responses/database-ops.response.js';

const rangeEnum = z.enum(Object.keys(DB_RANGES) as [DbRange, ...DbRange[]]);
const rangeSchema = z.object({ range: rangeEnum.default('1h') });
const metricsSchema = rangeSchema.extend({
  metric: z.enum(DB_METRICS as [DbMetric, ...DbMetric[]]).default('queries'),
});
const statsSchema = rangeSchema.extend({ minMs: z.coerce.number().min(0).max(600_000).default(0) });
const sessionId = z.string().regex(/^\d{1,20}$/);
const digest = z.string().regex(/^[\w-]{1,128}$/);
const confirm = (word: string) => z.object({ confirm: z.literal(word) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DatabaseValidationException(result.error.issues);
  return result.data;
}

/**
 * Database Monitor — sức khoẻ, query, session, transaction/lock, bảng/dung lượng, migration, lỗi & sự kiện.
 * Thao tác (cancel/terminate/migrate) yêu cầu body xác nhận và có thể tắt bằng env.
 */
@Controller(R.PREFIX)
export class DatabaseOpsController {
  constructor(private readonly db: DatabaseOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.db.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.db.getMetrics(range, metric);
  }

  @Public()
  @Get(R.QUERIES)
  public queries() {
    return this.db.getLiveQueries();
  }

  @Public()
  @Get(R.QUERY_STATS)
  public queryStats(@Query() q: Record<string, string>) {
    const { range, minMs } = parse(statsSchema, q);
    return this.db.getQueryStats(range, minMs);
  }

  @Public()
  @Get(R.QUERY_DETAIL)
  public queryDetail(@Param('digest') id: string, @Query() q: Record<string, string>) {
    return this.db.getQueryDetail(parse(digest, id), parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.QUERY_EXPLAIN)
  public explain(@Param('digest') id: string) {
    return this.db.getExplain(parse(digest, id));
  }

  @Public()
  @Post(R.QUERY_CANCEL)
  @HttpCode(HttpStatus.OK)
  public cancel(@Param('sessionId') id: string, @Body() body?: unknown) {
    parse(confirm('CANCEL'), body ?? {});
    return this.db.sessionAction('cancel', parse(sessionId, id));
  }

  @Public()
  @Get(R.CONNECTIONS)
  public connections() {
    return this.db.getConnections();
  }

  @Public()
  @Get(R.CONNECTION_DETAIL)
  public connection(@Param('sessionId') id: string) {
    return this.db.getConnectionDetail(parse(sessionId, id));
  }

  @Public()
  @Post(R.CONNECTION_TERMINATE)
  @HttpCode(HttpStatus.OK)
  public terminate(@Param('sessionId') id: string, @Body() body?: unknown) {
    parse(confirm('TERMINATE'), body ?? {});
    return this.db.sessionAction('terminate', parse(sessionId, id));
  }

  @Public()
  @Get(R.TRANSACTIONS)
  public transactions() {
    return this.db.getTransactions();
  }

  @Public()
  @Get(R.TABLES)
  public tables() {
    return this.db.getTables();
  }

  @Public()
  @Get(R.TABLE_DETAIL)
  public table(@Param('name') name: string) {
    return this.db.getTableDetail(name);
  }

  @Public()
  @Get(R.STORAGE)
  public storage() {
    return this.db.getStorage();
  }

  @Public()
  @Get(R.MIGRATIONS)
  public migrations() {
    return this.db.getMigrations();
  }

  @Public()
  @Post(R.MIGRATIONS_RUN)
  @HttpCode(HttpStatus.OK)
  public runMigrations(@Body() body?: unknown) {
    parse(confirm('MIGRATE'), body ?? {});
    return this.db.runMigrations();
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.db.getEvents(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    return this.db.getErrors(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.db.getConfig();
  }

  @Public()
  @Post(R.PING)
  @HttpCode(HttpStatus.OK)
  public ping() {
    return this.db.testConnection();
  }
}
