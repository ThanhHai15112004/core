import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseXlsxToMatrix,
} from '@packages/kernel/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import { USER_STATUS, resolveVietnameseNameParts } from '../contracts/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UsersService } from '../services/users.service.js';
import {
  type BulkImportUserRowInput,
  type BulkImportUsersRequest,
  bulkImportUserRowSchema,
} from '../requests/users.requests.js';
import type { BulkImportUsersResultResponse } from '../responses/users.response.js';
import { mapMatrixToImportRows, parseCsvToImportRows } from './user-import.parser.js';

const DEFAULT_BULK_PASSWORD = 'Abcd@454647#';

@Injectable()
export class UserImportService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  /** Nhập người dùng hàng loạt từ file Excel (.xlsx base64), chuỗi CSV hoặc mảng JSON (Mục 3.1.7) */
  public async bulkImport(
    dto: BulkImportUsersRequest,
    actorId?: number,
  ): Promise<BulkImportUsersResultResponse> {
    let rawRows: BulkImportUserRowInput[];
    if (dto.xlsxBase64) {
      try {
        const matrix = parseXlsxToMatrix(dto.xlsxBase64);
        rawRows = mapMatrixToImportRows(matrix);
      } catch (err: unknown) {
        throw new BadRequestAppException('users.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    } else if (dto.csvContent) {
      rawRows = parseCsvToImportRows(dto.csvContent);
    } else {
      rawRows = dto.items ?? [];
    }

    const errors: Array<{ row: number; identifier: string; message: string }> = [];
    const importedUserIds: number[] = [];
    let skippedCount = 0;

    // Thu thập toàn bộ roleCodes và organizationCodes để tra cứu 1 lần (tránh N+1 query)
    const allRoleTokens = [
      ...new Set(rawRows.flatMap((r) => r.roleCodes ?? []).map((c) => c.trim().toLowerCase())),
    ];
    const allOrgTokens = [
      ...new Set(
        rawRows.flatMap((r) => r.organizationCodes ?? []).map((c) => c.trim().toUpperCase()),
      ),
    ];

    const [rolesFound, orgsFound] = await Promise.all([
      allRoleTokens.length > 0 ? this.rolesPublicService.findByCodes(allRoleTokens) : [],
      allOrgTokens.length > 0 && this.organizationsPublicService
        ? this.organizationsPublicService.findByCodes(allOrgTokens)
        : [],
    ]);

    const roleIdByKey = new Map<string, number>();
    for (const r of rolesFound) {
      roleIdByKey.set(r.code.toLowerCase(), Number(r.id));
      roleIdByKey.set(r.name.toLowerCase(), Number(r.id));
    }

    const orgIdByKey = new Map<string, number>();
    for (const o of orgsFound) {
      orgIdByKey.set(o.code.toUpperCase(), Number(o.id));
      orgIdByKey.set(o.name.toUpperCase(), Number(o.id));
    }

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

      const roleIds = [
        ...new Set(
          (validRow.roleCodes ?? [])
            .map((code) => roleIdByKey.get(code.trim().toLowerCase()))
            .filter((id): id is number => typeof id === 'number'),
        ),
      ];

      const matchedOrgIds = [
        ...new Set(
          (validRow.organizationCodes ?? [])
            .map((code) => orgIdByKey.get(code.trim().toUpperCase()))
            .filter((id): id is number => typeof id === 'number'),
        ),
      ];

      const organizationUnits = matchedOrgIds.map((organizationUnitId, idx) => ({
        organizationUnitId,
        isPrimary: idx === 0,
        positionTitle: idx === 0 ? (validRow.positionTitle ?? null) : null,
      }));

      const nameParts = resolveVietnameseNameParts({
        firstName: validRow.firstName,
        lastName: validRow.lastName,
        fullName: validRow.fullName,
      });

      const fallbackPassword =
        this.settingRegistry.getString(
          'users.import.default_password',
          matchedOrgIds[0] ? { organizationUnitId: matchedOrgIds[0] } : undefined,
          DEFAULT_BULK_PASSWORD,
        ) || DEFAULT_BULK_PASSWORD;

      try {
        const created = await this.usersService.create(
          {
            username: normalizedUsername,
            email: normalizedEmail,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            fullName: nameParts.fullName,
            phone: validRow.phone ?? null,
            password: validRow.password || dto.defaultPassword || fallbackPassword,
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
}
