import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { QUEUES, QueueRegistry } from '@packages/messaging/index.js';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
} from '@packages/runtime/index.js';
import type { BaseQueueProcessor } from '../processors/base-queue.processor.js';
import { SystemProcessor } from '../processors/system/system.processor.js';
import { CriticalProcessor } from '../processors/critical/critical.processor.js';
import { NotificationsProcessor } from '../processors/notifications/notifications.processor.js';
import { HeavyJobProcessor } from '../processors/heavy/heavy-job.processor.js';

@Injectable()
export class WorkerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  private readonly processors: BaseQueueProcessor[];

  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly processor: SystemProcessor,
    private readonly queues: QueueRegistry,
    @Optional() criticalProcessor?: CriticalProcessor,
    @Optional() notificationsProcessor?: NotificationsProcessor,
    @Optional() heavyJobProcessor?: HeavyJobProcessor,
  ) {
    this.processors = [
      processor,
      ...(criticalProcessor ? [criticalProcessor] : []),
      ...(notificationsProcessor ? [notificationsProcessor] : []),
      ...(heavyJobProcessor ? [heavyJobProcessor] : []),
    ];
  }

  /** Đăng ký contributor này với RuntimeAgentService khi khởi tạo module */
  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  private readonly queueName = QUEUES.SYSTEM_EVENTS;
  private last: { processed: number; at: number } | null = null;

  private get totalProcessed(): number {
    return this.processors.reduce((sum, p) => sum + p.processed, 0);
  }

  private get totalConcurrency(): number {
    return this.processors.reduce((sum, p) => sum + p.concurrency, 0);
  }

  /** Job/phút giữa hai lần thu thập (null ở lần đầu). */
  private jobsPerMinute(): number | null {
    const now = Date.now();
    const cur = { processed: this.totalProcessed, at: now };
    const prev = this.last;
    this.last = cur;
    if (!prev || now <= prev.at) return null;
    return Math.round(((cur.processed - prev.processed) / (now - prev.at)) * 60_000 * 100) / 100;
  }

  /** Cung cấp thông tin mô tả chi tiết về Worker runtime */
  public describe(): RuntimeDescriptor {
    return {
      type: 'queue-consumer',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: withVersion('BullMQ', 'bullmq'),
      entrypoint: 'apps/worker/main.ts',
      sourcePath: 'backend/src/apps/worker/',
      details: {
        queue: this.queueName,
        queues: this.processors.map((p) => p.queueName).join(', '),
        concurrency: this.totalConcurrency,
      },
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
      concurrency: this.totalConcurrency,
      jobsPerMinute: this.jobsPerMinute(),
    };
  }

  /** Số job theo từng queue đã khai báo. */
  public async collectDetails(): Promise<Record<string, unknown>> {
    const consumedQueues = new Set<string>(this.processors.map((p) => p.queueName));
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
        consumed: consumedQueues.has(name),
      })),
    );
    return {
      queues,
      paused: this.processors.every((p) => p.worker?.isPaused() ?? false),
    };
  }

  /** Ngừng lấy job mới, chờ job đang chạy xong (lệnh pause từ Console). */
  public async pause(): Promise<void> {
    await Promise.all(this.processors.map((p) => p.worker?.pause()));
  }

  /** Tiếp tục nhận và xử lý các job mới sau khi đã tạm dừng */
  public async resume(): Promise<void> {
    for (const p of this.processors) {
      p.worker?.resume();
    }
  }

  /** Đóng worker sau khi hoàn tất job đang xử lý. */
  public async drain(): Promise<void> {
    await Promise.all(this.processors.map((p) => p.worker?.close()));
  }
}
