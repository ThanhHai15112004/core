import { describe, it, expect } from '@jest/globals';
import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import {
  RouteFilteringSampler,
  buildBaseSampler,
  shouldIgnoreRoute,
} from '@packages/tracing/samplers/route-filtering.sampler.js';

describe('RouteFilteringSampler & Sampling Strategy Unit Tests', () => {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

  it('identifies ignored routes with or without /api/v1 prefix and query string', () => {
    const ignored = ['/health', '/metrics', '/ops'];
    expect(shouldIgnoreRoute('/health', ignored)).toBe(true);
    expect(shouldIgnoreRoute('/api/v1/health/ready', ignored)).toBe(true);
    expect(shouldIgnoreRoute('/metrics?format=prom', ignored)).toBe(true);
    expect(shouldIgnoreRoute('/api/v1/ops/logs/trace/123', ignored)).toBe(true);
    expect(shouldIgnoreRoute('/api/v1/users', ignored)).toBe(false);
    expect(shouldIgnoreRoute('/api/v1/operations', ignored)).toBe(false);
  });

  it('drops ignored routes before delegating to inner sampler', () => {
    const sampler = new RouteFilteringSampler(buildBaseSampler('always_on', 1), [
      '/health',
      '/metrics',
      '/ops',
    ]);

    const dropped = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'GET /api/v1/health',
      SpanKind.SERVER,
      { 'url.path': '/api/v1/health' },
      [],
    );
    expect(dropped.decision).toBe(SamplingDecision.NOT_RECORD);

    const sampled = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'POST /api/v1/users',
      SpanKind.SERVER,
      { 'url.path': '/api/v1/users' },
      [],
    );
    expect(sampled.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('respects always_off, ratio=0, ratio=1, and parentbased_traceidratio inheritance', () => {
    const offSampler = new RouteFilteringSampler(buildBaseSampler('always_off', 1), []);
    expect(
      offSampler.shouldSample(ROOT_CONTEXT, traceId, 'op', SpanKind.INTERNAL, {}, []).decision,
    ).toBe(SamplingDecision.NOT_RECORD);

    const zeroSampler = new RouteFilteringSampler(
      buildBaseSampler('parentbased_traceidratio', 0),
      [],
    );
    expect(
      zeroSampler.shouldSample(ROOT_CONTEXT, traceId, 'op', SpanKind.INTERNAL, {}, []).decision,
    ).toBe(SamplingDecision.NOT_RECORD);

    // Parent đã được lấy mẫu -> ParentBasedSampler phải giữ quyết định sampled bất chấp ratio=0
    const sampledParentCtx = trace.setSpanContext(ROOT_CONTEXT, {
      traceId,
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
    expect(
      zeroSampler.shouldSample(sampledParentCtx, traceId, 'child', SpanKind.INTERNAL, {}, [])
        .decision,
    ).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });
});
