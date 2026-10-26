import { createHash } from 'node:crypto';
import {
  type NormalizedReportParameters,
  type ReportParametersInput,
  type ReportScheduleFrequency,
  REPORT_SCHEDULE_FREQUENCY,
} from '../contracts/report.contract.js';
import { BadRequestAppException, ForbiddenAppException } from '../errors/http-exceptions.js';

const FORBIDDEN_SHARED_LIST_PERMISSION_SUFFIXES = ['.read', '.list', '.view_list'] as const;

/**
 * Kiểm tra xem một mã quyền có phải là quyền dành riêng cho Báo cáo hay đang dùng chung quyền danh sách thông thường
 * (Mục 8.4.3 — Phân quyền xem báo cáo: Không dùng chung quyền với danh sách thông thường).
 */
export function isDistinctReportPermission(permission: string): boolean {
  const norm = permission.trim().toLowerCase();
  if (!norm) return false;
  for (const suffix of FORBIDDEN_SHARED_LIST_PERMISSION_SUFFIXES) {
    if (norm.endsWith(suffix) && !norm.includes('.report')) {
      return false;
    }
  }
  return true;
}

/**
 * Kiểm tra chặt chẽ phân quyền xem/chạy báo cáo (Mục 8.4.3):
 * 1. Chặn ngay (`BadRequestAppException`) nếu báo cáo cấu hình dùng chung quyền danh sách thông thường (`*.read`, `*.list`).
 * 2. Khi truyền `actor`, chặn (`ForbiddenAppException`) nếu người thực hiện chỉ có quyền xem danh sách thông thường (`*.read`)
 *    mà không có quyền báo cáo riêng biệt (`requiredPermission`).
 */
export function assertDistinctReportPermission(
  requiredPermission: string,
  actor?: {
    readonly id?: number | null | undefined;
    readonly roles?: readonly string[] | undefined;
    readonly permissions?: readonly string[] | undefined;
  } | null,
): void {
  const normRequired = requiredPermission.trim().toLowerCase();
  if (!isDistinctReportPermission(normRequired)) {
    throw new BadRequestAppException('report.sharedListPermissionForbidden', [
      {
        requiredPermission,
        reason: 'Report permission must be separate from standard list/read permissions (*.read)',
      },
    ]);
  }

  if (!actor) {
    return;
  }

  const actorPerms = new Set(
    (actor.permissions ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  const actorRoles = new Set(
    (actor.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean),
  );
  const modulePrefix = normRequired.split('.')[0] ?? 'system';

  const hasAccess =
    actorPerms.has(normRequired) ||
    actorPerms.has(`${modulePrefix}.report`) ||
    actorPerms.has(`${modulePrefix}.reports.view`) ||
    actorPerms.has(`${modulePrefix}.*`) ||
    actorPerms.has('reports.admin') ||
    actorPerms.has('system.admin') ||
    actorPerms.has('*') ||
    actorRoles.has('super_admin') ||
    actorRoles.has('superadmin');

  if (!hasAccess) {
    throw new ForbiddenAppException('report.permissionDenied', [
      {
        requiredPermission,
        actorId: actor.id ?? null,
      },
    ]);
  }
}

/**
 * Chuẩn hóa và kiểm tra tính hợp lệ của bộ tham số báo cáo
 * (Mục 8.4.2 — Thiết lập tham số báo cáo: Khoảng ngày, trạng thái, đơn vị và bộ lọc).
 */
export function normalizeReportParameters(
  input?: ReportParametersInput | null,
): NormalizedReportParameters {
  const fromDate = input?.fromDate?.trim() ? input.fromDate.trim() : null;
  const toDate = input?.toDate?.trim() ? input.toDate.trim() : null;

  if (fromDate && toDate) {
    const fromMs = Date.parse(fromDate);
    const toMs = Date.parse(toDate);
    if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs > toMs) {
      throw new BadRequestAppException('report.invalidDateRange', [
        {
          fromDate,
          toDate,
          message: 'fromDate must be earlier than or equal to toDate',
        },
      ]);
    }
  }

  const statuses: Array<string | number> = [];
  const rawStatus = input?.status;
  if (Array.isArray(rawStatus)) {
    for (const s of rawStatus) {
      if (s !== undefined && s !== null && String(s).trim() !== '') {
        statuses.push(
          typeof s === 'number' ? s : !Number.isNaN(Number(s)) ? Number(s) : String(s).trim(),
        );
      }
    }
  } else if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== '') {
    statuses.push(
      typeof rawStatus === 'number'
        ? rawStatus
        : !Number.isNaN(Number(rawStatus))
          ? Number(rawStatus)
          : String(rawStatus).trim(),
    );
  }

  const organizationUnitId =
    typeof input?.organizationUnitId === 'number' &&
    Number.isInteger(input.organizationUnitId) &&
    input.organizationUnitId > 0
      ? input.organizationUnitId
      : null;

  const includeSubUnits = Boolean(input?.includeSubUnits);

  const sortedFilters: Record<string, unknown> = {};
  if (input?.filters && typeof input.filters === 'object') {
    const keys = Object.keys(input.filters).sort();
    for (const k of keys) {
      const val = input.filters[k];
      if (val !== undefined && val !== null && val !== '') {
        sortedFilters[k] = val;
      }
    }
  }

  return {
    fromDate,
    toDate,
    statuses,
    organizationUnitId,
    includeSubUnits,
    filters: sortedFilters,
  };
}

