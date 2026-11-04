import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { UsersModule } from '@modules/users/index.js';
import { SESSIONS_PUBLIC_SERVICE } from './contracts/index.js';
import { SessionsController } from './controllers/sessions.controller.js';
import { AuthLoginHistoryEntity } from './entities/auth-login-history.entity.js';
import { AuthSessionEntity } from './entities/auth-session.entity.js';
import { AuthLoginHistoryRepository } from './repositories/auth-login-history.repository.js';
import { AuthSessionRepository } from './repositories/auth-session.repository.js';
import { SessionService } from './services/session.service.js';
import enSessions from './locales/en/sessions.json' with { type: 'json' };
import viSessions from './locales/vi/sessions.json' with { type: 'json' };

new CoreI18nService().registerNamespace('sessions', { vi: viSessions, en: enSessions });
new CoreI18nService().registerNamespace('auth', { vi: viSessions, en: enSessions });

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([AuthSessionEntity, AuthLoginHistoryEntity]),
    UsersModule,
  ],
  controllers: [SessionsController],
  providers: [
    AuthSessionRepository,
    AuthLoginHistoryRepository,
    SessionService,
    {
      provide: SESSIONS_PUBLIC_SERVICE,
      useExisting: SessionService,
    },
  ],
  exports: [SessionService, SESSIONS_PUBLIC_SERVICE],
})
export class SessionsModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('sessions', { vi: viSessions, en: enSessions });
    i18n?.registerNamespace('auth', { vi: viSessions, en: enSessions });
  }
}
