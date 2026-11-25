import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, type Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import {
  HTTP_STATUS_CODE,
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_OUTCOME,
  IDEMPOTENCY_SCOPE,
  IdempotencyInProgressException,
  IdempotencyKeyInvalidException,
  IdempotencyKeyRequiredException,
  IdempotencyPayloadMismatchException,
  IdempotencyRegistryService,
  computeIdempotencyFingerprint,
  defaultIdempotencyRegistry,
  normalizeIdempotencyKey,
  redactIdempotencyResponsePayload,
} from '@packages/kernel/index.js';
import {
  IDEMPOTENCY_METADATA_KEY,
  type IdempotentOptions,
} from '../decorators/idempotent.decorator.js';
import { maskIp } from '../utils/capture.js';

interface RequestWithOptionalUser extends FastifyRequest {
  user?: {
    id?: string | number;
    clientId?: string;
    serviceAccountId?: string | number;
    authType?: string;
  };
}

function readHeaderValue(
  headers: FastifyRequest['headers'],
  headerName: string,
): string | undefined {
  const raw = headers[headerName.toLowerCase()];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : undefined;
  }
  return typeof raw === 'string' ? raw : undefined;
}

function resolveScopeTarget(request: FastifyRequest, configuredTarget?: string): string {
  if (configuredTarget?.trim()) {
    return configuredTarget.trim();
  }
  const method = (request.method || 'POST').toUpperCase();
  const routeUrl = request.routeOptions?.url;
  const rawUrl = typeof request.url === 'string' ? request.url.split('?')[0] || '/' : '/';
  return `${method} ${routeUrl || rawUrl}`;
}

function resolveClientIdentifier(request: RequestWithOptionalUser): string {
  const user = request.user;
  if (user?.clientId) {
    return `client:${String(user.clientId)}`;
  }
  if (user?.serviceAccountId !== undefined && user.serviceAccountId !== null) {
    return `service:${String(user.serviceAccountId)}`;
  }
  if (user?.id !== undefined && user.id !== null) {
    return `user:${String(user.id)}`;
  }
  const masked = maskIp(request.ip);
  return masked ? `ip:${masked}` : 'anonymous';
}

function serializeSafeReplayBody(data: unknown, maxBytes: number): unknown {
  if (data === undefined || data === null) return null;
  const redacted = redactIdempotencyResponsePayload(data);
  try {
    const serialized = JSON.stringify(redacted);
    if (serialized && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      return {
        idempotentReplayed: true,
        responseTruncated: true,
        maxResponseBytes: maxBytes,
      };
    }
    return redacted;
  } catch {
    return null;
  }
}

