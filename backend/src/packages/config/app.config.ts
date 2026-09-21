import { env } from './env.js';

export const appConfig = () => ({
  name: env('APP_NAME'),
  env: env('NODE_ENV'),
  port: env.number('PORT'),
  host: env('HOST'),
  apiPrefix: env('API_PREFIX'),
});

export type AppConfig = ReturnType<typeof appConfig>;
