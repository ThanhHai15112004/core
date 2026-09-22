import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import {
  LONG_RUNNING_RUNTIMES,
  type CliExecution,
  type LongRunningRuntimeId,
} from '@packages/runtime/index.js';
import { RUNTIMES_ROUTES } from '../routes/runtimes.routes.js';
import { RuntimesService, METRIC_RANGES, type MetricRange } from '../services/runtimes.service.js';
import { RuntimeCommandService } from '../services/runtime-command.service.js';
import { RuntimeValidationException } from '../exceptions/runtime.exceptions.js';
import type {
  RuntimeCommandDto,
  RuntimeDetailDto,
  RuntimeEventDto,
  RuntimeLogDto,
  RuntimeSeriesDto,
  RuntimesOverviewDto,
} from '../responses/runtime.response.js';

const LOG_LEVELS = ['verbose', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
const rangeSchema = z
  .enum(Object.keys(METRIC_RANGES) as [MetricRange, ...MetricRange[]])
  .default('15m');
const limitSchema = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const restartSchema = z.object({ mode: z.enum(['graceful', 'force']).default('graceful') });
const stopSchema = z.object({ confirm: z.literal('STOP') });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new RuntimeValidationException('VALIDATION_FAILED', result.error.issues);
  return result.data;
}

/**
 * Runtime Operations — theo dõi & điều khiển API/Worker/Scheduler/CLI.
 * Lưu ý: /ops/* chưa có RBAC (TokenService còn là skeleton); action có thể khoá bằng OPS_RUNTIME_ACTIONS_ENABLED.
 */
@Controller(RUNTIMES_ROUTES.PREFIX)
export class RuntimesController {
  constructor(
    private readonly runtimes: RuntimesService,
    private readonly commands: RuntimeCommandService,
  ) {}

  @Public()
  @Get(RUNTIMES_ROUTES.LIST)
  public getOverview(): Promise<RuntimesOverviewDto> {
    return this.runtimes.getOverview();
  }

  @Public()
  @Get(RUNTIMES_ROUTES.METRICS_ALL)
  public getAllMetrics(@Query('range') range?: string): Promise<RuntimeSeriesDto> {
    return this.runtimes.getSeries([...LONG_RUNNING_RUNTIMES], parse(rangeSchema, range));
  }

  @Public()
  @Get(RUNTIMES_ROUTES.EVENTS)
  public getEvents(
    @Query('runtime') runtime?: string,
    @Query('limit') limit?: string,
  ): Promise<RuntimeEventDto[]> {
    return this.runtimes.getEvents(runtime || undefined, parse(limitSchema(500, 50), limit));
  }

  @Public()
  @Get(RUNTIMES_ROUTES.CLI_HISTORY)
  public getCliHistory(@Query('limit') limit?: string): Promise<CliExecution[]> {
    return this.runtimes.getCliHistory(parse(limitSchema(200, 50), limit));
  }

  @Public()
  @Get(RUNTIMES_ROUTES.COMMAND)
  public getCommand(@Param('commandId') commandId: string): Promise<RuntimeCommandDto> {
    return this.commands.getCommand(commandId);
  }

  @Public()
  @Get(RUNTIMES_ROUTES.DETAIL)
  public getDetail(@Param('runtimeId') runtimeId: string): Promise<RuntimeDetailDto> {
    return this.runtimes.getDetail(runtimeId);
  }

  @Public()
  @Get(RUNTIMES_ROUTES.METRICS)
  public async getMetrics(
    @Param('runtimeId') runtimeId: string,
    @Query('range') range?: string,
  ): Promise<RuntimeSeriesDto> {
    const id: LongRunningRuntimeId = this.runtimes.assertRuntimeId(runtimeId);
    return this.runtimes.getSeries([id], parse(rangeSchema, range));
  }

  @Public()
  @Get(RUNTIMES_ROUTES.LOGS)
  public getLogs(
    @Param('runtimeId') runtimeId: string,
    @Query('limit') limit?: string,
    @Query('level') level?: string,
    @Query('correlationId') correlationId?: string,
  ): Promise<RuntimeLogDto[]> {
    return this.runtimes.getLogs(runtimeId, parse(limitSchema(1000, 100), limit), {
      level: level ? parse(z.enum(LOG_LEVELS), level) : undefined,
      correlationId: correlationId ? parse(z.string().max(128), correlationId) : undefined,
    });
  }

  @Public()
  @Post(RUNTIMES_ROUTES.RESTART)
  @HttpCode(HttpStatus.ACCEPTED)
  public restart(
    @Param('runtimeId') runtimeId: string,
    @Body() body?: unknown,
  ): Promise<RuntimeCommandDto> {
    const { mode } = parse(restartSchema, body ?? {});
    return this.commands.dispatch(runtimeId, 'restart', mode);
  }

  @Public()
  @Post(RUNTIMES_ROUTES.STOP)
  @HttpCode(HttpStatus.ACCEPTED)
  public stop(
    @Param('runtimeId') runtimeId: string,
    @Body() body?: unknown,
  ): Promise<RuntimeCommandDto> {
    parse(stopSchema, body ?? {});
    return this.commands.dispatch(runtimeId, 'stop');
  }

  @Public()
  @Post(RUNTIMES_ROUTES.START)
  @HttpCode(HttpStatus.ACCEPTED)
  public start(@Param('runtimeId') runtimeId: string): Promise<RuntimeCommandDto> {
    return this.commands.dispatch(runtimeId, 'start');
  }
}
