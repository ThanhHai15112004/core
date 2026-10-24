import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ForbiddenAppException, HTTP_ERROR_CODE } from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  sanitizeMessagingMessage,
  type JobOperationAction,
  type JobOperationRecord,
} from '@packages/messaging/index.js';
import { redactPayload } from '@packages/http/index.js';
import { JobMonitoringService } from '../monitoring/job-monitoring.service.js';
import { JobOperationError } from '../utils/job-errors.js';
import {
  CANCEL_SIGNAL_TTL_SEC,
  JOB_OPERATION_LOG_SIZE,
  queueKeys,
} from '../constants/queue.keys.js';
import type { JobRecord } from '../contracts/job.types.js';
import { JobProgressTrackerService } from './job-progress.tracker.js';

const MAX_REASON = 200;

export interface JobOperationContext {
  ip: string | null;
  actor: string | null;
  userId?: number | string | null;
  permissions?: readonly string[] | null;
}

export type CancelMode = 'removed' | 'cooperative';

export interface JobCancelResult {
  record: JobOperationRecord;
  mode: CancelMode;
  delivered: boolean;
  instance: string | null;
}

export interface BulkRetryItem {
  queue: string;
  id: string;
  result: 'retried' | 'skipped' | 'failed';
  reason: string | null;
}

/**
 * Thao tác từng job bằng BullMQ API: retry job lỗi (`job.retry`), retry nhiều job đã chọn, huỷ job chưa chạy
 * (`job.remove`) hoặc huỷ hợp tác job đang chạy (`cooperative`), xoá bản ghi job đã xong.
 * Mọi thao tác bật/tắt bằng env, kiểm tra quyền RBAC và ghi audit vào log.
 */
@Injectable()
export class JobOperationsService {
  private readonly logger = new Logger('JobOperations');

  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    @Optional() private readonly progressTracker?: JobProgressTrackerService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  private get cfg() {
    return this.config.jobs;
  }

  /** Kiểm tra quyền RBAC khi có thông tin người dùng xác thực hoặc khi bật bắt buộc RBAC */
  private assertPermission(ctx: JobOperationContext, requiredPermission: string): void {
    const hasExplicitPermissions = Array.isArray(ctx.permissions);
    if (!hasExplicitPermissions && !this.cfg.requireRbac) {
      return;
    }
    const granted = new Set(ctx.permissions ?? []);
    if (
      granted.has(requiredPermission) ||
      granted.has('jobs.manage') ||
      granted.has('system.ops.manage')
    ) {
      return;
    }
    throw new ForbiddenAppException(HTTP_ERROR_CODE.FORBIDDEN, [
      {
        requiredPermissions: [requiredPermission],
        missingPermissions: [requiredPermission],
      },
    ]);
  }

  /** Đảm bảo dịch vụ hoặc điều kiện tiên quyết đã sẵn sàng */
  private ensure(
    enabled: boolean,
    code: 'RETRY_DISABLED' | 'CANCEL_DISABLED' | 'REMOVE_DISABLED' | 'PAYLOAD_DISABLED',
  ) {
    if (!enabled) throw new JobOperationError(code);
    if (!this.jobs.usable()) throw new JobOperationError('UNAVAILABLE');
  }

  /** Tải dữ liệu job từ bộ lưu trữ */
  private async load(queue: string, id: string): Promise<JobRecord> {
    if (!this.jobs.provider.isKnown(queue)) throw new JobOperationError('NOT_FOUND', queue, { id });
    const job = await this.jobs.get(id, queue);
    if (!job) throw new JobOperationError('NOT_FOUND', id, { id });
    return job;
  }

  /** Tạo đối tượng kết quả thông báo dữ liệu không hợp lệ */
  private invalid(job: JobRecord): JobOperationError {
    return new JobOperationError('INVALID_STATE', job.status, { id: job.id, state: job.status });
  }

  /** Ghi nhận nhật ký kiểm toán cho hành động nhạy cảm */
  private audit(
    action: JobOperationAction,
    target: string,
    jobType: string | null,
    ctx: JobOperationContext,
    started: number,
    detail: string | null,
    reason: string | null,
    error: string | null,
  ): JobOperationRecord {
    const record: JobOperationRecord = {
      id: `jop_${randomBytes(6).toString('hex')}`,
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
    };
    this.logger.log({
      msg: `job ${action} ${target}`,
      audit: { domain: 'jobs', userId: ctx.userId ?? null, ...record },
    });
    const key = queueKeys(this.redis).jobOperations();
    void this.redis.client
      .multi()
      .lpush(key, JSON.stringify(record))
      .ltrim(key, 0, JOB_OPERATION_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
    if (this.auditLogService) {
      void this.auditLogService
        .record({
          actorUserId: typeof ctx.userId === 'number' ? ctx.userId : null,
          actorIdentifier: ctx.actor,
          ipAddress: ctx.ip,
          module: 'jobs-ops',
          feature: 'job_operations',
          action: `JOB_${action.toUpperCase()}`,
          resourceType: 'job',
          resourceId: target,
          afterData: {
            jobType,
            result: record.result,
            detail,
            error,
          },
          reason,
        })
        .catch(() => undefined);
    }
    return record;
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
      this.audit(action, `${job.queue}|${job.id}`, job.type, ctx, started, null, reason, message);
      throw new JobOperationError('FAILED', message);
    }
  }

