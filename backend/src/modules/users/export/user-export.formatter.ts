import { LocaleFormatter } from '@packages/i18n/index.js';
import {
  type DeclarativeExportColumn,
  type ImportColumnDefinition,
  compileDeclarativeExportColumns,
  compileDeclarativeImportColumns,
  defaultCodeRegistry,
  escapeCsvCell,
} from '@packages/kernel/index.js';
import { USER_STATUS } from '../contracts/index.js';
import type { UserResponse } from '../responses/users.response.js';

export { escapeCsvCell };

/** Tiêu đề mặc định của báo cáo xuất danh sách nhân viên (tham chiếu `danh_sach_nhan_vien.xlsx`) */
export const DEFAULT_USER_EXPORT_REPORT_TITLE = 'DANH SÁCH CÁN BỘ NHÂN VIÊN';

/** Định dạng ngày giờ báo cáo `dd/MM/yyyy HH:mm:ss` theo múi giờ người dùng (5.3.4, 5.3.5, 5.3.6) */
export function formatVietnameseDateTime(date: Date = new Date(), timeZone?: string): string {
  return LocaleFormatter.formatReportDateTime(date, timeZone);
}

/** Định dạng ngày ngắn `dd/MM/yyyy` theo múi giờ người dùng (5.3.4, 5.3.5, 5.3.6) */
export function formatVietnameseDateOnly(
  isoOrDate?: string | Date | null,
  timeZone?: string,
): string {
  return LocaleFormatter.formatReportDateOnly(isoOrDate, timeZone);
}

/** Hiển thị nhãn trạng thái tiếng Việt tường minh trên file Excel xuất ra (tra cứu động từ CodeRegistryService `users.status`) */
export function formatVietnameseUserStatusLabel(status: number): string {
  const fallback =
    status === USER_STATUS.INACTIVE
      ? 'Ngừng hoạt động'
      : status === USER_STATUS.LOCKED
        ? 'Tạm khóa'
        : status === USER_STATUS.ARCHIVED
          ? 'Lưu trữ'
          : 'Đang làm việc';
  return defaultCodeRegistry.getLabel('users.status', status, 'vi') || fallback;
}

/**
 * Khai báo cột Xuất dữ liệu nhân sự tập trung 1 chỗ duy nhất (Declarative Export Schema — Mục 8.3).
 * Muốn thêm/sửa/xóa cột chỉ cần chỉnh mảng này, Engine tự động suy diễn `headers`, `columnWidths`,
 * `centerColumnIndices`, `textColumnIndices` và hàm map dòng `mapUserToExportRow`.
 */
export const USER_EXPORT_COLUMNS: readonly DeclarativeExportColumn<
  UserResponse,
  { readonly timeZone?: string | undefined }
>[] = [
  {
    field: 'stt',
    header: 'STT',
    width: 8,
    isCenter: true,
    value: (_u, idx) => idx + 1,
  },
  {
    field: 'employeeCode',
    header: 'Mã nhân viên',
    width: 16,
    isText: true,
    value: (u) => `NV${String(u.id).padStart(4, '0')}`,
  },
  {
    field: 'username',
    header: 'Username',
    width: 18,
    isText: true,
    value: (u) => u.username || '',
  },
  {
    field: 'lastName',
    header: 'Họ và tên đệm',
    width: 22,
    value: (u) => u.lastName || '',
  },
  {
    field: 'firstName',
    header: 'Tên',
    width: 14,
    value: (u) => u.firstName || '',
  },
  {
    field: 'fullName',
    header: 'Họ và tên',
    width: 24,
    value: (u) => u.fullName || '',
  },
  {
    field: 'email',
    header: 'Email',
    width: 30,
    value: (u) => u.email || '',
  },
  {
    field: 'phone',
    header: 'Số điện thoại',
    width: 16,
    isText: true,
    value: (u) => u.phone ?? '',
  },
  {
    field: 'organizationUnits',
    header: 'Đơn vị / Phòng ban',
    width: 32,
    value: (u) =>
      u.organizationUnits.map((o) => o.code || o.name || String(o.organizationUnitId)).join('|'),
  },
  {
    field: 'positionTitle',
    header: 'Chức danh',
    width: 24,
    value: (u) => {
      const primaryOrg =
        u.organizationUnits.find((o) => o.isPrimary) ?? u.organizationUnits[0] ?? null;
      return primaryOrg?.positionTitle?.trim() || '';
    },
  },
  {
    field: 'roles',
    header: 'Vai trò',
    width: 22,
    value: (u) => u.roles.map((r) => r.code).join('|'),
  },
  {
    field: 'mfaEnabled',
    header: 'MFA',
    width: 12,
    isCenter: true,
    value: (u) => (u.mfaEnabled ? 'Bật' : 'Tắt'),
  },
  {
    field: 'status',
    header: 'Trạng thái',
    width: 18,
    isCenter: true,
    value: (u) => formatVietnameseUserStatusLabel(u.status),
  },
  {
    field: 'createdAt',
    header: 'Ngày tạo',
    width: 16,
    isCenter: true,
    value: (u, _idx, ctx) => formatVietnameseDateOnly(u.createdAt, ctx?.timeZone),
  },
] as const;

