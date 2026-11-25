import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { OutboxRelayService } from '@modules/outbox/index.js';

/**
 * Runner chạy nền trong `apps/worker`: khởi động vòng poll đọc bảng `outbox_events`
 * và đẩy sự kiện an toàn ra Queue/Broker; dừng êm khi Worker shutdown.
 */
@Injectable()
export class OutboxRelayRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly outboxRelay: OutboxRelayService,
    private readonly config: CoreConfigService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest || !this.config.database.enabled) return;
    this.outboxRelay.startPolling();
  }

  public onApplicationShutdown(): void {
    this.outboxRelay.stopPolling();
  }
}
