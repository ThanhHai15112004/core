import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { LONG_RUNNING_RUNTIMES, type LongRunningRuntimeId } from '@packages/runtime/index.js';
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
/** Giới hạn kích thước hoặc độ dài dữ liệu theo schema */
const limitSchema = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const stopSchema = z.object({ confirm: z.literal('STOP') });

/** Xác thực và ép kiểu dữ liệu đầu vào theo schema Zod */
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

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  @Public()
  @Get(RUNTIMES_ROUTES.LIST)
  public getOverview(): Promise<RuntimesOverviewDto> {
    return this.runtimes.getOverview();
  }

  /** Lấy toàn bộ các chỉ số đo lường hiệu năng của tất cả các runtimes */
  @Public()
  @Get(RUNTIMES_ROUTES.METRICS_ALL)
  public getAllMetrics(@Query('range') range?: string): Promise<RuntimeSeriesDto> {
    return this.runtimes.getSeries([...LONG_RUNNING_RUNTIMES], parse(rangeSchema, range));
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  @Public()
  @Get(RUNTIMES_ROUTES.EVENTS)
  public getEvents(
    @Query('runtime') runtime?: string,
    @Query('limit') limit?: string,
  ): Promise<RuntimeEventDto[]> {
    return this.runtimes.getEvents(runtime || undefined, parse(limitSchema(500, 50), limit));
  }

  /** Lấy thông tin chi tiết một lệnh điều khiển runtime theo ID */
  @Public()
  @Get(RUNTIMES_ROUTES.COMMAND)
  public getCommand(@Param('commandId') commandId: string): Promise<RuntimeCommandDto> {
    return this.commands.getCommand(commandId);
  }

  /** Lấy thông tin chi tiết của một bản ghi theo mã định danh */
  @Public()
  @Get(RUNTIMES_ROUTES.DETAIL)
  public getDetail(@Param('runtimeId') runtimeId: string): Promise<RuntimeDetailDto> {
    return this.runtimes.getDetail(runtimeId);
  }

  /** Lấy các chỉ số đo lường hiệu năng và vận hành của hệ thống */
  @Public()
  @Get(RUNTIMES_ROUTES.METRICS)
  public async getMetrics(
    @Param('runtimeId') runtimeId: string,
    @Query('range') range?: string,
  ): Promise<RuntimeSeriesDto> {
    const id: LongRunningRuntimeId = this.runtimes.assertRuntimeId(runtimeId);
    return this.runtimes.getSeries([id], parse(rangeSchema, range));
  }

  /** Lấy danh sách bản ghi log gần đây của runtime process */
  @Public()
  @Get(RUNTIMES_ROUTES.LOGS)
  public getLogs(
    @Param('runtimeId') runtimeId: string,
    @Query('limit') limit?: string,
    @Query('level') level?: string,
  ): Promise<RuntimeLogDto[]> {
    return this.runtimes.getLogs(runtimeId, parse(limitSchema(1000, 100), limit), {
      level: level ? parse(z.enum(LOG_LEVELS), level) : undefined,
    });
  }

  /** Gửi tín hiệu dừng một runtime process */
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

  /** Gửi tín hiệu khởi động một runtime process */
  @Public()
  @Post(RUNTIMES_ROUTES.START)
  @HttpCode(HttpStatus.ACCEPTED)
  public start(@Param('runtimeId') runtimeId: string): Promise<RuntimeCommandDto> {
    return this.commands.dispatch(runtimeId, 'start');
  }
}
