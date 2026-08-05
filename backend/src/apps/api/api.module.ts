import { Module } from '@nestjs/common';
import { KERNEL_VERSION } from '@packages/kernel/index.js';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class ApiModule {
  static readonly version = KERNEL_VERSION;
}
