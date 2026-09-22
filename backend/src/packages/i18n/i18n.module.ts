import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CoreI18nService } from './providers/i18n.service.js';
import { LocaleMiddleware } from './middleware/locale.middleware.js';

@Global()
@Module({
  providers: [CoreI18nService],
  exports: [CoreI18nService],
})
export class I18nModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LocaleMiddleware).forRoutes('{*path}');
  }
}
