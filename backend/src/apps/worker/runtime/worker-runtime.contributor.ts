import { Injectable, type OnModuleInit } from '@nestjs/common';
import { QueueRegistry } from '@packages/messaging/index.js';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
  type RuntimeIssue,
} from '@packages/runtime/index.js';
import { QueueConsumerService } from '../consumers/queue-consumer.service.js';

@Injectable()
export class WorkerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly consumer: QueueConsumerService,
    private readonly queues: QueueRegistry,
  ) {}

  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  public describe(): RuntimeDescriptor {
    return {
      type: 'queue-consumer',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: withVersion('BullMQ', 'bullmq'),
      entrypoint: 'apps/worker/main.ts',
      sourcePath: 'backend/src/apps/worker/',
      details: { queue: this.consumer.queueName, concurrency: this.consumer.concurrency },
    };
  }

  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    const queue = this.queues.get(this.consumer.queueName);
    const [counts, consumers] = await Promise.all([
      this.queues
        .withTimeout(queue.getJobCounts('active', 'waiting', 'delayed', 'failed', 'completed'))
        .catch(() => null),
      this.queues.withTimeout(queue.getWorkersCount()).catch(() => null),
    ]);
    const stats = this.consumer.stats();

    return {
      activeJobs: counts?.['active'] ?? null,
      waitingJobs: counts?.['waiting'] ?? null,
      delayedJobs: counts?.['delayed'] ?? null,
      failedJobs: counts?.['failed'] ?? null,
      completedJobs: counts?.['completed'] ?? null,
      jobsPerMinute: stats.jobsPerMinute,
      avgJobDurationMs: stats.avgDurationMs,
      failedLastMinute: stats.failedLastMinute,
      consumers,
      concurrency: this.consumer.concurrency,
    };
  }

  /** Số job theo từng queue đã khai báo. */
  public async collectDetails(): Promise<Record<string, unknown>> {
    const queues = await Promise.all(
      this.queues.names().map(async (name) => ({
        name,
        counts: await this.queues
          .withTimeout(
            this.queues
              .get(name)
              .getJobCounts('active', 'waiting', 'delayed', 'failed', 'completed'),
          )
          .catch(() => null),
        consumed: name === this.consumer.queueName,
      })),
    );
    return { queues, paused: this.consumer.isPaused() };
  }

  public async collectIssues(): Promise<RuntimeIssue[]> {
    const { failedLastMinute } = this.consumer.stats();
    return failedLastMinute > 0
      ? [{ key: 'runtime.issue.jobsFailing', params: { count: failedLastMinute } }]
      : [];
  }

  public pause(): Promise<void> {
    return this.consumer.pause();
  }

  public resume(): Promise<void> {
    return this.consumer.resume();
  }

  public drain(): Promise<void> {
    return this.consumer.drain();
  }
}
