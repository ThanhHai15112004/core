import { performance } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  SchedulerStore,
  recordSchedulerEvent,
  recordSchedulerOperation,
  schedulerId,
  type ScheduledTaskMeta,
  type SchedulerCommand,
  type SchedulerCommandResult,
  type SchedulerOperationAction,
  type SchedulerOperationRecord,
} from '@packages/scheduler/index.js';
import { liveness } from './scheduler-utils.js';
import {
  SchedulerActionRejectedException,
  SchedulerNotFoundException,
  SchedulerUnavailableException,
} from '../exceptions/scheduler-ops.exceptions.js';

export interface SchedulerOperationContext {
  ip: string | null;
  actor: string | null;
}

/** Chờ scheduler xác nhận lệnh Run Now tối đa chừng này. */
const COMMAND_WAIT_MS = 4000;
const COMMAND_POLL_MS = 100;

/**
 * Thao tác của người vận hành trên task: Run Now (gửi lệnh tới Scheduler runtime qua Redis, runtime tự áp dụng
 * overlap policy), Enable / Disable (giữ task nhưng không trigger theo lịch — không xoá định nghĩa, không huỷ lần
 * đang chạy). Bật/tắt bằng env, ghi audit + sự kiện. Không sửa lịch: lịch được khai báo trong code.
 */
