import { performance } from 'node:perf_hooks';
import { Injectable, Logger } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { QueueRegistry } from '@packages/queue/index.js';
import type {
  SchedulerOperationAction,
  SchedulerOperationRecord,
} from '../contracts/scheduler.types.js';
import {
  SchedulerActionRejectedException,
  SchedulerNotFoundException,
  SchedulerUnavailableException,
} from '../exceptions/scheduler-ops.exceptions.js';

export interface SchedulerOperationContext {
  ip: string | null;
  actor: string | null;
}

const OPERATIONS_KEY = 'scheduler:operations';
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
}

@Injectable()
export class SchedulerOperationsService {
  private readonly logger = new Logger(SchedulerOperationsService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly queueRegistry: QueueRegistry,
  ) {}

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
          .lpush(OPERATIONS_KEY, JSON.stringify(record))
          .ltrim(OPERATIONS_KEY, 0, MAX_OPERATIONS - 1)
          .exec();
      }
    } catch (err) {
      this.logger.warn(
        `Failed to save audit record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return record;
  }

  public async getOperations(): Promise<SchedulerOperationRecord[]> {
    if (!this.redis.isReady()) return [];
    try {
      const raw = await this.redis.client.lrange(OPERATIONS_KEY, 0, MAX_OPERATIONS - 1);
      return raw.map((item) => JSON.parse(item) as SchedulerOperationRecord);
    } catch {
      return [];
    }
  }

  private async findTaskDefinition(taskId: string): Promise<TaskDefinitionJson | null> {
    if (!this.redis.isReady()) return null;
    const raw = await this.redis.client.hget('scheduler:definitions', taskId);
    if (raw) {
      try {
        return JSON.parse(raw) as TaskDefinitionJson;
      } catch {
        // continue search
      }
    }

    // Nếu không có trong cache định nghĩa, tìm trong các queue của BullMQ
    const queues = this.queueRegistry.getQueues();
    for (const [queueName, queue] of queues.entries()) {
      try {
        const schedulers = await queue.getJobSchedulers();
        const found = schedulers.find(
          (s: { id?: string | null; key?: string }) => s.id === taskId || s.key === taskId,
        );
        if (found) {
          return {
            id: taskId,
            queue: queueName,
            name: found.name || taskId,
            pattern: found.pattern,
            every: found.every,
            tz: found.tz,
            data: (found.template?.data as Record<string, unknown>) ?? {},
          };
        }
      } catch {
        // next queue
      }
    }

    return null;
  }

  /** Run Now: Kích hoạt ngay một job trong queue đích của scheduler */
  public async runNow(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<{ record: SchedulerOperationRecord; executionId: string; instance: string }> {
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

    try {
      const queue = this.queueRegistry.getQueue(task.queue);
      const job = await queue.add(task.name ?? taskId, {
        ...(task.data ?? {}),
        _triggeredBy: 'manual',
        _requestedAt: new Date().toISOString(),
      });

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

      return {
        record,
        executionId: execId,
        instance: 'api',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit('run', taskId, ctx, started, null, msg);
      throw new SchedulerUnavailableException('STORE_UNAVAILABLE', { error: msg });
    }
  }

  /** Enable task */
  public async enable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationRecord> {
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
      await this.redis.client.srem('scheduler:disabled', taskId);

      // Upsert scheduler vào BullMQ
      const queue = this.queueRegistry.getQueue(task.queue);
      const repeatOpts: { pattern?: string; every?: number; tz?: string } = {};
      if (task.pattern) repeatOpts.pattern = task.pattern;
      if (task.every) repeatOpts.every = task.every;
      repeatOpts.tz = task.tz || this.config.scheduler.timezone;

      await queue.upsertJobScheduler(taskId, repeatOpts, {
        name: task.name ?? taskId,
        data: task.data ?? {},
      });

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

  /** Disable task */
  public async disable(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationRecord> {
    if (!this.config.scheduler.toggle) {
      throw new SchedulerActionRejectedException('TOGGLE_DISABLED');
    }
    const started = performance.now();

    try {
      await this.redis.client.sadd('scheduler:disabled', taskId);

      // Gỡ scheduler khỏi BullMQ queue
      const queues = this.queueRegistry.getQueues();
      for (const queue of queues.values()) {
        try {
          await queue.removeJobScheduler(taskId);
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
}
