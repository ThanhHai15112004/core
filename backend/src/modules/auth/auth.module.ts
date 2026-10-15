import { Module } from '@nestjs/common';
import { USER_IDENTITY_RESOLVER } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { AUTH_PUBLIC_SERVICE } from './contracts/index.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthMfaConfigRepository } from './repositories/auth-mfa-config.repository.js';
import { AuthPasswordResetRepository } from './repositories/auth-password-reset.repository.js';
import { AuthSecuritySettingRepository } from './repositories/auth-security-setting.repository.js';
import { AuthSessionRepository } from './repositories/auth-session.repository.js';
import { AuthService } from './services/auth.service.js';
import { MfaService } from './services/mfa.service.js';
import { PasswordService } from './services/password.service.js';
import { SecuritySettingsService } from './services/security-settings.service.js';
import { SessionService } from './services/session.service.js';
import { UserIdentityResolverService } from './services/user-identity-resolver.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthSessionRepository,
    AuthMfaConfigRepository,
    AuthPasswordResetRepository,
    AuthSecuritySettingRepository,
    SecuritySettingsService,
    SessionService,
    PasswordService,
    MfaService,
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
    SecuritySettingsService,
    AUTH_PUBLIC_SERVICE,
    USER_IDENTITY_RESOLVER,
  ],
})
export class AuthModule {}
