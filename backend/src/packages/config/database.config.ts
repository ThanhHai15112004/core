import { DatabaseDriver, DEFAULT_DATABASE_PORTS } from '@packages/kernel/index.js';
import { env } from './env.js';

export const databaseConfig = () => {
  const connection = (env('DB_CONNECTION', false) || DatabaseDriver.MYSQL) as DatabaseDriver;
  const defaultPort = DEFAULT_DATABASE_PORTS[connection] ?? 3306;
  const port = env.number('DB_PORT', false) || defaultPort;

  return {
    connection,
    host: env('DB_HOST', false) || '127.0.0.1',
    port,
    database: env('DB_DATABASE', false) || 'core_db',
    username: env('DB_USERNAME', false) || 'root',
    password: env('DB_PASSWORD', false) || '',
    maxConnections: env.number('DB_MAX_CONNECTIONS', false) || 10,
    synchronize: env.boolean('DB_SYNCHRONIZE', false),
    logging: env.boolean('DB_LOGGING', false),
  };
};

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
