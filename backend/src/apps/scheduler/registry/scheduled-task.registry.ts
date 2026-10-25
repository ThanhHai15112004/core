import { Injectable } from '@nestjs/common';

/**
 * Khai báo một scheduled task trong Lean Core.
 * Scheduler runtime đồng bộ định nghĩa này sang BullMQ Job Scheduler.
 * Worker runtime sẽ là nơi thực sự xử lý job do scheduler kích hoạt.
 */
export type ScheduledTaskMisfirePolicy = 'skip' | 'run_once';

export interface ScheduledTaskDefinition {
  id: string;
  queue: string;
  name?: string;
  description?: string;
  pattern?: string; // cron expression
  every?: number; // interval in milliseconds
  tz?: string;
  data?: Record<string, unknown>;
  /** Người phụ trách chính nhận cảnh báo khi công việc định kỳ thất bại. */
  ownerEmail?: string;
  /** Danh sách email người nhận cảnh báo bổ sung khi công việc thất bại. */
  notifyEmails?: string[];
  /** Có gửi cảnh báo khi công việc thất bại hay không (mặc định true). */
  notifyOnFailure?: boolean;
  /** Chính sách xử lý khi phát hiện công việc bị bỏ lỡ (server tắt lâu): 'skip' hoặc 'run_once'. */
  misfirePolicy?: ScheduledTaskMisfirePolicy;
  /** Thời gian giữ distributed lock tối đa (giây) để ngăn chạy trùng. */
  lockTtlSec?: number;
}

const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

@Injectable()
export class ScheduledTaskRegistry {
  private readonly tasks = new Map<string, ScheduledTaskDefinition>();

  /** Đăng ký một định nghĩa scheduled task mới vào registry */
  public register(def: ScheduledTaskDefinition): void {
    if (!TASK_ID.test(def.id)) {
      throw new Error(`Invalid scheduled task id "${def.id}"`);
    }
    if (this.tasks.has(def.id)) {
      throw new Error(`Scheduled task "${def.id}" is already registered`);
    }
    this.tasks.set(def.id, def);
  }

  /** Lấy danh sách toàn bộ các định nghĩa scheduled task đã đăng ký */
  public list(): ScheduledTaskDefinition[] {
    return [...this.tasks.values()];
  }

  /** Tìm kiếm định nghĩa scheduled task theo mã định danh (ID) */
  public get(id: string): ScheduledTaskDefinition | undefined {
    return this.tasks.get(id);
  }
}
