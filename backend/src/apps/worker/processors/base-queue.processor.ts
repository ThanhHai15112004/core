import { Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Counter, Histogram } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import {
  QUEUE_PROFILES,
  classifyJobError,
  logLifecycle,
  parseEnvelope,
  scheduledEnvelope,
  toUnrecoverable,
  type MessageEnvelope,
  type QueueName,
} from '@packages/messaging/index.js';
import { JobProgressTrackerService, withJobExecutionTimeout } from '@packages/queue/index.js';

/**
 * Lớp cơ sở dùng chung cho các BullMQ Worker Processor trên các hàng đợi (`system.critical`,
 * `system.notifications`, `system.heavy`, `system.events`).
 * Tự động xử lý:
 * - Thiết lập số lượng worker đồng thời (`concurrency`) theo cấu hình môi trường
 * - Ghi nhận Prometheus metrics & Lifecycle logs (`received`, `completed`, `failed`, `dead_lettered`)
 * - Giới hạn thời gian chờ thực thi (`timeoutMs`) chống treo worker
 * - Kiểm tra tín hiệu huỷ hợp tác (`Cooperative Cancellation`)
 * - Lưu trữ danh sách job thất bại cuối cùng vào `FailedJobArchive` và chặn retry lỗi không phục hồi được
 */
export abstract class BaseQueueProcessor extends WorkerHost implements OnApplicationBootstrap {
  protected abstract readonly logger: Logger;
  public abstract readonly queueName: QueueName;

  private readonly consumed: Counter<'queue' | 'channel' | 'result'>;
  private readonly published: Counter<'queue' | 'channel' | 'result'>;
  private readonly duration: Histogram<'queue' | 'channel'>;
  private readonly wait: Histogram<'queue'>;
  private readonly attemptFailures: Counter<'queue' | 'channel' | 'final'>;
  private readonly recovered: Counter<'queue'>;
  /** Số job đã xử lý xong (thành công hoặc lỗi) từ khi process chạy — để tính job/phút. */
  public processed = 0;