/**
 * HTTP Interceptor chống xử lý trùng cho các endpoint gắn `@Idempotent(...)` (Phase 11.3):
 * - Đọc header `Idempotency-Key` (hoặc tên header cấu hình riêng).
 * - Tính dấu vân tay SHA-256 từ `method + route + params + query + body`.
 * - Trùng key + khớp dữ liệu đã `COMPLETED` → trả lại kết quả cũ kèm header `Idempotency-Replayed: true`.
 * - Trùng key + khác dữ liệu → ném `409 Conflict` (`IDEMPOTENCY_PAYLOAD_MISMATCH`).
 * - Trùng key đang xử lý song song → ném `409 Conflict` (`IDEMPOTENCY_IN_PROGRESS`).
 * - Xử lý thất bại → đánh dấu `FAILED` để client có thể retry hợp lệ cùng key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly idempotencyRegistry: IdempotencyRegistryService;

  constructor(
    @Optional() private readonly reflector?: Reflector,
    @Optional()
    @Inject(IdempotencyRegistryService)
    idempotencyRegistry?: IdempotencyRegistryService,
  ) {
    this.idempotencyRegistry = idempotencyRegistry ?? defaultIdempotencyRegistry;
  }

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const options = this.resolveOptions(context);
    if (!options) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithOptionalUser>();
    const reply = http.getResponse<FastifyReply>();
    const headerName = (options.headerName ?? IDEMPOTENCY_DEFAULTS.HEADER_NAME).toLowerCase();
    const rawKey = readHeaderValue(request.headers, headerName);

    if (rawKey === undefined || rawKey.trim().length === 0) {
      if (options.required) {
        return throwError(() => new IdempotencyKeyRequiredException(headerName));
      }
      return next.handle();
    }

    const idempotencyKey = normalizeIdempotencyKey(rawKey, IDEMPOTENCY_DEFAULTS.MAX_KEY_LENGTH);
    if (!idempotencyKey) {
      return throwError(
        () => new IdempotencyKeyInvalidException(headerName, IDEMPOTENCY_DEFAULTS.MAX_KEY_LENGTH),
      );
    }

    const scopeTarget = resolveScopeTarget(request, options.scopeTarget);
    const clientIdentifier = resolveClientIdentifier(request);
    const correlationId =
      readHeaderValue(request.headers, 'x-correlation-id') ??
      readHeaderValue(request.headers, 'x-request-id') ??
      (typeof request.id === 'string' ? request.id : null);
    const lockOwner = typeof request.id === 'string' && request.id ? request.id : correlationId;

    const fingerprintInput: Record<string, unknown> = {
      method: (request.method || 'POST').toUpperCase(),
      scopeTarget,
      params: request.params ?? {},
      body: request.body ?? null,
    };
    if (options.includeQueryInFingerprint !== false) {
      fingerprintInput['query'] = request.query ?? {};
    }
    const requestFingerprint = computeIdempotencyFingerprint(fingerprintInput);
    const maxResponseBytes = options.maxResponseBytes ?? IDEMPOTENCY_DEFAULTS.MAX_RESPONSE_BYTES;

    return from(
      this.idempotencyRegistry.acquire({
        scope: IDEMPOTENCY_SCOPE.API,
        scopeTarget,
        idempotencyKey,
        requestFingerprint,
        ttlSec: options.ttlSec,
        leaseSec: options.leaseSec,
        lockOwner,
        clientIdentifier,
        correlationId,
      }),
    ).pipe(
      mergeMap((acquired) => {
        if (acquired.outcome === IDEMPOTENCY_OUTCOME.PAYLOAD_MISMATCH) {
          return throwError(
            () =>
              new IdempotencyPayloadMismatchException({
                scope: IDEMPOTENCY_SCOPE.API,
                scopeTarget,
                idempotencyKey,
                reason: 'Idempotency-Key was already used with a different request payload',
              }),
          );
        }

        if (acquired.outcome === IDEMPOTENCY_OUTCOME.IN_PROGRESS) {
          return throwError(
            () =>
              new IdempotencyInProgressException({
                scope: IDEMPOTENCY_SCOPE.API,
                scopeTarget,
                idempotencyKey,
                reason:
                  'Another request with the same Idempotency-Key is currently being processed',
              }),
          );
        }

        if (acquired.outcome === IDEMPOTENCY_OUTCOME.REPLAYED) {
          const replayStatus = acquired.response?.statusCode ?? HTTP_STATUS_CODE.OK;
          if (typeof reply.header === 'function') {
            reply.header(IDEMPOTENCY_DEFAULTS.REPLAYED_HEADER_NAME, 'true');
            const storedHeaders = acquired.response?.headers ?? {};
            for (const [k, v] of Object.entries(storedHeaders)) {
              if (k.toLowerCase() !== 'content-length') {
                reply.header(k, v);
              }
            }
          }
          if (typeof reply.status === 'function') {
            reply.status(replayStatus);
          } else {
            reply.statusCode = replayStatus;
          }
          return of(acquired.response?.body ?? null);
        }

        return next.handle().pipe(
          mergeMap((data) => {
            const statusCode = reply.statusCode || HTTP_STATUS_CODE.OK;
            const safeBody = serializeSafeReplayBody(data, maxResponseBytes);
            return from(
              this.idempotencyRegistry.complete({
                scope: IDEMPOTENCY_SCOPE.API,
                scopeTarget,
                idempotencyKey,
                recordId: acquired.recordId,
                lockOwner: acquired.lockOwner,
                statusCode,
                responseBody: safeBody,
              }),
            ).pipe(mergeMap(() => of(data)));
          }),
          catchError((err: unknown) => {
            const errCode =
              typeof err === 'object' && err !== null && 'code' in err
                ? String((err as { code?: unknown }).code ?? 'REQUEST_FAILED')
                : err instanceof Error
                  ? err.name
                  : 'REQUEST_FAILED';
            const errMessage = err instanceof Error ? err.message : String(err);
            return from(
              this.idempotencyRegistry.fail({
                scope: IDEMPOTENCY_SCOPE.API,
                scopeTarget,
                idempotencyKey,
                recordId: acquired.recordId,
                lockOwner: acquired.lockOwner,
                errorCode: errCode.slice(0, 80),
                errorMessage: errMessage.slice(0, 1000),
              }),
            ).pipe(mergeMap(() => throwError(() => err)));
          }),
        );
      }),
    );
  }

  private resolveOptions(context: ExecutionContext): IdempotentOptions | undefined {
    if (!this.reflector) {
      return undefined;
    }
    return this.reflector.getAllAndOverride<IdempotentOptions>(IDEMPOTENCY_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
