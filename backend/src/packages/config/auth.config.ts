import { env } from './env.js';

export const authConfig = () => ({
  jwt: {
    accessSecret: env('JWT_ACCESS_SECRET'),
    refreshSecret: env('JWT_REFRESH_SECRET'),
    accessExpiration: env('JWT_ACCESS_EXPIRATION'),
    refreshExpiration: env('JWT_REFRESH_EXPIRATION'),
  },
});

export type AuthConfig = ReturnType<typeof authConfig>;
