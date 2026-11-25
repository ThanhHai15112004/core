import * as os from 'node:os';
import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/** Lấy thông tin cấu hình ứng dụng từ môi trường */
export const appConfig = () => ({
  name: env('APP_NAME'),
  version: env('APP_VERSION', false) || '1.0.0',
  instanceId: env('INSTANCE_ID', false) || `${os.hostname()}:${process.pid}`,
  env: env('NODE_ENV'),
  port: env.number('PORT'),
  host: env('HOST'),
  apiPrefix: env('API_PREFIX'),
  corsAllowedOrigins: env('CORS_ALLOWED_ORIGINS', false) || '',
  /** Thời gian tối đa (ms) cho phép một API request xử lý trước khi ngắt Timeout 504 (0 = tắt). */
  requestTimeoutMs: Math.max(0, numberOr('API_REQUEST_TIMEOUT_MS', 30_000)),
  /** Thời gian tối đa (ms) chờ hoàn tất kết nối HTTP ở tầng Fastify/Node server. */
  connectionTimeoutMs: Math.max(0, numberOr('API_CONNECTION_TIMEOUT_MS', 10_000)),
  /** Thời gian giữ kết nối HTTP keep-alive (ms) tại Fastify/Node server. */
  keepAliveTimeoutMs: Math.max(0, numberOr('API_KEEP_ALIVE_TIMEOUT_MS', 5_000)),
});

export type AppConfig = ReturnType<typeof appConfig>;
