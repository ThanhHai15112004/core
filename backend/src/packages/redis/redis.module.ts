import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from './redis.constants.js';
import { RedisService } from './redis.service.js';

const defaultFactory: RedisClientFactory = (options) => new Redis(options);

@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT_FACTORY, useValue: defaultFactory }, RedisService],
  exports: [RedisService],
})
export class RedisModule {}
