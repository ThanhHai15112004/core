import { Global, Module } from '@nestjs/common';
import { CoreConfigService } from './config.service.js';

@Global()
@Module({
  providers: [CoreConfigService],
  exports: [CoreConfigService],
})
export class ConfigModule {}
