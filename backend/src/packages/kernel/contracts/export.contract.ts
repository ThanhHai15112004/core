/**
 * Định dạng xuất dữ liệu được hỗ trợ chuẩn trên toàn hệ thống (Mục 8.3 — Xuất dữ liệu: Excel, CSV, PDF qua adapter).
 */
export const EXPORT_FORMAT = {
  CSV: 'csv',
  XLSX: 'xlsx',
  PDF: 'pdf',
} as const;

export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;

/** Chuẩn hóa chuỗi định dạng xuất dữ liệu (`'csv' | 'xlsx' | 'pdf'`) */
export function resolveExportFormat(
  format?: ExportFormat | string | null,
  defaultFormat: ExportFormat = EXPORT_FORMAT.CSV,
): ExportFormat {
  if (typeof format === 'string') {
    const lower = format.trim().toLowerCase();
    if (
      lower === EXPORT_FORMAT.CSV ||
      lower === EXPORT_FORMAT.XLSX ||
      lower === EXPORT_FORMAT.PDF
    ) {
      return lower;
    }
  }
  return defaultFormat;
}

/** Trả về MIME `Content-Type` chuẩn tương ứng với định dạng xuất dữ liệu */
export function resolveExportContentType(format: ExportFormat): string {
  switch (format) {
    case EXPORT_FORMAT.XLSX:
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case EXPORT_FORMAT.PDF:
      return 'application/pdf';
    case EXPORT_FORMAT.CSV:
    default:
      return 'text/csv; charset=utf-8';
  }
}

/**
 * Trạng thái tiến độ / lịch sử của một phiên Xuất dữ liệu (Mục 8.3.4, 8.3.7 & 8.3.8).
 */
export type ExportJobStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

/**
 * Tùy chọn định dạng khi kết xuất bảng dữ liệu sang PDF qua Adapter (Mục 8.3.3).
 */
export interface PdfExportBuildOptions {
  /** Tiêu đề báo cáo hiển thị ở đầu tài liệu PDF */
  readonly title?: string | null | undefined;
  /** Dòng phụ đề (ví dụ: Ngày xuất dữ liệu, Đơn vị, Người xuất) */
  readonly subtitle?: string | null | undefined;
  /** Độ rộng gợi ý của từng cột */
  readonly columnWidths?: readonly number[] | undefined;
  /** Danh sách chỉ số cột (0-based) cần căn giữa */
  readonly centerColumnIndices?: readonly number[] | undefined;
  /** Khổ giấy ngang (`true` mặc định cho bảng nhiều cột) */
  readonly landscape?: boolean | undefined;
  /** Chú thích chân trang tùy chọn */
  readonly footerText?: string | null | undefined;
}

/**
 * Hợp đồng Pluggable Adapter xuất PDF (Mục 8.3.3 — Hỗ trợ xuất PDF qua adapter: Chỉ cài khi dự án cần).
 * - Các dự án cần PDF phức tạp có thể cài thư viện riêng (PDFKit, Puppeteer, Gotenberg...) và đăng ký vào `ExportRegistryService.registerPdfAdapter(...)`.
 * - Khi chưa cài thư viện ngoài, hệ thống hỗ trợ adapter nhẹ hoặc kiểm tra cấu hình adapter rõ ràng.
 */
export interface IPdfExportAdapter {
  /** Tên định danh của PDF Adapter (ví dụ: `'builtin-tabular-pdf'`, `'pdfkit'`, `'puppeteer'`) */
  readonly name: string;
  /** Sinh nội dung nhị phân `.pdf` từ danh sách tiêu đề cột và ma trận dòng dữ liệu */
  buildPdfBuffer(
    headers: readonly string[],
    rows: ReadonlyArray<ReadonlyArray<string | number>>,
    options?: PdfExportBuildOptions,
  ): Promise<Buffer> | Buffer;
}

/** Ngữ cảnh người thực hiện dùng để tính giới hạn số dòng được phép xuất theo quyền và cấu hình (Mục 8.3.6) */
export interface ExportLimitActorContext {
  readonly id?: number | null | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly roleIds?: readonly number[] | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly organizationUnitIds?: readonly number[] | undefined;
}

