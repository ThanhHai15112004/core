import { Injectable } from '@nestjs/common';
import type {
  ExecutionTrigger,
  GeneratedJobRef,
  MisfirePolicy,
  OverlapPolicy,
  SchedulerTaskType,
} from '@packages/scheduler/index.js';

/** Ngữ cảnh một lần chạy — handler dùng để khai báo job đã tạo (nối sang Queue / Worker). */
export interface TaskExecutionContext {
  executionId: string;
  taskId: string;
  trigger: ExecutionTrigger;
  /** epoch ms theo lịch; null khi chạy thủ công. */
  scheduledAt: number | null;
  /** Log trong lần chạy và message được publish mang correlation ID này. */
  correlationId: string;
  recordJob(job: GeneratedJobRef): void;
}

/**
 * Khai báo một scheduled task. Task nặng chỉ nên trigger / enqueue (khai báo `downstreamQueue`) để Worker xử lý,
 * không tự làm toàn bộ công việc trong Scheduler.
 */
export interface ScheduledTaskDefinition {
  /** Định danh ổn định: chữ thường, số, `.`, `-`, `_` (vd. `system.maintenance`). */
  id: string;
  name: string;
  description?: string;
  group?: string;
  type: SchedulerTaskType;
  cron?: string;
  intervalMs?: number;
  runAt?: Date | number;
  /** Mặc định `SCHEDULER_TIMEZONE`. */
  timezone?: string;
  /** Mặc định `skip` (không chạy chồng, có lock phân tán). */
  overlap?: OverlapPolicy;
  /** Mặc định `run_once` (chạy bù một lần khi scheduler hồi phục). */
  misfire?: MisfirePolicy;
  expectedDurationMs?: number;
  lockTtlMs?: number;
  downstreamQueue?: string;
  className: string;
  sourcePath?: string;
  handler: (ctx: TaskExecutionContext) => Promise<void>;
}

const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** Registry task của Scheduler runtime: task tự đăng ký trong `onModuleInit`, runner đọc lúc bootstrap. */
@Injectable()
export class ScheduledTaskRegistry {
  private readonly tasks = new Map<string, ScheduledTaskDefinition>();

  public register(def: ScheduledTaskDefinition): void {
    if (!TASK_ID.test(def.id)) throw new Error(`Invalid scheduled task id "${def.id}"`);
    if (this.tasks.has(def.id)) throw new Error(`Scheduled task "${def.id}" is already registered`);
    this.tasks.set(def.id, def);
  }

  public list(): ScheduledTaskDefinition[] {
    return [...this.tasks.values()];
  }

  public get(id: string): ScheduledTaskDefinition | undefined {
    return this.tasks.get(id);
  }
}
