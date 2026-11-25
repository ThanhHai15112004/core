import {
  type DynamicModule,
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CoreConfigService } from '@packages/config/index.js';
import { DomainEventBusService, defaultDomainEventBus } from '@packages/kernel/index.js';
import { RequestContextService } from './context/request-context.service.js';
import { LOGGING_OPTIONS, type LoggingModuleOptions } from './contracts/logging-options.js';
import { requestContextMiddleware } from './middleware/request-context.middleware.js';
import { createRootLogger } from './providers/pino-root.logger.js';
import { LogLevelService } from './providers/log-level.service.js';
import { LogStreamReader } from './providers/log-stream.reader.js';
import { LoggingManageableAdapter } from './providers/logging-manageable.adapter.js';
import { resolveRequestId } from './utils/request-id.js';

/** Request không ghi log tự động (scrape metric, health check). */
const QUIET_URL = /\/(metrics|health)(\/|\?|$)/;
/** Endpoint vận hành System Console (`/ops/*`) hoặc mảnh upload (`/upload-chunked/.../chunk`) — bỏ qua log 2xx/3xx để tránh spam log. */
const OPS_URL = /\/ops(\/|\?|$)/;
const CHUNK_PART_URL = /\/upload-chunked\/[^/]+\/chunk(\/|\?|$)/;

/**
 * Structured logging bằng pino (nestjs-pino + pino-http): JSON ra stdout và Redis Stream `logs:<env>`, mỗi request
 * một `reqId`, log trong request / job mang ID ngữ cảnh. Bootstrap gắn bằng `app.useLogger(app.get(Logger))`.
 */
@Global()
@Module({})
export class LoggingModule implements NestModule, OnModuleInit {
  constructor(
    @Optional() private readonly domainEventBus?: DomainEventBusService,
    @Optional() private readonly pinoLogger?: PinoLogger,
  ) {}

  /** Tự động gắn RequestContext (requestId/correlationId/userId) và structured logger vào DomainEventBus. */
  public onModuleInit(): void {
    const bus = this.domainEventBus ?? defaultDomainEventBus;
    bus.setContextResolver(() => {
      const store = RequestContextService.current();
      if (!store) return undefined;
      return {
        requestId: store.requestId ?? (store.source?.kind === 'http' ? store.source.id : null),
        correlationId: store.correlationId ?? null,
        actorId: store.userId ?? null,
      };
    });
    if (this.pinoLogger) {
      const logger = this.pinoLogger;
      bus.setLogger({
        log: (msg, meta) => logger.info(meta ?? {}, msg),
        warn: (msg, meta) => logger.warn(meta ?? {}, msg),
        error: (msg, meta) => logger.error(meta ?? {}, msg),
      });
    }
  }
  /** Đăng ký dynamic module ở cấp root với cấu hình chỉ định */
  public static forRoot(options: LoggingModuleOptions): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRootAsync({
          inject: [CoreConfigService],
          useFactory: (config: CoreConfigService) => ({
            pinoHttp: {
              logger: createRootLogger({
                runtime: options.runtime,
                level: config.logs.level,
                format: config.logs.format,
              }),
              genReqId: (req: IncomingMessage, res: ServerResponse) => resolveRequestId(req, res),
              customAttributeKeys: { reqId: 'reqId' },
              quietReqLogger: true,
              customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
                if (err || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                if (
                  OPS_URL.test(req.url ?? '') &&
                  (req.method === 'GET' || req.method === 'HEAD')
                ) {
                  return 'silent';
                }
                if (CHUNK_PART_URL.test(req.url ?? '')) {
                  return 'silent';
                }
                return 'info';
              },
              autoLogging: { ignore: (req: IncomingMessage) => QUIET_URL.test(req.url ?? '') },
              serializers: {
                req: (req: { method?: string; url?: string }) => ({
                  method: req.method,
                  url: req.url,
                }),
                res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
              },
            },
          }),
        }),
      ],
      providers: [
        { provide: LOGGING_OPTIONS, useValue: options },
        RequestContextService,
        LogLevelService,
        LogStreamReader,
        LoggingManageableAdapter,
      ],
      exports: [RequestContextService, LogLevelService, LogStreamReader, LoggerModule],
    };
  }

  /** Cập nhật cấu hình hoạt động của dịch vụ */
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('{*path}');
  }
}
