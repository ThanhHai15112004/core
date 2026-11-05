import { Global, Module, Optional } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreI18nService } from '@packages/i18n/index.js';
import { MENUS_PUBLIC_SERVICE, NAVIGATION_PUBLIC_SERVICE } from './contracts/index.js';
import { MenusController } from './controllers/menus.controller.js';
import { MenuEntity } from './entities/menu.entity.js';
import enNavigation from './locales/en/navigation.json' with { type: 'json' };
import viNavigation from './locales/vi/navigation.json' with { type: 'json' };
import { MenuRepository } from './repositories/menu.repository.js';
import { MenusService } from './services/menus.service.js';

new CoreI18nService().registerNamespace('navigation', { vi: viNavigation, en: enNavigation });

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([MenuEntity])],
  controllers: [MenusController],
  providers: [
    MenuRepository,
    MenusService,
    {
      provide: MENUS_PUBLIC_SERVICE,
      useExisting: MenusService,
    },
    {
      provide: NAVIGATION_PUBLIC_SERVICE,
      useExisting: MenusService,
    },
  ],
  exports: [MenusService, MENUS_PUBLIC_SERVICE, NAVIGATION_PUBLIC_SERVICE, MenuRepository],
})
export class NavigationModule {
  constructor(@Optional() i18n?: CoreI18nService) {
    i18n?.registerNamespace('navigation', { vi: viNavigation, en: enNavigation });
  }
}
