import { Inject, Injectable, Optional } from '@nestjs/common';
import { LocaleContext, LocaleFormatter } from '@packages/i18n/index.js';
import {
  EXPORT_FORMAT,
  ExportRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  buildDeclarativeExportArtifact,
  buildImportTemplateFile,
  defaultExportRegistry,
  defaultSettingRegistry,
  resolveExportContentType,
  resolveExportFormat,
  resolveExportMaxRows,
  sanitizeExportFilters,
  type ExportCompletionNotification,
  type ExportFormat,
  type ExportHistoryRecord,
  type ExportProgressSnapshot,
  type IPdfExportAdapter,
} from '@packages/kernel/index.js';
import {
  BaseMessagePublisherProvider,
  JOB_PRIORITIES,
  QUEUES,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
import {
  AuditLogService,
  PlatformSecurityService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
} from '@modules/notifications/contracts/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import { UsersService } from '../services/users.service.js';
import type { ListUserExportHistoriesQuery, ListUsersQuery } from '../requests/users.requests.js';
import type { ExportUsersCsvResponse } from '../responses/users.response.js';
import {
  DEFAULT_USER_EXPORT_REPORT_TITLE,
  USER_EXPORT_COLUMNS,
  USER_IMPORT_TEMPLATE_COLUMNS,
  formatVietnameseDateTime,
} from './user-export.formatter.js';

const MAX_EXPORT_ROWS = 5_000;
const PRIVILEGED_MAX_EXPORT_ROWS = 50_000;
const DEFAULT_EXPORT_FILE_TTL_SECONDS = 3_600;
const USERS_EXPORT_PROFILE_CODE = 'users';

export interface ExecuteUserExportOptions {
  readonly skipQueuePublish?: boolean | undefined;
  readonly existingHistoryId?: number | undefined;
  readonly jobId?: string | undefined;
  readonly forceNotify?: boolean | undefined;
}

@Injectable()
export class UserExportService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly exportRegistry: ExportRegistryService;

  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly platformSecurityService?: PlatformSecurityService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider | null,
    @Optional() exportRegistry?: ExportRegistryService,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService?: INotificationsPublicService | null,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.registerUsersExportWorkerExecutor();
  }

  /**
   * 8.3.4 — Đăng ký bộ thực thi Export nền của module `users` vào `ExportRegistryService`
   * để `HeavyJobProcessor` tự động điều phối động mà không cần hardcode.
   */
  private registerUsersExportWorkerExecutor(): void {
    const executor = {
      profileCode: USERS_EXPORT_PROFILE_CODE,
      module: 'users',
      topic: 'users.export',
      executeExport: async (input: {
        readonly query?: Readonly<Record<string, unknown>> | undefined;
        readonly format?: ExportFormat | string | undefined;
        readonly notifyOnComplete?: boolean | undefined;
        readonly actorId?: number | undefined;
        readonly actor?: unknown;
        readonly historyId?: number | undefined;
        readonly jobId: string;
      }) => {
        const exportQuery: ListUsersQuery = {
          sortBy: 'id',
          sortOrder: 'ASC',
          ...((input.query ?? {}) as Partial<ListUsersQuery>),
          ...(input.format === 'csv' || input.format === 'xlsx' || input.format === 'pdf'
            ? { format: input.format }
            : {}),
          async: false,
          notifyOnComplete: input.notifyOnComplete ?? true,
        };

        const effectiveActor: UserIdentity | undefined =
          (input.actor as UserIdentity | undefined) ??
          (input.actorId !== undefined
            ? {
                id: input.actorId,
                roles: [],
                permissions: ['users.export'],
              }
            : undefined);

        return this.exportUsersCsv(exportQuery, effectiveActor, {
          skipQueuePublish: true,
          ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
          jobId: input.jobId,
          forceNotify: input.notifyOnComplete !== false,
        });
      },
    };

    this.exportRegistry.registerWorkerExecutor(executor);
    if (this.exportRegistry !== defaultExportRegistry) {
      defaultExportRegistry.registerWorkerExecutor(executor);
    }
  }

  /**
   * 8.3.3 — Đăng ký hoặc thay thế PDF Adapter phục vụ xuất danh sách người dùng ra PDF.
   */
  public registerPdfAdapter(adapter: IPdfExportAdapter): void {
    this.exportRegistry.registerPdfAdapter(adapter);
  }

  /**
   * Đẩy công việc Xuất danh sách người dùng lớn vào hàng đợi `system.heavy` để Worker xử lý nền
   * (Mục 8.3.4 — Chạy Export lớn bằng Queue: Không làm API chờ lâu).
   */
  public async enqueueUsersExport(
    query: ListUsersQuery,
    actor?: UserIdentity,
    existingHistoryId?: number,
    maxRowsApplied?: number,
  ): Promise<MessageEnvelope<{
    readonly operation: 'export';
    readonly executeInWorker: true;
    readonly format: ExportFormat;
    readonly fileName: string;
    readonly query: ListUsersQuery;
    readonly filters: Readonly<Record<string, unknown>>;
    readonly historyId: number;
    readonly actorId?: number | undefined;
    readonly actor?: UserIdentity | undefined;
    readonly notifyOnComplete: boolean;
  }> | null> {
    if (!this.messagePublisher) return null;

    const format = resolveExportFormat(query.format, EXPORT_FORMAT.CSV);
    const datePart = new Date().toISOString().slice(0, 10);
    const fileName = `danh_sach_nhan_vien_${datePart}.${format}`;
    const appliedFilters = sanitizeExportFilters(query);

    const historyRecord =
      existingHistoryId !== undefined
        ? (this.exportRegistry.getHistoryById(existingHistoryId) ??
          this.exportRegistry.startExportHistory({
            profileCode: USERS_EXPORT_PROFILE_CODE,
            module: 'users',
            fileName,
            format,
            actorId: actor?.id ?? null,
            filters: appliedFilters,
            maxRowsApplied: maxRowsApplied ?? MAX_EXPORT_ROWS,
            status: 'QUEUED',
          }))
        : this.exportRegistry.startExportHistory({
            profileCode: USERS_EXPORT_PROFILE_CODE,
            module: 'users',
            fileName,
            format,
            actorId: actor?.id ?? null,
            filters: appliedFilters,
            maxRowsApplied: maxRowsApplied ?? MAX_EXPORT_ROWS,
            status: 'QUEUED',
          });

    const envelope = await this.messagePublisher.publish(
      'users.export',
      {
        operation: 'export' as const,
        executeInWorker: true as const,
        format,
        fileName,
        query: {
          ...query,
          async: false,
        },
        filters: appliedFilters,
        historyId: historyRecord.id,
        ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
        ...(actor ? { actor } : {}),
        notifyOnComplete: query.notifyOnComplete ?? true,
      },
      QUEUES.SYSTEM_HEAVY,
      {
        priority: JOB_PRIORITIES.LOW,
        index: {
          operation: 'export',
          format,
          historyId: historyRecord.id,
          ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
        },
      },
    );

    if (envelope?.id) {
      this.exportRegistry.updateExportHistory(historyRecord.id, {
        jobId: envelope.id,
        status: 'QUEUED',
      });
    }

    return envelope;
  }

  /**
   * Xuất danh sách người dùng ra định dạng Excel (`.xlsx`), CSV (`.csv`) hoặc PDF (`.pdf` qua adapter)
   * theo bộ lọc hiện hành và Phạm vi dữ liệu (Data Scope) của người xuất báo cáo (Mục 3.1.8, 4.3.5 & 8.3).
   * Đáp ứng đầy đủ 8 tiêu chí của Mục 8.3:
   * - 8.3.1: Xuất Excel (`.xlsx`) giữ đúng bộ lọc hiện tại & Data Scope.
   * - 8.3.2: Xuất CSV (`.csv`) phù hợp dữ liệu lớn (hỗ trợ `onlyRequestedFormat` không build thừa XLSX).
   * - 8.3.3: Xuất PDF (`.pdf`) qua Pluggable Adapter (`IPdfExportAdapter`).
   * - 8.3.4: Chạy Export lớn bằng Queue (`async: true` hoặc vượt ngưỡng dòng) không làm API chờ lâu.
   * - 8.3.5: Gửi thông báo khi Export hoàn tất kèm đường dẫn tải tạm thời (`downloadUrl`).
   * - 8.3.6: Giới hạn số lượng bản ghi được xuất theo quyền/vai trò và cấu hình động.
   * - 8.3.7: Ghi lịch sử Export đầy đủ người thực hiện (`actorId`), bộ lọc (`filters`) và số dòng (`totalExported`).
   * - 8.3.8: Hết hạn file Export tự động (`expiresAt` theo TTL cấu hình, tự động thu hồi khi hết hạn).
   */
  public async exportUsersCsv(
    query: ListUsersQuery,
    actor?: UserIdentity,
    options?: ExecuteUserExportOptions,
  ): Promise<ExportUsersCsvResponse> {
    const format = resolveExportFormat(query.format, EXPORT_FORMAT.CSV);
    const actorOrgUnitId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0];

    // 8.3.6 — Giới hạn số lượng bản ghi được xuất theo Quyền/Vai trò và Cấu hình động
    const resolvedLimit = resolveExportMaxRows(
      {
        settingKey: 'users.export.max_rows',
        privilegedSettingKey: 'users.export.privileged_max_rows',
        roleLimitsSettingKey: 'users.export.role_max_rows',
        defaultMaxRows: MAX_EXPORT_ROWS,
        privilegedMaxRows: PRIVILEGED_MAX_EXPORT_ROWS,
        requestedLimit: query.limit,
        actor: actor
          ? {
              id: actor.id,
              roles: actor.roles,
              permissions: actor.permissions,
              organizationUnitIds: actor.organizationUnitIds,
            }
          : null,
        organizationUnitId: actorOrgUnitId ?? null,
        enforceStrictLimit: query.enforceStrictLimit === true,
      },
      this.settingRegistry,
    );

    const maxExportRows = resolvedLimit.maxRowsAllowed;
    const effectiveLimit = resolvedLimit.effectiveLimit;
    const appliedFilters = sanitizeExportFilters(query);
    const datePart = new Date().toISOString().slice(0, 10);
    const fileBaseName = `danh_sach_nhan_vien_${datePart}`;
    const fileName = `${fileBaseName}.${format}`;

    // 8.3.4 — Chạy Export lớn bằng Queue khi truyền `async: true` để không làm API chờ lâu
    if (query.async === true && !options?.skipQueuePublish && this.messagePublisher) {
      const history = this.exportRegistry.startExportHistory({
        profileCode: USERS_EXPORT_PROFILE_CODE,
        module: 'users',
        fileName,
        format,
        actorId: actor?.id ?? null,
        filters: appliedFilters,
        maxRowsApplied: maxExportRows,
        status: 'QUEUED',
      });
      const envelope = await this.enqueueUsersExport(query, actor, history.id, maxExportRows);
      return {
        fileName,
        contentType: resolveExportContentType(format),
        format,
        totalExported: 0,
        csvContent: '',
        xlsxBase64: '',
        historyId: history.id,
        jobId: envelope?.id ?? history.jobId,
        status: 'QUEUED',
        downloadToken: null,
        downloadUrl: null,
        expiresAt: null,
        maxRowsApplied: maxExportRows,
        filtersApplied: appliedFilters,
        notifiedAt: null,
      };
    }

    const historyRecord =
      options?.existingHistoryId !== undefined
        ? (this.exportRegistry.getHistoryById(options.existingHistoryId) ??
          this.exportRegistry.startExportHistory({
            profileCode: USERS_EXPORT_PROFILE_CODE,
            module: 'users',
            fileName,
            format,
            actorId: actor?.id ?? null,
            filters: appliedFilters,
            maxRowsApplied: maxExportRows,
            jobId: options.jobId ?? null,
            status: 'PROCESSING',
          }))
        : this.exportRegistry.startExportHistory({
            profileCode: USERS_EXPORT_PROFILE_CODE,
            module: 'users',
            fileName,
            format,
            actorId: actor?.id ?? null,
            filters: appliedFilters,
            maxRowsApplied: maxExportRows,
            jobId: options?.jobId ?? null,
            status: 'PROCESSING',
          });

    const defaultReportTitle = this.settingRegistry.getString(
      'users.export.default_report_title',
      actorOrgUnitId ? { organizationUnitId: actorOrgUnitId } : undefined,
      DEFAULT_USER_EXPORT_REPORT_TITLE,
    );

    // 8.3.1 — Truy vấn giữ đúng bộ lọc hiện tại (`query`) kết hợp với Phạm vi dữ liệu (`scopeFilter`)
    const scopeFilter = await this.usersService.resolveUserScopeFilter(actor, 'export');
    const { items } = await this.userRepository.searchPaginated({
      ...query,
      ...(scopeFilter ? { scopeFilter } : {}),
      page: 1,
      limit: effectiveLimit,
    });

    const hydrated = await this.usersService.hydrateUsersList(items);

    const effectiveTimezone = LocaleFormatter.resolveActiveTimezone(
      actor?.preferredTimezone ?? LocaleContext.getTimezone(),
    );
    const reportTitle = query.title?.trim() || defaultReportTitle;
    const exportedAtSubtitle = `Ngày xuất dữ liệu: ${formatVietnameseDateTime(new Date(), effectiveTimezone)}`;

    // 8.3.1, 8.3.2 & 8.3.3 — Kết xuất file Excel / CSV / PDF qua Declarative Export Engine
    const builtFile = await buildDeclarativeExportArtifact({
      fileBaseName,
      format,
      columns: USER_EXPORT_COLUMNS,
      items: hydrated,
      context: { timeZone: effectiveTimezone },
      sheetName: 'Sheet1',
      title: reportTitle,
      subtitle: exportedAtSubtitle,
      logoPng: query.logoBase64 ?? null,
      landscape: true,
      pdfAdapter: this.exportRegistry.getPdfAdapter(),
      onlyRequestedFormat: query.onlyRequestedFormat === true,
    });

    // 8.3.8 — Lưu file Export tạm thời có thời hạn (TTL) tự động hết hạn, không lưu vĩnh viễn
    const ttlSeconds =
      query.ttlSeconds ??
      this.settingRegistry.getNumber(
        'users.export.file_ttl_seconds',
        actorOrgUnitId ? { organizationUnitId: actorOrgUnitId } : undefined,
        DEFAULT_EXPORT_FILE_TTL_SECONDS,
      );

    const tempArtifact = this.exportRegistry.storeTemporaryArtifact({
      profileCode: USERS_EXPORT_PROFILE_CODE,
      module: 'users',
      fileName: builtFile.fileName,
      format,
      contentType: builtFile.contentType,
      totalExported: hydrated.length,
      buffer: builtFile.primaryBuffer,
      actorId: actor?.id ?? null,
      historyId: historyRecord.id,
      jobId: options?.jobId ?? historyRecord.jobId,
      ttlSeconds,
      baseDownloadPath: '/api/v1/exports/downloads',
    });

    // 8.3.7 — Ghi nhận hoàn tất Lịch sử Export (Người thực hiện, bộ lọc và số dòng)
    let publishedJobId: string | null = options?.jobId ?? historyRecord.jobId ?? null;
    if (!options?.skipQueuePublish && this.messagePublisher) {
      const env = await this.messagePublisher
        .publish(
          'users.export',
          {
            operation: 'export' as const,
            executeInWorker: false as const,
            format,
            fileName: builtFile.fileName,
            totalItems: hydrated.length,
            historyId: historyRecord.id,
            downloadToken: tempArtifact.token,
            downloadUrl: tempArtifact.downloadUrl,
            expiresAt: tempArtifact.expiresAt,
            ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
          },
          QUEUES.SYSTEM_HEAVY,
          {
            priority: JOB_PRIORITIES.LOW,
            index: {
              operation: 'export',
              format,
              totalExported: hydrated.length,
              historyId: historyRecord.id,
            },
          },
        )
        .catch(() => null);
      if (env?.id) {
        publishedJobId = env.id;
      }
    }

    this.exportRegistry.updateExportHistory(historyRecord.id, {
      ...(publishedJobId ? { jobId: publishedJobId } : {}),
      status: 'COMPLETED',
      fileName: builtFile.fileName,
      totalExported: hydrated.length,
      processedRows: hydrated.length,
      maxRowsApplied: maxExportRows,
      downloadToken: tempArtifact.token,
      downloadUrl: tempArtifact.downloadUrl,
      expiresAt: tempArtifact.expiresAt,
      completedAt: new Date().toISOString(),
    });

    // 8.3.5 — Gửi thông báo khi Export hoàn tất kèm đường dẫn tải tạm thời (`downloadUrl`)
    let notifiedAt: string | null = null;
    const shouldNotify =
      options?.forceNotify === true ||
      query.notifyOnComplete === true ||
      (query.notifyOnComplete !== false && actor?.id !== undefined);

    if (shouldNotify && actor?.id !== undefined) {
      const notification = await this.sendExportCompletionNotification({
        historyId: historyRecord.id,
        jobId: publishedJobId,
        recipientUserId: actor.id,
        organizationUnitId: actorOrgUnitId ?? null,
        format,
        fileName: builtFile.fileName,
        totalExported: hydrated.length,
        downloadToken: tempArtifact.token,
        downloadUrl: tempArtifact.downloadUrl,
        expiresAt: tempArtifact.expiresAt,
      });
      notifiedAt = notification.sentAt;
    }

    // 8.3.7 — Ghi Audit Log & Security Event kèm đầy đủ `filters`, `actorId` và `totalExported`
    if (this.platformSecurityService) {
      await this.platformSecurityService.recordSecurityEvent({
        eventType: 'DATA_EXPORT',
        module: 'users',
        feature: 'user_export',
        action: 'USER_DATA_EXPORTED',
        actorId: actor?.id ?? null,
        resourceType: 'user_export',
        resourceId: builtFile.fileName,
        recordCount: hydrated.length,
        reason: `Exported ${hydrated.length} user records as ${format.toUpperCase()}`,
        afterData: {
          historyId: historyRecord.id,
          fileName: builtFile.fileName,
          format,
          totalExported: hydrated.length,
          maxRowsApplied: maxExportRows,
          filters: appliedFilters,
          downloadUrl: tempArtifact.downloadUrl,
          expiresAt: tempArtifact.expiresAt,
          effectiveDataScope: scopeFilter?.effectiveScopeName ?? 'ALL',
        },
        metadata: {
          historyId: historyRecord.id,
          format,
          totalExported: hydrated.length,
          filters: appliedFilters,
        },
      });
    } else if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'users',
        feature: 'user_export',
        action: 'USER_DATA_EXPORTED',
        actorId: actor?.id ?? null,
        resourceType: 'user_export',
        resourceId: builtFile.fileName,
        reason: `Exported ${hydrated.length} user records as ${format.toUpperCase()}`,
        afterData: {
          historyId: historyRecord.id,
          fileName: builtFile.fileName,
          format,
          totalExported: hydrated.length,
          maxRowsApplied: maxExportRows,
          filters: appliedFilters,
          downloadUrl: tempArtifact.downloadUrl,
          expiresAt: tempArtifact.expiresAt,
          effectiveDataScope: scopeFilter?.effectiveScopeName ?? 'ALL',
        },
      });
    }

    return {
      fileName: builtFile.fileName,
      contentType: builtFile.contentType,
      format,
      totalExported: hydrated.length,
      csvContent: builtFile.csvContent,
      xlsxBase64: builtFile.xlsxBase64,
      ...(builtFile.pdfBase64 !== undefined ? { pdfBase64: builtFile.pdfBase64 } : {}),
      historyId: historyRecord.id,
      jobId: publishedJobId,
      status: 'COMPLETED',
      downloadToken: tempArtifact.token,
      downloadUrl: tempArtifact.downloadUrl,
      expiresAt: tempArtifact.expiresAt,
      maxRowsApplied: maxExportRows,
      filtersApplied: appliedFilters,
      notifiedAt,
    };
  }

  /**
   * 8.3.5 — Phát thông báo hoàn tất Export tới người dùng kèm đường dẫn tải tạm thời (`downloadUrl`).
   */
  public async sendExportCompletionNotification(params: {
    readonly historyId?: number | null | undefined;
    readonly jobId?: string | null | undefined;
    readonly recipientUserId: number;
    readonly organizationUnitId?: number | null | undefined;
    readonly format: ExportFormat;
    readonly fileName: string;
    readonly totalExported: number;
    readonly downloadToken: string;
    readonly downloadUrl: string;
    readonly expiresAt: string;
  }): Promise<ExportCompletionNotification> {
    const recorded = this.exportRegistry.recordCompletionNotification({
      historyId: params.historyId ?? null,
      jobId: params.jobId ?? null,
      recipientUserId: params.recipientUserId,
      module: 'users',
      profileCode: USERS_EXPORT_PROFILE_CODE,
      format: params.format,
      fileName: params.fileName,
      totalExported: params.totalExported,
      downloadToken: params.downloadToken,
      downloadUrl: params.downloadUrl,
      expiresAt: params.expiresAt,
    });

    if (this.notificationsPublicService) {
      await this.notificationsPublicService
        .dispatch({
          title: recorded.title,
          content: recorded.message,
          category: 'SYSTEM',
          priority: 'NORMAL',
          targetType: 'SINGLE_USER',
          userId: params.recipientUserId,
          actionUrl: params.downloadUrl,
          referenceModule: 'users',
          referenceType: 'user_export',
          referenceId: String(params.historyId ?? params.downloadToken),
          metadata: {
            downloadToken: params.downloadToken,
            downloadUrl: params.downloadUrl,
            expiresAt: params.expiresAt,
            fileName: params.fileName,
            format: params.format,
            totalExported: params.totalExported,
          },
          organizationUnitId: params.organizationUnitId ?? null,
        })
        .catch(() => null);
    }

    return recorded;
  }

  /**
   * 8.3.4 — Xem tiến độ thực thi Export theo `jobId` hoặc `historyId`.
   */
  public getExportJobProgress(jobIdOrHistoryId: string | number): ExportProgressSnapshot {
    const progress = this.exportRegistry.getProgress(jobIdOrHistoryId);
    if (!progress) {
      throw new NotFoundAppException('users.exportJobNotFound', { id: jobIdOrHistoryId });
    }
    return progress;
  }

  /**
   * 8.3.7 — Tra cứu danh sách lịch sử Export người dùng (Người thực hiện, bộ lọc và số dòng).
   */
  public listExportHistories(query?: ListUserExportHistoriesQuery): ExportHistoryRecord[] {
    return this.exportRegistry.listHistories({
      profileCode: USERS_EXPORT_PROFILE_CODE,
      module: 'users',
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.format !== undefined ? { format: query.format } : {}),
      ...(query?.status !== undefined ? { status: query.status } : {}),
      ...(query?.includeExpired !== undefined ? { includeExpired: query.includeExpired } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    });
  }

  /**
   * 8.3.7 — Xem chi tiết 1 bản ghi lịch sử Export theo ID.
   */
  public getExportHistoryById(historyId: number): ExportHistoryRecord {
    const record = this.exportRegistry.getHistoryById(historyId);
    if (!record || record.profileCode !== USERS_EXPORT_PROFILE_CODE) {
      throw new NotFoundAppException('users.exportHistoryNotFound', { id: historyId });
    }
    return record;
  }

  /**
   * 8.3.5 & 8.3.8 — Tải xuống file Export qua đường dẫn tạm thời (`token`).
   * Nếu file đã quá hạn `expiresAt`, tự động xóa khỏi bộ nhớ và ném lỗi `users.exportFileExpired`.
   */
  public downloadTemporaryExport(
    token: string,
    now: Date = new Date(),
  ): {
    readonly token: string;
    readonly downloadUrl: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly format: ExportFormat;
    readonly totalExported: number;
    readonly sizeBytes: number;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly csvContent?: string;
    readonly xlsxBase64?: string;
    readonly pdfBase64?: string;
  } {
    const artifact = this.exportRegistry.getTemporaryArtifactByToken(token, now);
    if (!artifact || artifact.profileCode !== USERS_EXPORT_PROFILE_CODE) {
      throw new NotFoundAppException('users.exportFileExpired', { token });
    }

    return {
      token: artifact.token,
      downloadUrl: artifact.downloadUrl,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      format: artifact.format,
      totalExported: artifact.totalExported,
      sizeBytes: artifact.sizeBytes,
      createdAt: artifact.createdAt,
      expiresAt: artifact.expiresAt,
      ...(artifact.format === 'csv'
        ? { csvContent: artifact.buffer.toString('utf8') }
        : artifact.format === 'xlsx'
          ? { xlsxBase64: artifact.buffer.toString('base64') }
          : { pdfBase64: artifact.buffer.toString('base64') }),
    };
  }

  /**
   * 8.3.8 — Dọn dẹp toàn bộ các file Export tạm thời đã hết hạn (`expiresAt <= now`).
   */
  public purgeExpiredExports(now: Date = new Date()): {
    readonly purgedCount: number;
    readonly purgedTokens: readonly string[];
    readonly purgedHistoryIds: readonly number[];
  } {
    return this.exportRegistry.purgeExpiredArtifacts(now);
  }

  /**
   * Xuất file mẫu (Template) Excel (.xlsx) & CSV phục vụ nhập người dùng hàng loạt (Mục 3.1.7 & 8.2.1/8.2.2).
   * - Chỉ cần truyền `columns: USER_IMPORT_TEMPLATE_COLUMNS` (Declarative Template Engine)
   */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportUsersCsvResponse {
    return buildImportTemplateFile({
      fileBaseName: 'mau_import_nhan_vien',
      format,
      columns: USER_IMPORT_TEMPLATE_COLUMNS,
    });
  }
}
