/**
 * Test Environment Fixtures
 * Cung cấp bộ biến môi trường mock chuẩn cho các bài test độc lập.
 */
export const testEnvFixture: Record<string, string> = {
  APP_NAME: 'CoreAppTest',
  NODE_ENV: 'test',
  PORT: '4001',
  HOST: '127.0.0.1',
  API_PREFIX: 'api/v1',
  DB_CONNECTION: 'pgsql',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_DATABASE: 'core_test',
  DB_USERNAME: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_MAX_CONNECTIONS: '5',
  JWT_ACCESS_SECRET: 'test_access_secret_key_at_least_32_chars_long!!',
  JWT_REFRESH_SECRET: 'test_refresh_secret_key_at_least_32_chars_long!',
  JWT_ACCESS_EXPIRATION: '15m',
  JWT_REFRESH_EXPIRATION: '7d',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  REDIS_PREFIX: 'core_test:',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: './storage/test-uploads',
};

/**
 * Nạp fixture vào process.env
 */
export function applyTestEnv(overrides?: Partial<Record<string, string>>): void {
  const merged = { ...testEnvFixture, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}
