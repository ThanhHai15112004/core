import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
  type RuntimeIssue,
} from '@packages/runtime/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { schedulerKeys } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import { ScheduledTaskRegistry } from '../registry/scheduled-task.registry.js';

/**
 * Scheduler runtime chỉ đồng bộ lịch sang BullMQ Job Scheduler — job được BullMQ tạo, worker xử lý. Số lần chạy /
 * lỗi xem ở trang Scheduler (đọc từ job trên broker). Không pause được từ Console (lịch nằm trên broker).
 */
@Injectable()
export class SchedulerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly registry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  public describe(): RuntimeDescriptor {
    return {
      type: 'scheduler',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: 'BullMQ JobScheduler',
      entrypoint: 'apps/scheduler/main.ts',
      sourcePath: 'backend/src/apps/scheduler/',
      details: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        scheduleTimezone: this.config.scheduler.timezone,
      },
    };
  }

  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    const tasks = this.registry.list();
    const disabled = this.redis.isReady()
      ? new Set(
          await this.redis.client.smembers(schedulerKeys(this.redis).disabled()).catch(() => []),
        )
      : null;
    return {
      registeredTasks: tasks.length,
      activeTasks: disabled ? tasks.filter((t) => !disabled.has(t.id)).length : null,
    };
  }

  public async collectDetails(): Promise<Record<string, unknown>> {
    return { tasks: this.registry.list() };
  }

  public async collectIssues(): Promise<RuntimeIssue[]> {
    return [];
  }

  public capabilities(): { pause: boolean } {
    return { pause: false };
  }
}
