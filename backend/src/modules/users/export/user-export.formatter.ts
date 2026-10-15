import { USER_STATUS } from '../contracts/index.js';
import type { UserResponse } from '../responses/users.response.js';

/** Tiêu đề mặc định của báo cáo xuất danh sách nhân viên (tham chiếu `danh_sach_nhan_vien.xlsx`) */
export const DEFAULT_USER_EXPORT_REPORT_TITLE = 'DANH SÁCH CÁN BỘ NHÂN VIÊN';

/** Danh sách cột chuẩn khi xuất báo cáo Excel / CSV danh sách nhân viên */
export const USER_EXPORT_HEADERS = [
  'STT',
  'Mã nhân viên',
  'Username',
  'Họ và tên đệm',
  'Tên',
  'Họ và tên',
  'Email',
  'Số điện thoại',
  'Đơn vị / Phòng ban',
  'Chức danh',
  'Vai trò',
  'MFA',
  'Trạng thái',
  'Ngày tạo',
] as const;

/** Độ rộng từng cột của bảng xuất danh sách nhân viên */
export const USER_EXPORT_COLUMN_WIDTHS = [
  8, 16, 18, 22, 14, 24, 30, 16, 32, 24, 22, 12, 18, 16,
] as const;

/** Các cột căn giữa trong bảng xuất danh sách nhân viên (0-based: STT, MFA, Trạng thái, Ngày tạo) */
export const USER_EXPORT_CENTER_COLUMNS = [0, 11, 12, 13] as const;

/** Các cột ép kiểu Text '@' để giữ số 0 ở đầu (0-based: Mã nhân viên, Username, Số điện thoại) */
export const USER_EXPORT_TEXT_COLUMNS = [1, 2, 7] as const;

/** Danh sách cột chuẩn của file Mẫu Import người dùng (tham chiếu `4_import_nhan_vien_moi.xlsx`) */
export const USER_IMPORT_TEMPLATE_HEADERS = [
  'STT',
  'Mã nhân viên*',
  'Username*',
  'Mật khẩu*',
  'Họ và tên đệm*',
  'Tên*',
  'Họ và tên',
  'Email*',
  'Số điện thoại',
  'Mã Đơn vị*',
  'Chức danh / Vị trí',
  'Vai trò',
  'Trạng thái* (1: Bật, 0: Tắt)',
  'Ngày vào làm (dd/MM/yyyy)',
] as const;

export const USER_IMPORT_TEMPLATE_COLUMN_WIDTHS = [
  8, 16, 18, 16, 22, 14, 24, 28, 16, 28, 24, 20, 26, 22,
] as const;

export const USER_IMPORT_TEMPLATE_CENTER_COLUMNS = [0, 12, 13] as const;

export const USER_IMPORT_TEMPLATE_TEXT_COLUMNS = [1, 2, 3, 8, 13] as const;

export const USER_IMPORT_TEMPLATE_SAMPLE_ROWS: ReadonlyArray<ReadonlyArray<string | number>> = [
  [
    1,
    'NV10001',
    'an.nguyen',
    'Abcd@454647#',
    'Nguyễn Văn',
    'An',
    'Nguyễn Văn An',
    'an.nguyen@gmail.com',
    '0901234567',
    'BRANCH_HCM|DEPT_ENGINEERING',
    'Chuyên viên Kỹ thuật',
    'staff',
    1,
    '15/10/2026',
  ],
  [
    2,
    'NV10002',
    'binh.tran',
    'Abcd@454647#',
    'Trần Thị',
    'Bình',
    'Trần Thị Bình',
    'binh.tran@gmail.com',
    '0902345678',
    'BRANCH_HCM|DEPT_HR',
    'Trưởng phòng Nhân sự',
    'department_manager',
    1,
    '15/10/2026',
  ],
  [
    3,
    'NV10003',
    'minh.le',
    'Abcd@454647#',
    'Lê Hoàng',
    'Minh',
    'Lê Hoàng Minh',
    'minh.le@gmail.com',
    '',
    'BRANCH_HCM',
    '',
    'staff',
    1,
    '',
  ],
];

/** Định dạng ngày giờ Việt Nam `dd/MM/yyyy HH:mm:ss` phục vụ dòng "Ngày xuất dữ liệu" */
export function formatVietnameseDateTime(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Định dạng ngày ngắn `dd/MM/yyyy` từ chuỗi ISO hoặc Date */
export function formatVietnameseDateOnly(isoOrDate?: string | Date | null): string {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Hiển thị nhãn trạng thái tiếng Việt tường minh trên file Excel xuất ra */
export function formatVietnameseUserStatusLabel(status: number): string {
  switch (status) {
    case USER_STATUS.INACTIVE:
      return 'Ngừng hoạt động';
    case USER_STATUS.LOCKED:
      return 'Tạm khóa';
    case USER_STATUS.ARCHIVED:
      return 'Lưu trữ';
    case USER_STATUS.ACTIVE:
    default:
      return 'Đang làm việc';
  }
}

/** Thoát chuỗi an toàn khi ghi ra ô CSV */
export function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Chuyển một `UserResponse` thành dòng dữ liệu xuất Excel / CSV.
 * Nếu trường nào chưa có thông tin (SĐT, Đơn vị, Chức danh, Vai trò...) thì để trống `""`.
 */
export function mapUserToExportRow(user: UserResponse, index: number): Array<string | number> {
  const stt = index + 1;
  const employeeCode = `NV${String(user.id).padStart(4, '0')}`;
  const rolesStr = user.roles.map((r) => r.code).join('|');
  const orgsStr = user.organizationUnits
    .map((o) => o.code || o.name || String(o.organizationUnitId))
    .join('|');
  const primaryOrg =
    user.organizationUnits.find((o) => o.isPrimary) ?? user.organizationUnits[0] ?? null;
  const positionTitle = primaryOrg?.positionTitle?.trim() || '';

  return [
    stt,
    employeeCode,
    user.username || '',
    user.lastName || '',
    user.firstName || '',
    user.fullName || '',
    user.email || '',
    user.phone ?? '',
    orgsStr,
    positionTitle,
    rolesStr,
    user.mfaEnabled ? 'Bật' : 'Tắt',
    formatVietnameseUserStatusLabel(user.status),
    formatVietnameseDateOnly(user.createdAt),
  ];
}
