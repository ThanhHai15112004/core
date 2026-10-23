import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { UsersModule } from '@modules/users/index.js';
import {
  EmailChannelProviderAdapter,
  NotificationChannelAdapterRegistry,
  PushChannelProviderAdapter,
  SmsChannelProviderAdapter,
} from './adapters/notification-channel.adapters.js';
import { NOTIFICATIONS_PUBLIC_SERVICE } from './contracts/index.js';
import { NotificationsController } from './controllers/notifications.controller.js';
import { NotificationDeliveryEntity } from './entities/notification-delivery.entity.js';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity.js';
import { NotificationPushSubscriptionEntity } from './entities/notification-push-subscription.entity.js';
import { NotificationQuotaUsageEntity } from './entities/notification-quota-usage.entity.js';
import { NotificationRecipientEntity } from './entities/notification-recipient.entity.js';
import { NotificationSuppressionEntity } from './entities/notification-suppression.entity.js';
import { NotificationTemplateEntity } from './entities/notification-template.entity.js';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsMapper } from './mappers/notifications.mapper.js';
import { NotificationChannelsRepository } from './repositories/notification-channels.repository.js';
import { NotificationPreferencesRepository } from './repositories/notification-preferences.repository.js';
import { NotificationRecipientsRepository } from './repositories/notification-recipients.repository.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import { NotificationChannelsService } from './services/notification-channels.service.js';
import { NotificationsService } from './services/notifications.service.js';
import enNotifications from './locales/en/notifications.json' with { type: 'json' };
import viNotifications from './locales/vi/notifications.json' with { type: 'json' };

new CoreI18nService().registerNamespace('notifications', {
  vi: viNotifications,
  en: enNotifications,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    OrganizationsModule,
    RolesModule,
    UsersModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationRecipientEntity,
      NotificationPreferenceEntity,
      NotificationTemplateEntity,
      NotificationDeliveryEntity,
      NotificationSuppressionEntity,
      NotificationPushSubscriptionEntity,
      NotificationQuotaUsageEntity,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationRecipientsRepository,
    NotificationPreferencesRepository,
    NotificationChannelsRepository,
    EmailChannelProviderAdapter,
    SmsChannelProviderAdapter,
    PushChannelProviderAdapter,
    NotificationChannelAdapterRegistry,
    NotificationsMapper,
    NotificationChannelsService,
    NotificationsService,
    {
      provide: NOTIFICATIONS_PUBLIC_SERVICE,
      useExisting: NotificationsService,
    },
  ],
  exports: [
    NotificationsService,
    NotificationChannelsService,
    NotificationChannelAdapterRegistry,
    NOTIFICATIONS_PUBLIC_SERVICE,
  ],
})
export class NotificationsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('notifications', {
      vi: viNotifications,
      en: enNotifications,
    });
  }
}
