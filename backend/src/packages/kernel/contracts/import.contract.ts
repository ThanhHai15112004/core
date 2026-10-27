import type { z } from 'zod';

/**
 * Chiến lược xử lý dữ liệu trùng khi nhập hàng loạt (Mục 8.2 — Xử lý dữ liệu trùng):
 * - `SKIP`: Bỏ qua dòng trùng (giữ nguyên bản ghi cũ, tăng `skippedCount`).
 * - `UPDATE`: Cập nhật đè vào bản ghi đã tồn tại theo khóa trùng (tăng `updatedCount`).
 * - `REJECT`: Từ chối dòng trùng và ghi nhận lỗi chi tiết vào danh sách `errors` (tăng `failedCount`).
 */
export const IMPORT_DUPLICATE_STRATEGY = {
  SKIP: 'SKIP',
  UPDATE: 'UPDATE',
  REJECT: 'REJECT',
} as const;

export type ImportDuplicateStrategy =
  (typeof IMPORT_DUPLICATE_STRATEGY)[keyof typeof IMPORT_DUPLICATE_STRATEGY];

export const IMPORT_DUPLICATE_STRATEGIES = ['SKIP', 'UPDATE', 'REJECT'] as const;

/** Chuẩn hóa chiến lược xử lý dữ liệu trùng (tương thích ngược với cờ `skipDuplicates?: boolean`) */
export function resolveImportDuplicateStrategy(
  strategy?: ImportDuplicateStrategy | string | null,
  skipDuplicates?: boolean | null,
  defaultStrategy: ImportDuplicateStrategy = IMPORT_DUPLICATE_STRATEGY.SKIP,
): ImportDuplicateStrategy {
  if (typeof strategy === 'string') {
    const upper = strategy.trim().toUpperCase();
    if (
      upper === IMPORT_DUPLICATE_STRATEGY.SKIP ||
      upper === IMPORT_DUPLICATE_STRATEGY.UPDATE ||
      upper === IMPORT_DUPLICATE_STRATEGY.REJECT
    ) {
      return upper;
    }
  }
  if (typeof skipDuplicates === 'boolean') {
    return skipDuplicates ? IMPORT_DUPLICATE_STRATEGY.SKIP : IMPORT_DUPLICATE_STRATEGY.REJECT;
  }
  return defaultStrategy;
}

/**
 * Định nghĩa một cột dữ liệu trong cấu hình Import dùng chung (Mục 8.2 — File mẫu & Ánh xạ cột).
 */
export interface ImportColumnDefinition<TField extends string = string> {
  /** Tên trường hệ thống (ví dụ: `'username'`, `'email'`, `'fullName'`, `'phone'`). */
  readonly field: TField;
  /** Tiêu đề cột chuẩn hiển thị trên file mẫu Excel/CSV (ví dụ: `'Email*'`, `'Số điện thoại'`). */
  readonly header: string;
  /** Danh sách các tên cột đồng nghĩa (tiếng Việt / tiếng Anh) để tự động nhận diện cột khi upload. */
  readonly aliases?: readonly string[] | undefined;
  /** Trường có bắt buộc có mặt hoặc không rỗng hay không. */
  readonly required?: boolean | undefined;
  /** Độ rộng cột khi xuất file mẫu Excel `.xlsx`. */
  readonly width?: number | undefined;
  /** Căn giữa ô trong file mẫu Excel `.xlsx`. */
  readonly isCenter?: boolean | undefined;
  /** Ép định dạng Text `'@'` trên Excel để giữ số `0` ở đầu (ví dụ: SĐT, Mã nhân viên). */
  readonly isText?: boolean | undefined;
  /** Các giá trị mẫu cho các dòng ví dụ trong file Template. */
  readonly sampleValues?: readonly (string | number)[] | undefined;
}

/**
 * Bản đồ ánh xạ cột do người dùng/Frontend truyền lên (Mục 8.2 — Cho phép ánh xạ cột):
 * Key = tên trường hệ thống (`field`), Value = tên cột trên file Excel/CSV, chữ cái cột (`'A'`, `'B'`), hoặc chỉ số cột 0-based (`0`, `1`).
 */
export type ImportColumnMappingInput = Readonly<Record<string, string | number | null>>;

/** Thông tin ánh xạ đã giải quyết của một trường hệ thống với cột trong file */
export interface ResolvedImportColumnMatch<TField extends string = string> {
  readonly field: TField;
  readonly header: string;
  readonly required: boolean;
  /** Chỉ số cột 0-based trong file (`-1` nếu không tìm thấy cột tương ứng). */
  readonly matchedIndex: number;
  /** Tên tiêu đề thực tế trên file Excel/CSV đã khớp (hoặc `null`). */
  readonly matchedHeader: string | null;
  /** Ký hiệu cột Excel (`'A'`, `'B'`, ... hoặc `null` nếu không tìm thấy). */
  readonly matchedColumnLetter: string | null;
  /** Nguồn khớp: `'custom'` (người dùng chỉ định), `'alias'` (tự động theo header/alias), hoặc `'unmapped'`. */
  readonly mappedBy: 'custom' | 'alias' | 'unmapped';
}

