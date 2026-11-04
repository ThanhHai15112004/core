import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SessionsModule } from '@modules/sessions/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_SMS_OTP_PROVIDER,
  CREDENTIALS_PUBLIC_SERVICE,
} from './contracts/index.js';
import { CredentialsController } from './controllers/credentials.controller.js';
import { AuthPasswordResetEntity } from './entities/auth-password-reset.entity.js';
import { AuthSecuritySettingEntity } from './entities/auth-security-setting.entity.js';
import { UserCredentialEntity } from './entities/user-credential.entity.js';
import { AuthPasswordResetRepository } from './repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from './repositories/auth-security-setting.repository.js';
import { UserCredentialRepository } from './repositories/user-credential.repository.js';
import {
  DefaultEmailNotificationAdapter,
  DefaultSmsOtpProvider,
} from './services/notification-adapters.provider.js';
import { PasswordService } from './services/password.service.js';
import { SecuritySettingsService } from './services/security-settings.service.js';
import enCredentials from './locales/en/credentials.json' with { type: 'json' };
import viCredentials from './locales/vi/credentials.json' with { type: 'json' };

new CoreI18nService().registerNamespace('credentials', { vi: viCredentials, en: enCredentials });
new CoreI18nService().registerNamespace('auth', { vi: viCredentials, en: enCredentials });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([
      UserCredentialEntity,
      AuthPasswordResetEntity,
      AuthSecuritySettingEntity,
    ]),
    UsersModule,
    SessionsModule,
  ],
  controllers: [CredentialsController],
  providers: [
    UserCredentialRepository,
    AuthPasswordResetRepository,
    AuthSecuritySettingRepository,
    DefaultEmailNotificationAdapter,
    DefaultSmsOtpProvider,
    {
      provide: AUTH_EMAIL_NOTIFICATION_ADAPTER,
      useExisting: DefaultEmailNotificationAdapter,
    },
    {
      provide: AUTH_SMS_OTP_PROVIDER,
      useExisting: DefaultSmsOtpProvider,
    },
    SecuritySettingsService,
    PasswordService,
    {
      provide: CREDENTIALS_PUBLIC_SERVICE,
      useExisting: PasswordService,
    },
  ],
  exports: [
    PasswordService,
    SecuritySettingsService,
    CREDENTIALS_PUBLIC_SERVICE,
    DefaultEmailNotificationAdapter,
    DefaultSmsOtpProvider,
    AUTH_EMAIL_NOTIFICATION_ADAPTER,
    AUTH_SMS_OTP_PROVIDER,
  ],
})
export class CredentialsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('credentials', { vi: viCredentials, en: enCredentials });
    i18n?.registerNamespace('auth', { vi: viCredentials, en: enCredentials });
  }
}
