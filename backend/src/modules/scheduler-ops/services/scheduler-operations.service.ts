import { performance } from 'node:perf_hooks';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  safeJsonParse,
  safeJsonParseList,
} from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  QueueRegistry,
  SCHEDULER_FAILURE_ALERT_LOG_SIZE,
  SCHEDULER_MISSED_LOG_SIZE,
  schedulerKeys,
} from '@packages/queue/index.js';
import {
  BaseMessagePublisherProvider,
  MANUAL_RUN_PREFIX,
  MessagingConnectionService,
  QUEUES,
} from '@packages/messaging/index.js';
import type {
  MissedExecutionRecord,
  SchedulerFailureAlertRecord,
  SchedulerMisfirePolicy,
  SchedulerOperationAction,
  SchedulerOperationRecord,
} from '../contracts/scheduler.types.js';
import {
  SchedulerActionRejectedException,
  SchedulerNotFoundException,
  SchedulerUnavailableException,
} from '../exceptions/scheduler-ops.exceptions.js';
import { liveQueues } from './scheduler-utils.js';

export interface SchedulerOperationContext {
  ip: string | null;
  actor: string | null;
  userId?: number | string | null;
  permissions?: readonly string[] | null;
}

const MAX_OPERATIONS = 100;

interface TaskDefinitionJson {
  id: string;
  queue: string;
  name?: string | undefined;
  description?: string | undefined;
  pattern?: string | undefined;
  every?: number | undefined;
  tz?: string | undefined;
  data?: Record<string, unknown> | undefined;
  ownerEmail?: string | undefined;
  notifyEmails?: string[] | undefined;
  notifyOnFailure?: boolean | undefined;
  misfirePolicy?: SchedulerMisfirePolicy | undefined;
  lockTtlSec?: number | undefined;
}