/** Đầu vào giải quyết giới hạn số lượng bản ghi được xuất (Mục 8.3.6 — Theo quyền và cấu hình) */
export interface ExportLimitPolicyInput {
  /** Khóa cấu hình giới hạn dòng mặc định trong `SettingRegistryService` (ví dụ: `'users.export.max_rows'`) */
  readonly settingKey: string;
  /** Khóa cấu hình giới hạn dòng nâng cao cho vai trò/quyền quản trị (ví dụ: `'users.export.privileged_max_rows'`) */
  readonly privilegedSettingKey?: string | undefined;
  /** Khóa cấu hình JSON ánh xạ giới hạn dòng theo từng mã vai trò (ví dụ: `'users.export.role_max_rows'`) */
  readonly roleLimitsSettingKey?: string | undefined;
  /** Giá trị mặc định khi cấu hình chưa khai báo (mặc định `5000`) */
  readonly defaultMaxRows?: number | undefined;
  /** Giới hạn mặc định cho quyền/vai trò cấp cao (mặc định `50000`) */
  readonly privilegedMaxRows?: number | undefined;
  /** Số lượng bản ghi người dùng yêu cầu trong query (`query.limit`) */
  readonly requestedLimit?: number | null | undefined;
  /** Thông tin người thực hiện (`actor`) để kiểm tra quyền và vai trò */
  readonly actor?: ExportLimitActorContext | null | undefined;
  /** Đơn vị/chi nhánh áp dụng để tra cứu cấu hình theo Scope */
  readonly organizationUnitId?: number | null | undefined;
  /** Danh sách quyền cho phép dùng hạn mức cao (ví dụ: `['users.export.unlimited', 'system.admin']`) */
  readonly unlimitedPermissions?: readonly string[] | undefined;
  /** Danh sách vai trò cho phép dùng hạn mức cao (ví dụ: `['super_admin', 'system_admin', 'admin']`) */
  readonly privilegedRoles?: readonly string[] | undefined;
  /** Bản đồ giới hạn số dòng cụ thể theo từng mã vai trò (`{ manager: 10000, staff: 1000 }`) */
  readonly roleLimits?: Readonly<Record<string, number>> | undefined;
  /** Nếu `true`, ném ngoại lệ khi `requestedLimit > maxRowsAllowed` thay vì tự động cắt về `maxRowsAllowed` */
  readonly enforceStrictLimit?: boolean | undefined;
}

/** Kết quả giải quyết giới hạn số bản ghi được phép xuất (Mục 8.3.6) */
export interface ResolvedExportLimit {
  /** Số bản ghi tối đa mà người thực hiện được phép xuất theo quyền & cấu hình */
  readonly maxRowsAllowed: number;
  /** Số bản ghi thực tế sẽ lấy trong truy vấn (`Math.min(requestedLimit ?? maxRowsAllowed, maxRowsAllowed)`) */
  readonly effectiveLimit: number;
  /** Người thực hiện có thuộc diện quyền/vai trò hạn mức cao hay không */
  readonly isPrivileged: boolean;
  /** Nguồn chính sách được áp dụng (`'default'` | `'setting'` | `'role'` | `'permission'`) */
  readonly appliedPolicy: 'default' | 'setting' | 'role' | 'permission';
}

/**
 * Tệp kết quả Export lưu tạm có thời hạn (Mục 8.3.5 & 8.3.8 — Đường dẫn tải tạm thời & Hết hạn file Export tự động).
 */
