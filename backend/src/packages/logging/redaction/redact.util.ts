const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'privatekey',
  'creditcardnumber',
  'cvv',
  'otp',
  'xapikey',
  'xauthtoken',
  'proxyauthorization',
  'sessionid',
]);

const EXTRA_SENSITIVE_KEYS = new Set<string>();

/** Chuẩn hóa tên key nhạy cảm (chữ thường, bỏ `-` và `_`). */
function normalizeKeyName(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** Cấu hình thêm danh sách tên field nhạy cảm từ biến môi trường (`LOG_REDACT_EXTRA_KEYS`). */
export function configureExtraSensitiveKeys(keys: readonly string[]): void {
  EXTRA_SENSITIVE_KEYS.clear();
  for (const key of keys) {
    const normalized = normalizeKeyName(key.trim());
    if (normalized) EXTRA_SENSITIVE_KEYS.add(normalized);
  }
}

/** So khớp không phân biệt hoa thường và bỏ `-`/`_`: `X-Api-Key`, `api_key`, `apiKey` đều nhạy cảm. */
/** Tên field luôn bị che (đã chuẩn hoá: chữ thường, bỏ `-` / `_`). */
export const SENSITIVE_KEY_NAMES: readonly string[] = [...SENSITIVE_KEYS];

/** Trả về toàn bộ danh sách tên field nhạy cảm (mặc định + bổ sung qua cấu hình). */
export function getSensitiveKeyNames(): string[] {
  return [...new Set([...SENSITIVE_KEYS, ...EXTRA_SENSITIVE_KEYS])];
}

/** Kiểm tra xem tên trường có chứa thông tin nhạy cảm cần che giấu hay không */
export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKeyName(key);
  const lower = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEYS.has(lower) ||
    EXTRA_SENSITIVE_KEYS.has(normalized) ||
    EXTRA_SENSITIVE_KEYS.has(lower)
  );
}

export interface RedactOptions {
  /** Độ sâu đệ quy tối đa (mặc định `8`) để bảo vệ hiệu năng trước payload lồng sâu. */
  maxDepth?: number;
  /** Bộ theo dõi object đã duyệt nhằm tránh vòng lặp tham chiếu (circular reference). */
  seen?: WeakSet<object>;
  /** Hàm lọc chuỗi nhạy cảm (vd. `redactText`) áp dụng cho giá trị string không thuộc key nhạy cảm. */
  redactStrings?: (value: string) => string;
}

/** Che giấu đệ quy các trường dữ liệu nhạy cảm trong đối tượng trước khi ghi log */
export function redactSensitiveData<T>(input: T, options?: RedactOptions, depth = 0): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return (options?.redactStrings ? options.redactStrings(input) : input) as unknown as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (input instanceof Date || Buffer.isBuffer(input) || input instanceof Error) {
    return input;
  }

  const maxDepth = options?.maxDepth ?? 8;
  if (depth > maxDepth) {
    return '[MaxDepth]' as unknown as T;
  }

  const seen = options?.seen ?? new WeakSet<object>();
  if (seen.has(input)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(input);
  const nextOptions: RedactOptions = {
    maxDepth,
    seen,
    ...(options?.redactStrings ? { redactStrings: options.redactStrings } : {}),
  };

  if (Array.isArray(input)) {
    return input.map((item) =>
      redactSensitiveData(item, nextOptions, depth + 1),
    ) as unknown as T;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveData(value, nextOptions, depth + 1);
    }
  }
  return redacted as T;
}
