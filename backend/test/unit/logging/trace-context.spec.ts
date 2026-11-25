import { describe, it, expect } from '@jest/globals';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestContextService } from '@packages/logging/context/request-context.service.js';
import { requestContextMiddleware } from '@packages/logging/middleware/request-context.middleware.js';
import { measureDurationMs } from '@packages/logging/utils/duration.util.js';
import { getHttpLogMeta } from '@packages/logging/utils/http-log-meta.js';
import { toLogEntry } from '@packages/logging/utils/log-entry.js';
import { parseTraceParent, resolveTraceId } from '@packages/logging/utils/request-id.js';

function createMockHttp(headers: Record<string, string | undefined> = {}) {
  const resHeaders = new Map<string, string>();
  const req = {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      resHeaders.set(name.toLowerCase(), value);
    },
  } as unknown as ServerResponse;
  return { req, res, resHeaders };
}

describe('Trace & RequestContext Unit Tests', () => {
  it('parses valid W3C traceparent and rejects invalid or zero traceIds', () => {
    expect(parseTraceParent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    );
    expect(parseTraceParent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceParent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceParent('invalid-header')).toBeNull();
  });

  it('resolves traceId from traceparent, x-trace-id, or generates 32-hex id', () => {
    const { req: req1, res: res1, resHeaders: h1 } = createMockHttp({
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    });
    expect(resolveTraceId(req1, res1)).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(h1.get('x-trace-id')).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    const { req: req2, res: res2, resHeaders: h2 } = createMockHttp({
      'x-trace-id': 'custom-trace-123',
    });
    expect(resolveTraceId(req2, res2)).toBe('custom-trace-123');
    expect(h2.get('x-trace-id')).toBe('custom-trace-123');

    const { req: req3, res: res3, resHeaders: h3 } = createMockHttp({});
    const generated = resolveTraceId(req3, res3);
    expect(generated).toMatch(/^[0-9a-f]{32}$/);
    expect(h3.get('x-trace-id')).toBe(generated);
  });

  it('requestContextMiddleware populates correlationId, requestId, traceId, and http meta', () => {
    const { req, res, resHeaders } = createMockHttp({
      'x-correlation-id': 'corr-1',
      'x-request-id': 'req-1',
      'x-trace-id': 'trace-1',
    });

    let captured: ReturnType<typeof RequestContextService.current>;
    requestContextMiddleware(req, res, () => {
      captured = RequestContextService.current();
    });

    expect(captured?.correlationId).toBe('corr-1');
    expect(captured?.requestId).toBe('req-1');
    expect(captured?.traceId).toBe('trace-1');
    expect(RequestContextService.withLogContext({ module: 'Users', action: 'create' }, () => RequestContextService.current()?.action)).toBe('create');
    expect(resHeaders.get('x-correlation-id')).toBe('corr-1');
    expect(resHeaders.get('x-request-id')).toBe('req-1');
    expect(resHeaders.get('x-trace-id')).toBe('trace-1');

    const meta = getHttpLogMeta(req);
    expect(meta?.correlationId).toBe('corr-1');
    expect(meta?.requestId).toBe('req-1');
    expect(meta?.traceId).toBe('trace-1');
  });

  it('measureDurationMs and toLogEntry preserve service, module, action, traceId, and slowRequest', async () => {
    const measured = await measureDurationMs(async () => 'done');
    expect(measured.result).toBe('done');
    expect(measured.durationMs).toBeGreaterThanOrEqual(0);

    const raw = JSON.stringify({
      level: 40,
      time: 1700000000000,
      msg: 'Slow request',
      service: 'core-api',
      runtime: 'api',
      module: 'Users',
      action: 'UsersController.create',
      reqId: 'corr-9',
      requestId: 'req-9',
      correlationId: 'corr-9',
      traceId: 'trace-9',
      responseTime: 1520,
      slowRequest: true,
      reqBody: { email: 'u@example.com' },
    });

    const entry = toLogEntry('1700000000000-0', raw);
    expect(entry).not.toBeNull();
    expect(entry?.service).toBe('core-api');
    expect(entry?.context).toBe('Users');
    expect(entry?.action).toBe('UsersController.create');
    expect(entry?.requestId).toBe('req-9');
    expect(entry?.correlationId).toBe('corr-9');
    expect(entry?.traceId).toBe('trace-9');
    expect(entry?.durationMs).toBe(1520);
    expect(entry?.slowRequest).toBe(true);
    expect(entry?.metadata?.reqBody).toEqual({ email: 'u@example.com' });
  });
});