const COMPILED_USER_EXPORT_SCHEMA = compileDeclarativeExportColumns(USER_EXPORT_COLUMNS);

export const USER_EXPORT_HEADERS = COMPILED_USER_EXPORT_SCHEMA.headers;
export const USER_EXPORT_COLUMN_WIDTHS = COMPILED_USER_EXPORT_SCHEMA.columnWidths;
export const USER_EXPORT_CENTER_COLUMNS = COMPILED_USER_EXPORT_SCHEMA.centerColumnIndices;
export const USER_EXPORT_TEXT_COLUMNS = COMPILED_USER_EXPORT_SCHEMA.textColumnIndices;

/**
 * Chuyển một `UserResponse` thành dòng dữ liệu xuất Excel / CSV tự động từ `USER_EXPORT_COLUMNS`.
 */
export function mapUserToExportRow(
  user: UserResponse,
  index: number,
  options?: { timeZone?: string },
): Array<string | number> {
  return COMPILED_USER_EXPORT_SCHEMA.mapItemToRow(user, index, {
    ...(options?.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  });
}

/**
 * Khai báo cột File Mẫu Import người dùng tập trung 1 chỗ duy nhất (Declarative Import Template Schema — Mục 8.2).
 */
export const USER_IMPORT_TEMPLATE_COLUMNS: readonly ImportColumnDefinition[] = [
  {
    field: 'stt',
    header: 'STT',
    width: 8,
    isCenter: true,
    sampleValues: [1, 2, 3],
  },
  {
    field: 'employeeCode',
    header: 'Mã nhân viên*',
    width: 16,
    isText: true,
    sampleValues: ['NV10001', 'NV10002', 'NV10003'],
  },
  {
    field: 'username',
    header: 'Username*',
    required: true,
    width: 18,
    isText: true,
    sampleValues: ['an.nguyen', 'binh.tran', 'minh.le'],
  },
  {
    field: 'password',
    header: 'Mật khẩu*',
    width: 16,
    isText: true,
    sampleValues: ['Abcd@454647#', 'Abcd@454647#', 'Abcd@454647#'],
  },
  {
    field: 'lastName',
    header: 'Họ và tên đệm*',
    width: 22,
    sampleValues: ['Nguyễn Văn', 'Trần Thị', 'Lê Hoàng'],
  },
  {
    field: 'firstName',
    header: 'Tên*',
    width: 14,
    sampleValues: ['An', 'Bình', 'Minh'],
  },
  {
    field: 'fullName',
    header: 'Họ và tên',
    width: 24,
    sampleValues: ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Minh'],
  },
  {
    field: 'email',
    header: 'Email*',
    required: true,
    width: 28,
    sampleValues: ['an.nguyen@gmail.com', 'binh.tran@gmail.com', 'minh.le@gmail.com'],
  },
  {
    field: 'phone',
    header: 'Số điện thoại',
    width: 16,
    isText: true,
    sampleValues: ['0901234567', '0902345678', ''],
  },
  {
    field: 'organizationCodes',
    header: 'Mã Đơn vị*',
    width: 28,
    sampleValues: ['BRANCH_HCM|DEPT_ENGINEERING', 'BRANCH_HCM|DEPT_HR', 'BRANCH_HCM'],
  },
  {
    field: 'positionTitle',
    header: 'Chức danh / Vị trí',
    width: 24,
    sampleValues: ['Chuyên viên Kỹ thuật', 'Trưởng phòng Nhân sự', ''],
  },
  {
    field: 'roleCodes',
    header: 'Vai trò',
    width: 20,
    sampleValues: ['staff', 'department_manager', 'staff'],
  },
  {
    field: 'status',
    header: 'Trạng thái* (1: Bật, 0: Tắt)',
    width: 26,
    isCenter: true,
    sampleValues: [1, 1, 1],
  },
  {
    field: 'joinedDate',
    header: 'Ngày vào làm (dd/MM/yyyy)',
    width: 22,
    isCenter: true,
    isText: true,
    sampleValues: ['15/10/2026', '15/10/2026', ''],
  },
] as const;

const COMPILED_USER_IMPORT_TEMPLATE_SCHEMA = compileDeclarativeImportColumns(
  USER_IMPORT_TEMPLATE_COLUMNS,
);

export const USER_IMPORT_TEMPLATE_HEADERS = COMPILED_USER_IMPORT_TEMPLATE_SCHEMA.headers;
export const USER_IMPORT_TEMPLATE_COLUMN_WIDTHS = COMPILED_USER_IMPORT_TEMPLATE_SCHEMA.columnWidths;
export const USER_IMPORT_TEMPLATE_CENTER_COLUMNS =
  COMPILED_USER_IMPORT_TEMPLATE_SCHEMA.centerColumnIndices;
export const USER_IMPORT_TEMPLATE_TEXT_COLUMNS =
  COMPILED_USER_IMPORT_TEMPLATE_SCHEMA.textColumnIndices;
export const USER_IMPORT_TEMPLATE_SAMPLE_ROWS = COMPILED_USER_IMPORT_TEMPLATE_SCHEMA.sampleRows;
