import { Injectable, type OnModuleInit } from '@nestjs/common';
import { QUEUES, QueueRegistry } from '@packages/messaging/index.js';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
} from '@packages/runtime/index.js';
import { SystemProcessor } from '../processors/system/system.processor.js';

@Injectable()
export class WorkerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly processor: SystemProcessor,
    private readonly queues: QueueRegistry,
  ) {}

  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  private readonly queueName = QUEUES.SYSTEM_EVENTS;
  private last: { processed: number; at: number } | null = null;

  /** Job/phút giữa hai lần thu thập (null ở lần đầu). */
  private jobsPerMinute(): number | null {
    const now = Date.now();
    const cur = { processed: this.processor.processed, at: now };
    const prev = this.last;
    this.last = cur;
    if (!prev || now <= prev.at) return null;
    return Math.round(((cur.processed - prev.processed) / (now - prev.at)) * 60_000 * 100) / 100;
  }

  public describe(): RuntimeDescriptor {
    return {
      type: 'queue-consumer',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: withVersion('BullMQ', 'bullmq'),
      entrypoint: 'apps/worker/main.ts',
      sourcePath: 'backend/src/apps/worker/',
      details: { queue: this.queueName, concurrency: this.processor.concurrency },
    };
  }

  /** Số job đọc thẳng từ BullMQ (`getJobCounts`, `getWorkersCount`); throughput/thời gian xử lý ở Prometheus. */
  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    const queue = this.queues.get(this.queueName);
    const [counts, consumers] = await Promise.all([
      this.queues
        .withTimeout(queue.getJobCounts('active', 'waiting', 'delayed', 'failed', 'completed'))
        .catch(() => null),
      this.queues.withTimeout(queue.getWorkersCount()).catch(() => null),
    ]);
    return {
      activeJobs: counts?.['active'] ?? null,
      waitingJobs: counts?.['waiting'] ?? null,
      delayedJobs: counts?.['delayed'] ?? null,
      failedJobs: counts?.['failed'] ?? null,
      completedJobs: counts?.['completed'] ?? null,
      consumers,
      concurrency: this.processor.concurrency,
      jobsPerMinute: this.jobsPerMinute(),
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
        consumed: name === this.queueName,
      })),
    );
    return { queues, paused: this.processor.worker.isPaused() };
  }

  /** Ngừng lấy job mới, chờ job đang chạy xong (lệnh pause từ Console). */
  public async pause(): Promise<void> {
    await this.processor.worker.pause();
  }

  public async resume(): Promise<void> {
    this.processor.worker.resume();
  }

  /** Đóng worker sau khi hoàn tất job đang xử lý. */
  public async drain(): Promise<void> {
    await this.processor.worker.close();
  }
}
