import { Module, Optional } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import { USER_IDENTITY_RESOLVER } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_PUBLIC_SERVICE,
  AUTH_SMS_OTP_PROVIDER,
} from './contracts/index.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthApiClientRepository } from './repositories/auth-api-client.repository.js';
import { AuthLoginHistoryRepository } from './repositories/auth-login-history.repository.js';
import { AuthMfaConfigRepository } from './repositories/auth-mfa-config.repository.js';
import { AuthPasswordResetRepository } from './repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from './repositories/auth-security-setting.repository.js';
import { AuthServiceAccountRepository } from './repositories/auth-service-account.repository.js';
import { AuthSessionRepository } from './repositories/auth-session.repository.js';
import { AuthVerificationCodeRepository } from './repositories/auth-verification-code.repository.js';
import { AuthService } from './services/auth.service.js';
import { MfaService } from './services/mfa.service.js';
import {
  DefaultEmailNotificationAdapter,
  DefaultSmsOtpProvider,
} from './services/notification-adapters.provider.js';
import { PasswordService } from './services/password.service.js';
import { SecuritySettingsService } from './services/security-settings.service.js';
import { ServiceAccountService } from './services/service-account.service.js';
import { SessionService } from './services/session.service.js';
import { UserIdentityResolverService } from './services/user-identity-resolver.service.js';
import { VerificationService } from './services/verification.service.js';
import enAuth from './locales/en/auth.json' with { type: 'json' };
import viAuth from './locales/vi/auth.json' with { type: 'json' };

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthSessionRepository,
    AuthLoginHistoryRepository,
    AuthMfaConfigRepository,
    AuthPasswordResetRepository,
    AuthSecuritySettingRepository,
    AuthVerificationCodeRepository,
    AuthServiceAccountRepository,
    AuthApiClientRepository,
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
    SessionService,
    PasswordService,
    MfaService,
    VerificationService,
    ServiceAccountService,
    AuthService,
    UserIdentityResolverService,
    {
      provide: AUTH_PUBLIC_SERVICE,
      useExisting: AuthService,
    },
    {
      provide: USER_IDENTITY_RESOLVER,
      useExisting: UserIdentityResolverService,
    },
  ],
  exports: [
    AuthService,
    SessionService,
    PasswordService,
    MfaService,
    VerificationService,
    ServiceAccountService,
    SecuritySettingsService,
    DefaultEmailNotificationAdapter,
    DefaultSmsOtpProvider,
    AUTH_EMAIL_NOTIFICATION_ADAPTER,
    AUTH_SMS_OTP_PROVIDER,
    AUTH_PUBLIC_SERVICE,
    USER_IDENTITY_RESOLVER,
  ],
})
export class AuthModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('auth', { vi: viAuth, en: enAuth });
  }
}
