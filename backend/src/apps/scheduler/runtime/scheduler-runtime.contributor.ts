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
import { ScheduledTaskRegistry } from '../registry/scheduled-task.registry.js';

@Injectable()
export class SchedulerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly registry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
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
    return {
      registeredTasks: tasks.length,
      activeTasks: tasks.length,
      runningTasks: 0,
      failedToday: 0,
      runsToday: 0,
      nextTaskName: tasks[0]?.name ?? null,
      nextTaskAt: null,
      lastFailedTask: null,
      lastFailedAt: null,
    };
  }

  public async collectDetails(): Promise<Record<string, unknown>> {
    return { tasks: this.registry.list() };
  }

  public async collectIssues(): Promise<RuntimeIssue[]> {
    return [];
  }

  public async pause(): Promise<void> {}

  public async resume(): Promise<void> {}

  public async drain(): Promise<void> {}
}
