import { Injectable, Logger } from '@nestjs/common';
import { BaseMessagePublisherProvider } from '@packages/messaging/index.js';

@Injectable()
export class SystemTask {
  private readonly logger = new Logger(SystemTask.name);

  constructor(private readonly publisher: BaseMessagePublisherProvider) {}

  /** Tác vụ bảo trì định kỳ: đẩy một job `system.maintenance.tick` cho Worker xử lý. */
  public async runMaintenance(): Promise<void> {
    const envelope = await this.publisher.publish('system.maintenance.tick', {
      triggeredAt: new Date().toISOString(),
    });
    this.logger.log(`Maintenance tick dispatched (job ${envelope.id})`);
  }
}
