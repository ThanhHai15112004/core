import type { Redis, RedisOptions } from 'ioredis';

/** Factory tạo client Redis — test có thể override bằng ioredis-mock. */
export const REDIS_CLIENT_FACTORY = Symbol('REDIS_CLIENT_FACTORY');

export type RedisClientFactory = (options: RedisOptions) => Redis;
