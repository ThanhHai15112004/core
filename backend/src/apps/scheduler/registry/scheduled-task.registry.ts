import { Injectable } from '@nestjs/common';

/**
 * Khai báo một scheduled task trong Lean Core.
 * Scheduler runtime đồng bộ định nghĩa này sang BullMQ Job Scheduler.
 * Worker runtime sẽ là nơi thực sự xử lý job do scheduler kích hoạt.
 */
export interface ScheduledTaskDefinition {
  id: string;
  queue: string;
  name?: string;
  description?: string;
  pattern?: string; // cron expression
  every?: number; // interval in milliseconds
  tz?: string;
  data?: Record<string, unknown>;
}

const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

@Injectable()
export class ScheduledTaskRegistry {
  private readonly tasks = new Map<string, ScheduledTaskDefinition>();

  public register(def: ScheduledTaskDefinition): void {
    if (!TASK_ID.test(def.id)) {
      throw new Error(`Invalid scheduled task id "${def.id}"`);
    }
    if (this.tasks.has(def.id)) {
      throw new Error(`Scheduled task "${def.id}" is already registered`);
    }
    this.tasks.set(def.id, def);
  }

  public list(): ScheduledTaskDefinition[] {
    return [...this.tasks.values()];
  }

  public get(id: string): ScheduledTaskDefinition | undefined {
    return this.tasks.get(id);
  }
}
