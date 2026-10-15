import { Inject, Injectable } from '@nestjs/common';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import type { UserStatus } from '../contracts/index.js';
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

const DEFAULT_BULK_PASSWORD = 'ChangeMe@123';
const MAX_EXPORT_ROWS = 5_000;

@Injectable()
export class UserImportExportService {
  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService,
  ) {}

  /** Nhập người dùng hàng loạt từ chuỗi CSV hoặc mảng đối tượng JSON (Mục 3.1.7) */
  public async bulkImport(
    dto: BulkImportUsersRequest,
    actorId?: string,
  ): Promise<BulkImportUsersResultResponse> {
    const rawRows: BulkImportUserRowInput[] = dto.csvContent
      ? this.parseCsvToRows(dto.csvContent)
      : (dto.items ?? []);

    const errors: Array<{ row: number; identifier: string; message: string }> = [];
    const importedUserIds: string[] = [];
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
      allOrgCodes.length > 0 ? this.organizationsPublicService.findByCodes(allOrgCodes) : [],
    ]);

    const roleIdByCode = new Map(rolesFound.map((r) => [r.code.toLowerCase(), r.id]));
    const orgIdByCode = new Map(orgsFound.map((o) => [o.code.toUpperCase(), o.id]));

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
        .filter((id): id is string => Boolean(id));

      const organizationUnits = (validRow.organizationCodes ?? [])
        .map((code) => orgIdByCode.get(code.trim().toUpperCase()))
        .filter((id): id is string => Boolean(id))
        .map((organizationUnitId, idx) => ({
          organizationUnitId,
          isPrimary: idx === 0,
          positionTitle: null,
        }));

      try {
        const created = await this.usersService.create(
          {
            username: normalizedUsername,
            email: normalizedEmail,
            fullName: validRow.fullName.trim(),
            phone: validRow.phone ?? null,
            password: validRow.password || dto.defaultPassword || DEFAULT_BULK_PASSWORD,
            status: validRow.status ?? 'ACTIVE',
            roleIds,
            organizationUnits,
          },
          actorId,
        );
        importedUserIds.push(created.id);
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

  /** Xuất danh sách người dùng ra định dạng CSV theo bộ lọc hiện hành (Mục 3.1.8) */
  public async exportUsersCsv(query: ListUsersQuery): Promise<ExportUsersCsvResponse> {
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
      'fullName',
      'phone',
      'status',
      'mfaEnabled',
      'roles',
      'organizationUnits',
      'lastLoginAt',
      'createdAt',
    ];

    const lines: string[] = [headers.join(',')];
    for (const user of hydrated) {
      const rolesStr = user.roles.map((r) => r.code).join('|');
      const orgsStr = user.organizationUnits
        .map((o) => `${o.code ?? o.organizationUnitId}${o.isPrimary ? '*' : ''}`)
        .join('|');

      const rowValues = [
        user.id,
        user.username,
        user.email,
        user.fullName,
        user.phone ?? '',
        user.status,
        user.mfaEnabled ? 'true' : 'false',
        rolesStr,
        orgsStr,
        user.lastLoginAt ?? '',
        user.createdAt,
      ];
      lines.push(rowValues.map((v) => this.escapeCsvCell(v)).join(','));
    }

    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    const datePart = new Date().toISOString().slice(0, 10);

    return {
      fileName: `users-export-${datePart}.csv`,
      contentType: 'text/csv; charset=utf-8',
      totalExported: hydrated.length,
      csvContent,
    };
  }

  /** Phân tích nội dung chuỗi CSV thành mảng dữ liệu đầu vào */
  private parseCsvToRows(csvContent: string): BulkImportUserRowInput[] {
    const normalized = csvContent.replace(/^\uFEFF/, '').trim();
    if (!normalized) return [];

    const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headerCells = this.parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
    const idxOf = (names: string[]): number => {
      for (const name of names) {
        const idx = headerCells.indexOf(name.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const usernameIdx = idxOf(['username', 'user_name', 'account']);
    const emailIdx = idxOf(['email', 'mail']);
    const fullNameIdx = idxOf(['fullname', 'full_name', 'name', 'hoten']);
    const phoneIdx = idxOf(['phone', 'phone_number', 'sdt']);
    const passwordIdx = idxOf(['password', 'pass']);
    const statusIdx = idxOf(['status', 'trangthai']);
    const rolesIdx = idxOf(['roles', 'rolecodes', 'role_codes']);
    const orgsIdx = idxOf(['organizations', 'organizationcodes', 'organization_codes', 'branches']);

    const rows: BulkImportUserRowInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = this.parseCsvLine(lines[i]!);
      const getCell = (idx: number): string => (idx >= 0 ? (cells[idx] ?? '').trim() : '');

      const email = getCell(emailIdx);
      const username = getCell(usernameIdx) || (email.includes('@') ? email.split('@')[0]! : '');
      const fullName = getCell(fullNameIdx) || username;
      const phone = getCell(phoneIdx) || null;
      const password = getCell(passwordIdx) || undefined;
      const rawStatus = getCell(statusIdx).toUpperCase();
      const status: UserStatus =
        rawStatus === 'INACTIVE' || rawStatus === 'LOCKED' ? rawStatus : 'ACTIVE';

      const roleCodes = getCell(rolesIdx)
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const organizationCodes = getCell(orgsIdx)
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean);

      rows.push({
        username,
        email,
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

  /** Tách một dòng CSV có hỗ trợ giá trị nằm trong dấu ngoặc kép */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  /** Chuẩn hóa giá trị ô CSV chống lỗi dấu phẩy, xuống dòng và CSV Formula Injection */
  private escapeCsvCell(value: string): string {
    const safeVal = /^[=+\-@]/.test(value) ? `'${value}` : value;
    if (/[",\r\n]/.test(safeVal)) {
      return `"${safeVal.replace(/"/g, '""')}"`;
    }
    return safeVal;
  }
}
