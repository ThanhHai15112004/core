import { Global, Module } from '@nestjs/common';
import { CodeRegistryService } from './contracts/code-lookup.contract.js';

@Global()
@Module({
  providers: [CodeRegistryService],
  exports: [CodeRegistryService],
})
export class KernelModule {}
