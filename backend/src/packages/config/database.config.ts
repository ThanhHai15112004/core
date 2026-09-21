import { env } from './env.js';

export const databaseConfig = () => ({
  connection: env('DB_CONNECTION'),
  host: env('DB_HOST'),
  port: env.number('DB_PORT'),
  database: env('DB_DATABASE'),
  username: env('DB_USERNAME'),
  password: env('DB_PASSWORD'),
  maxConnections: env.number('DB_MAX_CONNECTIONS'),
});

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
