import { USER_STATUS, parseUserStatus } from '../contracts/index.js';
import type { BulkImportUserRowInput } from '../requests/users.requests.js';

/** Chuẩn hóa nhãn tiêu đề cột Excel/CSV (bỏ dấu *, bỏ chú thích trong ngoặc, bỏ xuống dòng) */
function normalizeHeaderLabel(raw: string): string {
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Kiểm tra xem giá trị ô có thực sự có nội dung (bỏ qua ô trống hoặc dấu gạch ngang '—') */
function cleanCellValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') {
    return '';
  }
  return trimmed;
}

/** Phân tích một dòng CSV có hỗ trợ dấu ngoặc kép */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Tự động dò tìm dòng Header trong ma trận Excel/CSV
 * (Hỗ trợ cả file có dòng Tiêu đề lớn + Ngày xuất dữ liệu + Logo ở dòng 1-2 như `danh_sach_nhan_vien.xlsx`
 * lẫn file mẫu Import có Header ngay tại dòng 1).
 */
export function detectHeaderRowIndex(matrix: ReadonlyArray<ReadonlyArray<string>>): number {
  const knownHeaders = new Set([
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
  ]);

  const maxScan = Math.min(matrix.length, 10);
  let bestRowIdx = 0;
  let bestMatchCount = 0;

  for (let r = 0; r < maxScan; r++) {
    const row = matrix[r] ?? [];
    let matches = 0;
    for (const cell of row) {
      const norm = normalizeHeaderLabel(cell);
      if (knownHeaders.has(norm)) {
        matches++;
      }
    }
    if (matches > bestMatchCount) {
      bestMatchCount = matches;
      bestRowIdx = r;
    }
  }

  return bestRowIdx;
}

/** Chuyển đổi mảng 2 chiều (từ CSV hoặc Excel .xlsx) thành danh sách `BulkImportUserRowInput` */
export function mapMatrixToImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
): BulkImportUserRowInput[] {
  if (matrix.length < 2) return [];

  const headerRowIdx = detectHeaderRowIndex(matrix);
  if (headerRowIdx >= matrix.length - 1) return [];

  const headerCells = matrix[headerRowIdx]!.map((h) => normalizeHeaderLabel(h));
  const idxOf = (names: readonly string[]): number => {
    for (const name of names) {
      const target = normalizeHeaderLabel(name);
      const idx = headerCells.indexOf(target);
      if (idx >= 0) return idx;
    }
    return -1;
  };

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
  const normalized = csvContent.replace(/^\uFEFF/, '').trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const matrix = lines.map((line) => parseCsvLine(line));
  return mapMatrixToImportRows(matrix);
}
