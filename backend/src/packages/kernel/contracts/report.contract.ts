import type { ExportFormat } from './export.contract.js';
import { scanModuleManifests } from './manifest.contract.js';

/**
 * Tần suất lập lịch gửi báo cáo tự động (Mục 8.4.5 — Lên lịch gửi báo cáo: Theo ngày, tuần hoặc tháng).
 */
export const REPORT_SCHEDULE_FREQUENCY = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

export type ReportScheduleFrequency =
  (typeof REPORT_SCHEDULE_FREQUENCY)[keyof typeof REPORT_SCHEDULE_FREQUENCY];

export const REPORT_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

/**
 * Kênh gửi báo cáo khi hoàn tất hoặc đến kỳ lịch chạy (Mục 8.4.6 — Gửi báo cáo qua Email hoặc thông báo).
 */
export const REPORT_DELIVERY_CHANNEL = {
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
} as const;

export type ReportDeliveryChannel =
  (typeof REPORT_DELIVERY_CHANNEL)[keyof typeof REPORT_DELIVERY_CHANNEL];

export const REPORT_DELIVERY_CHANNELS = ['EMAIL', 'IN_APP'] as const;

/** Nguồn dữ liệu đã sử dụng để kết xuất báo cáo (Mục 8.4.8 & 8.4.9) */
export type ReportDataSourceType = 'REPLICA' | 'PRIMARY' | 'CACHE';

/** Chế độ thực thi báo cáo */
export type ReportExecutionMode = 'SYNC' | 'QUEUE' | 'SCHEDULED';

/** Trạng thái thực thi báo cáo */
export type ReportJobStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/** Định nghĩa một tham số đầu vào của báo cáo trong `module.manifest.json` (Mục 8.4.2) */
export interface ReportParameterManifestItem {
  readonly key: string;
  readonly name: string;
  readonly type:
    'date-range' | 'status' | 'organization-unit' | 'filter' | 'string' | 'number' | 'boolean';
  readonly required?: boolean | undefined;
  readonly defaultValue?: unknown;
  readonly allowedValues?: readonly (string | number | boolean)[] | undefined;
}

/**
 * Khai báo một Báo cáo / Dashboard trong `module.manifest.json`
 * (Mục 8.4.1 — Đăng ký danh sách báo cáo theo module: Mỗi module tự khai báo báo cáo).
 */
