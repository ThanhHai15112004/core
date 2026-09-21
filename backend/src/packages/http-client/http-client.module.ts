import { Global, Module } from '@nestjs/common';
import { BaseHttpClientProvider } from './providers/http-client.provider.js';

@Global()
@Module({
  providers: [BaseHttpClientProvider],
  exports: [BaseHttpClientProvider],
})
export class HttpClientModule {}