/**
 * Sinh khóa Cache ổn định cho Báo cáo theo chữ ký tham số và phạm vi dữ liệu
 * (Mục 8.4.9 — Cache báo cáo phù hợp: Giảm việc chạy lại cùng tham số).
 */
export function buildReportCacheKey(
  reportCode: string,
  params: NormalizedReportParameters,
  scopeKey = 'ALL',
): string {
  const normCode = reportCode.trim().toLowerCase();
  const normScope = scopeKey.trim() || 'ALL';
  const canonicalPayload = JSON.stringify({
    reportCode: normCode,
    scope: normScope,
    fromDate: params.fromDate,
    toDate: params.toDate,
    statuses: params.statuses,
    organizationUnitId: params.organizationUnitId,
    includeSubUnits: params.includeSubUnits,
    filters: params.filters,
  });
  const hash = createHash('sha256').update(canonicalPayload, 'utf8').digest('hex').slice(0, 24);
  return `rpt_cache:${normCode}:${normScope}:${hash}`;
}

/** Trả về biểu thức Cron theo tần suất lịch báo cáo (`DAILY`, `WEEKLY`, `MONTHLY` — Mục 8.4.5) */
export function resolveReportScheduleCron(
  frequency: ReportScheduleFrequency,
  hour = 8,
  minute = 0,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  customCron?: string | null,
): string {
  if (customCron?.trim()) {
    return customCron.trim();
  }
  const safeHour = Math.min(23, Math.max(0, Math.trunc(hour)));
  const safeMinute = Math.min(59, Math.max(0, Math.trunc(minute)));

  switch (frequency) {
    case REPORT_SCHEDULE_FREQUENCY.WEEKLY: {
      const dow =
        dayOfWeek !== undefined && dayOfWeek !== null
          ? Math.min(6, Math.max(0, Math.trunc(dayOfWeek)))
          : 1;
      return `${safeMinute} ${safeHour} * * ${dow}`;
    }
    case REPORT_SCHEDULE_FREQUENCY.MONTHLY: {
      const dom =
        dayOfMonth !== undefined && dayOfMonth !== null
          ? Math.min(28, Math.max(1, Math.trunc(dayOfMonth)))
          : 1;
      return `${safeMinute} ${safeHour} ${dom} * *`;
    }
    case REPORT_SCHEDULE_FREQUENCY.DAILY:
    default:
      return `${safeMinute} ${safeHour} * * *`;
  }
}

/** Tính toán thời điểm chạy tiếp theo (`nextRunAt`) cho lịch gửi báo cáo định kỳ (Mục 8.4.5) */
export function computeNextReportScheduleRun(
  frequency: ReportScheduleFrequency,
  hour = 8,
  minute = 0,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  baseDate: Date = new Date(),
): Date {
  const next = new Date(baseDate.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCHours(
    Math.min(23, Math.max(0, Math.trunc(hour))),
    Math.min(59, Math.max(0, Math.trunc(minute))),
  );

  switch (frequency) {
    case REPORT_SCHEDULE_FREQUENCY.WEEKLY: {
      const targetDow =
        dayOfWeek !== undefined && dayOfWeek !== null
          ? Math.min(6, Math.max(0, Math.trunc(dayOfWeek)))
          : 1;
      let daysAhead = (targetDow - next.getUTCDay() + 7) % 7;
      if (daysAhead === 0 && next.getTime() <= baseDate.getTime()) {
        daysAhead = 7;
      }
      next.setUTCDate(next.getUTCDate() + (daysAhead || 7));
      break;
    }
    case REPORT_SCHEDULE_FREQUENCY.MONTHLY: {
      const targetDom =
        dayOfMonth !== undefined && dayOfMonth !== null
          ? Math.min(28, Math.max(1, Math.trunc(dayOfMonth)))
          : 1;
      next.setUTCDate(targetDom);
      if (next.getTime() <= baseDate.getTime()) {
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(targetDom);
      }
      break;
    }
    case REPORT_SCHEDULE_FREQUENCY.DAILY:
    default: {
      if (next.getTime() <= baseDate.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      break;
    }
  }
  return next;
}