export interface ReportManifestItem {
  readonly code: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly category?: 'REPORT' | 'DASHBOARD' | undefined;
  /**
   * Quyền bắt buộc để xem/chạy báo cáo (Mục 8.4.3 — Phân quyền xem báo cáo: Không dùng chung quyền với danh sách thông thường).
   * Ví dụ: `'users.report'` (CẤM dùng `'users.read'`, `'users.list'`).
   */
  readonly requiredPermission: string;
  /** Báo cáo nặng cần ưu tiên đẩy qua Queue `system.heavy` (Mục 8.4.4) */
  readonly isHeavy?: boolean | undefined;
  readonly heavyRecordThreshold?: number | undefined;
  /** Thời gian lưu Cache kết quả báo cáo theo tham số (giây — Mục 8.4.9) */
  readonly cacheTtlSeconds?: number | undefined;
  /** Cho phép đọc từ Read Replica khi hệ thống có cấu hình `replication` (Mục 8.4.8) */
  readonly supportsReadReplica?: boolean | undefined;
  /** Các định dạng file hỗ trợ xuất tạm thời (`'xlsx' | 'csv' | 'pdf'`) */
  readonly supportedFormats?: readonly ExportFormat[] | undefined;
  /** Danh sách định nghĩa các tham số của báo cáo */
  readonly parameters?: readonly ReportParameterManifestItem[] | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

/** Định nghĩa Báo cáo đã được chuẩn hóa trong `ReportRegistryService` */
export interface RegisteredReportDefinition {
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: 'REPORT' | 'DASHBOARD';
  readonly requiredPermission: string;
  readonly isHeavy: boolean;
  readonly heavyRecordThreshold: number;
  readonly cacheTtlSeconds: number;
  readonly supportsReadReplica: boolean;
  readonly supportedFormats: readonly ExportFormat[];
  readonly parameters: readonly ReportParameterManifestItem[];
  readonly isSystem: boolean;
  readonly status: number;
}

/**
 * Tham số đầu vào khi yêu cầu chạy Báo cáo / Dashboard
 * (Mục 8.4.2 — Thiết lập tham số báo cáo: Khoảng ngày, trạng thái, đơn vị và bộ lọc).
 */
export interface ReportParametersInput {
  readonly fromDate?: string | null | undefined;
  readonly toDate?: string | null | undefined;
  readonly status?: string | number | readonly (string | number)[] | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly includeSubUnits?: boolean | undefined;
  readonly filters?: Readonly<Record<string, unknown>> | null | undefined;
}

/** Bộ tham số báo cáo đã được chuẩn hóa và kiểm tra hợp lệ */
export interface NormalizedReportParameters {
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly statuses: readonly (string | number)[];
  readonly organizationUnitId: number | null;
  readonly includeSubUnits: boolean;
  readonly filters: Readonly<Record<string, unknown>>;
}

/** Dữ liệu báo cáo đã được lưu trong Cache theo chữ ký tham số (Mục 8.4.9) */
export interface CachedReportEntry {
  readonly cacheKey: string;
  readonly reportCode: string;
  readonly parameters: NormalizedReportParameters;
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly dataSourceUsed: 'REPLICA' | 'PRIMARY';
  readonly cachedAt: string;
  readonly expiresAt: string;
}

/**
 * Bản ghi Lên lịch gửi báo cáo định kỳ (Mục 8.4.5 — Lên lịch gửi báo cáo: Theo ngày, tuần hoặc tháng).
 */
export interface ReportScheduleRecord {
  readonly id: number;
  readonly reportCode: string;
  readonly module: string;
  readonly name: string;
  readonly frequency: ReportScheduleFrequency;
  readonly cronExpression: string;
  readonly hour: number;
  readonly minute: number;
  readonly dayOfWeek: number | null;
  readonly dayOfMonth: number | null;
  readonly timezone: string;
  readonly format: ExportFormat;
  readonly parameters: NormalizedReportParameters;
  readonly channels: readonly ReportDeliveryChannel[];
  readonly recipientEmails: readonly string[];
  readonly recipientUserIds: readonly number[];
  readonly ttlSeconds: number;
  readonly actorId: number | null;
  readonly isActive: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Bản ghi Lịch sử chạy báo cáo (Mục 8.4.7 — Lưu lịch sử chạy báo cáo: Thời gian, người chạy và kết quả).
 */
export interface ReportExecutionHistoryRecord {
  readonly id: number;
  readonly jobId: string | null;
  readonly scheduleId: number | null;
  readonly reportCode: string;
  readonly module: string;
  readonly reportName: string;
  readonly actorId: number | null;
  readonly parameters: NormalizedReportParameters;
  readonly executionMode: ReportExecutionMode;
  readonly dataSourceUsed: ReportDataSourceType;
  readonly cacheHit: boolean;
  readonly cacheKey: string | null;
  readonly status: ReportJobStatus;
  readonly format: ExportFormat | null;
  readonly fileName: string | null;
  readonly totalRecords: number;
  readonly summary: Readonly<Record<string, unknown>> | null;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly isExpired: boolean;
  readonly notifiedChannels: readonly ReportDeliveryChannel[];
  readonly recipientEmails: readonly string[];
  readonly recipientUserIds: readonly number[];
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
}

/**
 * Thông báo gửi báo cáo qua Email hoặc In-App kèm đường dẫn tải file tạm có thời hạn (Mục 8.4.6).
 */
export interface ReportDeliveryNotification {
  readonly id: number;
  readonly historyId: number | null;
  readonly scheduleId: number | null;
  readonly reportCode: string;
  readonly reportName: string;
  readonly module: string;
  readonly channels: readonly ReportDeliveryChannel[];
  readonly recipientEmails: readonly string[];
  readonly recipientUserIds: readonly number[];
  readonly format: ExportFormat;
  readonly fileName: string;
  readonly totalRecords: number;
  readonly downloadToken: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly title: string;
  readonly message: string;
  readonly sentAt: string;
}

/**
 * Quét tự động toàn bộ các tệp `module.manifest.json` trong `modules/*` và `project-modules/*`
 * để thu thập danh mục `"reports"` do từng module tự khai báo (Mục 8.4.1).
 */
export function discoverManifestReports(): ReportManifestItem[] {
  const reportMap = new Map<string, ReportManifestItem>();

  for (const { moduleName, raw } of scanModuleManifests<{
    name?: string;
    reports?: ReportManifestItem[];
  }>()) {
    if (!Array.isArray(raw.reports)) continue;
    for (const item of raw.reports) {
      if (!item || typeof item.code !== 'string' || !item.code.trim()) continue;
      const code = item.code.trim().toLowerCase();
      if (!reportMap.has(code)) {
        reportMap.set(code, {
          ...item,
          code,
          module: (item.module ?? moduleName).trim().toLowerCase(),
        });
      }
    }
  }

  return [...reportMap.values()];
}
