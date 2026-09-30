import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerStore } from '@packages/scheduler/index.js';
import { ScheduledTaskRegistry } from '../../registry/scheduled-task.registry.js';

const HOUR_MS = 3600_000;

/** Dọn chỉ mục lịch sử thực thi quá hạn giữ (`SCHEDULER_HISTORY_RETENTION_DAYS`). */
@Injectable()
export class HistoryPruneTask implements OnModuleInit {
  private readonly logger = new Logger(HistoryPruneTask.name);

  constructor(
    private readonly registry: ScheduledTaskRegistry,
    private readonly store: SchedulerStore,
  ) {}

  public onModuleInit(): void {
    this.registry.register({
      id: 'scheduler.history-prune',
      name: 'SchedulerHistoryPrune',
      description: 'Remove execution history older than the retention period.',
      group: 'scheduler',
      type: 'interval',
      intervalMs: HOUR_MS,
      overlap: 'skip',
      misfire: 'skip',
      expectedDurationMs: 10_000,
      className: HistoryPruneTask.name,
      sourcePath: 'backend/src/apps/scheduler/tasks/system/history-prune.task.ts',
      handler: () => this.prune(),
    });
  }

  public async prune(): Promise<void> {
    const removed = await this.store.prune(this.registry.list().map((t) => t.id));
    this.logger.log(`Execution history pruned (${removed} index entries removed)`);
  }
}
