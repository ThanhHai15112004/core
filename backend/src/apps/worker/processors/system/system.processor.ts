import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Counter, Histogram } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import {
  JOB_LOCK_DURATION_MS,
  QUEUES,
  parseEnvelope,
  scheduledEnvelope,
  type MessageEnvelope,
} from '@packages/messaging/index.js';

/**
 * Consumer của queue `system.events` (`@nestjs/bullmq`). Mỗi job chạy trong correlation của envelope để lần theo
 * log; đếm `messages_consumed_total{queue,channel,result}` + histogram thời gian xử lý.
 */
@Processor(QUEUES.SYSTEM_EVENTS, { lockDuration: JOB_LOCK_DURATION_MS, name: 'worker' })
export class SystemProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);
  private readonly consumed: Counter<'queue' | 'channel' | 'result'>;
  private readonly duration: Histogram<'queue' | 'channel'>;
  private readonly wait: Histogram<'queue'>;
  private readonly attemptFailures: Counter<'queue' | 'final'>;
  private readonly recovered: Counter<'queue'>;
  /** Số job đã xử lý xong (thành công hoặc lỗi) từ khi process chạy — để tính job/phút. */
  public processed = 0;

  constructor(
    private readonly config: CoreConfigService,
    metrics: MetricsRegistryService,
  ) {
    super();
    this.consumed = metrics.counter('messages_consumed_total', 'Messages consumed', [
      'queue',
      'channel',
      'result',
    ]);
    this.duration = metrics.histogram('job_duration_seconds', 'Job processing duration', [
      'queue',
      'channel',
    ]);
    this.wait = metrics.histogram('job_wait_seconds', 'Time from enqueue to processing', ['queue']);
    this.attemptFailures = metrics.counter(
      'job_attempt_failures_total',
      'Failed job attempts (final = no attempts left)',
      ['queue', 'final'],
    );
    this.recovered = metrics.counter('job_recovered_total', 'Jobs that succeeded after a retry', [
      'queue',
    ]);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.concurrency;
  }

  public onApplicationBootstrap(): void {
    this.worker.concurrency = this.concurrency;
  }

  public async process(job: Job): Promise<void> {
    // Job từ Job Scheduler / Run Now không có envelope — dựng từ chính job (xem `scheduledEnvelope`).
    const envelope = parseEnvelope(job.data) ?? scheduledEnvelope(job);
    if (!envelope) {
      this.consumed.inc({ queue: job.queueName, channel: job.name, result: 'failed' });
      throw new UnrecoverableError(`Malformed envelope for job ${job.id ?? '?'}`);
    }
    if (job.timestamp > 0) {
      this.wait.observe(
        { queue: job.queueName },
        Math.max(0, ((job.processedOn ?? Date.now()) - job.timestamp) / 1000),
      );
    }
    const end = this.duration.startTimer({ queue: job.queueName, channel: envelope.topic });
    try {
      await RequestContextService.runWith(
        {
          correlationId: envelope.correlationId ?? envelope.id,
          jobId: String(job.id ?? ''),
          source: { kind: 'job', id: String(job.id ?? ''), name: job.name, detail: job.queueName },
        },
        () => this.handle(envelope),
      );
      this.consumed.inc({ queue: job.queueName, channel: envelope.topic, result: 'success' });
      if (job.attemptsMade > 0) this.recovered.inc({ queue: job.queueName });
    } catch (err) {
      this.consumed.inc({ queue: job.queueName, channel: envelope.topic, result: 'failed' });
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.attemptFailures.inc({ queue: job.queueName, final: String(final) });
      throw err;
    } finally {
      this.processed++;
      end();
    }
  }

  /** Logic nghiệp vụ theo topic — hiện chỉ ghi log (xử lý lặp lại an toàn). */
  private async handle(envelope: MessageEnvelope): Promise<void> {
    this.logger.log(
      `Processing message "${envelope.topic}" (${envelope.id}) from ${envelope.producer ?? 'unknown'}`,
    );
  }
}
