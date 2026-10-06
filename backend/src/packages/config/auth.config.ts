import { env } from './env.js';

export const authConfig = () => ({
  /** Nguồn đọc secret: `env` (mặc định) hoặc `file` (Docker secrets / mount). */
  secretDriver: ((env('SECRET_DRIVER', false) || 'env').toLowerCase() === 'file'
    ? 'file'
    : 'env') as 'env' | 'file',
  jwt: {
    accessSecret: env('JWT_ACCESS_SECRET'),
    refreshSecret: env('JWT_REFRESH_SECRET'),
    accessExpiration: env('JWT_ACCESS_EXPIRATION'),
    refreshExpiration: env('JWT_REFRESH_EXPIRATION'),
  },
});

export type AuthConfig = ReturnType<typeof authConfig>;
