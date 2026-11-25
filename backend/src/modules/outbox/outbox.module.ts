import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { OUTBOX_PUBLIC_SERVICE, OUTBOX_TRANSPORT_PORT } from './contracts/index.js';
import { OutboxController } from './controllers/outbox.controller.js';
import { OutboxEventEntity } from './entities/outbox-event.entity.js';
import enOutbox from './locales/en/outbox.json' with { type: 'json' };
import viOutbox from './locales/vi/outbox.json' with { type: 'json' };
import { OutboxEventRepository } from './repositories/outbox-event.repository.js';
import { OutboxRelayService } from './services/outbox-relay.service.js';
import { BullMqOutboxTransport } from './services/outbox-transport.service.js';
import { OutboxService } from './services/outbox.service.js';

new CoreI18nService().registerNamespace('outbox', {
  vi: viOutbox,
  en: enOutbox,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    NotificationsModule,
    TypeOrmModule.forFeature([OutboxEventEntity]),
  ],
  controllers: [OutboxController],
  providers: [
    OutboxEventRepository,
    BullMqOutboxTransport,
    {
      provide: OUTBOX_TRANSPORT_PORT,
      useExisting: BullMqOutboxTransport,
    },
    OutboxRelayService,
    OutboxService,
    {
      provide: OUTBOX_PUBLIC_SERVICE,
      useExisting: OutboxService,
    },
  ],
  exports: [OutboxService, OutboxRelayService, OUTBOX_PUBLIC_SERVICE, OUTBOX_TRANSPORT_PORT],
})
export class OutboxModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('outbox', {
      vi: viOutbox,
      en: enOutbox,
    });
  }
}
