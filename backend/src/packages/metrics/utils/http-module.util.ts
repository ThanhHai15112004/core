const SAFE_SEGMENT_RE = /[^a-z0-9_-]/gi;

/**
 * Chuẩn hóa tên module từ route pattern của Fastify (ví dụ `/api/v1/users/:id` -> `users`,
 * `/api/v1/ops/database/overview` -> `ops/database`, `unmatched` -> `unmatched`).
 * Giữ cardinality thấp và cố định để an toàn cho nhãn Prometheus.
 */
export function resolveHttpMetricModule(route: string, apiPrefix?: string): string {
  const trimmed = route.trim();
  if (!trimmed || trimmed === 'unmatched') return 'unmatched';

  let path = trimmed.replace(/^\/+|\/+$/g, '');
  const prefix = (apiPrefix ?? 'api/v1').replace(/^\/+|\/+$/g, '');
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
    path = path.slice(prefix.length).replace(/^\/+/, '');
  } else {
    const versionMatch = path.match(/^api\/v\d+(?:\/(.*))?$/i);
    if (versionMatch) {
      path = versionMatch[1] ?? '';
    }
  }

  if (!path) return 'root';
  const segments = path.split('/').filter((seg) => seg.length > 0 && !seg.startsWith(':'));
  const first = segments[0]?.toLowerCase().replace(SAFE_SEGMENT_RE, '');
  if (!first) return 'root';

  if (first === 'ops' && segments[1]) {
    const second = segments[1].toLowerCase().replace(SAFE_SEGMENT_RE, '');
    return second ? `ops/${second}` : 'ops';
  }
  return first;
}

/** Phân nhóm mã trạng thái HTTP (`2xx` | `3xx` | `4xx` | `5xx` | `other`). */
export function statusClassOf(statusCode: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
}
