import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import {
  INBOUND_WEBHOOKS_PUBLIC_SERVICE,
  INBOUND_WEBHOOK_HANDLER_REGISTRY,
} from './contracts/index.js';
import { InboundWebhooksController } from './controllers/inbound-webhooks.controller.js';
import { InboundWebhooksReceiveController } from './controllers/inbound-webhooks-receive.controller.js';
import { InboundWebhookAttemptEntity } from './entities/inbound-webhook-attempt.entity.js';
import { InboundWebhookEventEntity } from './entities/inbound-webhook-event.entity.js';
import { InboundWebhookProviderEntity } from './entities/inbound-webhook-provider.entity.js';
import { InboundWebhookAttemptRepository } from './repositories/inbound-webhook-attempt.repository.js';
import { InboundWebhookEventRepository } from './repositories/inbound-webhook-event.repository.js';
import { InboundWebhookProviderRepository } from './repositories/inbound-webhook-provider.repository.js';
import { InboundWebhookHandlerRegistry } from './services/inbound-webhook-handler.registry.js';
import { InboundWebhooksProcessingService } from './services/inbound-webhooks-processing.service.js';
import { InboundWebhooksProvidersService } from './services/inbound-webhooks-providers.service.js';
import { InboundWebhooksReceiveService } from './services/inbound-webhooks-receive.service.js';
import { InboundWebhooksService } from './services/inbound-webhooks.service.js';
import enInboundWebhooks from './locales/en/inbound-webhooks.json' with { type: 'json' };
import viInboundWebhooks from './locales/vi/inbound-webhooks.json' with { type: 'json' };

new CoreI18nService().registerNamespace('inbound-webhooks', {
  vi: viInboundWebhooks,
  en: enInboundWebhooks,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([
      InboundWebhookProviderEntity,
      InboundWebhookEventEntity,
      InboundWebhookAttemptEntity,
    ]),
  ],
  controllers: [InboundWebhooksReceiveController, InboundWebhooksController],
  providers: [
    InboundWebhookProviderRepository,
    InboundWebhookEventRepository,
    InboundWebhookAttemptRepository,
    InboundWebhookHandlerRegistry,
    InboundWebhooksProvidersService,
    InboundWebhooksReceiveService,
    InboundWebhooksProcessingService,
    InboundWebhooksService,
    {
      provide: INBOUND_WEBHOOKS_PUBLIC_SERVICE,
      useExisting: InboundWebhooksService,
    },
    {
      provide: INBOUND_WEBHOOK_HANDLER_REGISTRY,
      useExisting: InboundWebhookHandlerRegistry,
    },
  ],
  exports: [
    InboundWebhooksService,
    InboundWebhookHandlerRegistry,
    INBOUND_WEBHOOKS_PUBLIC_SERVICE,
    INBOUND_WEBHOOK_HANDLER_REGISTRY,
  ],
})
export class InboundWebhooksModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('inbound-webhooks', {
      vi: viInboundWebhooks,
      en: enInboundWebhooks,
    });
  }
}
