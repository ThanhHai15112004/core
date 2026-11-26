import { Global, Module } from '@nestjs/common';
import { Cluster, Redis } from 'ioredis';
import {
  REDIS_CLIENT_FACTORY,
  REDIS_CLUSTER_FACTORY,
  type RedisClientFactory,
  type RedisClusterFactory,
} from './redis.constants.js';
import { RedisService } from './redis.service.js';
import { RedisManageableAdapter } from './redis-manageable.adapter.js';

/** Hàm khởi tạo client Redis Standalone / Sentinel mặc định */
const defaultFactory: RedisClientFactory = (options) => new Redis(options);

/** Hàm khởi tạo client Redis Cluster mặc định */
const defaultClusterFactory: RedisClusterFactory = (nodes, options) => new Cluster(nodes, options);

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT_FACTORY, useValue: defaultFactory },
    { provide: REDIS_CLUSTER_FACTORY, useValue: defaultClusterFactory },
    RedisService,
    RedisManageableAdapter,
  ],
  exports: [RedisService, RedisManageableAdapter],
})
export class RedisModule {}
