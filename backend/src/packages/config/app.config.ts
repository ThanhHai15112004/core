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
  /** Thời gian giữ kết nối HTTP keep-alive (ms) tại Fastify/Node server (phải lớn hơn LB keepAliveTimeout). */
  keepAliveTimeoutMs: Math.max(0, numberOr('API_KEEP_ALIVE_TIMEOUT_MS', 65_000)),
  /** Thời gian tối đa (ms) chờ nhận toàn bộ HTTP headers (phải lớn hơn keepAliveTimeoutMs). */
  headersTimeoutMs: Math.max(0, numberOr('API_HEADERS_TIMEOUT_MS', 70_000)),
  /** Giới hạn kích thước request body tối đa của API (bytes, đồng nhất với Gateway). */
  maxBodySizeBytes: Math.max(1024, numberOr('API_MAX_BODY_SIZE_BYTES', 32 * 1024 * 1024)),
  /** Giới hạn kích thước payload JSON tối đa (bytes). */
  jsonBodyLimitBytes: Math.max(1024, numberOr('API_JSON_BODY_LIMIT_BYTES', 16 * 1024 * 1024)),
  /** Độ dài tối đa của tham số URL route tại Fastify. */
  maxParamLength: Math.max(64, numberOr('API_MAX_PARAM_LENGTH', 1024)),
  /** Metadata bản build / deployment do CI/CD hoặc Docker image truyền qua env. */
  deployment: {
    commit: env('APP_GIT_COMMIT', false) || env('GIT_COMMIT', false) || null,
    image: env('APP_IMAGE', false) || env('DOCKER_IMAGE', false) || null,
    buildTime: env('APP_BUILD_TIME', false) || env('BUILD_TIME', false) || null,
  },
});

export type AppConfig = ReturnType<typeof appConfig>;
