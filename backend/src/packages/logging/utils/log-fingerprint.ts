import { createHash } from 'node:crypto';

/**
 * Chuẩn hoá message để gom lỗi cùng loại: `User 821 not found` và `User 822 not found` → `User {n} not found`.
 * Thay UUID, email, IP, thời gian, số, hex dài, chuỗi trong nháy.
 */
export function normalizeMessage(message: string): string {
  return message
    .split('\n')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '{email}')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, '{time}')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '{ip}')
    .replace(/\b(0x)?[0-9a-f]{12,}\b/gi, '{hex}')
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, '{str}')
    .replace(/\b[A-Za-z]*\d[\w-]*\b/g, (w) => (/^\d+(\.\d+)?$/.test(w) ? '{n}' : '{id}'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** `TypeError: x` / `StorageTimeoutError: x` → tên lỗi ở đầu message hoặc dòng đầu stack. */
export function errorTypeFromText(text: string): string | undefined {
  const m = /^([A-Z][A-Za-z0-9_]*(?:Error|Exception|Timeout|Failure))\b:?/.exec(text.trim());
  return m?.[1];
}

/** Khung stack đầu tiên thuộc code ứng dụng: `ReportProcessor.handle (report.processor.ts)` — không có số dòng. */
export function topFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n')) {
    const m = /^\s*at (?:async )?(?:(.+?) \()?(.+?)(?::\d+)*\)?$/.exec(line);
    if (!m) continue;
    const file = m[2]!;
    if (file.startsWith('node:') || file.includes('node_modules') || file === '<anonymous>')
      continue;
    const base = file.split(/[\\/]/).pop()!.replace(/\?.*$/, '');
    return m[1] ? `${m[1]} (${base})` : base;
  }
  return undefined;
}

/** Fingerprint nhóm lỗi: loại lỗi + module + message chuẩn hoá + vị trí stack. */
export function fingerprintOf(parts: {
  errorType?: string | undefined;
  context?: string | undefined;
  message: string;
  stack?: string | undefined;
}): { fingerprint: string; template: string; frame: string | undefined } {
  const template = normalizeMessage(parts.message);
  const frame = topFrame(parts.stack);
  const fingerprint = createHash('sha1')
    .update([parts.errorType ?? '', parts.context ?? '', template, frame ?? ''].join('\u0000'))
    .digest('hex')
    .slice(0, 12);
  return { fingerprint, template, frame };
}
