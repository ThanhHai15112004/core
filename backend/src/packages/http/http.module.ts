import { Global, Module } from '@nestjs/common';
import { GlobalExceptionFilter } from './filters/global-exception.filter.js';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor.js';

@Global()
@Module({
  providers: [GlobalExceptionFilter, TransformResponseInterceptor],
  exports: [GlobalExceptionFilter, TransformResponseInterceptor],
})
export class HttpModule {}
