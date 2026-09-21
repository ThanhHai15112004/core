import { env } from './env.js';

export const cacheConfig = () => ({
  redis: {
    host: env('REDIS_HOST'),
    port: env.number('REDIS_PORT'),
    prefix: env('REDIS_PREFIX'),
  },
});

export type CacheConfig = ReturnType<typeof cacheConfig>;
