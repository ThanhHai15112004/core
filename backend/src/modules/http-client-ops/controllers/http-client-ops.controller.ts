import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public, isPrintableString } from '@packages/http/index.js';
import { HttpClientOpsValidationException } from '../exceptions/http-client-ops.exceptions.js';
import { HTTP_CLIENT_OPS_ROUTES as R } from '../routes/http-client-ops.routes.js';
import { HttpClientOpsService } from '../services/http-client-ops.service.js';

const serviceParamSchema = z.string().trim().min(1).max(128).refine(isPrintableString);
const errorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpClientOpsValidationException(result.error.issues);
  }
  return result.data;
}

/** API giám sát & điều khiển Outbound HTTP Client trên System Console (`/ops/http-client/*`) */
@Controller(R.PREFIX)
export class HttpClientOpsController {
  constructor(private readonly httpClientOps: HttpClientOpsService) {}

  /** Tổng quan trạng thái, thống kê lỗi/độ trễ và danh sách dịch vụ outbound HTTP */
  @Public()
  @Get(R.OVERVIEW)
  public overview() {
    return this.httpClientOps.getOverview();
  }

  /** Danh sách cấu hình timeout/retry/circuit breaker theo từng dịch vụ */
  @Public()
  @Get(R.SERVICES)
  public services() {
    return this.httpClientOps.getServices();
  }

  /** Danh sách trạng thái Circuit Breaker đang theo dõi */
  @Public()
  @Get(R.CIRCUITS)
  public circuits() {
    return this.httpClientOps.getCircuits();
  }

  /** Đặt lại toàn bộ Circuit Breaker đang mở về CLOSED */
  @Public()
  @Post(R.CIRCUITS_RESET_ALL)
  @HttpCode(HttpStatus.OK)
  public resetAllCircuits() {
    return this.httpClientOps.resetAllCircuits();
  }

  /** Đặt lại Circuit Breaker của một dịch vụ cụ thể về CLOSED */
  @Public()
  @Post(R.CIRCUIT_RESET)
  @HttpCode(HttpStatus.OK)
  public resetCircuit(@Param('service') service: string) {
    return this.httpClientOps.resetCircuit(parse(serviceParamSchema, service));
  }

  /** Danh sách lỗi gọi dịch vụ ngoài gần nhất (đã che bí mật) */
  @Public()
  @Get(R.ERRORS)
  public errors(@Query() query: Record<string, string>) {
    const { limit } = parse(errorsQuerySchema, query);
    return this.httpClientOps.getRecentErrors(limit);
  }

  /** Cấu hình HTTP Client mặc định & các dịch vụ đã đăng ký (đã che headers nhạy cảm) */
  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.httpClientOps.getConfig();
  }

  /** Tổng hợp chính sách & chỉ số Retry, Timeout, Circuit Breaker, Bulkhead của 4 tầng (API, DB, Queue, Provider) */
  @Public()
  @Get(R.RESILIENCE)
  public resilience() {
    return this.httpClientOps.getResilienceSummary();
  }
}
