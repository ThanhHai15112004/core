import {
  type DynamicModule,
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CoreConfigService } from '@packages/config/index.js';
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

/**
 * Structured logging bằng pino (nestjs-pino + pino-http): JSON ra stdout và Redis Stream `logs:<env>`, mỗi request
 * một `reqId`, log trong request / job mang ID ngữ cảnh. Bootstrap gắn bằng `app.useLogger(app.get(Logger))`.
 */
@Global()
@Module({})
export class LoggingModule implements NestModule {
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
              customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) =>
                err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
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

  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('{*path}');
  }
}
