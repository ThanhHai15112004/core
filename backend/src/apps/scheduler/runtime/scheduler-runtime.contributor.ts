import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
  type RuntimeIssue,
} from '@packages/runtime/index.js';
import { TaskRunnerService } from '../runner/task-runner.service.js';

/** Task lỗi trong khoảng này vẫn được coi là vấn đề đang diễn ra. */
const RECENT_FAILURE_MS = 15 * 60_000;

@Injectable()
export class SchedulerRuntimeContributor implements RuntimeContributor, OnModuleInit {
  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly runner: TaskRunnerService,
  ) {}

  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  public describe(): RuntimeDescriptor {
    return {
      type: 'scheduler',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: withVersion('@nestjs/schedule', '@nestjs/schedule'),
      entrypoint: 'apps/scheduler/main.ts',
      sourcePath: 'backend/src/apps/scheduler/',
      details: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
  }

  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    const tasks = this.runner.list();
    const next = tasks
      .filter((t) => t.nextRunAt)
      .sort((a, b) => (a.nextRunAt! < b.nextRunAt! ? -1 : 1))[0];
    const lastFailed = tasks
      .filter((t) => t.lastFailedAt)
      .sort((a, b) => (a.lastFailedAt! > b.lastFailedAt! ? -1 : 1))[0];

    return {
      registeredTasks: tasks.length,
      runningTasks: tasks.filter((t) => t.running).length,
      failedToday: tasks.reduce((sum, t) => sum + t.failuresToday, 0),
      runsToday: tasks.reduce((sum, t) => sum + t.runsToday, 0),
      nextTaskName: next?.name ?? null,
      nextTaskAt: next?.nextRunAt ?? null,
      lastFailedTask: lastFailed?.name ?? null,
      lastFailedAt: lastFailed?.lastFailedAt ?? null,
    };
  }

  public async collectDetails(): Promise<Record<string, unknown>> {
    return { tasks: this.runner.list() };
  }

  public async collectIssues(): Promise<RuntimeIssue[]> {
    const now = Date.now();
    return this.runner
      .list()
      .filter(
        (t) =>
          t.lastError && t.lastFailedAt && now - Date.parse(t.lastFailedAt) < RECENT_FAILURE_MS,
      )
      .map((t) => ({
        key: 'runtime.issue.taskFailed',
        params: { task: t.name, error: t.lastError ?? '', at: t.lastFailedAt ?? '' },
      }));
  }

  public async pause(): Promise<void> {
    this.runner.pause();
  }

  public async resume(): Promise<void> {
    this.runner.resume();
  }

  public drain(): Promise<void> {
    return this.runner.drain();
  }
}
