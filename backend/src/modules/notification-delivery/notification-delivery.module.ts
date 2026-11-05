import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { TemplatesModule } from '@modules/templates/index.js';
import { UsersModule } from '@modules/users/index.js';
import {
  EmailChannelProviderAdapter,
  NotificationChannelAdapterRegistry,
  PushChannelProviderAdapter,
  SmsChannelProviderAdapter,
} from './adapters/notification-channel.adapters.js';
import { NOTIFICATION_DELIVERY_PUBLIC_SERVICE } from './contracts/index.js';
import { NotificationDeliveryController } from './controllers/notification-delivery.controller.js';
import { NotificationDeliveryEntity } from './entities/notification-delivery.entity.js';
import { NotificationPushSubscriptionEntity } from './entities/notification-push-subscription.entity.js';
import { NotificationQuotaUsageEntity } from './entities/notification-quota-usage.entity.js';
import { NotificationSuppressionEntity } from './entities/notification-suppression.entity.js';
import enNotificationDelivery from './locales/en/notification-delivery.json' with { type: 'json' };
import viNotificationDelivery from './locales/vi/notification-delivery.json' with { type: 'json' };
import { NotificationDeliveryMapper } from './mappers/notification-delivery.mapper.js';
import { NotificationDeliveryRepository } from './repositories/notification-delivery.repository.js';
import { NotificationDeliveryService } from './services/notification-delivery.service.js';

new CoreI18nService().registerNamespace('notification-delivery', {
  vi: viNotificationDelivery,
  en: enNotificationDelivery,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    UsersModule,
    TemplatesModule,
    TypeOrmModule.forFeature([
      NotificationDeliveryEntity,
      NotificationSuppressionEntity,
      NotificationPushSubscriptionEntity,
      NotificationQuotaUsageEntity,
    ]),
  ],
  controllers: [NotificationDeliveryController],
  providers: [
    NotificationDeliveryRepository,
    NotificationDeliveryMapper,
    EmailChannelProviderAdapter,
    SmsChannelProviderAdapter,
    PushChannelProviderAdapter,
    {
      provide: NotificationChannelAdapterRegistry,
      useFactory: (
        emailAdapter: EmailChannelProviderAdapter,
        smsAdapter: SmsChannelProviderAdapter,
        pushAdapter: PushChannelProviderAdapter,
      ) => new NotificationChannelAdapterRegistry(emailAdapter, smsAdapter, pushAdapter),
      inject: [EmailChannelProviderAdapter, SmsChannelProviderAdapter, PushChannelProviderAdapter],
    },
    NotificationDeliveryService,
    {
      provide: NOTIFICATION_DELIVERY_PUBLIC_SERVICE,
      useExisting: NotificationDeliveryService,
    },
  ],
  exports: [
    NotificationDeliveryMapper,
    EmailChannelProviderAdapter,
    SmsChannelProviderAdapter,
    PushChannelProviderAdapter,
    NotificationChannelAdapterRegistry,
    NotificationDeliveryService,
    NOTIFICATION_DELIVERY_PUBLIC_SERVICE,
  ],
})
export class NotificationDeliveryModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('notification-delivery', {
      vi: viNotificationDelivery,
      en: enNotificationDelivery,
    });
  }
}
