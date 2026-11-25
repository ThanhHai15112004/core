import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Traced } from '@packages/tracing/decorators/traced.decorator.js';
import { SpanBufferProcessor } from '@packages/tracing/processors/span-buffer.processor.js';
import { runInSpan } from '@packages/tracing/utils/span.util.js';

class PilotUseCaseService {
  @Traced('usecase.pilot.execute')
  public async execute(input: { email: string; password: string }): Promise<string> {
    return runInSpan('usecase.pilot.step', { category: 'usecase' }, () => `ok:${input.email}`);
  }

  @Traced('usecase.pilot.fail')
  public async failNow(): Promise<void> {
    throw new Error('Use case failed');
  }
}

describe('@Traced UseCase Decorator & SpanBuffer Unit Tests', () => {
  let buffer: SpanBufferProcessor;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    buffer = new SpanBufferProcessor({
      maxSize: 50,
      runtime: 'api',
      serviceName: 'core-test',
    });
    provider = new NodeTracerProvider({ spanProcessors: [buffer] });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it('creates parent-child usecase spans without capturing sensitive input arguments', async () => {
    const svc = new PilotUseCaseService();
    const res = await svc.execute({ email: 'a@b.com', password: 'raw-secret-password' });
    expect(res).toBe('ok:a@b.com');

    const recent = await buffer.getRecentTraces(10);
    expect(recent).toHaveLength(1);
    const spans = await buffer.getSpansByTraceId(recent[0]!.traceId);
    expect(spans).toHaveLength(2);

    const root = spans.find((s) => s.name === 'usecase.pilot.execute');
    const child = spans.find((s) => s.name === 'usecase.pilot.step');
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(root?.category).toBe('usecase');
    expect(root?.attributes['code.namespace']).toBe('PilotUseCaseService');
    expect(root?.attributes['code.function']).toBe('execute');
    expect(child?.parentSpanId).toBe(root?.spanId);
    expect(JSON.stringify(spans)).not.toContain('raw-secret-password');
  });

  it('records exception and error status when traced method rejects', async () => {
    const svc = new PilotUseCaseService();
    await expect(svc.failNow()).rejects.toThrow('Use case failed');

    const recent = await buffer.getRecentTraces(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.status).toBe('error');

    const spans = await buffer.getSpansByTraceId(recent[0]!.traceId);
    expect(spans[0]?.status).toBe('error');
    expect(spans[0]?.statusMessage).toBe('Use case failed');
  });
});
