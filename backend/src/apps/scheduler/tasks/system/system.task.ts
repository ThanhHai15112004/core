import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { QUEUES } from '@packages/messaging/index.js';
import { ScheduledTaskRegistry } from '../../registry/scheduled-task.registry.js';

@Injectable()
export class SystemTask implements OnModuleInit {
  constructor(
    private readonly registry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
  ) {}

  public onModuleInit(): void {
    this.registry.register({
      id: 'system.maintenance',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'system.maintenance.tick',
      description: 'Enqueue a system.maintenance.tick job for the Worker.',
      pattern: this.config.runtime.scheduler.maintenanceCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler' },
    });
  }
}
