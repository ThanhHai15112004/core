import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Phân tách biến môi trường dạng danh sách CSV */
const csvList = (key: string, fallback: readonly string[]): string[] => {
  const raw = env(key, false);
  if (!raw.trim()) return [...fallback];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Phân tách danh sách header dạng `key=value,key2=value2` */
const parseHeaders = (key: string): Record<string, string> => {
  const raw = env(key, false);
  if (!raw.trim()) return {};
  const headers: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) headers[k] = v;
  }
  return headers;
};

export const TRACING_EXPORTERS = ['none', 'console', 'otlp'] as const;
export type TracingExporterType = (typeof TRACING_EXPORTERS)[number];

export const TRACING_SAMPLERS = [
  'parentbased_traceidratio',
  'always_on',
  'always_off',
  'traceidratio',
] as const;
export type TracingSamplerType = (typeof TRACING_SAMPLERS)[number];

const DEFAULT_IGNORE_ROUTES = ['/health', '/metrics', '/ops'] as const;

/**
 * Tracing (OpenTelemetry): cấu hình thu thập span phân tán, OTLP exporter, lấy mẫu trace (sampling)
 * và ring-buffer nội bộ phục vụ xem waterfall cơ bản trong System Console.
 */
export const tracingConfig = () => {
  const nodeEnv = (env('NODE_ENV', false) || 'development').toLowerCase();
  const exporterRaw = (env('TRACING_EXPORTER', false) || 'none').toLowerCase();
  const exporter = (
    TRACING_EXPORTERS.includes(exporterRaw as TracingExporterType) ? exporterRaw : 'none'
  ) as TracingExporterType;

  const samplerRaw = (
    env('TRACING_SAMPLER', false) || 'parentbased_traceidratio'
  ).toLowerCase();
  const sampler = (
    TRACING_SAMPLERS.includes(samplerRaw as TracingSamplerType)
      ? samplerRaw
      : 'parentbased_traceidratio'
  ) as TracingSamplerType;

  const defaultRatio = nodeEnv === 'production' ? 0.1 : 1;
  const rawRatio = numberOr('TRACING_SAMPLING_RATIO', defaultRatio);
  const samplingRatio = Number.isFinite(rawRatio) ? Math.min(1, Math.max(0, rawRatio)) : defaultRatio;

  return {
    /** Bật/tắt tạo và xuất OpenTelemetry span (mặc định bật ở dev/prod, tắt ở test). */
    enabled: booleanOr('TRACING_ENABLED', nodeEnv !== 'test'),
    /** Tên service gắn vào OpenTelemetry Resource (`service.name`). */
    serviceName:
      env('TRACING_SERVICE_NAME', false) ||
      env('LOG_SERVICE_NAME', false) ||
      env('APP_NAME', false) ||
      'core-app',
    /** Đích xuất span: `none` (chỉ buffer Console), `console` (stdout), `otlp` (OTLP/HTTP). */
    exporter,
    /** Endpoint OTLP HTTP nhận traces (Jaeger / Tempo / OTel Collector). */
    otlpEndpoint: env('TRACING_OTLP_ENDPOINT', false) || 'http://127.0.0.1:4318/v1/traces',
    /** Header bổ sung khi gọi OTLP exporter (ví dụ `Authorization=Bearer ...`). */
    otlpHeaders: parseHeaders('TRACING_OTLP_HEADERS'),
    /** Timeout (ms) cho mỗi batch gửi OTLP. */
    otlpTimeoutMs: Math.max(500, numberOr('TRACING_OTLP_TIMEOUT_MS', 5000)),
    /** Chiến lược lấy mẫu trace (`parentbased_traceidratio` | `always_on` | `always_off` | `traceidratio`). */
    sampler,
    /** Tỉ lệ lấy mẫu từ 0.0 đến 1.0 (dev mặc định 1.0, production mặc định 0.1). */
    samplingRatio,
    /** Danh sách route prefix không lấy mẫu để giảm nhiễu (`/health,/metrics,/ops`). */
    ignoreRoutes: csvList('TRACING_IGNORE_ROUTES', DEFAULT_IGNORE_ROUTES),
    /** Lưu gọn span gần nhất vào Redis/Memory để System Console hiển thị waterfall mà chưa cần Jaeger. */
    consoleBufferEnabled: booleanOr('TRACING_CONSOLE_BUFFER_ENABLED', true),
    /** Số span tối đa giữ trong Console buffer. */
    consoleBufferMax: Math.max(50, numberOr('TRACING_CONSOLE_BUFFER_MAX', 1000)),
  };
};

export type TracingConfig = ReturnType<typeof tracingConfig>;
