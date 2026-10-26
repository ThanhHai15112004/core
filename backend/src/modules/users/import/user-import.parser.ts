import {
  cleanSpreadsheetCell as cleanCellValue,
  detectSpreadsheetHeaderRowIndex,
  extractMappedRowsFromMatrix,
  parseCsvLine,
  parseCsvToMatrix,
  resolveImportColumnMapping,
  type ExtractedImportMatrixRow,
  type ImportColumnDefinition,
  type ImportColumnMappingInput,
  type ResolvedImportColumnMappingResult,
} from '@packages/kernel/index.js';
import { USER_STATUS, parseUserStatus } from '../contracts/index.js';
import type { BulkImportUserRowInput } from '../requests/users.requests.js';

export { parseCsvLine };

/**
 * Định nghĩa chuẩn các cột Import người dùng cho Import Engine dùng chung (`@packages/kernel` — Mục 8.2).
 */
export const USER_IMPORT_COLUMNS: readonly ImportColumnDefinition[] = [
  {
    field: 'employeeCode',
    header: 'Mã nhân viên*',
    required: false,
    width: 16,
    isText: true,
    aliases: ['mã nhân viên', 'ma nhan vien', 'employee_code', 'emp_code', 'mã nv'],
  },
  {
    field: 'username',
    header: 'Username*',
    required: true,
    width: 18,
    isText: true,
    aliases: [
      'username',
      'user_name',
      'account',
      'tai_khoan',
      'tài khoản',
      'tên đăng nhập',
      'ten dang nhap',
    ],
  },
  {
    field: 'password',
    header: 'Mật khẩu*',
    required: false,
    width: 16,
    isText: true,
    aliases: ['password', 'pass', 'mat_khau', 'mật khẩu'],
  },
  {
    field: 'lastName',
    header: 'Họ và tên đệm*',
    required: false,
    width: 22,
    aliases: [
      'lastname',
      'last_name',
      'ho',
      'ho_dem',
      'họ',
      'họ và tên đệm',
      'ho va ten dem',
      'họ nhân viên',
    ],
  },
  {
    field: 'middleName',
    header: 'Tên đệm',
    required: false,
    width: 14,
    aliases: ['tên đệm', 'ten dem', 'middlename', 'middle_name'],
  },
  {
    field: 'firstName',
    header: 'Tên*',
    required: false,
    width: 14,
    aliases: ['firstname', 'first_name', 'ten', 'tên', 'tên nhân viên'],
  },
  {
    field: 'fullName',
    header: 'Họ và tên',
    required: false,
    width: 24,
    aliases: ['fullname', 'full_name', 'name', 'hoten', 'ho_ten', 'họ và tên', 'họ tên'],
  },
  {
    field: 'email',
    header: 'Email*',
    required: true,
    width: 28,
    aliases: ['email', 'mail', 'thư điện tử'],
  },
  {
    field: 'phone',
    header: 'Số điện thoại',
    required: false,
    width: 16,
    isText: true,
    aliases: [
      'phone',
      'phone_number',
      'phonenumber',
      'sdt',
      'sđt',
      'so_dien_thoai',
      'số điện thoại',
    ],
  },
  {
    field: 'organizationCodes',
    header: 'Mã Đơn vị*',
    required: false,
    width: 28,
    aliases: [
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
    ],
  },
  {
    field: 'positionTitle',
    header: 'Chức danh / Vị trí',
    required: false,
    width: 24,
    aliases: [
      'chức danh',
      'chuc danh',
      'mã chức danh',
      'ma chuc danh',
      'vị trí công việc',
      'vi tri cong viec',
      'chức danh / vị trí',
      'position',
      'position_title',
    ],
  },
  {
    field: 'roleCodes',
    header: 'Vai trò',
    required: false,
    width: 20,
    aliases: ['roles', 'rolecodes', 'role_codes', 'vai_tro', 'vai trò', 'mã vai trò', 'mã chức vụ'],
  },
  {
    field: 'status',
    header: 'Trạng thái* (1: Bật, 0: Tắt)',
    required: false,
    width: 26,
    isCenter: true,
    aliases: ['status', 'trangthai', 'trang_thai', 'trạng thái'],
  },
] as const;

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

