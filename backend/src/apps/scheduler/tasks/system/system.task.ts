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

  /** Đăng ký tác vụ bảo trì hệ thống định kỳ (maintenance tick) khi khởi tạo module */
  public onModuleInit(): void {
    this.registry.register({
      id: 'system.maintenance',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'system.maintenance.tick',
      description: 'Enqueue a system.maintenance.tick job for the Worker.',
      pattern: this.config.runtime.scheduler.maintenanceCron,
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'workflows.sla.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'workflows.sla.tick',
      description:
        'Quét thời hạn SLA của các quy trình xử lý (Workflows) đang chạy và gửi cảnh báo sắp quá hạn / quá hạn (Mục 9.3.8).',
      pattern: '*/15 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'workflows' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });

    this.registry.register({
      id: 'calendar.reminder.scan',
      queue: QUEUES.SYSTEM_EVENTS,
      name: 'calendar.reminder.tick',
      description:
        'Quét các lịch nhắc sự kiện (Calendar & Events) đến hạn và gửi thông báo qua Notification (Mục 9.7.4).',
      pattern: '*/5 * * * *',
      tz: this.config.scheduler.timezone,
      data: { triggeredBy: 'scheduler', module: 'calendar' },
      notifyOnFailure: true,
      misfirePolicy: 'run_once',
    });
  }
}