export interface TemporaryExportArtifact {
  readonly token: string;
  readonly downloadUrl: string;
  readonly historyId: number | null;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly actorId: number | null;
  readonly fileName: string;
  readonly contentType: string;
  readonly format: ExportFormat;
  readonly totalExported: number;
  readonly sizeBytes: number;
  readonly buffer: Buffer;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Thông tin tóm tắt của file Export tạm thời (không kèm `buffer` nhị phân) */
export interface TemporaryExportArtifactSummary {
  readonly token: string;
  readonly downloadUrl: string;
  readonly historyId: number | null;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly actorId: number | null;
  readonly fileName: string;
  readonly contentType: string;
  readonly format: ExportFormat;
  readonly totalExported: number;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly isExpired: boolean;
}

/**
 * Bản ghi Lịch sử Export (Mục 8.3.7 — Ghi lịch sử Export: Người thực hiện, bộ lọc và số dòng).
 */
export interface ExportHistoryRecord {
  readonly id: number;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly fileName: string;
  readonly format: ExportFormat;
  /** ID người thực hiện xuất dữ liệu */
  readonly actorId: number | null;
  readonly status: ExportJobStatus;
  /** Bộ lọc hiện tại đã áp dụng khi xuất danh sách */
  readonly filters: Readonly<Record<string, unknown>>;
  /** Số lượng bản ghi (dòng) thực tế đã xuất */
  readonly totalExported: number;
  readonly processedRows: number;
  /** Giới hạn số dòng tối đa đã áp dụng theo quyền và cấu hình */
  readonly maxRowsApplied: number;
  /** Token tải file tạm thời */
  readonly downloadToken: string | null;
  /** Đường dẫn tải file tạm thời (kèm trong thông báo hoàn tất) */
  readonly downloadUrl: string | null;
  /** Thời điểm hết hạn file Export tạm thời (ISO 8601) */
  readonly expiresAt: string | null;
  /** Cờ đánh dấu file tạm đã hết hạn và bị thu hồi hay chưa */
  readonly isExpired: boolean;
  /** Thời điểm đã gửi thông báo hoàn tất Export tới người thực hiện */
  readonly notifiedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/** Bộ lọc truy vấn danh sách Lịch sử Export */
export interface ExportHistoryQueryFilter {
  readonly profileCode?: string | undefined;
  readonly module?: string | undefined;
  readonly format?: ExportFormat | undefined;
  readonly status?: ExportJobStatus | undefined;
  readonly actorId?: number | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly limit?: number | undefined;
}

/**
 * Trạng thái tiến độ Export chạy nền qua Queue (Mục 8.3.4 & 8.3.5).
 */
export interface ExportProgressSnapshot {
  readonly jobId: string;
  readonly historyId: number | null;
  readonly profileCode: string;
  readonly format: ExportFormat;
  readonly status: ExportJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly remainingRows: number;
  readonly percent: number;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly notifiedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * Thông tin thông báo được phát đi khi một phiên Export hoàn tất (Mục 8.3.5 — Gửi thông báo khi Export hoàn tất kèm đường dẫn tải tạm thời).
 */
export interface ExportCompletionNotification {
  readonly id: number;
  readonly historyId: number | null;
  readonly jobId: string | null;
  readonly recipientUserId: number;
  readonly module: string;
  readonly profileCode: string;
  readonly format: ExportFormat;
  readonly fileName: string;
  readonly totalExported: number;
  readonly downloadToken: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly title: string;
  readonly message: string;
  readonly sentAt: string;
}

/**
 * Đầu vào khi Worker thực thi một tác vụ Export lớn chạy nền qua Queue (Mục 8.3.4).
 */
export interface ExportQueueWorkerExecutionInput {
  readonly query?: Readonly<Record<string, unknown>> | undefined;
  readonly format?: ExportFormat | string | undefined;
  readonly notifyOnComplete?: boolean | undefined;
  readonly actorId?: number | undefined;
  readonly actor?: unknown;
  readonly historyId?: number | undefined;
  readonly jobId: string;
}

/**
 * Kết quả trả về sau khi Worker thực thi tác vụ Export lớn (Mục 8.3.4 & 8.3.5).
 */
export interface ExportQueueWorkerExecutionResult {
  readonly fileName: string;
  readonly format: ExportFormat | string;
  readonly totalExported: number;
  readonly historyId?: number | null | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly notifiedAt?: string | null | undefined;
}

/**
 * Hợp đồng đăng ký bộ thực thi Export nền (`ExportQueueWorkerExecutor`) vào `ExportRegistryService`
 * giúp `HeavyJobProcessor` điều phối động cho mọi module mà không cần hardcode từng service.
 */
export interface ExportQueueWorkerExecutor {
  readonly profileCode: string;
  readonly module: string;
  readonly topic?: string | undefined;
  executeExport(input: ExportQueueWorkerExecutionInput): Promise<ExportQueueWorkerExecutionResult>;
}

/**
 * Định nghĩa một cột xuất dữ liệu theo hướng khai báo (Declarative Export Column — Mục 8.3).
 * Cho phép mỗi module chỉ cần khai báo 1 mảng cột duy nhất (tiêu đề, độ rộng, căn giữa, ép kiểu text, hàm lấy giá trị)
 * mà không cần tách rời nhiều mảng `HEADERS`, `WIDTHS`, `CENTER_COLUMNS`, `TEXT_COLUMNS` hay đếm chỉ số cột thủ công.
 */
export interface DeclarativeExportColumn<TItem = unknown, TContext = unknown> {
  /** Mã trường nội bộ (tùy chọn, phục vụ định danh hoặc chọn cột) */
  readonly field?: string | undefined;
  /** Tiêu đề cột hiển thị trên file Excel / CSV / PDF */
  readonly header: string;
  /** Độ rộng cột khi xuất Excel / PDF (mặc định `18`) */
  readonly width?: number | undefined;
  /** Căn giữa giá trị ô trong bảng Excel / PDF */
  readonly isCenter?: boolean | undefined;
  /** Ép định dạng Text `'@'` trên Excel để giữ số `0` ở đầu (ví dụ: SĐT, Mã nhân viên, Mã đơn vị) */
  readonly isText?: boolean | undefined;
  /** Hàm trích xuất giá trị của ô từ bản ghi `item`, vị trí `index` (0-based) và `context` */
  readonly value: (
    item: TItem,
    index: number,
    context: TContext,
  ) => string | number | null | undefined;
}

/**
 * Kết quả biên dịch mảng `DeclarativeExportColumn` thành bộ metadata cột chuẩn & hàm ánh xạ dòng.
 */
export interface CompiledDeclarativeExportSchema<TItem = unknown, TContext = unknown> {
  readonly columns: readonly DeclarativeExportColumn<TItem, TContext>[];
  readonly headers: readonly string[];
  readonly columnWidths: readonly number[];
  readonly centerColumnIndices: readonly number[];
  readonly textColumnIndices: readonly number[];
  mapItemToRow(item: TItem, index: number, context: TContext): Array<string | number>;
  mapItemsToRows(items: readonly TItem[], context: TContext): Array<Array<string | number>>;
}
