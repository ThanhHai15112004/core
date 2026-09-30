import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingMonitoringService,
  jobMetric,
  jobRecordId,
  recordJobEvent,
  recordJobOperation,
  sanitizeMessagingMessage,
  type ConsumerRegistration,
  type JobCommand,
  type JobCommandResult,
  type JobEventType,
  type JobOperationAction,
  type JobOperationRecord,
} from '@packages/messaging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { redactPayload } from '@packages/traffic/utils/capture.js';
import { JobMonitoringService } from '../monitoring/job-monitoring.service.js';
import { JobOperationError } from '../utils/job-errors.js';
import type { JobRecord } from '../contracts/job.types.js';

const COMMAND_WAIT_MS = 3000;
const COMMAND_POLL_MS = 150;
const MAX_REASON = 200;

export interface JobOperationContext {
  ip: string | null;
  actor: string | null;
}

export type CancelMode = 'removed' | 'cooperative';

export interface JobCancelResult {
  record: JobOperationRecord;
  mode: CancelMode;
  /** cooperative: worker đang giữ job đã nhận yêu cầu (job sẽ dừng khi handler kiểm tra signal). */
  delivered: boolean;
  instance: string | null;
}

export interface BulkRetryItem {
  queue: string;
  id: string;
  result: 'retried' | 'skipped' | 'failed';
  reason: string | null;
}

/** Job đang chạy chỉ huỷ được khi processor của queue khai báo hỗ trợ huỷ hợp tác. */
export const cancellableConsumers = (consumers: ConsumerRegistration[], queue: string) =>
  consumers.filter((c) => c.queue === queue && c.cancellable);

/**
 * Thao tác từng job: retry job lỗi (lần thử mới của chính job đó), retry nhiều job đã chọn (có giới hạn), huỷ job
 * chưa chạy (xoá khỏi hàng đợi, giữ bản ghi Cancelled để audit) hoặc yêu cầu huỷ hợp tác job đang chạy, xoá bản
 * ghi job đã xong. Không kill process. Mọi thao tác bật/tắt bằng env và ghi audit + sự kiện.
 */
@Injectable()
export class JobOperationsService {
  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get cfg() {
    return this.config.jobs;
  }

  private ensure(
    enabled: boolean,
    code: 'RETRY_DISABLED' | 'CANCEL_DISABLED' | 'REMOVE_DISABLED' | 'PAYLOAD_DISABLED',
  ) {
    if (!enabled) throw new JobOperationError(code);
    if (!this.jobs.usable()) throw new JobOperationError('UNAVAILABLE');
  }

  private async load(queue: string, id: string): Promise<JobRecord> {
    if (!this.jobs.provider.isKnown(queue)) throw new JobOperationError('NOT_FOUND', queue, { id });
    const job = await this.jobs.get(id, queue);
    if (!job) throw new JobOperationError('NOT_FOUND', id, { id });
    return job;
  }

  private invalid(job: JobRecord): JobOperationError {
    return new JobOperationError('INVALID_STATE', job.status, { id: job.id, state: job.status });
  }

  private audit(
    action: JobOperationAction,
    target: string,
    jobType: string | null,
    ctx: JobOperationContext,
    started: number,
    detail: string | null,
    reason: string | null,
    error: string | null,
  ) {
    return recordJobOperation(this.redis, {
      at: Date.now(),
      action,
      target,
      jobType,
      result: error ? 'failed' : 'success',
      detail,
      reason,
      durationMs: Number((performance.now() - started).toFixed(1)),
      actor: ctx.actor,
      ip: ctx.ip,
      error,
    });
  }

  private event(
    type: JobEventType,
    severity: 'info' | 'warning',
    job: Pick<JobRecord, 'id' | 'queue' | 'type'> | null,
    ctx: JobOperationContext,
    params: Record<string, string | number> = {},
  ) {
    return recordJobEvent(this.redis, {
      type,
      severity,
      jobId: job?.id ?? null,
      queue: job?.queue ?? null,
      jobType: job?.type ?? null,
      params: { ...params, ...(ctx.actor ? { actor: ctx.actor } : {}) },
      runtime: this.identity?.id ?? null,
    });
  }