@Injectable()
export class SchedulerOperationsService {
  constructor(
    private readonly store: SchedulerStore,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  private async task(id: string): Promise<ScheduledTaskMeta> {
    if (!this.store.isAvailable()) throw new SchedulerUnavailableException('STORE_UNAVAILABLE');
    const meta = await this.store.task(id);
    if (!meta) throw new SchedulerNotFoundException('scheduler.error.taskNotFound', { id });
    return meta;
  }

  private audit(
    action: SchedulerOperationAction,
    target: string,
    ctx: SchedulerOperationContext,
    started: number,
    detail: string | null,
    error: string | null,
    executionId: string | null = null,
  ): Promise<SchedulerOperationRecord> {
    return recordSchedulerOperation(this.redis, {
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
    });
  }

  /** Chạy thủ công ngay (trigger = manual). Task đang chạy mà overlap = Prevent → từ chối, không chạy chồng. */
  public async runNow(
    taskId: string,
    ctx: SchedulerOperationContext,
  ): Promise<{ record: SchedulerOperationRecord; executionId: string; instance: string }> {
    if (!this.config.scheduler.run) throw new SchedulerActionRejectedException('RUN_DISABLED');
    const meta = await this.task(taskId);
    const started = performance.now();
    const fail = async (err: Error, detail: string | null = null) => {
      await this.audit('run', taskId, ctx, started, detail, err.message);
      return err;
    };
    if (meta.error)
      throw await fail(
        new SchedulerActionRejectedException('MISCONFIGURED', { error: meta.error }),
      );
    const live = liveness(
      await this.store.instances(),
      Date.now(),
      this.config.scheduler.rules.heartbeatTimeoutSec,
    );
    if (live.alive.length === 0)
      throw await fail(new SchedulerUnavailableException('RUNTIME_DOWN'));
    if (live.paused) throw await fail(new SchedulerActionRejectedException('RUNTIME_PAUSED'));
    if (meta.overlap === 'skip') {
      const holder = await this.store.client.get(this.store.keys.lock(taskId));
      if (holder) {
        const executionId = holder.split('|')[0] ?? '';
        const running = await this.store.execution(executionId);
        throw await fail(
          new SchedulerActionRejectedException('TASK_RUNNING', {
            execution: executionId,
            startedAt: running?.startedAt ? new Date(running.startedAt).toISOString() : '',
          }),
        );
      }
    }
    const cmd: SchedulerCommand = {
      id: schedulerId('scmd'),
      action: 'run',
      taskId,
      executionId: schedulerId('sch'),
      actor: ctx.actor,
      ip: ctx.ip,
      requestedAt: Date.now(),
    };
    const receivers = await this.store.client.publish(
      this.store.keys.commandChannel(),
      JSON.stringify(cmd),
    );
    if (receivers === 0) throw await fail(new SchedulerUnavailableException('RUNTIME_DOWN'));
    const result = await this.waitResult(cmd.id);
    if (!result) throw await fail(new SchedulerUnavailableException('NO_RESPONSE'));
    if (result.status === 'rejected')
      throw await fail(
        new SchedulerActionRejectedException(result.code ?? 'REJECTED', result.params),
        `instance=${result.instance}`,
      );
    const executionId = result.executionId ?? cmd.executionId!;
    const record = await this.audit(
      'run',
      taskId,
      ctx,
      started,
      `instance=${result.instance}`,
      null,
      executionId,
    );
    await recordSchedulerEvent(this.redis, {
      type: 'manual_run',
      severity: 'info',
      taskId,
      executionId,
      params: { task: meta.name, ...(ctx.actor ? { actor: ctx.actor } : {}) },
    });
    return { record, executionId, instance: result.instance };
  }

  private async waitResult(id: string): Promise<SchedulerCommandResult | null> {
    const deadline = Date.now() + COMMAND_WAIT_MS;
    while (Date.now() < deadline) {
      const raw = await this.store.client.get(this.store.keys.commandResult(id));
      if (raw) {
        try {
          return JSON.parse(raw) as SchedulerCommandResult;
        } catch {
          return null;
        }
      }
      await new Promise((r) => setTimeout(r, COMMAND_POLL_MS));
    }
    return null;
  }

  public enable(taskId: string, ctx: SchedulerOperationContext) {
    return this.toggle(taskId, true, ctx);
  }

  public disable(taskId: string, ctx: SchedulerOperationContext) {
    return this.toggle(taskId, false, ctx);
  }

  /** Ghi trạng thái bật/tắt vào Redis (bền qua restart) rồi báo runtime lên lịch lại. */
  private async toggle(
    taskId: string,
    enable: boolean,
    ctx: SchedulerOperationContext,
  ): Promise<SchedulerOperationRecord> {
    if (!this.config.scheduler.toggle)
      throw new SchedulerActionRejectedException('TOGGLE_DISABLED');
    const meta = await this.task(taskId);
    const started = performance.now();
    const key = this.store.keys.disabled();
    const isDisabled = (await this.store.client.hexists(key, taskId)) === 1;
    if (enable !== isDisabled)
      throw new SchedulerActionRejectedException(enable ? 'ALREADY_ENABLED' : 'ALREADY_DISABLED', {
        task: meta.name,
      });
    const action = enable ? 'enable' : 'disable';
    try {
      if (enable) await this.store.client.hdel(key, taskId);
      else
        await this.store.client.hset(
          key,
          taskId,
          JSON.stringify({ at: Date.now(), actor: ctx.actor, ip: ctx.ip }),
        );
      const cmd: SchedulerCommand = {
        id: schedulerId('scmd'),
        action: 'refresh',
        taskId,
        executionId: null,
        actor: ctx.actor,
        ip: ctx.ip,
        requestedAt: Date.now(),
      };
      await this.store.client.publish(this.store.keys.commandChannel(), JSON.stringify(cmd));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.audit(action, taskId, ctx, started, null, message);
      throw new SchedulerActionRejectedException('FAILED', { message }, 502);
    }
    const state = (await this.store.states()).get(taskId);
    const record = await this.audit(
      action,
      taskId,
      ctx,
      started,
      state?.nextRunAt ? `nextRunAt=${new Date(state.nextRunAt).toISOString()}` : null,
      null,
    );
    await recordSchedulerEvent(this.redis, {
      type: enable ? 'task_enabled' : 'task_disabled',
      severity: enable ? 'info' : 'warning',
      taskId,
      params: { task: meta.name, ...(ctx.actor ? { actor: ctx.actor } : {}) },
    });
    return record;
  }
}
