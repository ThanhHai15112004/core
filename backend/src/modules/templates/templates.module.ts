import { Module, Optional } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotificationsModule } from '@modules/notifications/index.js';
import { TEMPLATES_PUBLIC_SERVICE } from './contracts/index.js';
import { TemplatesController } from './controllers/templates.controller.js';
import { TemplatesService } from './services/templates.service.js';
import enTemplates from './locales/en/templates.json' with { type: 'json' };
import viTemplates from './locales/vi/templates.json' with { type: 'json' };

new CoreI18nService().registerNamespace('templates', {
  vi: viTemplates,
  en: enTemplates,
});

@Module({
  imports: [NotificationsModule],
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    {
      provide: TEMPLATES_PUBLIC_SERVICE,
      useExisting: TemplatesService,
    },
  ],
  exports: [TemplatesService, TEMPLATES_PUBLIC_SERVICE],
})
export class TemplatesModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('templates', {
      vi: viTemplates,
      en: enTemplates,
    });
  }
}
