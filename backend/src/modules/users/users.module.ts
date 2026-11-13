import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { OrganizationMembersModule } from '@modules/organization-members/index.js';
import { RolesModule } from '@modules/roles/index.js';
import { OrganizationsModule } from '@modules/organizations/index.js';
import { CodesModule } from '@modules/codes/index.js';
import { SettingsModule } from '@modules/settings/index.js';
import { USERS_PUBLIC_SERVICE } from './contracts/index.js';
import { UserEntity } from './entities/user.entity.js';
import { UserProfileEntity } from './entities/user-profile.entity.js';
import { UserStatusHistoryEntity } from './entities/user-status-history.entity.js';
import { UserRepository } from './repositories/user.repository.js';
import { UserProfileRepository } from './repositories/user-profile.repository.js';
import { UserStatusHistoryRepository } from './repositories/user-status-history.repository.js';
import { UsersMapper } from './mappers/users.mapper.js';
import { UsersService } from './services/users.service.js';
import { UsersController } from './controllers/users.controller.js';
import { UserImportService } from './import/user-import.service.js';
import { UserExportService } from './export/user-export.service.js';
import { UserReportService } from './reports/user-report.service.js';
import { UserSearchService } from './search/user-search.service.js';
import enUsers from './locales/en/users.json' with { type: 'json' };
import viUsers from './locales/vi/users.json' with { type: 'json' };

new CoreI18nService().registerNamespace('users', {
  en: enUsers,
  vi: viUsers,
});

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserProfileEntity, UserStatusHistoryEntity]),
    RolesModule,
    OrganizationsModule,
    OrganizationMembersModule,
    CodesModule,
    SettingsModule,
  ],
  controllers: [UsersController],
  providers: [
    UserRepository,
    UserProfileRepository,
    UserStatusHistoryRepository,
    UsersMapper,
    UsersService,
    UserImportService,
    UserExportService,
    UserReportService,
    UserSearchService,
    {
      provide: USERS_PUBLIC_SERVICE,
      useExisting: UsersService,
    },
  ],
  exports: [
    UsersService,
    UserImportService,
    UserExportService,
    UserReportService,
    UserSearchService,
    USERS_PUBLIC_SERVICE,
  ],
})
export class UsersModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('users', {
      en: enUsers,
      vi: viUsers,
    });
  }
}
