import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { CoreConfigService } from '@packages/config/index.js';
import {
  GatewayTimeoutAppException,
  HTTP_ERROR_CODE,
  RESILIENCE_SETTING_KEYS,
  SettingRegistryService,
  defaultSettingRegistry,
  readDynamicResilienceNumber,
} from '@packages/kernel/index.js';
import { REQUEST_TIMEOUT_METADATA_KEY } from '../decorators/request-timeout.decorator.js';

export interface ApiTimeoutRecord {
  readonly method: string;
  readonly route: string;
  readonly timeoutMs: number;
  readonly at: string;
}

export interface ApiTimeoutStatsSnapshot {
  readonly configuredDefaultTimeoutMs: number;
  readonly effectiveDefaultTimeoutMs: number;
  readonly totalTimeouts: number;
  readonly lastTimeoutAt: string | null;
  readonly recentTimeouts: readonly ApiTimeoutRecord[];
}

const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const MAX_API_REQUEST_TIMEOUT_MS = 600_000;
const MAX_RECENT_TIMEOUTS = 30;

/**
 * Interceptor áp dụng giới hạn thời gian xử lý (Timeout) cho mọi HTTP API request:
 * - Thứ tự ưu tiên: `@NoRequestTimeout()` / `@RequestTimeout(ms)` trên route/controller
 *   → cấu hình động `resilience.api.request_timeout_ms` (Settings) → `API_REQUEST_TIMEOUT_MS` (.env).
 * - Khi quá hạn: trả về `504 Gateway Timeout` chuẩn Envelope (`GATEWAY_TIMEOUT`), ghi log cảnh báo
 *   và lưu thống kê in-memory phục vụ System Console.
 */
@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestTimeoutInterceptor.name);
  private totalTimeouts = 0;
  private lastTimeoutAt: string | null = null;
  private readonly recentTimeouts: ApiTimeoutRecord[] = [];

  constructor(
    @Optional() private readonly reflector?: Reflector,
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly settingsRegistry?: SettingRegistryService,
  ) {}

  /** Xác định timeout mặc định hiện hành (đã hợp nhất Settings động và `.env`). */
  public resolveDefaultTimeoutMs(): number {
    const envFallback = this.config?.app?.requestTimeoutMs ?? DEFAULT_API_REQUEST_TIMEOUT_MS;
    return readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.API_REQUEST_TIMEOUT_MS,
      envFallback,
      {
        min: 0,
        max: MAX_API_REQUEST_TIMEOUT_MS,
        round: true,
        registry: this.settingsRegistry ?? defaultSettingRegistry,
      },
    );
  }

  /** Xác định timeout thực tế áp dụng cho execution context hiện tại (`0` = bỏ qua timeout). */
  public resolveEffectiveTimeoutMs(context: ExecutionContext): number {
    const override = this.reflector?.getAllAndOverride<number | undefined>(
      REQUEST_TIMEOUT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (typeof override === 'number' && Number.isFinite(override)) {
      return Math.max(0, Math.min(MAX_API_REQUEST_TIMEOUT_MS, Math.floor(override)));
    }
    return this.resolveDefaultTimeoutMs();
  }

  /** Ảnh chụp thống kê số lần timeout của tầng API cho trang giám sát System Console. */
  public getStats(): ApiTimeoutStatsSnapshot {
    const configuredDefaultTimeoutMs =
      this.config?.app?.requestTimeoutMs ?? DEFAULT_API_REQUEST_TIMEOUT_MS;
    return {
      configuredDefaultTimeoutMs,
      effectiveDefaultTimeoutMs: this.resolveDefaultTimeoutMs(),
      totalTimeouts: this.totalTimeouts,
      lastTimeoutAt: this.lastTimeoutAt,
      recentTimeouts: [...this.recentTimeouts],
    };
  }

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rawUrl = request?.url ?? '';
    if (rawUrl.endsWith('/metrics')) {
      return next.handle();
    }

    const timeoutMs = this.resolveEffectiveTimeoutMs(context);
    if (timeoutMs <= 0) {
      return next.handle();
    }

    const method = request?.method ?? 'UNKNOWN';
    const route = request?.routeOptions?.url ?? rawUrl.split('?')[0] ?? 'unknown';

    return next.handle().pipe(
      timeout({ first: timeoutMs }),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          this.recordTimeout(method, route, timeoutMs);
          return throwError(
            () =>
              new GatewayTimeoutAppException(HTTP_ERROR_CODE.GATEWAY_TIMEOUT, [], {
                timeoutMs,
              }),
          );
        }
        return throwError(() => err);
      }),
    );
  }

  private recordTimeout(method: string, route: string, timeoutMs: number): void {
    const nowIso = new Date().toISOString();
    this.totalTimeouts += 1;
    this.lastTimeoutAt = nowIso;
    this.recentTimeouts.unshift({ method, route, timeoutMs, at: nowIso });
    if (this.recentTimeouts.length > MAX_RECENT_TIMEOUTS) {
      this.recentTimeouts.length = MAX_RECENT_TIMEOUTS;
    }
    this.logger.warn(`[ApiTimeout] ${method} ${route} exceeded ${timeoutMs}ms`);
  }
}