@Injectable()
export class SchedulerOperationsService {
  private readonly logger = new Logger(SchedulerOperationsService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly queueRegistry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    private readonly publisher: BaseMessagePublisherProvider,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  private get keys() {
    return schedulerKeys(this.redis);
  }

  /** Kiểm tra xem broker truyền tin có đang duy trì kết nối hay không */
  private brokerConnected(): boolean {
    return this.connection.getStatus().state === 'connected';
  }

  /**
   * 7.4.5 & 7.4.6 — Kiểm tra quyền RBAC khi thao tác Run Now / Enable / Disable
   * (kiểm tra khi có `permissions` từ request xác thực hoặc khi `OPS_SCHEDULER_REQUIRE_RBAC=true`).
   */
  public assertPermission(ctx: SchedulerOperationContext, requiredPermission: string): void {
    const hasExplicitPermissions = Array.isArray(ctx.permissions);
    if (!hasExplicitPermissions && !this.config.scheduler.requireRbac) {
      return;
    }
    const granted = new Set(ctx.permissions ?? []);
    if (
      granted.has(requiredPermission) ||
      granted.has('scheduler.manage') ||
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

  /** Ghi nhận nhật ký kiểm toán vào cả Redis `scheduler:operations` và bảng DB `audit_logs` */
  private async audit(
    action: SchedulerOperationAction,
    target: string,
    ctx: SchedulerOperationContext,
    started: number,
    detail: string | null,
    error: string | null,
    executionId: string | null = null,
  ): Promise<SchedulerOperationRecord> {
    const record: SchedulerOperationRecord = {
      id: `sch_op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      action,
      target,
      result: error ? 'failed' : 'success',
      detail,
      durationMs: Number((performance.now() - started).toFixed(1)),
      actor: ctx.actor,
      ip: ctx.ip,
      error,
      executionId,
    };

    try {
      if (this.redis.isReady()) {
        await this.redis.client
          .pipeline()
          .lpush(this.keys.operations(), JSON.stringify(record))
          .ltrim(this.keys.operations(), 0, MAX_OPERATIONS - 1)
          .exec();
      }
    } catch (err) {
      this.logger.warn(
        `Failed to save audit record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          actorUserId: typeof ctx.userId === 'number' ? ctx.userId : null,
          actorIdentifier: ctx.actor,
          ipAddress: ctx.ip,
          module: 'scheduler-ops',
          feature: 'scheduler_operations',
          action: `SCHEDULER_${action.toUpperCase()}`,
          resourceType: 'scheduled_task',
          resourceId: target,
          afterData: {
            result: record.result,
            detail,
            error,
            executionId,
          },
        })
        .catch(() => undefined);
    }

    return record;
  }

  /** Lấy thông tin operations của hệ thống */
  public async getOperations(): Promise<SchedulerOperationRecord[]> {
    if (!this.redis.isReady()) return [];
    try {
      const raw = await this.redis.client.lrange(this.keys.operations(), 0, MAX_OPERATIONS - 1);
      return safeJsonParseList<SchedulerOperationRecord>(raw);
    } catch {
      return [];
    }
  }

  /**
   * 7.4.3 — Chiếm giữ Distributed Lock trên Redis cho một công việc định kỳ (`scheduler:lock:<taskId>`)
   * để ngăn công việc chạy trùng.
   */
  public async acquireTaskLock(
    taskId: string,
    executionId: string,
    ttlSec?: number,
  ): Promise<{ acquired: boolean; holder: string | null }> {
    const key = this.keys.taskLock(taskId);
    const effectiveTtl = Math.max(5, ttlSec ?? this.config.scheduler.lockTtlSec ?? 300);
    const setRes = await this.redis.client
      .set(key, executionId, 'EX', effectiveTtl, 'NX')
      .catch(() => null);
    if (setRes === 'OK') {
      return { acquired: true, holder: executionId };
    }
    const currentHolder = await this.redis.client.get(key).catch(() => null);
    if (currentHolder === executionId) {
      await this.redis.client.expire(key, effectiveTtl).catch(() => undefined);
      return { acquired: true, holder: executionId };
    }
    return { acquired: false, holder: currentHolder };
  }

  /** Giải phóng Distributed Lock của một công việc định kỳ (chỉ chủ sở hữu lock mới giải phóng được) */
  public async releaseTaskLock(taskId: string, executionId: string): Promise<boolean> {
    const key = this.keys.taskLock(taskId);
    const holder = await this.redis.client.get(key).catch(() => null);
    if (holder !== executionId) return false;
    await this.redis.client.del(key).catch(() => undefined);
    return true;
  }

  /** Đọc mã execution đang giữ Distributed Lock của công việc định kỳ (null nếu rảnh) */
  public async getTaskLock(taskId: string): Promise<string | null> {
    if (!this.redis.isReady()) return null;
    return this.redis.client.get(this.keys.taskLock(taskId)).catch(() => null);
  }

  /** Định nghĩa do scheduler runtime ghi; task đã xoá khỏi code bị gỡ khỏi hash nên không Run Now được nữa. */
  private async findTaskDefinition(taskId: string): Promise<TaskDefinitionJson | null> {
    if (!this.redis.isReady()) return null;
    const raw = await this.redis.client.hget(this.keys.definitions(), taskId);
    if (raw) {
      return safeJsonParse<TaskDefinitionJson | null>(raw, null);
    }

    return null;
  }

  /** Run Now: Kích hoạt ngay một job trong queue đích của scheduler (có RBAC, Distributed Lock & Audit) */
  public async runNow(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<{ record: SchedulerOperationRecord; executionId: string }> {
    this.assertPermission(ctx, 'scheduler.run');
    if (!this.config.scheduler.run) {
      throw new SchedulerActionRejectedException('RUN_DISABLED');
    }
    const started = performance.now();
    const task = await this.findTaskDefinition(taskId);
    if (!task) {
      const err = new SchedulerNotFoundException('scheduler.error.taskNotFound', { id: taskId });
      await this.audit('run', taskId, ctx, started, null, err.message);
      throw err;
    }

    const activeHolder = await this.getTaskLock(taskId);
    if (activeHolder) {
      const err = new SchedulerActionRejectedException(
        'TASK_RUNNING',
        { execution: activeHolder },
        409,
      );
      await this.audit(
        'run',
        taskId,
        ctx,
        started,
        null,
        `Task "${taskId}" is currently locked by execution "${activeHolder}"`,
        activeHolder,
      );
      throw err;
    }

    const channel = task.name ?? taskId;
    try {
      if (!this.brokerConnected()) throw new Error(`Broker ${this.connection.getStatus().state}`);
      const queue = this.queueRegistry.getQueue(task.queue);
      // jobId `manual:<task>:<ts>` để trang Scheduler nhận ra lần chạy thủ công; worker dựng envelope từ job.
      const job = await this.queueRegistry
        .withTimeout(
          queue.add(channel, task.data ?? {}, {
            ...this.queueRegistry.retentionOptions(),
            jobId: `${MANUAL_RUN_PREFIX}${taskId}:${Date.now()}`,
          }),
        )
        .catch((err: unknown) => {
          this.publisher.recordPublished(task.queue, channel, false);
          throw err;
        });
      this.publisher.recordPublished(task.queue, channel, true);

      const execId = String(job.id);
      const record = await this.audit(
        'run',
        taskId,
        ctx,
        started,
        `Job dispatched to queue "${task.queue}" (id: ${execId})`,
        null,
        execId,
      );

      return { record, executionId: execId };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit('run', taskId, ctx, started, null, msg);
      throw new SchedulerUnavailableException('STORE_UNAVAILABLE', { error: msg });
    }
  }

  /** Enable task (có RBAC & Audit) */
  public async enable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationRecord> {
    this.assertPermission(ctx, 'scheduler.toggle');
    if (!this.config.scheduler.toggle) {
      throw new SchedulerActionRejectedException('TOGGLE_DISABLED');
    }
    const started = performance.now();
    const task = await this.findTaskDefinition(taskId);
    if (!task) {
      const err = new SchedulerNotFoundException('scheduler.error.taskNotFound', { id: taskId });
      await this.audit('enable', taskId, ctx, started, null, err.message);
      throw err;
    }

    try {
      await this.redis.client.srem(this.keys.disabled(), taskId);

      // Set disabled là nguồn sự thật; broker mất kết nối → scheduler đồng bộ lại khi khởi động.
      if (!this.brokerConnected()) {
        return await this.audit(
          'enable',
          taskId,
          ctx,
          started,
          `Task "${taskId}" enabled; BullMQ will sync when the broker is available`,
          null,
        );
      }

      // Upsert scheduler vào BullMQ
      const queue = this.queueRegistry.getQueue(task.queue);
      const repeatOpts: { pattern?: string; every?: number; tz?: string } = {};
      if (task.pattern) repeatOpts.pattern = task.pattern;
      if (task.every) repeatOpts.every = task.every;
      repeatOpts.tz = task.tz || this.config.scheduler.timezone;

      await this.queueRegistry.withTimeout(
        queue.upsertJobScheduler(taskId, repeatOpts, {
          name: task.name ?? taskId,
          data: task.data ?? {},
        }),
      );

      return await this.audit(
        'enable',
        taskId,
        ctx,
        started,
        `Task "${taskId}" enabled and upserted to queue "${task.queue}"`,
        null,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit('enable', taskId, ctx, started, null, msg);
      throw new SchedulerUnavailableException('STORE_UNAVAILABLE', { error: msg });
    }
  }

  /** Disable task (có RBAC & Audit) */
  public async disable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationRecord> {
    this.assertPermission(ctx, 'scheduler.toggle');
    if (!this.config.scheduler.toggle) {
      throw new SchedulerActionRejectedException('TOGGLE_DISABLED');
    }
    const started = performance.now();

    try {
      await this.redis.client.sadd(this.keys.disabled(), taskId);

      // Gỡ scheduler khỏi BullMQ queue
      const queues = liveQueues(this.queueRegistry, this.connection);
      for (const queue of queues.values()) {
        try {
          await this.queueRegistry.withTimeout(queue.removeJobScheduler(taskId));
        } catch {
          // ignore
        }
      }

      return await this.audit(
        'disable',
        taskId,
        ctx,
        started,
        `Task "${taskId}" disabled and removed from BullMQ`,
        null,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit('disable', taskId, ctx, started, null, msg);
      throw new SchedulerUnavailableException('STORE_UNAVAILABLE', { error: msg });
    }
  }

  /**
   * 7.4.7 — Gửi cảnh báo tới người phụ trách khi một công việc định kỳ thất bại
   * và lưu lịch sử cảnh báo vào Redis `scheduler:failure-alerts`.
   */
  public async notifyTaskFailure(input: {
    taskId: string;
    taskName?: string;
    queue: string;
    executionId: string;
    error: string;
    attemptsMade?: number;
    recipients?: readonly string[];
  }): Promise<SchedulerFailureAlertRecord | null> {
    const task = await this.findTaskDefinition(input.taskId);
    if (task?.notifyOnFailure === false) {
      return null;
    }

    const recipientSet = new Set<string>();
    for (const email of input.recipients ?? []) {
      if (email?.trim()) recipientSet.add(email.trim());
    }
    if (task?.ownerEmail?.trim()) {
      recipientSet.add(task.ownerEmail.trim());
    }
    for (const email of task?.notifyEmails ?? []) {
      if (email?.trim()) recipientSet.add(email.trim());
    }
    for (const email of this.config.scheduler.alertRecipients ?? []) {
      if (email?.trim()) recipientSet.add(email.trim());
    }

    const recipients = [...recipientSet];
    const record: SchedulerFailureAlertRecord = {
      id: `sch_fail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      taskId: input.taskId,
      taskName: input.taskName ?? task?.name ?? input.taskId,
      queue: input.queue,
      executionId: input.executionId,
      error: input.error,
      attemptsMade: input.attemptsMade ?? 1,
      recipients,
      failedAt: Date.now(),
    };

    if (this.redis.isReady()) {
      await this.redis.client
        .pipeline()
        .lpush(this.keys.failureAlerts(), JSON.stringify(record))
        .ltrim(this.keys.failureAlerts(), 0, SCHEDULER_FAILURE_ALERT_LOG_SIZE - 1)
        .exec()
        .catch(() => undefined);
    }

    if (recipients.length > 0 && input.taskName !== 'scheduler.task.failed') {
      await this.publisher
        .publish(
          QUEUES.SYSTEM_CRITICAL,
          'scheduler.task.failed',
          {
            channel: 'EMAIL',
            templateCode: 'SCHEDULER_TASK_FAILED',
            recipients: recipients.map((recipientAddress) => ({ recipientAddress })),
            metadata: record,
          },
          {
            correlationId: input.executionId,
            job: {
              source: {
                kind: 'scheduler',
                id: input.taskId,
                name: record.taskName,
                detail: input.executionId,
              },
            },
          },
        )
        .catch(() => undefined);
    }

    return record;
  }

  /** Lấy danh sách các cảnh báo thất bại đã gửi cho người phụ trách */
  public async listFailureAlerts(limit = 50): Promise<SchedulerFailureAlertRecord[]> {
    if (!this.redis.isReady()) return [];
    const safeLimit = Math.min(SCHEDULER_FAILURE_ALERT_LOG_SIZE, Math.max(1, limit));
    const raw = await this.redis.client
      .lrange(this.keys.failureAlerts(), 0, safeLimit - 1)
      .catch(() => [] as string[]);
    return safeJsonParseList<SchedulerFailureAlertRecord>(raw);
  }

  /** Lấy danh sách các lần chạy bị bỏ lỡ đã phát hiện (7.4.8) */
  public async listMissedExecutions(limit = 50): Promise<MissedExecutionRecord[]> {
    if (!this.redis.isReady()) return [];
    const safeLimit = Math.min(SCHEDULER_MISSED_LOG_SIZE, Math.max(1, limit));
    const raw = await this.redis.client
      .lrange(this.keys.missedRuns(), 0, safeLimit - 1)
      .catch(() => [] as string[]);
    return safeJsonParseList<MissedExecutionRecord>(raw);
  }
}