  /** Thực hiện thao tác; lỗi không lường trước → audit thất bại + `FAILED`. */
  private async guarded<T>(
    action: JobOperationAction,
    job: JobRecord,
    ctx: JobOperationContext,
    started: number,
    reason: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof JobOperationError) throw err;
      const message = sanitizeMessagingMessage(err);
      await this.audit(
        action,
        `${job.queue}|${job.id}`,
        job.type,
        ctx,
        started,
        null,
        reason,
        message,
      );
      throw new JobOperationError('FAILED', message);
    }
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  /** Job lỗi → một lần thử mới (giữ lịch sử các lần thử trước). Lỗi không retry được → từ chối. */
  public async retry(
    queue: string,
    id: string,
    ctx: JobOperationContext,
  ): Promise<{ record: JobOperationRecord; job: JobRecord }> {
    this.ensure(this.cfg.retry, 'RETRY_DISABLED');
    const started = performance.now();
    const job = await this.load(queue, id);
    if (job.status !== 'failed') throw this.invalid(job);
    if (job.retryable === false)
      throw new JobOperationError('NON_RETRYABLE', id, { id, error: job.errorType ?? 'Error' });
    await this.guarded('retry', job, ctx, started, null, () => this.jobs.provider.retry(queue, id));
    const attempt = job.attempts + 1;
    await this.jobs.provider.log(queue, id, {
      type: 'retried_manually',
      attempt,
      actor: ctx.actor,
    });
    this.recorder?.count('wq.manualRetry');
    const record = await this.audit(
      'retry',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      `attempt=${attempt}, lastError=${job.errorType ?? '-'}`,
      null,
      null,
    );
    await this.event('job_retried', 'info', job, ctx, { attempt });
    return { record, job: (await this.jobs.get(id, queue)) ?? job };
  }

  /** Retry các job lỗi đã chọn (tối đa `OPS_JOBS_BULK_RETRY_MAX`); job không hợp lệ bị bỏ qua kèm lý do. */
  public async bulkRetry(
    items: { queue: string; id: string }[],
    ctx: JobOperationContext,
  ): Promise<{ record: JobOperationRecord; items: BulkRetryItem[] }> {
    this.ensure(this.cfg.retry, 'RETRY_DISABLED');
    const max = this.cfg.bulkRetryMax;
    if (items.length > max)
      throw new JobOperationError('TOO_MANY', String(items.length), { max, count: items.length });
    const started = performance.now();
    const seen = new Set<string>();
    const out: BulkRetryItem[] = [];
    for (const { queue, id } of items) {
      const key = `${queue}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const job = this.jobs.provider.isKnown(queue)
        ? await this.jobs.get(id, queue).catch(() => null)
        : null;
      if (!job) {
        out.push({ queue, id, result: 'skipped', reason: 'NOT_FOUND' });
        continue;
      }
      if (job.status !== 'failed') {
        out.push({ queue, id, result: 'skipped', reason: `STATE_${job.status.toUpperCase()}` });
        continue;
      }
      if (job.retryable === false) {
        out.push({ queue, id, result: 'skipped', reason: 'NON_RETRYABLE' });
        continue;
      }
      const ok = await this.jobs.provider.retry(queue, id).then(
        () => true,
        () => false,
      );
      if (ok) {
        await this.jobs.provider.log(queue, id, {
          type: 'retried_manually',
          attempt: job.attempts + 1,
          actor: ctx.actor,
        });
        this.recorder?.count('wq.manualRetry');
      }
      out.push({ queue, id, result: ok ? 'retried' : 'failed', reason: ok ? null : 'FAILED' });
    }
    const retried = out.filter((i) => i.result === 'retried').length;
    const record = await this.audit(
      'bulk_retry',
      `${out.length} jobs`,
      null,
      ctx,
      started,
      `retried=${retried}, skipped=${out.length - retried}`,
      null,
      null,
    );
    if (retried > 0) await this.event('job_bulk_retried', 'info', null, ctx, { count: retried });
    return { record, items: out };
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  /**
   * Job chưa chạy (waiting / delayed / retrying): xoá khỏi hàng đợi, giữ bản ghi Cancelled. Job đang chạy: gửi yêu
   * cầu huỷ hợp tác tới worker đang giữ job (chỉ khi processor hỗ trợ) — không kill process.
   */
  public async cancel(
    queue: string,
    id: string,
    rawReason: string | null,
    ctx: JobOperationContext,
  ): Promise<JobCancelResult> {
    this.ensure(this.cfg.cancel, 'CANCEL_DISABLED');
    const started = performance.now();
    const reason = rawReason?.trim().slice(0, MAX_REASON) || null;
    const job = await this.load(queue, id);
    if (job.status === 'waiting' || job.status === 'delayed' || job.status === 'retrying') {
      const removed = await this.guarded('cancel', job, ctx, started, reason, () =>
        this.jobs.provider.removeQueued(queue, id),
      );
      if (!removed)
        throw new JobOperationError('INVALID_STATE', 'changed', { id, state: 'changed' });
      const now = Date.now();
      await this.jobs.saveTombstone({
        record: { ...job, status: 'cancelled', state: 'removed', heartbeat: null },
        cancelledAt: now,
        actor: ctx.actor,
        reason,
      });
      this.recorder?.count('wq.cancelled');
      this.recorder?.count(jobMetric(queue, 'cancelled'));
      const record = await this.audit(
        'cancel',
        `${queue}|${id}`,
        job.type,
        ctx,
        started,
        `state=${job.status}`,
        reason,
        null,
      );
      await this.event('job_cancelled', 'warning', job, ctx, { from: job.status });
      return { record, mode: 'removed', delivered: true, instance: null };
    }
    if (job.status !== 'active' && job.status !== 'stalled') throw this.invalid(job);
    const consumers = await this.messaging.consumers().catch(() => [] as ConsumerRegistration[]);
    if (!cancellableConsumers(consumers, queue).length)
      throw new JobOperationError('NOT_CANCELLABLE', id, { id, queue });
    const cmd: JobCommand = {
      id: jobRecordId('jcmd'),
      action: 'cancel',
      queue,
      jobId: id,
      reason: reason ?? `Cancelled by ${ctx.actor ?? 'operator'}`,
      requestedAt: Date.now(),
    };
    const receivers = await this.guarded('cancel', job, ctx, started, reason, () =>
      this.redis.client.publish(this.jobs.keys.commandChannel(), JSON.stringify(cmd)),
    );
    if (receivers === 0) throw new JobOperationError('NO_WORKER', id, { id, queue });
    const result = await this.waitResult(cmd.id);
    await this.jobs.provider.log(queue, id, {
      type: 'cancel_requested',
      actor: ctx.actor,
      error: reason,
      instance: result?.instance ?? null,
    });
    const record = await this.audit(
      'cancel',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      result ? `cooperative, instance=${result.instance}` : 'cooperative, not delivered',
      reason,
      null,
    );
    await this.event('job_cancel_requested', 'warning', job, ctx, { delivered: result ? 1 : 0 });
    return {
      record,
      mode: 'cooperative',
      delivered: result !== null,
      instance: result?.instance ?? null,
    };
  }

  private async waitResult(id: string): Promise<JobCommandResult | null> {
    const deadline = Date.now() + COMMAND_WAIT_MS;
    while (Date.now() < deadline) {
      const raw = await this.redis.client.get(this.jobs.keys.commandResult(id)).catch(() => null);
      if (raw) {
        try {
          return JSON.parse(raw) as JobCommandResult;
        } catch {
          return null;
        }
      }
      await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
    }
    return null;
  }

  // ─── Remove / Payload ─────────────────────────────────────────────────────

  /** Xoá bản ghi job đã xong / lỗi / đã huỷ — chỉ xoá record, không hoàn tác nghiệp vụ đã chạy. */
  public async remove(
    queue: string,
    id: string,
    ctx: JobOperationContext,
  ): Promise<JobOperationRecord> {
    this.ensure(this.cfg.remove, 'REMOVE_DISABLED');
    const started = performance.now();
    const job = await this.load(queue, id);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) throw this.invalid(job);
    await this.guarded('remove', job, ctx, started, null, async () => {
      if (job.state !== 'removed') await this.jobs.provider.remove(queue, id);
      if (job.status === 'cancelled') await this.jobs.removeTombstone(queue, id);
    });
    const record = await this.audit(
      'remove',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      `status=${job.status}`,
      null,
      null,
    );
    await this.event('job_removed', 'warning', job, ctx, { status: job.status });
    return record;
  }

  /** Payload đã che field nhạy cảm — quyền riêng, mỗi lần xem ghi audit. */
  public async payload(queue: string, id: string, ctx: JobOperationContext) {
    this.ensure(this.cfg.payload, 'PAYLOAD_DISABLED');
    const started = performance.now();
    const detail = await this.jobs.detail(id, queue);
    if (!detail) throw new JobOperationError('NOT_FOUND', id, { id });
    if (detail.payload === undefined)
      throw new JobOperationError('INVALID_STATE', 'removed', { id, state: 'removed' });
    await this.audit(
      'payload',
      `${queue}|${id}`,
      detail.record.type,
      ctx,
      started,
      null,
      null,
      null,
    );
    return { payload: redactPayload(detail.payload), malformed: detail.malformed };
  }
}
