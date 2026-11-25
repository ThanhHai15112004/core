import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { RequestContextService } from '@packages/logging/context/request-context.service.js';
import { requestContextMiddleware } from '@packages/logging/middleware/request-context.middleware.js';
import { createHttpTracingMiddleware } from '@packages/tracing/middleware/http-tracing.middleware.js';
import { SpanBufferProcessor } from '@packages/tracing/processors/span-buffer.processor.js';
import { finishHttpTraceSpan } from '@packages/tracing/utils/http-trace-meta.js';
import { getActiveSpanContext } from '@packages/tracing/utils/trace-context.util.js';

function createMockHttp(url: string, headers: Record<string, string> = {}) {
  const resHeaders = new Map<string, string>();
  const emitter = new EventEmitter();
  const req = {
    method: 'POST',
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;

  const res = Object.assign(emitter, {
    statusCode: 201,
    headersSent: false,
    setHeader(name: string, value: string) {
      resHeaders.set(name.toLowerCase(), value);
    },
  }) as unknown as ServerResponse;

  return { req, res, resHeaders };
}

describe('HTTP Tracing & Logging Context Sync Unit Tests', () => {
  let buffer: SpanBufferProcessor;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    buffer = new SpanBufferProcessor({
      maxSize: 50,
      runtime: 'api',
      serviceName: 'core-test',
    });
    provider = new NodeTracerProvider({ spanProcessors: [buffer] });
    provider.register({ propagator: new W3CTraceContextPropagator() });
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
    propagation.disable();
  });

  it('opens SERVER span, extracts incoming traceparent, and syncs traceId & spanId into RequestContext', async () => {
    const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const incomingParentSpanId = '00f067aa0ba902b7';
    const { req, res, resHeaders } = createMockHttp('/api/v1/users?page=1', {
      traceparent: `00-${incomingTraceId}-${incomingParentSpanId}-01`,
    });

    const tracingMiddleware = createHttpTracingMiddleware(() => ({ enabled: true }));
    const captured: {
      store: ReturnType<typeof RequestContextService.current>;
      sc: ReturnType<typeof getActiveSpanContext>;
    } = { store: undefined, sc: null };

    tracingMiddleware(req, res, () => {
      requestContextMiddleware(req, res, () => {
        captured.store = RequestContextService.current();
        captured.sc = getActiveSpanContext();
      });
    });

    finishHttpTraceSpan(req, 201, '/api/v1/users', 'POST');

    expect(captured.sc?.traceId).toBe(incomingTraceId);
    expect(captured.store?.traceId).toBe(incomingTraceId);
    expect(captured.store?.spanId).toBe(captured.sc?.spanId);
    expect(resHeaders.get('x-trace-id')).toBe(incomingTraceId);
    expect(resHeaders.get('traceparent')).toBe(`00-${incomingTraceId}-${captured.sc?.spanId}-01`);

    const spans = await buffer.getSpansByTraceId(incomingTraceId);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('POST /api/v1/users');
    expect(spans[0]!.kind).toBe('server');
    expect(spans[0]!.category).toBe('api');
    expect(spans[0]!.parentSpanId).toBe(incomingParentSpanId);
    expect(spans[0]!.attributes['http.route']).toBe('/api/v1/users');
    expect(spans[0]!.attributes['http.response.status_code']).toBe(201);
  });
});
