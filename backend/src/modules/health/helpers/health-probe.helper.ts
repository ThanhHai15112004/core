import { performance } from 'node:perf_hooks';
import type { UserIdentity } from '@packages/security/index.js';
import {
  HEALTH_ADMIN_PERMISSIONS,
  HEALTH_ADMIN_ROLES,
  HEALTH_INDICATOR_STATUS,
  HEALTH_STATUS,
  type HealthIndicatorStatusValue,
  type HealthSeverityValue,
  type HealthStatusValue,
} from '../enum/health.enum.js';
import type {
  HealthCheckResult,
  PublicHealthCheckResult,
  ReadinessCheckResult,
} from '../types/health.types.js';

/** Bọc Promise với timeout giới hạn và tự dọn timer để tránh rò rỉ handle. */
export async function withHealthTimeout<T>(
  task: Promise<T>,
  ms: number,
  targetName: string,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${targetName} check timed out after ${ms}ms`)),
          ms,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Đo nhanh độ trễ Event Loop hiện tại (ms) qua `setImmediate`. */
export function measureEventLoopLagMs(): Promise<number> {
  const started = performance.now();
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve(Math.max(0, Math.round((performance.now() - started) * 10) / 10));
    });
  });
}

/** Loại bỏ chuỗi kết nối, credential, đường dẫn tuyệt đối hoặc SQL khỏi thông báo lỗi health check. */
export function sanitizeHealthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(mysql|postgres|postgresql|redis|rediss|mongodb|amqp):\/\/[^\s]+/gi, '[REDACTED_URI]')
    .replace(/(password|secret|token|apikey|api_key)=([^\s&;]+)/gi, '$1=[REDACTED]')
    .replace(/\/[\w./-]+/g, (seg) => (seg.length > 24 ? '[PATH]' : seg))
    .slice(0, 240);
}

/** Kiểm tra actor hiện tại có quyền quản trị để xem chi tiết đầy đủ của Health API hay không. */
export function hasAdminHealthAccess(actor?: UserIdentity | null): boolean {
  if (!actor) return false;
  const userPermissions = new Set((actor.permissions ?? []).map((p) => p.trim().toLowerCase()));
  for (const perm of HEALTH_ADMIN_PERMISSIONS) {
    if (userPermissions.has(perm)) return true;
  }
  const userRoles = new Set((actor.roles ?? []).map((r) => r.trim().toLowerCase()));
  for (const role of HEALTH_ADMIN_ROLES) {
    if (userRoles.has(role)) return true;
  }
  return false;
}

/** Tổng hợp trạng thái chung từ danh sách indicator (`down` > `degraded` > `ok`). */
export function aggregateHealthStatus(
  statuses: readonly HealthIndicatorStatusValue[],
): HealthStatusValue {
  if (statuses.some((s) => s === HEALTH_INDICATOR_STATUS.DOWN)) {
    return HEALTH_STATUS.DOWN;
  }
  if (statuses.some((s) => s === HEALTH_INDICATOR_STATUS.DEGRADED)) {
    return HEALTH_STATUS.DEGRADED;
  }
  return HEALTH_STATUS.OK;
}

/** Ẩn toàn bộ chi tiết nhạy cảm khỏi kết quả `/health` công khai. */
export function redactHealthCheckResult(result: HealthCheckResult): PublicHealthCheckResult {
  return {
    status: result.status,
    ready: result.ready,
    live: result.live,
    uptime: result.uptime,
    timestamp: result.timestamp,
    redacted: true,
  };
}

/** Ẩn chi tiết nhạy cảm khỏi kết quả `/health/ready` công khai. */
export function redactReadinessResult(result: ReadinessCheckResult): ReadinessCheckResult {
  return {
    status: result.status,
    ready: result.ready,
    uptime: result.uptime,
    timestamp: result.timestamp,
    redacted: true,
  };
}

/** Thu gọn một `HealthIndicatorDetail` cho các ngữ cảnh tóm tắt công khai nếu cần. */
export function toIndicatorSeverity(status: HealthIndicatorStatusValue): HealthSeverityValue {
  if (status === HEALTH_INDICATOR_STATUS.DOWN) return 'critical';
  if (status === HEALTH_INDICATOR_STATUS.DEGRADED) return 'degraded';
  return 'ok';
}
