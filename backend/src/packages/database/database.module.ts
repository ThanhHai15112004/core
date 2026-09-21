import { Global, Module } from '@nestjs/common';
import { BaseDatabaseProvider } from './providers/database.provider.js';

@Global()
@Module({
  providers: [BaseDatabaseProvider],
  exports: [BaseDatabaseProvider],
})
export class DatabaseModule {}
