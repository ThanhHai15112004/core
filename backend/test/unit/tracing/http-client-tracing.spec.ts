import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BaseHttpClientProvider,
  CircuitBreakerRegistry,
  HttpClientMetricsService,
  HttpServiceRegistry,
} from '@packages/http-client/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { SpanBufferProcessor } from '@packages/tracing/processors/span-buffer.processor.js';
import { runInSpan } from '@packages/tracing/utils/span.util.js';

const originalFetch = globalThis.fetch;

describe('Outbound HTTP Client Tracing Unit Tests', () => {
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
    globalThis.fetch = originalFetch;
    await provider.shutdown();
    trace.disable();
    propagation.disable();
  });

  it('creates CLIENT span with peer.service, sanitized URL, and injects W3C traceparent header', async () => {
    const registry = new HttpServiceRegistry();
    registry.registerService('vnpay', {
      baseUrl: 'https://sandbox.vnpayment.vn',
      timeoutMs: 2000,
    });
    const client = new BaseHttpClientProvider(
      registry,
      new CircuitBreakerRegistry(),
      new HttpClientMetricsService(new MetricsRegistryService({ runtime: 'test' })),
    );

    let outboundTraceparent: string | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      outboundTraceparent = new Headers(init?.headers).get('traceparent');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    await runInSpan('usecase.payments.create', { category: 'usecase' }, async () => {
      const res = await client
        .forService('vnpay')
        .post<{ ok: boolean }>('/pay?apiKey=secret_val', { amount: 100 });
      expect(res.ok).toBe(true);
    });

    const recent = await buffer.getRecentTraces(10);
    expect(recent).toHaveLength(1);
    const spans = await buffer.getSpansByTraceId(recent[0]!.traceId);
    expect(spans).toHaveLength(2);

    const parent = spans.find((s) => s.name === 'usecase.payments.create');
    const httpSpan = spans.find((s) => s.name === 'HTTP POST vnpay');
    expect(parent).toBeDefined();
    expect(httpSpan).toBeDefined();
    expect(httpSpan?.parentSpanId).toBe(parent?.spanId);
    expect(httpSpan?.category).toBe('http');
    expect(httpSpan?.kind).toBe('client');
    expect(httpSpan?.attributes['peer.service']).toBe('vnpay');
    expect(httpSpan?.attributes['http.response.status_code']).toBe(200);
    expect(String(httpSpan?.attributes['url.full'] ?? '')).not.toContain('secret_val');
    expect(outboundTraceparent).toBe(`00-${recent[0]!.traceId}-${httpSpan!.spanId}-01`);
  });

  it('marks HTTP span as error when downstream fails with 5xx', async () => {
    const registry = new HttpServiceRegistry();
    registry.registerService('sms', {
      baseUrl: 'https://sms.example.com',
      timeoutMs: 2000,
      retry: { maxRetries: 0 },
    });
    const client = new BaseHttpClientProvider(
      registry,
      new CircuitBreakerRegistry(),
      new HttpClientMetricsService(new MetricsRegistryService({ runtime: 'test' })),
    );

    globalThis.fetch = (async () =>
      new Response('gateway down', { status: 503 })) as typeof globalThis.fetch;

    await expect(client.forService('sms').get('/send')).rejects.toThrow();

    const recent = await buffer.getRecentTraces(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.status).toBe('error');
    const spans = await buffer.getSpansByTraceId(recent[0]!.traceId);
    expect(spans[0]?.status).toBe('error');
    expect(spans[0]?.attributes['http.response.status_code']).toBe(503);
  });
});
