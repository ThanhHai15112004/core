import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { WEBHOOKS_PUBLIC_SERVICE } from './contracts/index.js';
import { WebhooksController } from './controllers/webhooks.controller.js';
import { WebhookDeliveryAttemptEntity } from './entities/webhook-delivery-attempt.entity.js';
import { WebhookDeliveryEntity } from './entities/webhook-delivery.entity.js';
import { WebhookEndpointEntity } from './entities/webhook-endpoint.entity.js';
import { WebhookDeliveryAttemptRepository } from './repositories/webhook-delivery-attempt.repository.js';
import { WebhookDeliveryRepository } from './repositories/webhook-delivery.repository.js';
import { WebhookEndpointRepository } from './repositories/webhook-endpoint.repository.js';
import { WebhooksDeliveryService } from './services/webhooks-delivery.service.js';
import { WebhooksEndpointsService } from './services/webhooks-endpoints.service.js';
import { WebhooksService } from './services/webhooks.service.js';
import enWebhooks from './locales/en/webhooks.json' with { type: 'json' };
import viWebhooks from './locales/vi/webhooks.json' with { type: 'json' };

new CoreI18nService().registerNamespace('webhooks', {
  vi: viWebhooks,
  en: enWebhooks,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      WebhookEndpointEntity,
      WebhookDeliveryEntity,
      WebhookDeliveryAttemptEntity,
    ]),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhookEndpointRepository,
    WebhookDeliveryRepository,
    WebhookDeliveryAttemptRepository,
    WebhooksEndpointsService,
    WebhooksDeliveryService,
    WebhooksService,
    {
      provide: WEBHOOKS_PUBLIC_SERVICE,
      useExisting: WebhooksService,
    },
  ],
  exports: [WebhooksService, WEBHOOKS_PUBLIC_SERVICE],
})
export class WebhooksModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('webhooks', {
      vi: viWebhooks,
      en: enWebhooks,
    });
  }
}
