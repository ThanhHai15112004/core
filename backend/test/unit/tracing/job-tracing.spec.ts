import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { Job } from 'bullmq';
import { BaseQueueProcessor } from '@apps/worker/processors/base-queue.processor.js';
import type { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/context/request-context.service.js';
import {
  BaseMessagePublisherProvider,
  QUEUES,
  type MessageEnvelope,
  type QueueRegistry,
} from '@packages/messaging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { SpanBufferProcessor } from '@packages/tracing/processors/span-buffer.processor.js';
import { runInSpan } from '@packages/tracing/utils/span.util.js';

class PilotWorkerProcessor extends BaseQueueProcessor {
  protected readonly logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as BaseQueueProcessor['logger'];
  public readonly queueName = QUEUES.SYSTEM_EVENTS;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    private readonly handler: (env: MessageEnvelope, job: Job) => Promise<unknown>,
  ) {
    super(config, metrics);
  }

  public get concurrency(): number {
    return 1;
  }

  protected handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    return this.handler(envelope, job);
  }
}

describe('Job Producer <-> Worker Distributed Tracing Unit Tests', () => {
  let buffer: SpanBufferProcessor;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    buffer = new SpanBufferProcessor({
      maxSize: 50,
      runtime: 'api+worker',
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

  it('propagates OpenTelemetry traceContext from API publish() to Worker process()', async () => {
    const addedJobs: Array<{ name: string; data: MessageEnvelope }> = [];
    const fakeQueues = {
      get: () => ({
        add: async (name: string, data: MessageEnvelope) => {
          addedJobs.push({ name, data });
        },
      }),
      withTimeout: async <T>(p: Promise<T>) => p,
      jobOptions: () => ({ attempts: 1 }),
    } as unknown as QueueRegistry;

    const metrics = new MetricsRegistryService({ runtime: 'test' });
    const publisher = new BaseMessagePublisherProvider(fakeQueues, metrics, undefined, {
      id: 'api',
      kind: 'long-running',
    });

    const envelope = await runInSpan('POST /api/v1/exports', { category: 'api' }, () =>
      RequestContextService.runWith({ correlationId: 'corr-job-1' }, () =>
        publisher.publish('export.generate', { exportId: 42 }, QUEUES.SYSTEM_EVENTS),
      ),
    );

    expect(envelope.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(envelope.meta?.traceContext?.['traceparent']).toMatch(
      new RegExp(`^00-${envelope.traceId}-[0-9a-f]{16}-01$`),
    );

    let workerTraceId: string | undefined;
    let workerSpanId: string | undefined;
    const fakeConfig = {
      runtime: { worker: { jobTimeoutMs: 5000 } },
      scheduler: { lockTtlSec: 60 },
    } as unknown as CoreConfigService;

    const processor = new PilotWorkerProcessor(fakeConfig, metrics, async () => {
      workerTraceId = RequestContextService.currentTraceId();
      workerSpanId = RequestContextService.currentSpanId();
      return runInSpan('usecase.export.run', { category: 'usecase' }, () => ({ ok: true }));
    });

    const fakeJob = {
      id: envelope.id,
      name: envelope.topic,
      queueName: QUEUES.SYSTEM_EVENTS,
      data: addedJobs[0]!.data,
      attemptsMade: 0,
      attemptsStarted: 1,
      timestamp: Date.now() - 10,
      processedOn: Date.now(),
      opts: { attempts: 1 },
    } as unknown as Job;

    await processor.process(fakeJob);

    expect(workerTraceId).toBe(envelope.traceId);
    expect(workerSpanId).toMatch(/^[0-9a-f]{16}$/);

    const spans = await buffer.getSpansByTraceId(envelope.traceId!);
    expect(spans).toHaveLength(4);

    const apiSpan = spans.find((s) => s.name === 'POST /api/v1/exports');
    const producerSpan = spans.find(
      (s) => s.name === 'queue.publish system.events/export.generate',
    );
    const consumerSpan = spans.find(
      (s) => s.name === 'queue.process system.events/export.generate',
    );
    const usecaseSpan = spans.find((s) => s.name === 'usecase.export.run');

    expect(apiSpan).toBeDefined();
    expect(producerSpan?.parentSpanId).toBe(apiSpan?.spanId);
    expect(producerSpan?.kind).toBe('producer');
    expect(consumerSpan?.parentSpanId).toBe(producerSpan?.spanId);
    expect(consumerSpan?.kind).toBe('consumer');
    expect(usecaseSpan?.parentSpanId).toBe(consumerSpan?.spanId);
  });
});