  /** Job lỗi → một lần thử mới (giữ lịch sử các lần thử trước). Lỗi không retry được → từ chối. */
  public async retry(
    queue: string,
    id: string,
    ctx: JobOperationContext,
  ): Promise<{ record: JobOperationRecord; job: JobRecord }> {
    this.assertPermission(ctx, 'jobs.retry');
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
    const record = this.audit(
      'retry',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      `attempt=${attempt}, lastError=${job.errorType ?? '-'}`,
      null,
      null,
    );
    return { record, job: (await this.jobs.get(id, queue)) ?? job };
  }

  /** Retry các job lỗi đã chọn (tối đa `OPS_JOBS_BULK_RETRY_MAX`); job không hợp lệ bị bỏ qua kèm lý do. */
  public async bulkRetry(
    items: { queue: string; id: string }[],
    ctx: JobOperationContext,
  ): Promise<{ record: JobOperationRecord; items: BulkRetryItem[] }> {
    this.assertPermission(ctx, 'jobs.retry');
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
      if (ok)
        await this.jobs.provider.log(queue, id, {
          type: 'retried_manually',
          attempt: job.attempts + 1,
          actor: ctx.actor,
        });
      out.push({ queue, id, result: ok ? 'retried' : 'failed', reason: ok ? null : 'FAILED' });
    }
    const retried = out.filter((i) => i.result === 'retried').length;
    const record = this.audit(
      'bulk_retry',
      `${out.length} jobs`,
      null,
      ctx,
      started,
      `retried=${retried}, skipped=${out.length - retried}`,
      null,
      null,
    );
    return { record, items: out };
  }

  /**
   * Huỷ job chưa chạy (waiting / delayed / retrying) = xoá khỏi hàng đợi (`mode: 'removed'`).
   * Với job đang chạy (active / stalled) = gửi tín hiệu huỷ hợp tác qua Redis (`mode: 'cooperative'`).
   */
  public async cancel(
    queue: string,
    id: string,
    rawReason: string | null,
    ctx: JobOperationContext,
  ): Promise<JobCancelResult> {
    this.assertPermission(ctx, 'jobs.cancel');
    this.ensure(this.cfg.cancel, 'CANCEL_DISABLED');
    const started = performance.now();
    const reason = rawReason?.trim().slice(0, MAX_REASON) || null;
    const job = await this.load(queue, id);

    if (job.status === 'active' || job.status === 'stalled') {
      await this.guarded('cancel', job, ctx, started, reason, async () => {
        if (this.progressTracker) {
          await this.progressTracker.requestCancel(queue, id, { reason, actor: ctx.actor });
        } else {
          const signalKey = queueKeys(this.redis).cancelSignal(queue, id);
          await this.redis.client.set(
            signalKey,
            JSON.stringify({
              queue,
              jobId: id,
              reason,
              actor: ctx.actor,
              requestedAt: Date.now(),
            }),
            'EX',
            CANCEL_SIGNAL_TTL_SEC,
          );
        }
        await this.jobs.provider.log(queue, id, {
          type: 'cancel_requested',
          actor: ctx.actor,
          error: reason ?? 'Cooperative cancel requested',
        });
      });

      const record = this.audit(
        'cancel',
        `${queue}|${id}`,
        job.type,
        ctx,
        started,
        `state=${job.status}, mode=cooperative`,
        reason,
        null,
      );
      return { record, mode: 'cooperative', delivered: true, instance: job.worker };
    }

    if (job.status !== 'waiting' && job.status !== 'delayed' && job.status !== 'retrying')
      throw this.invalid(job);
    const removed = await this.guarded('cancel', job, ctx, started, reason, () =>
      this.jobs.provider.removeQueued(queue, id),
    );
    if (!removed) throw new JobOperationError('INVALID_STATE', 'changed', { id, state: 'changed' });
    const record = this.audit(
      'cancel',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      `state=${job.status}, mode=removed`,
      reason,
      null,
    );
    return { record, mode: 'removed', delivered: true, instance: null };
  }

  /** Xoá bản ghi job đã xong / lỗi — chỉ xoá record, không hoàn tác nghiệp vụ đã chạy. */
  public async remove(
    queue: string,
    id: string,
    ctx: JobOperationContext,
  ): Promise<JobOperationRecord> {
    this.assertPermission(ctx, 'jobs.remove');
    this.ensure(this.cfg.remove, 'REMOVE_DISABLED');
    const started = performance.now();
    const job = await this.load(queue, id);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) throw this.invalid(job);
    await this.guarded('remove', job, ctx, started, null, () =>
      this.jobs.provider.remove(queue, id),
    );
    return this.audit(
      'remove',
      `${queue}|${id}`,
      job.type,
      ctx,
      started,
      `status=${job.status}`,
      null,
      null,
    );
  }

  /** Payload đã che field nhạy cảm — mỗi lần xem ghi audit. */
  public async payload(queue: string, id: string, ctx: JobOperationContext) {
    this.assertPermission(ctx, 'jobs.payload');
    this.ensure(this.cfg.payload, 'PAYLOAD_DISABLED');
    const started = performance.now();
    const detail = await this.jobs.detail(id, queue);
    if (!detail) throw new JobOperationError('NOT_FOUND', id, { id });
    this.audit('payload', `${queue}|${id}`, detail.record.type, ctx, started, null, null, null);
    return { payload: redactPayload(detail.payload), malformed: detail.malformed };
  }
}
