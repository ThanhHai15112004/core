import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ImportRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  buildImportPreviewResult,
  defaultImportRegistry,
  defaultSettingRegistry,
  parseCsvToMatrix,
  parseXlsxToMatrix,
  resolveImportDuplicateStrategy,
  validateImportRowsAndCells,
  type ExistingDuplicateMatch,
  type ImportCellIssue,
  type ImportDuplicateStrategy,
  type ImportHistoryRecord,
  type ImportPreviewResult,
  type ImportProgressSnapshot,
} from '@packages/kernel/index.js';
import {
  BaseMessagePublisherProvider,
  JOB_PRIORITIES,
  QUEUES,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
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
  type ListUserImportHistoriesQuery,
  type PreviewImportUsersRequest,
  bulkImportUserRowSchema,
} from '../requests/users.requests.js';
import type {
  BulkImportUsersErrorItem,
  BulkImportUsersResultResponse,
} from '../responses/users.response.js';
import {
  USER_IMPORT_COLUMNS,
  extractUserImportMatrixData,
  mapMatrixToImportRows,
  parseCsvToImportRows,
} from './user-import.parser.js';

const DEFAULT_BULK_PASSWORD = 'Abcd@454647#';
const USERS_IMPORT_PROFILE_CODE = 'users';

@Injectable()
export class UserImportService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly importRegistry: ImportRegistryService;

  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesPublicService: IRolesPublicService,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional()
    private readonly messagePublisher?: BaseMessagePublisherProvider | null,
    @Optional() importRegistry?: ImportRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.importRegistry = importRegistry ?? defaultImportRegistry;
    this.registerUsersImportProfile();
  }

  /** Đăng ký profile Import người dùng vào `ImportRegistryService` dùng chung (Mục 8.2) */
  private registerUsersImportProfile(): void {
    this.importRegistry.registerProfile<BulkImportUserRowInput>({
      profileCode: USERS_IMPORT_PROFILE_CODE,
      module: 'users',
      columns: USER_IMPORT_COLUMNS,
      rowSchema: bulkImportUserRowSchema,
      uniqueKeyFields: ['email', 'username'],
      findExistingDuplicates: (rows) => this.findExistingUserDuplicates(rows),
    });
  }

  /** Kiểm tra trùng lặp email/username trong DB cho tập dòng hợp lệ */
  private async findExistingUserDuplicates(
    rows: ReadonlyArray<{ readonly row: number; readonly data: BulkImportUserRowInput }>,
  ): Promise<ReadonlyMap<number, ExistingDuplicateMatch>> {
    const matches = new Map<number, ExistingDuplicateMatch>();
    for (const item of rows) {
      const normalizedEmail = item.data.email.trim().toLowerCase();
      const normalizedUsername = item.data.username.trim().toLowerCase();
      const [existingEmail, existingUsername] = await Promise.all([
        this.userRepository.findByEmail(normalizedEmail, true),
        this.userRepository.findByUsername(normalizedUsername, true),
      ]);
      if (existingEmail) {
        matches.set(item.row, {
          existingId: Number(existingEmail.id),
          matchedField: 'email',
          matchedValue: normalizedEmail,
        });
      } else if (existingUsername) {
        matches.set(item.row, {
          existingId: Number(existingUsername.id),
          matchedField: 'username',
          matchedValue: normalizedUsername,
        });
      }
    }
    return matches;
  }

  /** Giải mã dữ liệu đầu vào (.xlsx base64, CSV hoặc mảng JSON) thành danh sách dòng import */
  public parseImportRows(dto: BulkImportUsersRequest): BulkImportUserRowInput[] {
    if (dto.xlsxBase64) {
      try {
        const matrix = parseXlsxToMatrix(dto.xlsxBase64);
        return mapMatrixToImportRows(matrix, dto.columnMapping);
      } catch (err: unknown) {
        throw new BadRequestAppException('users.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    }
    if (dto.csvContent) {
      return parseCsvToImportRows(dto.csvContent, dto.columnMapping);
    }
    return dto.items ?? [];
  }

  /** Phân tích dữ liệu kèm thông tin ánh xạ cột (`mapping`) và toạ độ dòng/ô (`extractedRows`) */
  private parseImportDataWithMatrixContext(dto: BulkImportUsersRequest) {
    if (dto.xlsxBase64) {
      try {
        const matrix = parseXlsxToMatrix(dto.xlsxBase64);
        return {
          format: 'xlsx' as const,
          ...extractUserImportMatrixData(matrix, dto.columnMapping),
        };
      } catch (err: unknown) {
        throw new BadRequestAppException('users.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    }
    if (dto.csvContent) {
      const matrix = parseCsvToMatrix(dto.csvContent);
      return {
        format: 'csv' as const,
        ...extractUserImportMatrixData(matrix, dto.columnMapping),
      };
    }

    const items = dto.items ?? [];
    const headerRow = USER_IMPORT_COLUMNS.map((c) => c.header);
    const syntheticMatrix: string[][] = [headerRow];
    const extractedRows = items.map((item, idx) => ({
      row: idx + 1,
      sheetRowNumber: idx + 2,
      rawByField: {
        username: item.username ?? '',
        email: item.email ?? '',
        firstName: item.firstName ?? '',
        lastName: item.lastName ?? '',
        fullName: item.fullName ?? '',
        phone: item.phone ?? '',
        password: item.password ?? '',
        status: String(item.status ?? USER_STATUS.ACTIVE),
        positionTitle: item.positionTitle ?? '',
        roleCodes: (item.roleCodes ?? []).join('|'),
        organizationCodes: (item.organizationCodes ?? []).join('|'),
      },
    }));
    const { mapping } = extractUserImportMatrixData(syntheticMatrix, dto.columnMapping);
    return {
      format: 'json' as const,
      mapping,
      extractedRows,
      rows: items,
    };
  }

  /**
   * 8.2.3, 8.2.4, 8.2.5 — Xem trước dữ liệu trước khi nhập (Preview / Dry-run):
   * Hiển thị bảng ánh xạ cột, các dòng mẫu, lỗi chi tiết theo từng dòng/cột và số dòng sẽ Tạo mới / Cập nhật / Bỏ qua / Từ chối.
   */
  public async previewImport(
    dto: PreviewImportUsersRequest,
  ): Promise<ImportPreviewResult<BulkImportUserRowInput>> {
    const duplicateStrategy = resolveImportDuplicateStrategy(
      dto.duplicateStrategy,
      dto.skipDuplicates,
    );
    const { mapping, extractedRows, rows } = this.parseImportDataWithMatrixContext(dto);
    const { validRows, issues } = validateImportRowsAndCells(
      rows,
      extractedRows,
      mapping,
      bulkImportUserRowSchema,
      ['email', 'username'],
    );
    const existingDuplicates = await this.findExistingUserDuplicates(validRows);

    return buildImportPreviewResult({
      profileCode: USERS_IMPORT_PROFILE_CODE,
      mapping,
      extractedRows,
      validRows,
      validationIssues: issues,
      existingDuplicates,
      duplicateStrategy,
      ...(dto.previewLimit !== undefined ? { previewLimit: dto.previewLimit } : {}),
    });
  }

  /** Đẩy công việc Import người dùng hàng loạt vào hàng đợi `system.heavy` để Worker xử lý theo lô */
  public async enqueueBulkImport(
    dto: BulkImportUsersRequest,
    actorId?: number,
    existingHistoryId?: number,
  ): Promise<MessageEnvelope<{
    readonly operation: 'import';
    readonly executeInWorker: true;
    readonly totalItems: number;
    readonly items: readonly BulkImportUserRowInput[];
    readonly defaultPassword?: string | undefined;
    readonly skipDuplicates?: boolean | undefined;
    readonly duplicateStrategy?: ImportDuplicateStrategy | undefined;
    readonly columnMapping?: Readonly<Record<string, string | number | null>> | undefined;
    readonly fileName?: string | undefined;
    readonly historyId?: number | undefined;
    readonly actorId?: number | undefined;
  }> | null> {
    if (!this.messagePublisher) return null;
    const { format, rows: rawRows } = this.parseImportDataWithMatrixContext(dto);
    const duplicateStrategy = resolveImportDuplicateStrategy(
      dto.duplicateStrategy,
      dto.skipDuplicates,
    );
    const historyRecord =
      existingHistoryId !== undefined
        ? this.importRegistry.getHistoryById(existingHistoryId)
        : this.importRegistry.startImportHistory({
            profileCode: USERS_IMPORT_PROFILE_CODE,
            module: 'users',
            fileName: dto.fileName ?? `users_import_${Date.now()}.${format}`,
            format,
            duplicateStrategy,
            actorId: actorId ?? null,
            totalRows: rawRows.length,
            status: 'QUEUED',
            columnMapping: dto.columnMapping ?? null,
          });

    const envelope = await this.messagePublisher.publish(
      'users.import',
      {
        operation: 'import' as const,
        executeInWorker: true as const,
        totalItems: rawRows.length,
        items: rawRows,
        ...(dto.defaultPassword !== undefined ? { defaultPassword: dto.defaultPassword } : {}),
        ...(dto.skipDuplicates !== undefined ? { skipDuplicates: dto.skipDuplicates } : {}),
        duplicateStrategy,
        ...(dto.columnMapping !== undefined ? { columnMapping: dto.columnMapping } : {}),
        ...(dto.fileName !== undefined ? { fileName: dto.fileName } : {}),
        ...(historyRecord ? { historyId: historyRecord.id } : {}),
        ...(actorId !== undefined ? { actorId } : {}),
      },
      QUEUES.SYSTEM_HEAVY,
      {
        priority: JOB_PRIORITIES.LOW,
        index: {
          operation: 'import',
          totalRows: rawRows.length,
          duplicateStrategy,
          ...(historyRecord ? { historyId: historyRecord.id } : {}),
          ...(actorId !== undefined ? { actorId } : {}),
        },
      },
    );

    if (historyRecord && envelope?.id) {
      this.importRegistry.updateImportHistory(historyRecord.id, {
        jobId: envelope.id,
        status: 'QUEUED',
      });
    }

    return envelope;
  }

  /**
   * Nhập người dùng hàng loạt từ file Excel (.xlsx base64), chuỗi CSV hoặc mảng JSON (Mục 3.1.7 & 8.2).
   * Hỗ trợ đầy đủ:
   * - Ánh xạ cột động (`columnMapping`)
   * - Kiểm tra lỗi theo từng dòng và cột (`row`, `sheetRowNumber`, `column`, `columnLetter`, `field`, `code`, `value`, `message`)
   * - Xử lý trùng lặp theo 3 chiến lược: `SKIP` (bỏ qua), `UPDATE` (cập nhật), `REJECT` (từ chối)
   * - Chạy nền qua Queue (`async: true`) + theo dõi tiến độ & lưu lịch sử Import
   */
  public async bulkImport(
    dto: BulkImportUsersRequest,
    actorId?: number,
    options?: { readonly skipQueuePublish?: boolean; readonly skipHistoryRecord?: boolean },
  ): Promise<BulkImportUsersResultResponse> {
    const duplicateStrategy = resolveImportDuplicateStrategy(
      dto.duplicateStrategy,
      dto.skipDuplicates,
    );
    const {
      format,
      mapping,
      extractedRows,
      rows: rawRows,
    } = this.parseImportDataWithMatrixContext(dto);

    // 8.2.7 — Nếu yêu cầu chạy bất đồng bộ qua Queue (`async: true`), đẩy vào `system.heavy` và trả về ngay không treo request
    if (dto.async === true && !options?.skipQueuePublish && this.messagePublisher) {
      const history = this.importRegistry.startImportHistory({
        profileCode: USERS_IMPORT_PROFILE_CODE,
        module: 'users',
        fileName: dto.fileName ?? `users_import_${Date.now()}.${format}`,
        format,
        duplicateStrategy,
        actorId: actorId ?? null,
        totalRows: rawRows.length,
        status: 'QUEUED',
        columnMapping: dto.columnMapping ?? null,
      });
      const envelope = await this.enqueueBulkImport(dto, actorId, history.id);
      return {
        totalRows: rawRows.length,
        importedCount: 0,
        updatedCount: 0,
        successCount: 0,
        skippedCount: 0,
        failedCount: 0,
        remainingCount: rawRows.length,
        duplicateStrategy,
        historyId: history.id,
        jobId: envelope?.id ?? null,
        status: 'QUEUED',
        importedUserIds: [],
        updatedUserIds: [],
        errors: [],
      };
    }

    const historyRecord = !options?.skipHistoryRecord
      ? this.importRegistry.startImportHistory({
          profileCode: USERS_IMPORT_PROFILE_CODE,
          module: 'users',
          fileName: dto.fileName ?? `users_import_${Date.now()}.${format}`,
          format,
          duplicateStrategy,
          actorId: actorId ?? null,
          totalRows: rawRows.length,
          status: 'PROCESSING',
          columnMapping: dto.columnMapping ?? null,
        })
      : null;

    const errors: BulkImportUsersErrorItem[] = [];
    const historyIssues: ImportCellIssue[] = [];
    const importedUserIds: number[] = [];
    const updatedUserIds: number[] = [];
    let skippedCount = 0;

    // 8.2.5 — Kiểm tra lỗi chi tiết theo từng dòng và cột + phát hiện trùng ngay trong file
    const { validRows, issues: cellValidationIssues } = validateImportRowsAndCells(
      rawRows,
      extractedRows,
      mapping,
      bulkImportUserRowSchema,
      ['email', 'username'],
    );

    const issuesByRow = new Map<number, ImportCellIssue[]>();
    for (const iss of cellValidationIssues) {
      const list = issuesByRow.get(iss.row) ?? [];
      list.push(iss);
      issuesByRow.set(iss.row, list);
      historyIssues.push(iss);
    }

    for (const [rowNumber, rowIssues] of issuesByRow.entries()) {
      const raw = rawRows[rowNumber - 1];
      const identifier = raw?.email || raw?.username || `row-${rowNumber}`;
      const firstIssue = rowIssues[0]!;
      errors.push({
        row: rowNumber,
        sheetRowNumber: firstIssue.sheetRowNumber,
        identifier,
        field: firstIssue.field,
        column: firstIssue.column,
        columnLetter: firstIssue.columnLetter,
        code: firstIssue.code,
        value: firstIssue.value,
        message: rowIssues.map((iss) => iss.message).join('; '),
      });
    }

    // Thu thập toàn bộ roleCodes và organizationCodes để tra cứu 1 lần (tránh N+1 query)
    const allRoleTokens = [
      ...new Set(
        validRows.flatMap((r) => r.data.roleCodes ?? []).map((c) => c.trim().toLowerCase()),
      ),
    ];
    const allOrgTokens = [
      ...new Set(
        validRows.flatMap((r) => r.data.organizationCodes ?? []).map((c) => c.trim().toUpperCase()),
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

    const matchByField = new Map(mapping.matches.map((m) => [m.field, m]));

    for (const validItem of validRows) {
      const rowNumber = validItem.row;
      const sheetRowNumber = validItem.sheetRowNumber;
      const validRow = validItem.data;
      const identifier = validRow.email || validRow.username || `row-${rowNumber}`;
      const normalizedEmail = validRow.email.trim().toLowerCase();
      const normalizedUsername = validRow.username.trim().toLowerCase();

      const [existingEmail, existingUsername] = await Promise.all([
        this.userRepository.findByEmail(normalizedEmail, true),
        this.userRepository.findByUsername(normalizedUsername, true),
      ]);

      const existingUser = existingEmail ?? existingUsername;

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

      // 8.2.6 — Xử lý dữ liệu trùng theo 3 chiến lược: SKIP | UPDATE | REJECT
      if (existingUser) {
        if (duplicateStrategy === 'SKIP') {
          skippedCount++;
          continue;
        }

        if (duplicateStrategy === 'UPDATE') {
          try {
            const targetUserId = Number(existingUser.id);
            await this.usersService.update(
              targetUserId,
              {
                firstName: nameParts.firstName,
                lastName: nameParts.lastName,
                fullName: nameParts.fullName,
                ...(validRow.phone !== undefined ? { phone: validRow.phone } : {}),
              },
              actorId,
            );
            if (roleIds.length > 0) {
              await this.usersService.assignRoles(targetUserId, { roleIds }, actorId);
            }
            if (organizationUnits.length > 0) {
              await this.usersService.assignOrganizations(
                targetUserId,
                { organizationUnits },
                actorId,
              );
            }
            updatedUserIds.push(targetUserId);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update existing user';
            const issue: ImportCellIssue = {
              row: rowNumber,
              sheetRowNumber,
              column: null,
              columnLetter: null,
              field: existingEmail ? 'email' : 'username',
              code: 'UPDATE_FAILED',
              value: identifier,
              message,
            };
            historyIssues.push(issue);
            errors.push({
              row: rowNumber,
              sheetRowNumber,
              identifier,
              field: issue.field,
              column: null,
              columnLetter: null,
              code: 'UPDATE_FAILED',
              value: identifier,
              message,
            });
          }
          continue;
        }

        // duplicateStrategy === 'REJECT'
        const dupField = existingEmail ? 'email' : 'username';
        const colMatch = matchByField.get(dupField);
        const dupMessage = existingEmail
          ? `Duplicate email: ${normalizedEmail}`
          : `Duplicate username: ${normalizedUsername}`;
        const dupIssue: ImportCellIssue = {
          row: rowNumber,
          sheetRowNumber,
          column: colMatch?.matchedHeader ?? colMatch?.header ?? dupField,
          columnLetter: colMatch?.matchedColumnLetter ?? null,
          field: dupField,
          code: 'DUPLICATE_IN_DB',
          value: existingEmail ? normalizedEmail : normalizedUsername,
          message: dupMessage,
        };
        historyIssues.push(dupIssue);
        errors.push({
          row: rowNumber,
          sheetRowNumber,
          identifier,
          field: dupIssue.field,
          column: dupIssue.column,
          columnLetter: dupIssue.columnLetter,
          code: dupIssue.code,
          value: dupIssue.value,
          message: dupMessage,
        });
        continue;
      }

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
        const createIssue: ImportCellIssue = {
          row: rowNumber,
          sheetRowNumber,
          column: null,
          columnLetter: null,
          field: null,
          code: 'CREATE_FAILED',
          value: identifier,
          message,
        };
        historyIssues.push(createIssue);
        errors.push({
          row: rowNumber,
          sheetRowNumber,
          identifier,
          field: null,
          column: null,
          columnLetter: null,
          code: 'CREATE_FAILED',
          value: identifier,
          message,
        });
      }
    }

    const createdCount = importedUserIds.length;
    const updatedCount = updatedUserIds.length;
    const successCount = createdCount + updatedCount;
    const failedCount = errors.length;
    const finalStatus =
      failedCount === 0 ? 'COMPLETED' : successCount > 0 || skippedCount > 0 ? 'PARTIAL' : 'FAILED';

    let publishedJobId: string | null = null;
    if (!options?.skipQueuePublish && this.messagePublisher) {
      const env = await this.messagePublisher
        .publish(
          'users.import',
          {
            operation: 'import' as const,
            executeInWorker: false as const,
            totalItems: rawRows.length,
            importedCount: createdCount,
            updatedCount,
            successCount,
            skippedCount,
            failedCount,
            duplicateStrategy,
            ...(dto.skipDuplicates !== undefined ? { skipDuplicates: dto.skipDuplicates } : {}),
            ...(historyRecord ? { historyId: historyRecord.id } : {}),
            ...(actorId !== undefined ? { actorId } : {}),
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'import',
              totalRows: rawRows.length,
              importedCount: createdCount,
              updatedCount,
              duplicateStrategy,
            },
          },
        )
        .catch(() => null);
      publishedJobId = env?.id ?? null;
    }

    if (historyRecord) {
      this.importRegistry.updateImportHistory(historyRecord.id, {
        ...(publishedJobId ? { jobId: publishedJobId } : {}),
        status: finalStatus,
        totalRows: rawRows.length,
        processedRows: rawRows.length,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount,
        errors: historyIssues,
        completedAt: new Date().toISOString(),
      });
    }

    return {
      totalRows: rawRows.length,
      importedCount: createdCount,
      updatedCount,
      successCount,
      skippedCount,
      failedCount,
      remainingCount: 0,
      duplicateStrategy,
      ...(historyRecord ? { historyId: historyRecord.id } : {}),
      ...(publishedJobId ? { jobId: publishedJobId } : {}),
      status: finalStatus,
      importedUserIds,
      updatedUserIds,
      errors,
    };
  }

  /** 8.2.8 — Xem tiến độ Import (số dòng thành công, lỗi và còn lại) theo `jobId` hoặc `historyId` */
  public getImportJobProgress(jobIdOrHistoryId: string | number): ImportProgressSnapshot {
    const progress = this.importRegistry.getProgress(jobIdOrHistoryId);
    if (!progress) {
      throw new NotFoundAppException('users.importJobNotFound', { id: jobIdOrHistoryId });
    }
    return progress;
  }

  /** 8.2.9 — Truy vấn danh sách lịch sử Import người dùng (File, người thực hiện và kết quả) */
  public listImportHistories(query?: ListUserImportHistoriesQuery): ImportHistoryRecord[] {
    return this.importRegistry.listHistories({
      profileCode: USERS_IMPORT_PROFILE_CODE,
      module: 'users',
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.status !== undefined ? { status: query.status } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    });
  }

  /** 8.2.9 — Xem chi tiết 1 bản ghi lịch sử Import theo ID */
  public getImportHistoryById(historyId: number): ImportHistoryRecord {
    const record = this.importRegistry.getHistoryById(historyId);
    if (!record || record.profileCode !== USERS_IMPORT_PROFILE_CODE) {
      throw new NotFoundAppException('users.importHistoryNotFound', { id: historyId });
    }
    return record;
  }
}
