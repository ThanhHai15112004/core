import { Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { SecurityModule } from '@packages/security/index.js';
import { TEMPLATES_PUBLIC_SERVICE } from './contracts/index.js';
import { TemplatesController } from './controllers/templates.controller.js';
import { NotificationTemplateUsageEntity } from './entities/notification-template-usage.entity.js';
import { NotificationTemplateVersionEntity } from './entities/notification-template-version.entity.js';
import { NotificationTemplateEntity } from './entities/notification-template.entity.js';
import enTemplates from './locales/en/templates.json' with { type: 'json' };
import viTemplates from './locales/vi/templates.json' with { type: 'json' };
import { TemplatesMapper } from './mappers/templates.mapper.js';
import { TemplatesRepository } from './repositories/templates.repository.js';
import { TemplatesService } from './services/templates.service.js';

new CoreI18nService().registerNamespace('templates', {
  vi: viTemplates,
  en: enTemplates,
});

@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    TypeOrmModule.forFeature([
      NotificationTemplateEntity,
      NotificationTemplateVersionEntity,
      NotificationTemplateUsageEntity,
    ]),
  ],
  controllers: [TemplatesController],
  providers: [
    TemplatesRepository,
    TemplatesMapper,
    TemplatesService,
    {
      provide: TEMPLATES_PUBLIC_SERVICE,
      useExisting: TemplatesService,
    },
  ],
  exports: [TemplatesMapper, TemplatesService, TEMPLATES_PUBLIC_SERVICE],
})
export class TemplatesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('templates', {
      vi: viTemplates,
      en: enTemplates,
    });
  }
}
