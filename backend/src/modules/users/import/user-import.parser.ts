import {
  cleanSpreadsheetCell as cleanCellValue,
  createSpreadsheetColumnFinder,
  detectSpreadsheetHeaderRowIndex,
  parseCsvLine,
  parseCsvToMatrix,
} from '@packages/kernel/index.js';
import { USER_STATUS, parseUserStatus } from '../contracts/index.js';
import type { BulkImportUserRowInput } from '../requests/users.requests.js';

export { parseCsvLine };

const USER_KNOWN_HEADERS = [
  'email',
  'mail',
  'username',
  'user_name',
  'tên đăng nhập',
  'ten dang nhap',
  'mã nhân viên',
  'ma nhan vien',
  'employee_code',
  'họ và tên đệm',
  'họ',
  'tên',
  'họ và tên',
  'số điện thoại',
  'sđt',
] as const;

/**
 * Tự động dò tìm dòng Header trong ma trận Excel/CSV
 * (Hỗ trợ cả file có dòng Tiêu đề lớn + Ngày xuất dữ liệu + Logo ở dòng 1-2 như `danh_sach_nhan_vien.xlsx`
 * lẫn file mẫu Import có Header ngay tại dòng 1).
 */
export function detectHeaderRowIndex(matrix: ReadonlyArray<ReadonlyArray<string>>): number {
  return detectSpreadsheetHeaderRowIndex(matrix, USER_KNOWN_HEADERS);
}

/** Chuyển đổi mảng 2 chiều (từ CSV hoặc Excel .xlsx) thành danh sách `BulkImportUserRowInput` */
export function mapMatrixToImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
): BulkImportUserRowInput[] {
  if (matrix.length < 2) return [];

  const headerRowIdx = detectHeaderRowIndex(matrix);
  if (headerRowIdx >= matrix.length - 1) return [];

  const idxOf = createSpreadsheetColumnFinder(matrix[headerRowIdx]!);

  const usernameIdx = idxOf([
    'username',
    'user_name',
    'account',
    'tai_khoan',
    'tài khoản',
    'tên đăng nhập',
    'ten dang nhap',
  ]);
  const employeeCodeIdx = idxOf([
    'mã nhân viên',
    'ma nhan vien',
    'employee_code',
    'emp_code',
    'mã nv',
  ]);
  const emailIdx = idxOf(['email', 'mail', 'thư điện tử']);
  const firstNameIdx = idxOf(['firstname', 'first_name', 'ten', 'tên', 'tên nhân viên']);
  const lastNameIdx = idxOf([
    'lastname',
    'last_name',
    'ho',
    'ho_dem',
    'họ',
    'họ và tên đệm',
    'ho va ten dem',
    'họ nhân viên',
  ]);
  const middleNameIdx = idxOf(['tên đệm', 'ten dem', 'middlename', 'middle_name']);
  const fullNameIdx = idxOf([
    'fullname',
    'full_name',
    'name',
    'hoten',
    'ho_ten',
    'họ và tên',
    'họ tên',
  ]);
  const phoneIdx = idxOf([
    'phone',
    'phone_number',
    'phonenumber',
    'sdt',
    'sđt',
    'so_dien_thoai',
    'số điện thoại',
  ]);
  const passwordIdx = idxOf(['password', 'pass', 'mat_khau', 'mật khẩu']);
  const statusIdx = idxOf(['status', 'trangthai', 'trang_thai', 'trạng thái']);
  const positionIdx = idxOf([
    'chức danh',
    'chuc danh',
    'mã chức danh',
    'ma chuc danh',
    'vị trí công việc',
    'vi tri cong viec',
    'chức danh / vị trí',
    'position',
    'position_title',
  ]);
  const rolesIdx = idxOf([
    'roles',
    'rolecodes',
    'role_codes',
    'vai_tro',
    'vai trò',
    'mã vai trò',
    'mã chức vụ',
  ]);
  const orgsIdx = idxOf([
    'organizations',
    'organizationcodes',
    'organization_codes',
    'organizationunits',
    'organizationunitcodes',
    'branches',
    'don_vi',
    'đơn vị',
    'mã đơn vị',
    'ma don vi',
    'đơn vị / phòng ban',
    'don vi / phong ban',
    'phòng ban',
  ]);

  const rows: BulkImportUserRowInput[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i]!;
    const getCell = (idx: number): string => (idx >= 0 ? cleanCellValue(cells[idx] ?? '') : '');

    const rawEmail = getCell(emailIdx);
    const rawUsername = getCell(usernameIdx);
    const rawEmpCode = getCell(employeeCodeIdx);

    const email =
      rawEmail ||
      (rawUsername && !rawUsername.includes('@')
        ? `${rawUsername.toLowerCase()}@gmail.com`
        : rawEmpCode
          ? `${rawEmpCode.toLowerCase()}@gmail.com`
          : '');

    const fallbackUserFromEmail = email.includes('@') ? email.split('@')[0]! : '';
    const candidateUsername = rawUsername || fallbackUserFromEmail || rawEmpCode;
    const username = candidateUsername.replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();

    if (!email && !username) continue;

    const rawFirst = getCell(firstNameIdx);
    const rawLast = getCell(lastNameIdx);
    const rawMiddle = getCell(middleNameIdx);
    const combinedLast = [rawLast, rawMiddle].filter(Boolean).join(' ').trim();

    const firstName = rawFirst || undefined;
    const lastName = combinedLast || undefined;
    const fullName = getCell(fullNameIdx) || `${combinedLast} ${rawFirst}`.trim() || username;
    const phone = getCell(phoneIdx) || null;
    const password = getCell(passwordIdx) || undefined;
    const rawStatus = getCell(statusIdx);
    const status = rawStatus ? parseUserStatus(rawStatus) : USER_STATUS.ACTIVE;
    const positionTitle = getCell(positionIdx) || null;

    const roleCodes = getCell(rolesIdx)
      .split(/[|;,]/)
      .map((s) => cleanCellValue(s))
      .filter(Boolean);

    const organizationCodes = getCell(orgsIdx)
      .split(/[|;,]/)
      .map((s) => cleanCellValue(s.replace(/\*$/, '')))
      .filter(Boolean);

    rows.push({
      username,
      email,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      fullName,
      phone,
      ...(password ? { password } : {}),
      status,
      positionTitle,
      roleCodes,
      organizationCodes,
    });
  }

  return rows;
}

/** Phân tích nội dung chuỗi CSV thành mảng dữ liệu đầu vào */
export function parseCsvToImportRows(csvContent: string): BulkImportUserRowInput[] {
  const matrix = parseCsvToMatrix(csvContent);
  if (matrix.length < 2) return [];
  return mapMatrixToImportRows(matrix);
}
