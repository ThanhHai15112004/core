import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  buildXlsxBuffer,
  parseXlsxToMatrix,
} from '@packages/kernel/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import { USER_STATUS, parseUserStatus, resolveVietnameseNameParts } from '../contracts/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UsersService } from './users.service.js';
import {
  type BulkImportUserRowInput,
  type BulkImportUsersRequest,
  type ListUsersQuery,
  bulkImportUserRowSchema,
} from '../requests/users.requests.js';
import type {
  BulkImportUsersResultResponse,
  ExportUsersCsvResponse,
} from '../responses/users.response.js';

const DEFAULT_BULK_PASSWORD = 'Abcd@454647#';
const MAX_EXPORT_ROWS = 5_000;

@Injectable()
export class UserImportExportService {
  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
  ) {}

  /** Nhập người dùng hàng loạt từ file Excel (.xlsx base64), chuỗi CSV hoặc mảng JSON (Mục 3.1.7) */
  public async bulkImport(
    dto: BulkImportUsersRequest,
    actorId?: number,
  ): Promise<BulkImportUsersResultResponse> {
    let rawRows: BulkImportUserRowInput[];
    if (dto.xlsxBase64) {
      try {
        const matrix = parseXlsxToMatrix(dto.xlsxBase64);
        rawRows = this.mapMatrixToImportRows(matrix);
      } catch (err: unknown) {
        throw new BadRequestAppException('users.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    } else if (dto.csvContent) {
      rawRows = this.parseCsvToRows(dto.csvContent);
    } else {
      rawRows = dto.items ?? [];
    }

    const errors: Array<{ row: number; identifier: string; message: string }> = [];
    const importedUserIds: number[] = [];
    let skippedCount = 0;

    // Thu thập toàn bộ roleCodes và organizationCodes để tra cứu 1 lần (tránh N+1 query)
    const allRoleCodes = [
      ...new Set(rawRows.flatMap((r) => r.roleCodes ?? []).map((c) => c.trim().toLowerCase())),
    ];
    const allOrgCodes = [
      ...new Set(
        rawRows.flatMap((r) => r.organizationCodes ?? []).map((c) => c.trim().toUpperCase()),
      ),
    ];

    const [rolesFound, orgsFound] = await Promise.all([
      allRoleCodes.length > 0 ? this.rolesPublicService.findByCodes(allRoleCodes) : [],
      allOrgCodes.length > 0 && this.organizationsPublicService
        ? this.organizationsPublicService.findByCodes(allOrgCodes)
        : [],
    ]);

    const roleIdByCode = new Map(rolesFound.map((r) => [r.code.toLowerCase(), Number(r.id)]));
    const orgIdByCode = new Map(orgsFound.map((o) => [o.code.toUpperCase(), Number(o.id)]));

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 1;
      const raw = rawRows[i]!;
      const identifier = raw.email || raw.username || `row-${rowNumber}`;

      const parsed = bulkImportUserRowSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = parsed.error.issues.map((iss) => iss.message).join('; ');
        errors.push({ row: rowNumber, identifier, message: msg });
        continue;
      }

      const validRow = parsed.data;
      const normalizedEmail = validRow.email.trim().toLowerCase();
      const normalizedUsername = validRow.username.trim().toLowerCase();

      const [existingEmail, existingUsername] = await Promise.all([
        this.userRepository.findByEmail(normalizedEmail, true),
        this.userRepository.findByUsername(normalizedUsername, true),
      ]);

      if (existingEmail || existingUsername) {
        if (dto.skipDuplicates) {
          skippedCount++;
          continue;
        }
        errors.push({
          row: rowNumber,
          identifier,
          message: existingEmail
            ? `Duplicate email: ${normalizedEmail}`
            : `Duplicate username: ${normalizedUsername}`,
        });
        continue;
      }

      const roleIds = (validRow.roleCodes ?? [])
        .map((code) => roleIdByCode.get(code.trim().toLowerCase()))
        .filter((id): id is number => typeof id === 'number');

      const organizationUnits = (validRow.organizationCodes ?? [])
        .map((code) => orgIdByCode.get(code.trim().toUpperCase()))
        .filter((id): id is number => typeof id === 'number')
        .map((organizationUnitId, idx) => ({
          organizationUnitId,
          isPrimary: idx === 0,
          positionTitle: null,
        }));

      const nameParts = resolveVietnameseNameParts({
        firstName: validRow.firstName,
        lastName: validRow.lastName,
        fullName: validRow.fullName,
      });

      try {
        const created = await this.usersService.create(
          {
            username: normalizedUsername,
            email: normalizedEmail,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            fullName: nameParts.fullName,
            phone: validRow.phone ?? null,
            password: validRow.password || dto.defaultPassword || DEFAULT_BULK_PASSWORD,
            status: validRow.status ?? USER_STATUS.ACTIVE,
            roleIds,
            organizationUnits,
          },
          actorId,
        );
        importedUserIds.push(Number(created.id));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to import user row';
        errors.push({ row: rowNumber, identifier, message });
      }
    }

    return {
      totalRows: rawRows.length,
      importedCount: importedUserIds.length,
      skippedCount,
      failedCount: errors.length,
      importedUserIds,
      errors,
    };
  }

  /** Xuất danh sách người dùng ra định dạng CSV hoặc Excel (.xlsx) theo bộ lọc hiện hành (Mục 3.1.8) */
  public async exportUsersCsv(query: ListUsersQuery): Promise<ExportUsersCsvResponse> {
    const format: 'csv' | 'xlsx' = query.format === 'xlsx' ? 'xlsx' : 'csv';
    const { items } = await this.userRepository.searchPaginated({
      ...query,
      page: 1,
      limit: Math.min(query.limit ?? MAX_EXPORT_ROWS, MAX_EXPORT_ROWS),
    });

    const hydrated = await this.usersService.hydrateUsersList(items);

    const headers = [
      'id',
      'username',
      'email',
      'lastName',
      'firstName',
      'fullName',
      'phone',
      'status',
      'statusName',
      'mfaEnabled',
      'roles',
      'organizationUnits',
      'lastLoginAt',
      'createdAt',
    ];

    const lines: string[] = [headers.join(',')];
    const matrixRows: Array<Array<string | number>> = [];

    for (const user of hydrated) {
      const rolesStr = user.roles.map((r) => r.code).join('|');
      const orgsStr = user.organizationUnits
        .map((o) => `${o.code ?? o.organizationUnitId}${o.isPrimary ? '*' : ''}`)
        .join('|');

      const rowValues: Array<string | number> = [
        user.id,
        user.username,
        user.email,
        user.lastName,
        user.firstName,
        user.fullName,
        user.phone ?? '',
        user.status,
        user.statusName,
        user.mfaEnabled ? 'true' : 'false',
        rolesStr,
        orgsStr,
        user.lastLoginAt ?? '',
        user.createdAt,
      ];
      matrixRows.push(rowValues);
      lines.push(rowValues.map((v) => this.escapeCsvCell(v)).join(','));
    }

    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    const xlsxBuffer = buildXlsxBuffer(headers, matrixRows, 'Users');
    const xlsxBase64 = xlsxBuffer.toString('base64');
    const datePart = new Date().toISOString().slice(0, 10);

    return {
      fileName: `users-export-${datePart}.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      totalExported: hydrated.length,
      csvContent,
      xlsxBase64,
    };
  }

  /** Xuất file mẫu (Template) Excel (.xlsx) & CSV phục vụ nhập người dùng hàng loạt (Mục 3.1.7) */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportUsersCsvResponse {
    const headers = [
      'username',
      'email',
      'lastName',
      'firstName',
      'fullName',
      'phone',
      'status',
      'roles',
      'organizations',
    ];
    const sampleRows: Array<Array<string | number>> = [
      [
        'an.nguyen',
        'an.nguyen@gmail.com',
        'Nguyễn Văn',
        'An',
        'Nguyễn Văn An',
        '0901234567',
        1,
        'staff',
        'BRANCH_HCM|DEPT_ENGINEERING',
      ],
      [
        'binh.tran',
        'binh.tran@gmail.com',
        'Trần Thị',
        'Bình',
        'Trần Thị Bình',
        '0902345678',
        1,
        'department_manager',
        'BRANCH_HCM|DEPT_HR',
      ],
    ];

    const lines: string[] = [
      headers.join(','),
      ...sampleRows.map((row) => row.map((v) => this.escapeCsvCell(v)).join(',')),
    ];
    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    const xlsxBase64 = buildXlsxBuffer(headers, sampleRows, 'UsersImportTemplate').toString(
      'base64',
    );

    return {
      fileName: `users-import-template.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      totalExported: sampleRows.length,
      csvContent,
      xlsxBase64,
    };
  }

  /** Phân tích nội dung chuỗi CSV thành mảng dữ liệu đầu vào */
  private parseCsvToRows(csvContent: string): BulkImportUserRowInput[] {
    const normalized = csvContent.replace(/^\uFEFF/, '').trim();
    if (!normalized) return [];

    const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const matrix = lines.map((line) => this.parseCsvLine(line));
    return this.mapMatrixToImportRows(matrix);
  }

  /** Chuyển đổi mảng 2 chiều (từ CSV hoặc Excel .xlsx) thành danh sách `BulkImportUserRowInput` */
  private mapMatrixToImportRows(
    matrix: ReadonlyArray<ReadonlyArray<string>>,
  ): BulkImportUserRowInput[] {
    if (matrix.length < 2) return [];

    const headerCells = matrix[0]!.map((h) => h.trim().toLowerCase());
    const idxOf = (names: string[]): number => {
      for (const name of names) {
        const idx = headerCells.indexOf(name.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const usernameIdx = idxOf(['username', 'user_name', 'account', 'tai_khoan']);
    const emailIdx = idxOf(['email', 'mail']);
    const firstNameIdx = idxOf(['firstname', 'first_name', 'ten']);
    const lastNameIdx = idxOf(['lastname', 'last_name', 'ho', 'ho_dem']);
    const fullNameIdx = idxOf(['fullname', 'full_name', 'name', 'hoten', 'ho_ten']);
    const phoneIdx = idxOf(['phone', 'phone_number', 'sdt', 'so_dien_thoai']);
    const passwordIdx = idxOf(['password', 'pass', 'mat_khau']);
    const statusIdx = idxOf(['status', 'trangthai', 'trang_thai']);
    const rolesIdx = idxOf(['roles', 'rolecodes', 'role_codes', 'vai_tro']);
    const orgsIdx = idxOf([
      'organizations',
      'organizationcodes',
      'organization_codes',
      'organizationunits',
      'branches',
      'don_vi',
    ]);

    const rows: BulkImportUserRowInput[] = [];
    for (let i = 1; i < matrix.length; i++) {
      const cells = matrix[i]!;
      const getCell = (idx: number): string => (idx >= 0 ? (cells[idx] ?? '').trim() : '');

      const email = getCell(emailIdx);
      const username = getCell(usernameIdx) || (email.includes('@') ? email.split('@')[0]! : '');
      if (!email && !username) continue;

      const firstName = getCell(firstNameIdx) || undefined;
      const lastName = getCell(lastNameIdx) || undefined;
      const fullName =
        getCell(fullNameIdx) || `${lastName ?? ''} ${firstName ?? ''}`.trim() || username;
      const phone = getCell(phoneIdx) || null;
      const password = getCell(passwordIdx) || undefined;
      const rawStatus = getCell(statusIdx);
      const status = rawStatus ? parseUserStatus(rawStatus) : USER_STATUS.ACTIVE;

      const roleCodes = getCell(rolesIdx)
        .split(/[|;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const organizationCodes = getCell(orgsIdx)
        .split(/[|;,]/)
        .map((s) => s.replace(/\*$/, '').trim())
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
        roleCodes,
        organizationCodes,
      });
    }

    return rows;
  }

  /** Phân tích một dòng CSV có hỗ trợ dấu ngoặc kép */
  private parseCsvLine(line: string): string[] {
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

  /** Thoát chuỗi an toàn khi ghi ra ô CSV */
  private escapeCsvCell(value: unknown): string {
    const str = String(value ?? '');
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