export interface ResolvedImportColumnMappingResult<TField extends string = string> {
  readonly headerRowIndex: number;
  readonly detectedHeaders: readonly string[];
  readonly matches: readonly ResolvedImportColumnMatch<TField>[];
  readonly unmappedRequiredFields: readonly TField[];
}

export interface ExtractedImportMatrixRow {
  readonly row: number;
  readonly sheetRowNumber: number;
  readonly rawByField: Readonly<Record<string, string>>;
}

/**
 * Chi tiết lỗi kiểm tra trên từng dòng và từng cột (Mục 8.2 — Kiểm tra lỗi theo từng dòng và cột, báo rõ nguyên nhân).
 */
export interface ImportCellIssue {
  /** Số thứ tự dòng dữ liệu (1-based tính từ dòng dữ liệu đầu tiên, tương thích ngược với `errors[].row`). */
  readonly row: number;
  /** Số dòng thực tế trên trang tính Excel/CSV (bao gồm cả dòng tiêu đề). */
  readonly sheetRowNumber: number;
  /** Tên cột thực tế trên file Excel/CSV (ví dụ: `'Email'`, `'Số điện thoại'`). */
  readonly column: string | null;
  /** Ký hiệu chữ cái cột Excel (`'A'`, `'B'`, ...). */
  readonly columnLetter: string | null;
  /** Tên trường hệ thống bị lỗi (ví dụ: `'email'`, `'phone'`). */
  readonly field: string | null;
  /** Mã phân loại lỗi (`'VALIDATION_ERROR'`, `'DUPLICATE_IN_FILE'`, `'DUPLICATE_IN_DB'`, `'CREATE_FAILED'`, `'UPDATE_FAILED'`). */
  readonly code: string;
  /** Giá trị gốc gây lỗi tại ô. */
  readonly value?: unknown;
  /** Thông báo nguyên nhân lỗi rõ ràng cho người dùng. */
  readonly message: string;
}

/** Đầu vào chung cho yêu cầu Xem trước (Preview) hoặc Thực thi Import (Mục 8.2) */
export interface ImportPayloadInput<TRow = Record<string, unknown>> {
  readonly fileName?: string | undefined;
  readonly xlsxBase64?: string | undefined;
  readonly csvContent?: string | undefined;
  readonly items?: readonly TRow[] | undefined;
  /** Ánh xạ cột tùy chỉnh từ cột trong file sang trường hệ thống */
  readonly columnMapping?: ImportColumnMappingInput | undefined;
  /** Chiến lược xử lý dữ liệu trùng (`'SKIP'` | `'UPDATE'` | `'REJECT'`) */
  readonly duplicateStrategy?: ImportDuplicateStrategy | undefined;
  /** Cờ tương thích ngược: `true` -> `'SKIP'`, `false` -> `'REJECT'` */
  readonly skipDuplicates?: boolean | undefined;
  /** Số dòng mẫu tối đa trả về khi xem trước (mặc định `20`) */
  readonly previewLimit?: number | undefined;
  /** Chạy bất đồng bộ qua Queue `system.heavy` để không treo request */
  readonly async?: boolean | undefined;
}

/** Kết quả trả về khi tạo file Mẫu Import (Template .xlsx / .csv) */
export interface ImportTemplateFileResult {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
}

/** Một dòng mẫu trong kết quả Xem trước dữ liệu trước khi nhập (Preview — Mục 8.2) */
export interface ImportPreviewRowItem<TRow = Record<string, unknown>> {
  readonly row: number;
  readonly sheetRowNumber: number;
  readonly rawValues: Readonly<Record<string, string>>;
  readonly parsedRow: TRow | null;
  readonly status: 'VALID' | 'DUPLICATE_SKIP' | 'DUPLICATE_UPDATE' | 'DUPLICATE_REJECT' | 'INVALID';
  readonly existingRecordId: number | string | null;
  readonly issues: readonly ImportCellIssue[];
}

/** Kết quả Xem trước dữ liệu trước khi nhập (Preview — Mục 8.2) */
export interface ImportPreviewResult<TRow = Record<string, unknown>> {
  readonly profileCode: string;
  readonly detectedHeaders: readonly string[];
  readonly headerRowIndex: number;
  readonly columnMatches: readonly ResolvedImportColumnMatch[];
  readonly unmappedRequiredFields: readonly string[];
  readonly totalRows: number;
  readonly validRowsCount: number;
  readonly invalidRowsCount: number;
  readonly duplicateRowsCount: number;
  readonly willCreateCount: number;
  readonly willUpdateCount: number;
  readonly willSkipCount: number;
  readonly willRejectCount: number;
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly sampleRows: readonly ImportPreviewRowItem<TRow>[];
  readonly issues: readonly ImportCellIssue[];
}

/**
 * Trạng thái tiến độ Import theo thời gian thực (Mục 8.2 — Hiển thị tiến độ Import: Số dòng thành công, lỗi và còn lại).
 */
