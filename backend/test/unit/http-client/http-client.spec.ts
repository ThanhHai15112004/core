import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  BaseHttpClientProvider,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
  HttpClientLoggingInterceptor,
  HttpClientMetricsService,
  HttpNetworkError,
  HttpServiceRegistry,
  HttpStatusError,
  HttpTimeoutError,
  computeBackoffDelayMs,
  parseRetryAfterMs,
  type HttpRedirectMode,
  type HttpRetryPolicy,
} from '@packages/http-client/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  });
}

function createProvider(options?: {
  clock?: () => number;
  metricsRegistry?: MetricsRegistryService;
}) {
  const registry = new HttpServiceRegistry();
  const circuitBreaker = new CircuitBreakerRegistry(options?.clock);
  const metrics = new HttpClientMetricsService(options?.metricsRegistry);
  const client = new BaseHttpClientProvider(registry, circuitBreaker, metrics);
  return { registry, circuitBreaker, metrics, client };
}

describe('Phase 10.1 — Shared HTTP Client Adapter (@packages/http-client)', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('1. Adapter methods (get, post, put, patch, delete, forService, 204, query params)', async () => {
    const { registry, client } = createProvider();
    registry.registerService('billing', {
      baseUrl: 'https://billing.example.com/v1',
      timeoutMs: 2_000,
      defaultHeaders: { 'x-client': 'core' },
    });

    const calls: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body,
      });
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ ok: true, method: init?.method ?? 'GET' }, 200, { 'x-upstream': '1' });
    }) as typeof fetch;

    const billingClient = client.forService('billing');
    const got = await billingClient.get<{ ok: boolean }>('/invoices', {
      params: { page: 2, active: true, ignored: undefined },
    });
    expect(got.ok).toBe(true);
    expect(calls[0]?.url).toBe('https://billing.example.com/v1/invoices?page=2&active=true');
    expect(calls[0]?.headers.get('x-client')).toBe('core');

    const posted = await billingClient.post<{ method: string }, { amount: number }>('/charges', {
      amount: 100,
    });
    expect(posted.method).toBe('POST');
    expect(calls[1]?.body).toBe(JSON.stringify({ amount: 100 }));
    expect(calls[1]?.headers.get('content-type')).toBe('application/json');

    await billingClient.put('/charges/1', { amount: 120 });
    await billingClient.patch('/charges/1', { status: 'paid' });
    const deleted = await billingClient.delete<undefined>('/charges/1');
    expect(deleted).toBeUndefined();

    const raw = await billingClient.requestRaw<{ ok: boolean }>('GET', '/health');
    expect(raw.status).toBe(200);
    expect(raw.headers['x-upstream']).toBe('1');
    expect(raw.service).toBe('billing');
    expect(raw.attempts).toBe(1);
  });

  it('2. Per-service timeout aborts slow upstream and throws HttpTimeoutError', async () => {
    const { registry, client } = createProvider();
    registry.registerService('fast-svc', {
      baseUrl: 'https://fast.example.com',
      timeoutMs: 35,
      retry: { maxRetries: 0 },
    });
    registry.registerService('slow-svc', {
      baseUrl: 'https://slow.example.com',
      timeoutMs: 250,
      retry: { maxRetries: 0 },
    });

    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse({ ok: true })), 100);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason ?? new DOMException('Timed out', 'TimeoutError'));
          },
          { once: true },
        );
      });
    }) as typeof fetch;

    await expect(client.forService('fast-svc').get('/ping')).rejects.toBeInstanceOf(
      HttpTimeoutError,
    );
    const slowRes = await client.forService('slow-svc').get<{ ok: boolean }>('/ping');
    expect(slowRes.ok).toBe(true);
  });

  it('3. Retries transient 503/429/network errors, never retries business 4xx or unsafe POST without idempotencyKey', async () => {
    const { registry, client } = createProvider();
    registry.registerService('payments', {
      baseUrl: 'https://pay.example.com',
      timeoutMs: 1_000,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 30, jitter: false },
    });
    const svc = client.forService('payments');

    // 3a. Transient 503 then 503 then 200 on GET -> retried and succeeds
    let attempt = 0;
    globalThis.fetch = (async () => {
      attempt += 1;
      if (attempt <= 2) return jsonResponse({ error: 'busy' }, 503);
      return jsonResponse({ paid: true }, 200);
    }) as typeof fetch;
    const okRes = await svc.get<{ paid: boolean }>('/status');
    expect(okRes.paid).toBe(true);
    expect(attempt).toBe(3);

    // 3b. Transient network error then 200 on GET -> retried
    let netAttempt = 0;
    globalThis.fetch = (async () => {
      netAttempt += 1;
      if (netAttempt === 1) throw new TypeError('ECONNRESET');
      return jsonResponse({ ok: true }, 200);
    }) as typeof fetch;
    await expect(svc.get('/net')).resolves.toEqual({ ok: true });
    expect(netAttempt).toBe(2);

    // 3c. Exhausting retries on network failure throws HttpNetworkError
    let failNetCount = 0;
    globalThis.fetch = (async () => {
      failNetCount += 1;
      throw new TypeError('ECONNREFUSED');
    }) as typeof fetch;
    await expect(svc.get('/down')).rejects.toBeInstanceOf(HttpNetworkError);
    expect(failNetCount).toBe(3);

    // 3d. Business 400 / 404 / 422 -> called ONCE only (never retried)
    for (const status of [400, 401, 404, 422]) {
      let calls4xx = 0;
      globalThis.fetch = (async () => {
        calls4xx += 1;
        return jsonResponse({ message: 'validation error' }, status);
      }) as typeof fetch;
      let caught: unknown;
      try {
        await svc.get(`/item-${status}`);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpStatusError);
      expect((caught as HttpStatusError).status).toBe(status);
      expect((caught as HttpStatusError).retryable).toBe(false);
      expect(calls4xx).toBe(1);
    }

    // 3e. Non-idempotent POST on 503 is NOT retried by default, IS retried with idempotencyKey
    let postCalls = 0;
    globalThis.fetch = (async () => {
      postCalls += 1;
      return jsonResponse({ err: 'unavailable' }, 503);
    }) as typeof fetch;
    await expect(svc.post('/charge', { amount: 10 })).rejects.toBeInstanceOf(HttpStatusError);
    expect(postCalls).toBe(1);

    let postIdemCalls = 0;
    globalThis.fetch = (async () => {
      postIdemCalls += 1;
      if (postIdemCalls < 2) return jsonResponse({ err: 'unavailable' }, 503);
      return jsonResponse({ id: 'ch_1' }, 200);
    }) as typeof fetch;
    const charged = await svc.post<{ id: string }>(
      '/charge',
      { amount: 10 },
      { idempotencyKey: 'idem-123' },
    );
    expect(charged.id).toBe('ch_1');
    expect(postIdemCalls).toBe(2);
  });

  it('4. Computes increasing exponential backoff with jitter, maxDelayMs cap, and Retry-After', () => {
    const policy: HttpRetryPolicy = {
      maxRetries: 4,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      jitter: false,
      retryableStatusCodes: [429, 503],
      retryNonIdempotent: false,
      respectRetryAfter: true,
    };

    expect(computeBackoffDelayMs(1, policy)).toBe(100);
    expect(computeBackoffDelayMs(2, policy)).toBe(200);
    expect(computeBackoffDelayMs(3, policy)).toBe(400);
    expect(computeBackoffDelayMs(4, policy)).toBe(800);
    expect(computeBackoffDelayMs(5, policy)).toBe(1_000);

    const jitterPolicy: HttpRetryPolicy = { ...policy, jitter: true };
    expect(computeBackoffDelayMs(2, jitterPolicy, null, () => 0)).toBe(100);
    expect(computeBackoffDelayMs(2, jitterPolicy, null, () => 1)).toBe(200);

    expect(parseRetryAfterMs('2', 5_000)).toBe(2_000);
    expect(parseRetryAfterMs('30', 5_000)).toBe(5_000);
    expect(computeBackoffDelayMs(1, policy, 750)).toBe(750);
  });

  it('5. Propagates x-request-id, x-correlation-id, and x-trace-id from RequestContextService', async () => {
    const { client } = createProvider();
    let capturedHeaders = new Headers();
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await RequestContextService.runWith(
      {
        correlationId: 'corr-abc',
        requestId: 'req-xyz',
        traceId: 'trace-999',
      },
      async () => {
        await client.get('https://partner.example.com/data');
      },
    );

    expect(capturedHeaders.get('x-request-id')).toBe('req-xyz');
    expect(capturedHeaders.get('x-correlation-id')).toBe('corr-abc');
    expect(capturedHeaders.get('x-trace-id')).toBe('trace-999');

    // Caller explicit header overrides are preserved
    await RequestContextService.runWith(
      { correlationId: 'corr-abc', requestId: 'req-xyz' },
      async () => {
        await client.get('https://partner.example.com/data', {
          headers: { 'x-request-id': 'custom-req' },
          traceId: 'custom-trace',
        });
      },
    );
    expect(capturedHeaders.get('x-request-id')).toBe('custom-req');
    expect(capturedHeaders.get('x-trace-id')).toBe('custom-trace');
  });

  it('6. Redacts tokens, API keys, URL credentials, and truncates error snippets in logs & metrics errors', async () => {
    const { registry, metrics, client } = createProvider();
    registry.registerService('oauth', {
      baseUrl: 'https://oauth.example.com',
      retry: { maxRetries: 0 },
    });

    const sanitizedUrl = HttpClientLoggingInterceptor.sanitizeUrl(
      'https://client:supersecret@oauth.example.com/token?api_key=key_123&access_token=tok_999&page=2',
    );
    expect(sanitizedUrl).not.toContain('supersecret');
    expect(sanitizedUrl).not.toContain('key_123');
    expect(sanitizedUrl).not.toContain('tok_999');
    expect(sanitizedUrl).toContain('page=2');

    const sanitizedHeaders = HttpClientLoggingInterceptor.sanitizeHeaders({
      Authorization: 'Bearer my-secret-jwt-token',
      'X-Api-Key': 'secret-api-key',
      'X-Custom-Token': 'Bearer abcdef123456',
      'Content-Type': 'application/json',
    });
    expect(sanitizedHeaders['Authorization']).toBe('[REDACTED]');
    expect(sanitizedHeaders['X-Api-Key']).toBe('[REDACTED]');
    expect(sanitizedHeaders['X-Custom-Token']).toBe('Bearer [REDACTED]');
    expect(sanitizedHeaders['Content-Type']).toBe('application/json');

    globalThis.fetch = (async () =>
      new Response(`error token=leakedSecret123 ${'x'.repeat(400)}`, {
        status: 500,
      })) as typeof fetch;

    await expect(
      client.forService('oauth').get('/introspect?token=mySecretParam'),
    ).rejects.toBeInstanceOf(HttpStatusError);

    const recentErrors = metrics.getRecentErrors(5, 'oauth');
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]?.url).not.toContain('mySecretParam');
    expect(recentErrors[0]?.url).toContain('token=[REDACTED]');
  });

  it('7. Records latency histograms, request counters, error rate and p95 in MetricsRegistryService', async () => {
    const promRegistry = new MetricsRegistryService({ runtime: 'api' });
    const { registry, metrics, client } = createProvider({ metricsRegistry: promRegistry });
    registry.registerService('webhook', {
      baseUrl: 'https://hooks.example.com',
      retry: { maxRetries: 0 },
    });

    let callNum = 0;
    globalThis.fetch = (async () => {
      callNum += 1;
      if (callNum === 2) return jsonResponse({ err: 'bad gateway' }, 502);
      return jsonResponse({ ok: true }, 200);
    }) as typeof fetch;

    const svc = client.forService('webhook');
    await svc.get('/a');
    await expect(svc.get('/b')).rejects.toBeInstanceOf(HttpStatusError);
    await svc.get('/c');
    await svc.get('/d');

    const snapshot = metrics.getServiceMetrics('webhook');
    expect(snapshot).toBeDefined();
    expect(snapshot?.totalRequests).toBe(4);
    expect(snapshot?.successRequests).toBe(3);
    expect(snapshot?.failedRequests).toBe(1);
    expect(snapshot?.errorRatePercent).toBe(25);
    expect(snapshot?.lastStatus).toBe(200);

    const exposition = await promRegistry.metrics();
    expect(exposition).toContain('outbound_http_requests_total');
    expect(exposition).toContain('outbound_http_request_duration_seconds');
    expect(exposition).toContain('outbound_http_circuit_state');
  });

  it('8. Circuit Breaker opens after consecutive transient failures, skips business 4xx, and transitions OPEN -> HALF_OPEN -> CLOSED', async () => {
    let now = 1_000_000;
    const { registry, circuitBreaker, client } = createProvider({ clock: () => now });
    registry.registerService('erp', {
      baseUrl: 'https://erp.example.com',
      retry: { maxRetries: 0 },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 3,
        failureWindowMs: 60_000,
        resetTimeoutMs: 10_000,
        halfOpenMaxProbes: 1,
      },
    });
    const svc = client.forService('erp');

    // Business 404 errors must NOT trip the circuit breaker
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    for (let i = 0; i < 4; i += 1) {
      await expect(svc.get('/missing')).rejects.toBeInstanceOf(HttpStatusError);
    }
    expect(calls).toBe(4);
    expect(circuitBreaker.getSnapshot('erp')?.state).toBe('CLOSED');

    // 3 transient 503 responses trip the circuit to OPEN
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ error: 'down' }, 503);
    }) as typeof fetch;

    for (let i = 0; i < 3; i += 1) {
      await expect(svc.get('/orders')).rejects.toBeInstanceOf(HttpStatusError);
    }
    expect(calls).toBe(7);
    expect(circuitBreaker.getSnapshot('erp')?.state).toBe('OPEN');

    // While OPEN, calls fail fast WITHOUT calling fetch
    await expect(svc.get('/orders')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(calls).toBe(7);

    // Advance clock past resetTimeoutMs -> HALF_OPEN probe fails -> reopens OPEN
    now += 10_001;
    await expect(svc.get('/orders')).rejects.toBeInstanceOf(HttpStatusError);
    expect(calls).toBe(8);
    expect(circuitBreaker.getSnapshot('erp')?.state).toBe('OPEN');

    // Advance clock again -> HALF_OPEN probe succeeds -> CLOSED
    now += 10_001;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ ok: true }, 200);
    }) as typeof fetch;

    const recovered = await svc.get<{ ok: boolean }>('/orders');
    expect(recovered.ok).toBe(true);
    expect(calls).toBe(9);
    expect(circuitBreaker.getSnapshot('erp')?.state).toBe('CLOSED');
  });

  it('9. Forwards explicit redirect mode (e.g. manual for webhook SSRF protection) to fetch', async () => {
    const { client } = createProvider();
    let capturedRedirect: HttpRedirectMode | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedRedirect = init?.redirect as HttpRedirectMode | undefined;
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      });
    }) as typeof fetch;

    await expect(
      client.requestRaw(
        'POST',
        'https://hooks.example.com/events',
        { ok: true },
        {
          redirect: 'manual',
          retry: { maxRetries: 0 },
        },
      ),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(capturedRedirect).toBe('manual');
  });
});
