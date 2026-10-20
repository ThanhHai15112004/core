import { env } from './env.js';

/** Lấy thông tin cấu hình ứng dụng từ môi trường */
export const appConfig = () => ({
  name: env('APP_NAME'),
  env: env('NODE_ENV'),
  port: env.number('PORT'),
  host: env('HOST'),
  apiPrefix: env('API_PREFIX'),
  corsAllowedOrigins: env('CORS_ALLOWED_ORIGINS', false) || '',
});

export type AppConfig = ReturnType<typeof appConfig>;
