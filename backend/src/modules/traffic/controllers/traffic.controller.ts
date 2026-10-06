import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { TRAFFIC_ROUTES } from '../routes/traffic.routes.js';
import {
  ENDPOINT_SORTS,
  TRAFFIC_RANGES,
  TrafficService,
  type TrafficQuery,
  type TrafficRange,
} from '../services/traffic.service.js';
import { TrafficValidationException } from '../exceptions/traffic.exceptions.js';
import type {
  EndpointDetailDto,
  EndpointRowDto,
  ErrorAnalysisDto,
  TimeseriesDto,
  TrafficInsightsDto,
  TrafficSummaryDto,
} from '../responses/traffic.response.js';

const rangeEnum = z.enum(Object.keys(TRAFFIC_RANGES) as [TrafficRange, ...TrafficRange[]]);
const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => v || undefined);
const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === undefined || v === 'true' || v === '1');

const filterSchema = z.object({
  instance: optionalText,
  method: optionalText,
  module: optionalText,
  routeId: optionalText,
  internal: booleanFlag,
});

const trafficSchema = filterSchema.extend({ range: rangeEnum.default('15m') });

type RawQuery = Record<string, string | undefined>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TrafficValidationException(result.error.issues);
  return result.data;
}

function toTrafficQuery(raw: RawQuery): TrafficQuery {
  const { internal, ...rest } = parse(trafficSchema, raw);
  return { ...rest, includeInternal: internal };
}

/**
 * HTTP Traffic — lưu lượng, latency, lỗi theo endpoint và request cụ thể.
 * Lưu ý: /ops/* chưa có RBAC (TokenService còn là skeleton).
 */
@Controller(TRAFFIC_ROUTES.PREFIX)
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Public()
  @Get(TRAFFIC_ROUTES.SUMMARY)
  public getSummary(@Query() query: RawQuery): Promise<TrafficSummaryDto> {
    return this.traffic.getSummary(toTrafficQuery(query));
  }

  @Public()
  @Get(TRAFFIC_ROUTES.TIMESERIES)
  public getTimeseries(@Query() query: RawQuery): Promise<TimeseriesDto> {
    const metric = parse(
      z.enum(['requests', 'latency', 'errors', 'status']).default('requests'),
      query['metric'],
    );
    return this.traffic.getTimeseries(toTrafficQuery(query), metric);
  }

  @Public()
  @Get(TRAFFIC_ROUTES.ENDPOINTS)
  public getEndpoints(@Query() query: RawQuery): Promise<EndpointRowDto[]> {
    const sort = parse(z.enum(ENDPOINT_SORTS).default('traffic'), query['sort']);
    return this.traffic.getEndpoints(toTrafficQuery(query), sort);
  }

  @Public()
  @Get(TRAFFIC_ROUTES.ENDPOINT_DETAIL)
  public getEndpoint(
    @Param('routeId') routeId: string,
    @Query() query: RawQuery,
  ): Promise<EndpointDetailDto> {
    return this.traffic.getEndpoint(routeId, toTrafficQuery(query));
  }

  @Public()
  @Get(TRAFFIC_ROUTES.ERRORS)
  public getErrors(@Query() query: RawQuery): Promise<ErrorAnalysisDto> {
    return this.traffic.getErrors(toTrafficQuery(query));
  }

  @Public()
  @Get(TRAFFIC_ROUTES.INSIGHTS)
  public getInsights(@Query() query: RawQuery): Promise<TrafficInsightsDto> {
    return this.traffic.getInsights(toTrafficQuery(query));
  }
}
