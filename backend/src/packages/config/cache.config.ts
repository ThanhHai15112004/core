import { env } from './env.js';

export const cacheConfig = () => ({
  redis: {
    host: env('REDIS_HOST'),
    port: env.number('REDIS_PORT'),
    prefix: env('REDIS_PREFIX'),
    password: env('REDIS_PASSWORD', false) || undefined,
    db: env.number('REDIS_DB', false),
  },
});

export type CacheConfig = ReturnType<typeof cacheConfig>;
