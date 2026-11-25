import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '../context/request-context.service.js';
import { LOG_REQUEST_BODY_METADATA } from '../decorators/log-request-body.decorator.js';
import { setHttpLogMeta } from '../utils/http-log-meta.js';
import { pickAllowedRequestBody } from '../utils/request-body.util.js';

interface HttpRequestLike {
  body?: unknown;
  raw?: unknown;
}

/**
 * Gắn tên `module`, `action` (`Controller.handler`) và `reqBody` (đã lọc theo allowlist & redact)
 * vào cả `RequestContextService` lẫn `req.raw` để mọi log trong request và HTTP access log đều đầy đủ ngữ cảnh.
 */
@Injectable()
export class HttpLoggingContextInterceptor implements NestInterceptor {
  constructor(
    @Optional() private readonly reflector?: Reflector,
    @Optional() private readonly config?: CoreConfigService,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const controllerName = context.getClass()?.name;
    const handlerName = context.getHandler()?.name;
    const moduleName = controllerName
      ? controllerName.replace(/Controller$/, '') || controllerName
      : undefined;
    const actionName =
      controllerName && handlerName ? `${controllerName}.${handlerName}` : handlerName;

    const store = RequestContextService.current();
    if (store) {
      if (moduleName) store.module = moduleName;
      if (actionName) store.action = actionName;
    }

    const req = context.switchToHttp().getRequest<HttpRequestLike>();
    const rawReq = req?.raw ?? req;

    const routeAllowlist = this.reflector?.getAllAndOverride<readonly string[] | undefined>(
      LOG_REQUEST_BODY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const bodyCfg = this.config?.logs.requestBody;
    const effectiveAllowlist = routeAllowlist ?? bodyCfg?.allowlist ?? [];
    const bodyEnabled = Boolean(routeAllowlist) || Boolean(bodyCfg?.enabled);

    const reqBody =
      bodyEnabled && effectiveAllowlist.length > 0 && req?.body !== undefined
        ? pickAllowedRequestBody(req.body, effectiveAllowlist, bodyCfg?.maxBytes ?? 2048)
        : undefined;

    setHttpLogMeta(rawReq, {
      ...(moduleName ? { module: moduleName } : {}),
      ...(actionName ? { action: actionName } : {}),
      ...(reqBody ? { reqBody } : {}),
    });

    return next.handle();
  }
}