/**
 * Chuyển một dòng thô đã ánh xạ cột (`rawByField`) thành `BulkImportUserRowInput`.
 */
export function mapExtractedUserImportRow(
  rawByField: Readonly<Record<string, string>>,
): BulkImportUserRowInput | null {
  const rawEmail = cleanCellValue(rawByField['email'] ?? '');
  const rawUsername = cleanCellValue(rawByField['username'] ?? '');
  const rawEmpCode = cleanCellValue(rawByField['employeeCode'] ?? '');

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

  if (!email && !username) return null;

  const rawFirst = cleanCellValue(rawByField['firstName'] ?? '');
  const rawLast = cleanCellValue(rawByField['lastName'] ?? '');
  const rawMiddle = cleanCellValue(rawByField['middleName'] ?? '');
  const combinedLast = [rawLast, rawMiddle].filter(Boolean).join(' ').trim();

  const firstName = rawFirst || undefined;
  const lastName = combinedLast || undefined;
  const fullName =
    cleanCellValue(rawByField['fullName'] ?? '') ||
    `${combinedLast} ${rawFirst}`.trim() ||
    username;
  const phone = cleanCellValue(rawByField['phone'] ?? '') || null;
  const password = cleanCellValue(rawByField['password'] ?? '') || undefined;
  const rawStatus = cleanCellValue(rawByField['status'] ?? '');
  const status = rawStatus ? parseUserStatus(rawStatus) : USER_STATUS.ACTIVE;
  const positionTitle = cleanCellValue(rawByField['positionTitle'] ?? '') || null;

  const roleCodes = cleanCellValue(rawByField['roleCodes'] ?? '')
    .split(/[|;,]/)
    .map((s) => cleanCellValue(s))
    .filter(Boolean);

  const organizationCodes = cleanCellValue(rawByField['organizationCodes'] ?? '')
    .split(/[|;,]/)
    .map((s) => cleanCellValue(s.replace(/\*$/, '')))
    .filter(Boolean);

  return {
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
  };
}

/**
 * Giải quyết ánh xạ cột (auto-alias hoặc custom `columnMapping`) và trích xuất toàn bộ dòng dữ liệu từ ma trận.
 */
export function extractUserImportMatrixData(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  customMapping?: ImportColumnMappingInput | null,
): {
  readonly mapping: ResolvedImportColumnMappingResult;
  readonly extractedRows: readonly ExtractedImportMatrixRow[];
  readonly rows: BulkImportUserRowInput[];
} {
  const mapping = resolveImportColumnMapping(matrix, USER_IMPORT_COLUMNS, customMapping);
  if (matrix.length < 2 || mapping.headerRowIndex >= matrix.length - 1) {
    return {
      mapping,
      extractedRows: [],
      rows: [],
    };
  }

  const rawExtracted = extractMappedRowsFromMatrix(matrix, mapping);
  const extractedRows: ExtractedImportMatrixRow[] = [];
  const rows: BulkImportUserRowInput[] = [];

  for (const item of rawExtracted) {
    const mapped = mapExtractedUserImportRow(item.rawByField);
    if (!mapped) continue;
    rows.push(mapped);
    extractedRows.push({
      row: rows.length,
      sheetRowNumber: item.sheetRowNumber,
      rawByField: item.rawByField,
    });
  }

  return {
    mapping,
    extractedRows,
    rows,
  };
}

/** Chuyển đổi mảng 2 chiều (từ CSV hoặc Excel .xlsx) thành danh sách `BulkImportUserRowInput` */
export function mapMatrixToImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  customMapping?: ImportColumnMappingInput | null,
): BulkImportUserRowInput[] {
  return extractUserImportMatrixData(matrix, customMapping).rows;
}

/** Phân tích nội dung chuỗi CSV thành mảng dữ liệu đầu vào */
export function parseCsvToImportRows(
  csvContent: string,
  customMapping?: ImportColumnMappingInput | null,
): BulkImportUserRowInput[] {
  const matrix = parseCsvToMatrix(csvContent);
  if (matrix.length < 2) return [];
  return mapMatrixToImportRows(matrix, customMapping);
}
