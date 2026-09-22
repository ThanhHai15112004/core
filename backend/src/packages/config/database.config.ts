import { DatabaseDriver, DEFAULT_DATABASE_PORTS } from '@packages/kernel/index.js';
import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

export const databaseConfig = () => {
  const connection = (env('DB_CONNECTION', false) || DatabaseDriver.MYSQL) as DatabaseDriver;
  const defaultPort = DEFAULT_DATABASE_PORTS[connection] ?? 3306;
  const port = env.number('DB_PORT', false) || defaultPort;

  return {
    /** Tắt thì không kết nối database (các trang Database hiện "đã tắt"). */
    enabled: booleanOr('DB_ENABLED', true),
    connection,
    host: env('DB_HOST', false) || '127.0.0.1',
    port,
    database: env('DB_DATABASE', false) || 'core_db',
    username: env('DB_USERNAME', false) || 'root',
    password: env('DB_PASSWORD', false) || '',
    maxConnections: env.number('DB_MAX_CONNECTIONS', false) || 10,
    synchronize: env.boolean('DB_SYNCHRONIZE', false),
    logging: env.boolean('DB_LOGGING', false),
    ssl: booleanOr('DB_SSL', false),
    connectTimeoutMs: numberOr('DB_CONNECT_TIMEOUT_MS', 10_000),
    /** Chu kỳ kiểm tra kết nối (`SELECT 1`) và tự kết nối lại. */
    healthIntervalMs: numberOr('DB_HEALTH_INTERVAL_MS', 5000),
    /** Ngưỡng query chậm của trang Database. */
    slowQueryMs: numberOr('DB_SLOW_QUERY_MS', 500),
    /** Số query chậm trong 15 phút để bật cảnh báo "query chậm tăng". */
    slowQueryAlertCount: numberOr('DB_SLOW_QUERY_ALERT_COUNT', 10),
    /** Transaction mở lâu hơn ngưỡng này được đánh dấu "dài". */
    longTransactionSec: numberOr('DB_LONG_TX_SEC', 10),
    /** Dung lượng tối đa cấp cho database (GB) để tính % sử dụng; 0 = không biết. */
    storageLimitGb: numberOr('DB_STORAGE_LIMIT_GB', 0),
    storageWarnPercent: numberOr('DB_STORAGE_WARN_PERCENT', 80),
    /** Cancel query / terminate session từ System Console. */
    actionsEnabled: booleanOr('OPS_DATABASE_ACTIONS_ENABLED', true),
    /** Chạy migration từ System Console (nên tắt ở production khi chưa có RBAC). */
    migrationsEnabled: booleanOr('OPS_DATABASE_MIGRATIONS_ENABLED', false),
    migrationsTableName: env('DB_MIGRATIONS_TABLE', false) || 'core_migrations',
  };
};

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
