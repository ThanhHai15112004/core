import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { PERFORMANCE_ROUTES } from '../routes/performance.routes.js';
import {
  BASELINE_MODES,
  PERF_RANGES,
  PerformanceService,
  TIMESERIES_METRICS,
} from '../services/performance.service.js';
import { PerformanceValidationException } from '../exceptions/performance.exceptions.js';
import type {
  BaselineMode,
  BottleneckDto,
  ComponentDetailDto,
  PerfEventDto,
  PerfRange,
  PerfTimeseriesDto,
  PerformanceOverviewDto,
  TimeseriesMetric,
} from '../responses/performance.response.js';

const rangeEnum = z.enum(Object.keys(PERF_RANGES) as [PerfRange, ...PerfRange[]]);
const metricEnum = z.enum(TIMESERIES_METRICS as [TimeseriesMetric, ...TimeseriesMetric[]]);

const rangeSchema = z.object({ range: rangeEnum.default('1h') });
const timeseriesSchema = rangeSchema.extend({
  metric: metricEnum.default('latency'),
  compare: metricEnum.optional(),
  baseline: z.enum(BASELINE_MODES as [BaselineMode, ...BaselineMode[]]).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PerformanceValidationException(result.error.issues);
  return result.data;
}

/**
 * Performance — hiệu năng toàn hệ thống: tài nguyên runtime, latency/throughput, database, cache,
 * worker/queue, điểm nghẽn và sự kiện. Chỉ đọc; không có thao tác nguy hiểm.
 */
@Controller(PERFORMANCE_ROUTES.PREFIX)
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Public()
  @Get(PERFORMANCE_ROUTES.OVERVIEW)
  public async overview(@Query() raw: Record<string, string>): Promise<PerformanceOverviewDto> {
    return this.performance.getOverview(parse(rangeSchema, raw).range);
  }

  @Public()
  @Get(PERFORMANCE_ROUTES.TIMESERIES)
  public async timeseries(@Query() raw: Record<string, string>): Promise<PerfTimeseriesDto> {
    const q = parse(timeseriesSchema, raw);
    return this.performance.getTimeseries(q.range, q.metric, q.compare ?? null, q.baseline ?? null);
  }

  @Public()
  @Get(PERFORMANCE_ROUTES.BOTTLENECKS)
  public async bottlenecks(): Promise<BottleneckDto[]> {
    return this.performance.getBottlenecks();
  }

  @Public()
  @Get(PERFORMANCE_ROUTES.EVENTS)
  public async events(@Query() raw: Record<string, string>): Promise<PerfEventDto[]> {
    return this.performance.getEvents(parse(rangeSchema, raw).range);
  }

  @Public()
  @Get(PERFORMANCE_ROUTES.COMPONENT_DETAIL)
  public async component(
    @Param('componentId') componentId: string,
    @Query() raw: Record<string, string>,
  ): Promise<ComponentDetailDto> {
    return this.performance.getComponent(componentId, parse(rangeSchema, raw).range);
  }
}