export type ImportJobStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface ImportProgressSnapshot {
  readonly jobId: string;
  readonly profileCode: string;
  readonly status: ImportJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  /** Số dòng còn lại chưa xử lý (`totalRows - processedRows`) */
  readonly remainingRows: number;
  /** Tổng số dòng thành công (`createdCount + updatedCount`) */
  readonly successCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly percent: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * Bản ghi Lịch sử Import (Mục 8.2 — Lưu lịch sử Import: File, người thực hiện và kết quả).
 */
export interface ImportHistoryRecord {
  readonly id: number;
  readonly jobId: string | null;
  readonly profileCode: string;
  readonly module: string;
  readonly fileName: string;
  readonly format: 'xlsx' | 'csv' | 'json';
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly actorId: number | null;
  readonly status: ImportJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly remainingRows: number;
  readonly successCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly errors: readonly ImportCellIssue[];
  readonly columnMapping: Readonly<Record<string, string | number | null>> | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/** Bộ lọc truy vấn danh sách Lịch sử Import */
export interface ImportHistoryQueryFilter {
  readonly profileCode?: string | undefined;
  readonly module?: string | undefined;
  readonly status?: ImportJobStatus | undefined;
  readonly actorId?: number | undefined;
  readonly limit?: number | undefined;
}

/** Kết quả phát hiện bản ghi đã tồn tại trong DB của một dòng Import */
export interface ExistingDuplicateMatch {
  readonly existingId: number | string;
  readonly matchedField: string;
  readonly matchedValue: string;
}

/**
 * Hợp đồng đăng ký một Profile Import nghiệp vụ vào `ImportRegistryService`
 * để mọi module (`users`, `organizations`, `codes`, LMS/CRM...) dùng chung toàn bộ 9 tính năng của Mục 8.2.
 */
export interface ImportProfileHandler<TRow = Record<string, unknown>> {
  readonly profileCode: string;
  readonly module: string;
  readonly columns: readonly ImportColumnDefinition[];
  readonly rowSchema: z.ZodType<TRow>;
  readonly uniqueKeyFields?: readonly string[] | undefined;
  /** Kiểm tra trùng lặp hàng loạt với dữ liệu đã có trong DB (Batch 1 lần để tránh N+1 query) */
  readonly findExistingDuplicates?:
    | ((
        rows: ReadonlyArray<{ readonly row: number; readonly data: TRow }>,
      ) => Promise<ReadonlyMap<number, ExistingDuplicateMatch>>)
    | undefined;
}

/**
 * Đầu vào khi Worker thực thi một chunk Import hàng loạt từ hàng đợi `system.heavy` (Mục 8.2.7).
 */
export interface ImportQueueChunkExecutionInput<TRow = unknown> {
  readonly items?: readonly TRow[] | undefined;
  readonly csvContent?: string | undefined;
  readonly xlsxBase64?: string | undefined;
  readonly columnMapping?: ImportColumnMappingInput | undefined;
  readonly duplicateStrategy?: ImportDuplicateStrategy | undefined;
  readonly skipDuplicates?: boolean | undefined;
  readonly defaultPassword?: string | undefined;
  readonly actorId?: number | undefined;
  readonly options?:
    | {
        readonly skipQueuePublish?: boolean | undefined;
        readonly skipHistoryRecord?: boolean | undefined;
      }
    | undefined;
}

/**
 * Kết quả trả về sau khi Worker thực thi một chunk Import hàng loạt (Mục 8.2.7 & 8.2.8).
 */
export interface ImportQueueChunkExecutionResult {
  readonly importedCount: number;
  readonly updatedCount?: number | undefined;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly errors: ReadonlyArray<{
    readonly row: number;
    readonly sheetRowNumber?: number | undefined;
    readonly column?: string | null | undefined;
    readonly columnLetter?: string | null | undefined;
    readonly field?: string | null | undefined;
    readonly code?: string | undefined;
    readonly value?: unknown;
    readonly message: string;
  }>;
}

/**
 * Hợp đồng đăng ký bộ thực thi Import nền (`ImportQueueWorkerExecutor`) vào `ImportRegistryService`
 * giúp `HeavyJobProcessor` điều phối động cho mọi module mà không cần hardcode từng service.
 */
export interface ImportQueueWorkerExecutor<TRow = unknown> {
  readonly profileCode: string;
  readonly module: string;
  readonly topic?: string | undefined;
  parseImportRows(input: ImportQueueChunkExecutionInput<TRow>): readonly TRow[];
  executeChunkImport(
    input: ImportQueueChunkExecutionInput<TRow>,
  ): Promise<ImportQueueChunkExecutionResult>;
}

/**
 * Kết quả biên dịch danh sách `ImportColumnDefinition` thành bộ metadata cột chuẩn & dữ liệu mẫu cho Template.
 */
export interface CompiledDeclarativeImportSchema<TField extends string = string> {
  readonly columns: readonly ImportColumnDefinition<TField>[];
  readonly headers: readonly string[];
  readonly columnWidths: readonly number[];
  readonly centerColumnIndices: readonly number[];
  readonly textColumnIndices: readonly number[];
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string | number>>;
}