  constructor(
    protected readonly config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() protected readonly progressTracker?: JobProgressTrackerService,
  ) {
    super();
    this.consumed = metrics.counter('messages_consumed_total', 'Messages consumed', [
      'queue',
      'channel',
      'result',
    ]);
    this.published = metrics.counter('messages_published_total', 'Messages published', [
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
      ['queue', 'channel', 'final'],
    );
    this.recovered = metrics.counter('job_recovered_total', 'Jobs that succeeded after a retry', [
      'queue',
    ]);
  }

  /** Số luồng xử lý đồng thời của processor này (đọc từ cấu hình môi trường). */
  public abstract get concurrency(): number;

  /** Cấu hình mức độ concurrency cho BullMQ worker khi ứng dụng hoàn tất bootstrap */
  public onApplicationBootstrap(): void {
    if (this.worker) {
      this.worker.concurrency = this.concurrency;
    }
  }

  /** Xác định thời gian chờ tối đa (ms) cho một job trước khi bị ngắt Timeout */
  public resolveExecutionTimeoutMs(envelope: MessageEnvelope): number {
    const metaTimeout = envelope.meta?.timeoutMs;
    if (typeof metaTimeout === 'number' && metaTimeout > 0) {
      return metaTimeout;
    }
    const profile = QUEUE_PROFILES[this.queueName];
    return profile?.defaultTimeoutMs ?? this.config.runtime.worker.jobTimeoutMs ?? 60_000;
  }

  /** Tiếp nhận, xác thực envelope và thực thi xử lý một BullMQ job */
  public async process(job: Job): Promise<unknown> {
    const envelope = parseEnvelope(job.data) ?? scheduledEnvelope(job);
    if (!envelope) {
      this.consumed.inc({ queue: job.queueName, channel: job.name, result: 'failed' });
      throw new UnrecoverableError(`Malformed envelope for job ${job.id ?? '?'}`);
    }

    const attempt = (job.attemptsMade ?? 0) + 1;
    const jobId = String(job.id ?? envelope.id);
    logLifecycle(job, 'received', {
      attempt,
      runtime: 'worker',
      consumer: this.constructor.name,
    });

    if (job.repeatJobKey && job.attemptsMade === 0 && job.attemptsStarted <= 1) {
      this.published.inc({ queue: job.queueName, channel: envelope.topic, result: 'success' });
    }
    if (job.timestamp > 0) {
      this.wait.observe(
        { queue: job.queueName },
        Math.max(0, ((job.processedOn ?? Date.now()) - job.timestamp) / 1000),
      );
    }

    const startedMs = Date.now();
    const end = this.duration.startTimer({ queue: job.queueName, channel: envelope.topic });
    const timeoutMs = this.resolveExecutionTimeoutMs(envelope);

    try {
      if (this.progressTracker) {
        await this.progressTracker.assertNotCancelled(job.queueName, jobId, job);
      }

      const result = await RequestContextService.runWith(
        {
          correlationId: envelope.correlationId ?? envelope.id,
          jobId,
          source: { kind: 'job', id: jobId, name: job.name, detail: job.queueName },
        },
        () =>
          withJobExecutionTimeout(
            () => this.handle(envelope, job),
            timeoutMs,
            `${job.queueName}/${envelope.topic}`,
          ),
      );

      logLifecycle(job, 'completed', {
        attempt,
        runtime: 'worker',
        consumer: this.constructor.name,
        ms: Math.max(0, Date.now() - startedMs),
      });
      this.consumed.inc({ queue: job.queueName, channel: envelope.topic, result: 'success' });
      if (job.attemptsMade > 0) this.recovered.inc({ queue: job.queueName });
      return result;
    } catch (err) {
      this.consumed.inc({ queue: job.queueName, channel: envelope.topic, result: 'failed' });
      const info = classifyJobError(err);
      const maxAttempts = Math.max(1, job.opts?.attempts ?? 1);
      const unrecoverable = info.retryable === false;
      const final = unrecoverable || attempt >= maxAttempts;

      this.attemptFailures.inc({
        queue: job.queueName,
        channel: envelope.topic,
        final: String(final),
      });

      logLifecycle(job, 'failed', {
        attempt,
        runtime: 'worker',
        consumer: this.constructor.name,
        ms: Math.max(0, Date.now() - startedMs),
        error: info.message,
        errorType: info.type,
        retryable: info.retryable,
        dependency: info.dependency,
      });

      if (final) {
        logLifecycle(job, 'dead_lettered', {
          attempt,
          runtime: 'worker',
          consumer: this.constructor.name,
          error: info.message,
          errorType: info.type,
        });
        if (this.progressTracker) {
          await this.progressTracker.recordFailedJob({
            id: jobId,
            queue: job.queueName,
            type: envelope.topic,
            errorType: info.type,
            error: info.message,
            stacktrace: err instanceof Error && err.stack ? [err.stack] : [],
            attempts: attempt,
            maxAttempts,
            dependency: info.dependency,
            retryable: info.retryable,
            correlationId: envelope.correlationId ?? null,
            producer: envelope.producer ?? null,
            failedAt: Date.now(),
          });
        }
      }

      if (unrecoverable && !(err instanceof UnrecoverableError)) {
        throw toUnrecoverable(err, info);
      }
      throw err;
    } finally {
      this.processed++;
      end();
    }
  }

  /** Xử lý nghiệp vụ cụ thể của từng hàng đợi */
  protected abstract handle(envelope: MessageEnvelope, job: Job): Promise<unknown>;

  /** Khởi tạo danh sách các pha (phases) và đánh dấu bước đầu tiên của job */
  protected async initJobPhases(
    job: Job,
    phases: readonly string[],
    total: number,
    initialStep: string,
    completedPhases: readonly string[] = [phases[0] ?? 'Validate'],
    activePhase: string | undefined = phases[1] ?? phases[0],
  ): Promise<void> {
    if (!this.progressTracker) return;
    await this.progressTracker.initPhases(job, phases, total);
    await this.progressTracker.updateProgress(job, {
      processed: 0,
      total,
      step: initialStep,
      completedPhases,
      ...(activePhase ? { activePhase } : {}),
    });
  }

  /** Cập nhật tiến độ xử lý từng phần (chunk/batch) của job đang chạy */
  protected async reportJobProgress(
    job: Job,
    input: {
      readonly percent?: number;
      readonly processed: number;
      readonly total: number;
      readonly step: string;
      readonly completedPhases?: readonly string[];
      readonly activePhase?: string;
    },
  ): Promise<void> {
    if (!this.progressTracker) return;
    await this.progressTracker.updateProgress(job, input);
  }

  /** Đánh dấu job hoàn tất 100% cùng toàn bộ các phase */
  protected async completeJobProgress(
    job: Job,
    total: number,
    step: string,
    phases?: readonly string[],
  ): Promise<void> {
    if (!this.progressTracker) return;
    await this.progressTracker.updateProgress(job, {
      percent: 100,
      processed: total,
      total,
      step,
      ...(phases ? { completedPhases: [...phases] } : {}),
    });
  }
}
