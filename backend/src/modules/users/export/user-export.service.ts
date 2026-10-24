import { Injectable, Optional } from '@nestjs/common';
import { LocaleContext, LocaleFormatter } from '@packages/i18n/index.js';
import {
  SettingRegistryService,
  buildXlsxBuffer,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, JOB_PRIORITIES, QUEUES } from '@packages/messaging/index.js';
import {
  AuditLogService,
  PlatformSecurityService,
  type UserIdentity,
} from '@packages/security/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UsersService } from '../services/users.service.js';
import type { ListUsersQuery } from '../requests/users.requests.js';
import type { ExportUsersCsvResponse } from '../responses/users.response.js';
import {
  DEFAULT_USER_EXPORT_REPORT_TITLE,
  USER_EXPORT_CENTER_COLUMNS,
  USER_EXPORT_COLUMN_WIDTHS,
  USER_EXPORT_HEADERS,
  USER_EXPORT_TEXT_COLUMNS,
  USER_IMPORT_TEMPLATE_CENTER_COLUMNS,
  USER_IMPORT_TEMPLATE_COLUMN_WIDTHS,
  USER_IMPORT_TEMPLATE_HEADERS,
  USER_IMPORT_TEMPLATE_SAMPLE_ROWS,
  USER_IMPORT_TEMPLATE_TEXT_COLUMNS,
  escapeCsvCell,
  formatVietnameseDateTime,
  mapUserToExportRow,
} from './user-export.formatter.js';

const MAX_EXPORT_ROWS = 5_000;

@Injectable()
export class UserExportService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly platformSecurityService?: PlatformSecurityService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider | null,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  /**
   * Xuất danh sách người dùng ra định dạng Excel (.xlsx) hoặc CSV (.csv) theo bộ lọc hiện hành
   * và áp dụng Phạm vi dữ liệu (Data Scope) của người xuất báo cáo (Mục 3.1.8, 4.3.5 & 4.5.7).
   */
  public async exportUsersCsv(
    query: ListUsersQuery,
    actor?: UserIdentity,
  ): Promise<ExportUsersCsvResponse> {
    const format: 'csv' | 'xlsx' = query.format === 'xlsx' ? 'xlsx' : 'csv';
    const maxExportRows = this.settingRegistry.getNumber(
      'users.export.max_rows',
      undefined,
      MAX_EXPORT_ROWS,
    );
    const actorOrgUnitId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0];
    const defaultReportTitle = this.settingRegistry.getString(
      'users.export.default_report_title',
      actorOrgUnitId ? { organizationUnitId: actorOrgUnitId } : undefined,
      DEFAULT_USER_EXPORT_REPORT_TITLE,
    );
    const scopeFilter = await this.usersService.resolveUserScopeFilter(actor, 'export');
    const { items } = await this.userRepository.searchPaginated({
      ...query,
      ...(scopeFilter ? { scopeFilter } : {}),
      page: 1,
      limit: Math.min(query.limit ?? maxExportRows, maxExportRows),
    });

    const hydrated = await this.usersService.hydrateUsersList(items);

    const effectiveTimezone = LocaleFormatter.resolveActiveTimezone(
      actor?.preferredTimezone ?? LocaleContext.getTimezone(),
    );
    const reportTitle = query.title?.trim() || defaultReportTitle;
    const exportedAtSubtitle = `Ngày xuất dữ liệu: ${formatVietnameseDateTime(new Date(), effectiveTimezone)}`;

    const lines: string[] = [USER_EXPORT_HEADERS.join(',')];
    const matrixRows: Array<Array<string | number>> = [];

    for (let i = 0; i < hydrated.length; i++) {
      const user = hydrated[i]!;
      const rowValues = mapUserToExportRow(user, i, { timeZone: effectiveTimezone });
      matrixRows.push(rowValues);
      lines.push(rowValues.map((v) => escapeCsvCell(v)).join(','));
    }

    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    const xlsxBuffer = buildXlsxBuffer(USER_EXPORT_HEADERS, matrixRows, {
      sheetName: 'Sheet1',
      title: reportTitle,
      subtitle: exportedAtSubtitle,
      logoPng: query.logoBase64 ?? null,
      columnWidths: USER_EXPORT_COLUMN_WIDTHS,
      centerColumnIndices: USER_EXPORT_CENTER_COLUMNS,
      textColumnIndices: USER_EXPORT_TEXT_COLUMNS,
      freezeHeader: true,
    });
    const xlsxBase64 = xlsxBuffer.toString('base64');
    const datePart = new Date().toISOString().slice(0, 10);
    const fileName = `danh_sach_nhan_vien_${datePart}.${format}`;

    if (this.platformSecurityService) {
      await this.platformSecurityService.recordSecurityEvent({
        eventType: 'DATA_EXPORT',
        module: 'users',
        feature: 'user_export',
        action: 'USER_DATA_EXPORTED',
        actorId: actor?.id ?? null,
        resourceType: 'user_export',
        resourceId: fileName,
        recordCount: hydrated.length,
        reason: `Exported ${hydrated.length} user records as ${format.toUpperCase()}`,
        afterData: {
          fileName,
          format,
          totalExported: hydrated.length,
          effectiveDataScope: scopeFilter?.effectiveScopeName ?? 'ALL',
        },
        metadata: {
          format,
          totalExported: hydrated.length,
        },
      });
    } else if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'users',
        feature: 'user_export',
        action: 'USER_DATA_EXPORTED',
        actorId: actor?.id ?? null,
        resourceType: 'user_export',
        resourceId: fileName,
        reason: `Exported ${hydrated.length} user records as ${format.toUpperCase()}`,
        afterData: {
          fileName,
          format,
          totalExported: hydrated.length,
          effectiveDataScope: scopeFilter?.effectiveScopeName ?? 'ALL',
        },
      });
    }

    if (this.messagePublisher) {
      await this.messagePublisher
        .publish(
          'users.export',
          {
            operation: 'export' as const,
            format,
            fileName,
            totalItems: hydrated.length,
            ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'export',
              format,
              totalExported: hydrated.length,
            },
          },
        )
        .catch(() => null);
    }

    return {
      fileName,
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

  /**
   * Xuất file mẫu (Template) Excel (.xlsx) & CSV phục vụ nhập người dùng hàng loạt (Mục 3.1.7).
   * - Định dạng bảng Header nền xanh đậm #1E4488 chữ trắng in đậm, cố định dòng tiêu đề,
   *   định dạng Text '@' cho SĐT / Mã nhân viên, kèm dữ liệu mẫu.
   */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportUsersCsvResponse {
    const lines: string[] = [
      USER_IMPORT_TEMPLATE_HEADERS.join(','),
      ...USER_IMPORT_TEMPLATE_SAMPLE_ROWS.map((row) => row.map((v) => escapeCsvCell(v)).join(',')),
    ];
    const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    const xlsxBase64 = buildXlsxBuffer(
      USER_IMPORT_TEMPLATE_HEADERS,
      USER_IMPORT_TEMPLATE_SAMPLE_ROWS,
      {
        sheetName: 'Sheet1',
        columnWidths: USER_IMPORT_TEMPLATE_COLUMN_WIDTHS,
        centerColumnIndices: USER_IMPORT_TEMPLATE_CENTER_COLUMNS,
        textColumnIndices: USER_IMPORT_TEMPLATE_TEXT_COLUMNS,
        freezeHeader: true,
      },
    ).toString('base64');

    return {
      fileName: `mau_import_nhan_vien.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      totalExported: USER_IMPORT_TEMPLATE_SAMPLE_ROWS.length,
      csvContent,
      xlsxBase64,
    };
  }
}
