import { Global, Module } from '@nestjs/common';
import { CoreConfigService } from './config.service.js';
import { ConfigInspectorService } from './config-inspector.service.js';

@Global()
@Module({
  providers: [CoreConfigService, ConfigInspectorService],
  exports: [CoreConfigService, ConfigInspectorService],
})
export class ConfigModule {}
