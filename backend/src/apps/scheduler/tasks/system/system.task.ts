import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { TaskError } from '@packages/scheduler/index.js';
import {
  ScheduledTaskRegistry,
  type TaskExecutionContext,
} from '../../registry/scheduled-task.registry.js';

@Injectable()
export class SystemTask implements OnModuleInit {
  private readonly logger = new Logger(SystemTask.name);

  constructor(
    private readonly publisher: BaseMessagePublisherProvider,
    private readonly registry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
  ) {}

  public onModuleInit(): void {
    this.registry.register({
      id: 'system.maintenance',
      name: 'SystemMaintenance',
      description: 'Enqueue a system.maintenance.tick job for the Worker.',
      group: 'system',
      type: 'cron',
      cron: this.config.runtime.scheduler.maintenanceCron,
      overlap: 'skip',
      misfire: 'run_once',
      expectedDurationMs: 5000,
      downstreamQueue: QUEUES.SYSTEM_EVENTS,
      className: SystemTask.name,
      sourcePath: 'backend/src/apps/scheduler/tasks/system/system.task.ts',
      handler: (ctx) => this.runMaintenance(ctx),
    });
  }

  /** Tác vụ bảo trì định kỳ: chỉ đẩy một job `system.maintenance.tick` cho Worker xử lý. */
  public async runMaintenance(ctx: TaskExecutionContext): Promise<void> {
    const envelope = await this.publisher
      .publish('system.maintenance.tick', {
        triggeredAt: new Date().toISOString(),
        executionId: ctx.executionId,
      })
      .catch((err: unknown) => {
        throw new TaskError('EnqueueFailure', err instanceof Error ? err.message : String(err), {
          cause: err,
        });
      });
    ctx.recordJob({ id: envelope.id, queue: QUEUES.SYSTEM_EVENTS, topic: envelope.topic });
    this.logger.log(`Maintenance tick dispatched (job ${envelope.id})`);
  }
}
