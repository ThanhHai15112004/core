export const REDACTED = '[REDACTED]';

/**
 * Mẫu bí mật nằm lẫn trong chuỗi (message, stack, giá trị metadata): header Bearer/Basic, `password=…`, JWT, mật khẩu
 * trong URL kết nối. Che ngay khi ghi log — trước console và trước khi lưu — không phải ở frontend.
 */
const TEXT_PATTERNS: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/g, `$1 ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [
    /\b(password|passwd|pwd|secret|client_?secret|token|access_?token|refresh_?token|api_?key|x-api-key|authorization|cookie|session_?id|private_?key|otp)("?\s*[=:]\s*)("?)(?!\[REDACTED|Bearer\b|Basic\b)[^\s"&,;]+\3/gi,
    `$1$2$3${REDACTED}$3`,
  ],
];

/** Tên các mẫu che trong chuỗi (hiển thị ở cấu hình). */
export const TEXT_REDACTION_PATTERNS = [
  'bearer/basic',
  'jwt',
  'url-credentials',
  'key=value',
] as const;

/** Kết quả che: chuỗi đã che và số chỗ bị che (để báo "redaction đang hoạt động"). */
export function redactText(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, replacement] of TEXT_PATTERNS) {
    out = out.replace(re, (...args: unknown[]) => {
      count++;
      const groups = args.slice(1, -2) as (string | undefined)[];
      return replacement.replace(/\$(\d)/g, (_, i: string) => groups[Number(i) - 1] ?? '');
    });
  }
  return { text: out, count };
}
