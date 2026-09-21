import { Global, Module } from '@nestjs/common';
import { CoreI18nService } from './providers/i18n.service.js';

@Global()
@Module({
  providers: [CoreI18nService],
  exports: [CoreI18nService],
})
export class I18nModule {}
