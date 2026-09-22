import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { SystemProcessor } from '../processors/system/system.processor.js';

const THROUGHPUT_WINDOW_MS = 60_000;
const DURATION_SAMPLES = 200;

/** Consumer BullMQ cho queue `system.events`, có thống kê throughput/thời gian xử lý thật. */
@Injectable()
export class QueueConsumerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueConsumerService.name);
  private worker: Worker | null = null;
  private paused = false;
  private completedAt: number[] = [];
  private durations: number[] = [];
  private failedAt: number[] = [];
  private failedTotal = 0;
  private completedTotal = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    private readonly processor: SystemProcessor,
  ) {}

  public readonly queueName = QUEUES.SYSTEM_EVENTS;

  public get concurrency(): number {
    return this.config.runtime.worker.concurrency;
  }

  public onApplicationBootstrap(): void {
    this.worker = new Worker(
      this.queueName,
      async (job: Job<MessageEnvelope>) => this.processor.processJob(job.name, job.data),
      {
        connection: this.redis.bullConnection(),
        prefix: this.redis.bullPrefix(),
        concurrency: this.concurrency,
        autorun: false,
      },
    );
    this.worker.on('completed', (job) => this.track('completed', job));
    this.worker.on('failed', (job, err) => {
      this.track('failed', job);
      this.logger.error(`Job ${job?.id ?? '?'} (${job?.name ?? '?'}) failed: ${err.message}`);
    });
    this.worker.on('error', (err) => this.logger.warn(`Worker error: ${err.message}`));

    if (!this.paused) void this.worker.run();
  }

  /** Ngừng lấy job mới, chờ job đang chạy xong (Stop từ Console). */
  public async pause(): Promise<void> {
    this.paused = true;
    if (this.worker?.isRunning()) await this.worker.pause();
  }

  /** BullMQ `resume()` tự chạy lại vòng lặp nếu nó đã dừng (hoặc chưa từng chạy). */
  public async resume(): Promise<void> {
    this.paused = false;
    await this.worker?.resume();
  }

  /** Đóng worker sau khi hoàn tất job đang xử lý (graceful restart). */
  public async drain(): Promise<void> {
    await this.worker?.close();
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public stats() {
    const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
    this.completedAt = this.completedAt.filter((t) => t >= cutoff);
    this.failedAt = this.failedAt.filter((t) => t >= cutoff);
    const avg = this.durations.length
      ? this.durations.reduce((a, b) => a + b, 0) / this.durations.length
      : null;
    return {
      jobsPerMinute: this.completedAt.length,
      failedLastMinute: this.failedAt.length,
      avgDurationMs: avg === null ? null : Math.round(avg),
      completedSinceStart: this.completedTotal,
      failedSinceStart: this.failedTotal,
    };
  }

  private track(kind: 'completed' | 'failed', job: Job | undefined): void {
    const now = Date.now();
    if (kind === 'completed') {
      this.completedTotal++;
      this.completedAt.push(now);
    } else {
      this.failedTotal++;
      this.failedAt.push(now);
    }
    if (job?.processedOn && job.finishedOn) {
      this.durations.push(job.finishedOn - job.processedOn);
      if (this.durations.length > DURATION_SAMPLES) this.durations.shift();
    }
  }
}
