import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  EXPORT_FORMAT,
  ExportRegistryService,
  NotFoundAppException,
  ReportRegistryService,
  SettingRegistryService,
  assertDistinctReportPermission,
  buildExportFileArtifact,
  buildReportCacheKey,
  defaultExportRegistry,
  defaultReportRegistry,
  defaultSettingRegistry,
  discoverManifestReports,
  normalizeReportParameters,
  resolveExportFormat,
  type ExportFormat,
  type NormalizedReportParameters,
  type RegisteredReportDefinition,
  type ReportDeliveryChannel,
  type ReportDeliveryNotification,
  type ReportExecutionHistoryRecord,
  type ReportExecutionMode,
  type ReportParametersInput,
  type ReportScheduleRecord,
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
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { USER_STATUS, type UserStatusCode, parseUserStatus } from '../contracts/index.js';
import { UserRepository, type SearchUsersFilter } from '../repositories/user.repository.js';
import { UsersService } from '../services/users.service.js';
import type {
  CreateUserReportScheduleRequest,
  ListUserReportHistoriesQuery,
  ListUserReportSchedulesQuery,
  RunUserReportRequest,
} from '../requests/users.requests.js';
import type { UserReportExecutionResponse, UserResponse } from '../responses/users.response.js';

const DEFAULT_REPORT_FILE_TTL_SECONDS = 3_600;
const USERS_REPORT_PROFILE_CODE = 'users_report';

export interface ExecuteUserReportOptions {
  readonly skipQueuePublish?: boolean | undefined;
  readonly existingHistoryId?: number | undefined;
  readonly jobId?: string | undefined;
  readonly scheduleId?: number | undefined;
  readonly executionMode?: ReportExecutionMode | undefined;
  readonly bypassPermissionCheck?: boolean | undefined;
}

@Injectable()
export class UserReportService {
  private readonly reportRegistry: ReportRegistryService;
  private readonly exportRegistry: ExportRegistryService;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly usersService: UsersService,
    private readonly userRepository: UserRepository,
    @Optional() reportRegistry?: ReportRegistryService,
    @Optional() exportRegistry?: ExportRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider | null,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly platformSecurityService?: PlatformSecurityService,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService?: INotificationsPublicService | null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService?: IOrganizationsPublicService | null,
  ) {
    this.reportRegistry = reportRegistry ?? defaultReportRegistry;
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.ensureModuleReportsRegistered();
  }

  /**
   * 8.4.1 — Đăng ký danh sách báo cáo của module `users` (tự động đồng bộ từ `module.manifest.json` + fallback an toàn).
   */
  public ensureModuleReportsRegistered(): void {
    const discovered = discoverManifestReports().filter((item) => item.module === 'users');
    if (discovered.length > 0) {
      this.reportRegistry.registerManifestReports(discovered);
    }

    if (!this.reportRegistry.getReport('users.summary_dashboard')) {
      this.reportRegistry.registerReport({
        code: 'users.summary_dashboard',
        module: 'users',
        name: 'Báo cáo tổng hợp nhân sự & trạng thái tài khoản',
        description:
          'Thống kê tổng số nhân sự theo trạng thái, đơn vị, tỷ lệ kích hoạt MFA và xu hướng tạo tài khoản',
        category: 'DASHBOARD',
        requiredPermission: 'users.report',
        isHeavy: false,
        heavyRecordThreshold: 2000,
        cacheTtlSeconds: 300,
        supportsReadReplica: true,
        supportedFormats: ['xlsx', 'csv', 'pdf'],
        parameters: [
          { key: 'dateRange', name: 'Khoảng ngày tạo', type: 'date-range', required: false },
          { key: 'status', name: 'Trạng thái tài khoản', type: 'status', required: false },
          {
            key: 'organizationUnitId',
            name: 'Đơn vị / Phòng ban',
            type: 'organization-unit',
            required: false,
          },
          { key: 'filters', name: 'Bộ lọc mở rộng', type: 'filter', required: false },
        ],
        isSystem: true,
        status: 1,
      });
    }

    if (!this.reportRegistry.getReport('users.security_compliance')) {
      this.reportRegistry.registerReport({
        code: 'users.security_compliance',
        module: 'users',
        name: 'Báo cáo tuân thủ bảo mật & phiên đăng nhập nhân sự',
        description:
          'Báo cáo chuyên sâu các tài khoản chưa bật MFA, tài khoản bị khóa hoặc lâu chưa đăng nhập theo từng đơn vị',
        category: 'REPORT',
        requiredPermission: 'users.report',
        isHeavy: true,
        heavyRecordThreshold: 500,
        cacheTtlSeconds: 600,
        supportsReadReplica: true,
        supportedFormats: ['xlsx', 'csv', 'pdf'],
        parameters: [
          { key: 'dateRange', name: 'Khoảng ngày', type: 'date-range', required: false },
          { key: 'status', name: 'Trạng thái tài khoản', type: 'status', required: false },
          {
            key: 'organizationUnitId',
            name: 'Đơn vị / Phòng ban',
            type: 'organization-unit',
            required: false,
          },
          { key: 'filters', name: 'Bộ lọc mở rộng', type: 'filter', required: false },
        ],
        isSystem: true,
        status: 1,
      });
    }

    const reportExecutor = {
      module: 'users',
      topic: 'users.report',
      reportCodes: ['users.summary_dashboard', 'users.security_compliance'],
      executeReport: async (input: {
        readonly reportCode: string;
        readonly request?: Readonly<Record<string, unknown>> | undefined;
        readonly format?: ExportFormat | string | undefined;
        readonly actorId?: number | undefined;
        readonly actor?: unknown;
        readonly historyId?: number | undefined;
        readonly scheduleId?: number | undefined;
        readonly executionMode?: ReportExecutionMode | undefined;
        readonly jobId: string;
      }) => {
        const reportRequest: Partial<RunUserReportRequest> = {
          reportCode: input.reportCode || 'users.security_compliance',
          ...((input.request ?? {}) as Partial<RunUserReportRequest>),
          ...(input.format === 'csv' || input.format === 'xlsx' || input.format === 'pdf'
            ? { format: input.format }
            : {}),
          async: false,
        };

        const effectiveActor: UserIdentity | undefined =
          (input.actor as UserIdentity | undefined) ??
          (input.actorId !== undefined
            ? {
                id: input.actorId,
                roles: [],
                permissions: ['users.report'],
              }
            : undefined);

        const effectiveMode: ReportExecutionMode = input.executionMode ?? 'QUEUE';

        return this.runReport(reportRequest, effectiveActor, {
          skipQueuePublish: true,
          ...(input.historyId !== undefined ? { existingHistoryId: input.historyId } : {}),
          ...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
          jobId: input.jobId,
          executionMode: effectiveMode,
          bypassPermissionCheck: effectiveActor === undefined || effectiveMode === 'SCHEDULED',
        });
      },
    };

    this.reportRegistry.registerWorkerExecutor(reportExecutor);
    if (this.reportRegistry !== defaultReportRegistry) {
      defaultReportRegistry.registerWorkerExecutor(reportExecutor);
    }
  }

  /**
   * 8.4.1 — Lấy danh sách các báo cáo đã đăng ký của module `users` (hoặc toàn bộ báo cáo khi truyền `includeAllModules`).
   */
  public listAvailableReports(options?: {
    readonly includeAllModules?: boolean | undefined;
    readonly category?: 'REPORT' | 'DASHBOARD' | undefined;
  }): RegisteredReportDefinition[] {
    this.ensureModuleReportsRegistered();
    if (options?.includeAllModules) {
      this.reportRegistry.syncFromManifests();
    }
    return this.reportRegistry.listReports({
      ...(options?.includeAllModules ? {} : { module: 'users' }),
      ...(options?.category ? { category: options.category } : {}),
    });
  }

  /**
   * 8.4.4 — Đẩy báo cáo nặng vào hàng đợi `QUEUES.SYSTEM_HEAVY` để tránh tải database trong request HTTP.
   */
  public async enqueueUserReport(
    request: RunUserReportRequest,
    actor?: UserIdentity,
    existingHistoryId?: number,
  ): Promise<MessageEnvelope<{
    readonly operation: 'report';
    readonly executeInWorker: true;
    readonly reportCode: string;
    readonly request: RunUserReportRequest;
    readonly historyId: number;
    readonly actorId?: number | undefined;
    readonly actor?: UserIdentity | undefined;
  }> | null> {
    if (!this.messagePublisher) return null;

    this.ensureModuleReportsRegistered();
    const reportCode = (request.reportCode ?? 'users.summary_dashboard').trim().toLowerCase();
    const reportDef = this.reportRegistry.getReport(reportCode);
    if (!reportDef) {
      throw new NotFoundAppException('users.reportNotFound', { reportCode });
    }

    const normalizedParams = this.extractNormalizedParameters(request);
    const historyRecord =
      existingHistoryId !== undefined
        ? (this.reportRegistry.getHistoryById(existingHistoryId) ??
          this.reportRegistry.startReportHistory({
            reportCode: reportDef.code,
            module: reportDef.module,
            reportName: reportDef.name,
            actorId: actor?.id ?? null,
            parameters: normalizedParams,
            executionMode: 'QUEUE',
            status: 'QUEUED',
            format: request.format ?? null,
          }))
        : this.reportRegistry.startReportHistory({
            reportCode: reportDef.code,
            module: reportDef.module,
            reportName: reportDef.name,
            actorId: actor?.id ?? null,
            parameters: normalizedParams,
            executionMode: 'QUEUE',
            status: 'QUEUED',
            format: request.format ?? null,
          });

    const envelope = await this.messagePublisher.publish(
      'users.report',
      {
        operation: 'report' as const,
        executeInWorker: true as const,
        reportCode: reportDef.code,
        request: {
          ...request,
          async: false,
        },
        historyId: historyRecord.id,
        ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
        ...(actor ? { actor } : {}),
      },
      QUEUES.SYSTEM_HEAVY,
      {
        priority: JOB_PRIORITIES.LOW,
        index: {
          operation: 'report',
          reportCode: reportDef.code,
          historyId: historyRecord.id,
          ...(actor?.id !== undefined ? { actorId: actor.id } : {}),
        },
      },
    );

    if (envelope?.id) {
      this.reportRegistry.updateReportHistory(historyRecord.id, {
        jobId: envelope.id,
        status: 'QUEUED',
      });
    }

    return envelope;
  }

  /**
   * Thực thi Báo cáo / Dashboard nhân sự (Mục 8.4):
   * - 8.4.1: Tra cứu báo cáo đã khai báo theo module (`users.summary_dashboard`, `users.security_compliance`).
   * - 8.4.2: Chuẩn hóa tham số báo cáo (Khoảng ngày `fromDate`/`toDate`, `status`, `organizationUnitId`, `filters`).
   * - 8.4.3: Kiểm tra phân quyền xem báo cáo riêng biệt (`users.report`), cấm dùng chung quyền `users.read`.
   * - 8.4.4: Tự động đẩy báo cáo nặng (`isHeavy` hoặc `async: true`) sang `QUEUES.SYSTEM_HEAVY`.
   * - 8.4.6: Khi cần gửi báo cáo qua Email/In-App hoặc xuất file, tạo file tạm có `expiresAt` và phát thông báo.
   * - 8.4.7: Lưu lịch sử chạy báo cáo đầy đủ thời gian (`startedAt`, `completedAt`, `durationMs`), người chạy (`actorId`) và kết quả.
   * - 8.4.8: Hỗ trợ đọc từ Read Replica (`searchPaginatedReadOnly`) khi hệ thống có cấu hình `replication`.
   * - 8.4.9: Cache kết quả báo cáo theo `reportCode + normalizedParams + scopeKey` để giảm chạy lại cùng tham số.
   */
  public async runReport(
    request: Partial<RunUserReportRequest> = {},
    actor?: UserIdentity,
    options?: ExecuteUserReportOptions,
  ): Promise<UserReportExecutionResponse> {
    this.ensureModuleReportsRegistered();
    const reportCode = (request.reportCode ?? 'users.summary_dashboard').trim().toLowerCase();
    const reportDef = this.reportRegistry.getReport(reportCode);
    if (!reportDef) {
      throw new NotFoundAppException('users.reportNotFound', { reportCode });
    }

    // 8.4.3 — Phân quyền xem báo cáo: Không dùng chung quyền với danh sách thông thường (`users.read`)
    if (!options?.bypassPermissionCheck) {
      assertDistinctReportPermission(reportDef.requiredPermission, actor);
    } else {
      assertDistinctReportPermission(reportDef.requiredPermission);
    }

    // 8.4.2 — Thiết lập & chuẩn hóa tham số báo cáo (Khoảng ngày, trạng thái, đơn vị và bộ lọc)
    const normalizedParams = this.extractNormalizedParameters(request);
    const fullRequest: RunUserReportRequest = {
      reportCode: reportDef.code,
      ...request,
    };

    // 8.4.4 — Chạy báo cáo nặng bằng Queue (tránh tải database trong request HTTP)
    const shouldQueue =
      !options?.skipQueuePublish &&
      Boolean(this.messagePublisher) &&
      (request.async === true || (reportDef.isHeavy && request.async !== false));

    if (shouldQueue) {
      const queuedHistory = this.reportRegistry.startReportHistory({
        reportCode: reportDef.code,
        module: reportDef.module,
        reportName: reportDef.name,
        actorId: actor?.id ?? null,
        scheduleId: options?.scheduleId ?? null,
        parameters: normalizedParams,
        executionMode: 'QUEUE',
        status: 'QUEUED',
        format: request.format ?? null,
        recipientEmails: request.recipientEmails ?? [],
        recipientUserIds: request.recipientUserIds ?? [],
      });

      const envelope = await this.enqueueUserReport(fullRequest, actor, queuedHistory.id);
      return {
        reportCode: reportDef.code,
        reportName: reportDef.name,
        module: reportDef.module,
        category: reportDef.category,
        requiredPermission: reportDef.requiredPermission,
        historyId: queuedHistory.id,
        jobId: envelope?.id ?? queuedHistory.jobId,
        status: 'QUEUED',
        executionMode: 'QUEUE',
        dataSourceUsed: 'PRIMARY',
        cacheHit: false,
        cacheKey: null,
        parameters: normalizedParams,
        totalRecords: 0,
        summary: {},
        rows: [],
        format: request.format ?? null,
        fileName: null,
        downloadToken: null,
        downloadUrl: null,
        expiresAt: null,
        notifiedChannels: [],
        startedAt: queuedHistory.startedAt,
        completedAt: null,
        durationMs: null,
      };
    }

    const executionMode: ReportExecutionMode =
      options?.executionMode ?? (options?.scheduleId ? 'SCHEDULED' : 'SYNC');

    const scopeFilter = await this.usersService.resolveUserScopeFilter(actor, 'report');
    const scopeKey = scopeFilter
      ? `${scopeFilter.effectiveScopeName}:${(scopeFilter.allowedOrganizationUnitIds ?? []).join(',')}:${(scopeFilter.allowedUserIds ?? []).join(',')}`
      : 'ALL';

    // 8.4.9 — Cache báo cáo phù hợp để giảm việc chạy lại cùng tham số
    const cacheKey = buildReportCacheKey(reportDef.code, normalizedParams, scopeKey);
    const canUseCache =
      request.useCache !== false && request.forceRefresh !== true && reportDef.cacheTtlSeconds > 0;
    const cachedEntry = canUseCache ? this.reportRegistry.getCachedReport(cacheKey) : null;

    const historyRecord =
      options?.existingHistoryId !== undefined
        ? (this.reportRegistry.getHistoryById(options.existingHistoryId) ??
          this.reportRegistry.startReportHistory({
            reportCode: reportDef.code,
            module: reportDef.module,
            reportName: reportDef.name,
            actorId: actor?.id ?? null,
            jobId: options.jobId ?? null,
            scheduleId: options.scheduleId ?? null,
            parameters: normalizedParams,
            executionMode,
            dataSourceUsed: cachedEntry ? 'CACHE' : 'PRIMARY',
            cacheHit: Boolean(cachedEntry),
            cacheKey,
            status: 'PROCESSING',
            format: request.format ?? null,
            recipientEmails: request.recipientEmails ?? [],
            recipientUserIds: request.recipientUserIds ?? [],
          }))
        : this.reportRegistry.startReportHistory({
            reportCode: reportDef.code,
            module: reportDef.module,
            reportName: reportDef.name,
            actorId: actor?.id ?? null,
            jobId: options?.jobId ?? null,
            scheduleId: options?.scheduleId ?? null,
            parameters: normalizedParams,
            executionMode,
            dataSourceUsed: cachedEntry ? 'CACHE' : 'PRIMARY',
            cacheHit: Boolean(cachedEntry),
            cacheKey,
            status: 'PROCESSING',
            format: request.format ?? null,
            recipientEmails: request.recipientEmails ?? [],
            recipientUserIds: request.recipientUserIds ?? [],
          });

    let summary: Readonly<Record<string, unknown>>;
    let rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    let totalRecords: number;
    let dataSourceUsed: 'REPLICA' | 'PRIMARY' | 'CACHE';
    let cacheHit = false;

    if (cachedEntry) {
      summary = cachedEntry.summary;
      rows = cachedEntry.rows;
      totalRecords = cachedEntry.totalRecords;
      dataSourceUsed = 'CACHE';
      cacheHit = true;
    } else {
      // 8.4.8 — Hỗ trợ đọc từ Read Replica khi hệ thống có cấu hình `replication`
      const preferReplica = reportDef.supportsReadReplica && (request.preferReplica ?? true);
      const computed = await this.computeReportData(
        reportDef,
        normalizedParams,
        scopeFilter,
        preferReplica,
      );
      summary = computed.summary;
      rows = computed.rows;
      totalRecords = computed.totalRecords;
      dataSourceUsed = computed.dataSourceUsed;

      if (canUseCache) {
        this.reportRegistry.setCachedReport({
          cacheKey,
          reportCode: reportDef.code,
          parameters: normalizedParams,
          totalRecords,
          summary,
          rows,
          dataSourceUsed: computed.dataSourceUsed,
          ttlSeconds: reportDef.cacheTtlSeconds,
        });
      }
    }

    // 8.4.6 — Tạo file báo cáo tạm có thời hạn (`expiresAt`) & gửi qua Email hoặc thông báo
    const requestedChannels = this.resolveDeliveryChannels(request);
    const shouldGenerateFile = Boolean(request.format) || requestedChannels.length > 0;
    let fileName: string | null = null;
    let downloadToken: string | null = null;
    let downloadUrl: string | null = null;
    let expiresAt: string | null = null;
    let resolvedFormat: ExportFormat | null = request.format
      ? resolveExportFormat(request.format, EXPORT_FORMAT.XLSX)
      : null;

    if (shouldGenerateFile) {
      const format = resolvedFormat ?? EXPORT_FORMAT.XLSX;
      resolvedFormat = format;
      const ttlSeconds =
        request.ttlSeconds ??
        this.settingRegistry.getNumber(
          'users.report.file_ttl_seconds',
          normalizedParams.organizationUnitId
            ? { organizationUnitId: normalizedParams.organizationUnitId }
            : undefined,
          DEFAULT_REPORT_FILE_TTL_SECONDS,
        );

      const artifact = await this.buildAndStoreTemporaryReportFile({
        reportDef,
        format,
        summary,
        rows,
        totalRecords,
        actorId: actor?.id ?? null,
        historyId: historyRecord.id,
        jobId: options?.jobId ?? historyRecord.jobId,
        ttlSeconds,
      });

      fileName = artifact.fileName;
      downloadToken = artifact.token;
      downloadUrl = artifact.downloadUrl;
      expiresAt = artifact.expiresAt;
    }

    let notifiedChannels: readonly ReportDeliveryChannel[] = [];
    if (requestedChannels.length > 0 && downloadToken && downloadUrl && expiresAt && fileName) {
      const delivery = await this.deliverReportNotification({
        historyId: historyRecord.id,
        scheduleId: options?.scheduleId ?? null,
        reportDef,
        channels: requestedChannels,
        recipientEmails: request.recipientEmails ?? (actor?.email ? [actor.email] : []),
        recipientUserIds:
          request.recipientUserIds && request.recipientUserIds.length > 0
            ? request.recipientUserIds
            : actor?.id
              ? [actor.id]
              : [],
        format: resolvedFormat ?? EXPORT_FORMAT.XLSX,
        fileName,
        totalRecords,
        downloadToken,
        downloadUrl,
        expiresAt,
        organizationUnitId: normalizedParams.organizationUnitId,
      });
      notifiedChannels = delivery.channels;
    }

    // 8.4.7 — Lưu lịch sử chạy báo cáo (Thời gian, người chạy và kết quả)
    const completedAt = new Date().toISOString();
    const updatedHistory =
      this.reportRegistry.updateReportHistory(historyRecord.id, {
        ...(options?.jobId ? { jobId: options.jobId } : {}),
        status: 'COMPLETED',
        executionMode,
        dataSourceUsed,
        cacheHit,
        cacheKey,
        format: resolvedFormat,
        fileName,
        totalRecords,
        summary,
        downloadToken,
        downloadUrl,
        expiresAt,
        notifiedChannels,
        completedAt,
      }) ?? historyRecord;

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'users',
        feature: 'user_report',
        action: 'USER_REPORT_EXECUTED',
        actorId: actor?.id ?? null,
        resourceType: 'user_report',
        resourceId: reportDef.code,
        reason: `Executed report ${reportDef.code} (${totalRecords} records, source: ${dataSourceUsed})`,
        afterData: {
          historyId: updatedHistory.id,
          reportCode: reportDef.code,
          parameters: normalizedParams,
          totalRecords,
          dataSourceUsed,
          cacheHit,
          downloadUrl,
          expiresAt,
        },
      });
    }

    return {
      reportCode: reportDef.code,
      reportName: reportDef.name,
      module: reportDef.module,
      category: reportDef.category,
      requiredPermission: reportDef.requiredPermission,
      historyId: updatedHistory.id,
      jobId: updatedHistory.jobId,
      status: 'COMPLETED',
      executionMode,
      dataSourceUsed,
      cacheHit,
      cacheKey,
      parameters: normalizedParams,
      totalRecords,
      summary,
      rows,
      format: resolvedFormat,
      fileName,
      downloadToken,
      downloadUrl,
      expiresAt,
      notifiedChannels,
      startedAt: updatedHistory.startedAt,
      completedAt: updatedHistory.completedAt,
      durationMs: updatedHistory.durationMs,
    };
  }

  /**
   * 8.4.5 — Lên lịch gửi báo cáo định kỳ theo ngày (`DAILY`), tuần (`WEEKLY`) hoặc tháng (`MONTHLY`).
   */
  public createReportSchedule(
    dto: CreateUserReportScheduleRequest,
    actor?: UserIdentity,
  ): ReportScheduleRecord {
    this.ensureModuleReportsRegistered();
    const reportCode = (dto.reportCode ?? 'users.summary_dashboard').trim().toLowerCase();
    const reportDef = this.reportRegistry.getReport(reportCode);
    if (!reportDef) {
      throw new NotFoundAppException('users.reportNotFound', { reportCode });
    }

    assertDistinctReportPermission(reportDef.requiredPermission, actor);

    return this.reportRegistry.createSchedule({
      reportCode: reportDef.code,
      module: reportDef.module,
      name: dto.name,
      frequency: dto.frequency,
      cronExpression: dto.cronExpression,
      hour: dto.hour,
      minute: dto.minute,
      dayOfWeek: dto.dayOfWeek ?? null,
      dayOfMonth: dto.dayOfMonth ?? null,
      timezone: dto.timezone ?? actor?.preferredTimezone ?? 'Asia/Ho_Chi_Minh',
      format: dto.format ?? 'xlsx',
      parameters: dto.parameters,
      channels: dto.channels ?? ['EMAIL', 'IN_APP'],
      recipientEmails: dto.recipientEmails ?? (actor?.email ? [actor.email] : []),
      recipientUserIds:
        dto.recipientUserIds && dto.recipientUserIds.length > 0
          ? dto.recipientUserIds
          : actor?.id
            ? [actor.id]
            : [],
      ttlSeconds: dto.ttlSeconds ?? DEFAULT_REPORT_FILE_TTL_SECONDS,
      actorId: actor?.id ?? null,
      isActive: dto.isActive ?? true,
    });
  }

  /**
   * 8.4.5 — Lấy danh sách lịch gửi báo cáo định kỳ của module `users`.
   */
  public listReportSchedules(query?: ListUserReportSchedulesQuery): ReportScheduleRecord[] {
    return this.reportRegistry.listSchedules({
      module: 'users',
      ...(query?.reportCode ? { reportCode: query.reportCode } : {}),
      ...(query?.frequency ? { frequency: query.frequency } : {}),
      ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
    });
  }

  /**
   * 8.4.5 & 8.4.6 — Kích hoạt thực thi các lịch báo cáo đã đến hạn (`nextRunAt <= now`),
   * tự động xuất file tạm có thời hạn (`expiresAt`) và gửi qua Email / thông báo.
   */
  public async triggerDueReportSchedules(now: Date = new Date()): Promise<{
    readonly triggeredCount: number;
    readonly results: ReadonlyArray<{
      readonly scheduleId: number;
      readonly reportCode: string;
      readonly historyId: number;
      readonly nextRunAt: string;
      readonly downloadUrl: string | null;
      readonly expiresAt: string | null;
      readonly notifiedChannels: readonly ReportDeliveryChannel[];
    }>;
  }> {
    return this.reportRegistry.triggerDueSchedules(now, { module: 'users' });
  }

  /**
   * 8.4.7 — Tra cứu danh sách lịch sử chạy báo cáo (Thời gian, người chạy và kết quả).
   */
  public listReportHistories(query?: ListUserReportHistoriesQuery): ReportExecutionHistoryRecord[] {
    return this.reportRegistry.listHistories({
      module: 'users',
      ...(query?.reportCode ? { reportCode: query.reportCode } : {}),
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.status ? { status: query.status } : {}),
      ...(query?.executionMode ? { executionMode: query.executionMode } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    });
  }

  /**
   * 8.4.7 — Xem chi tiết 1 bản ghi lịch sử chạy báo cáo theo ID.
   */
  public getReportHistoryById(historyId: number): ReportExecutionHistoryRecord {
    const record = this.reportRegistry.getHistoryById(historyId);
    if (!record || record.module !== 'users') {
      throw new NotFoundAppException('users.reportHistoryNotFound', { id: historyId });
    }
    return record;
  }

  /**
   * 8.4.6 — Tải xuống file báo cáo tạm thời qua token (tự động hết hạn theo `expiresAt`).
   */
  public downloadTemporaryReport(
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
    if (!artifact || artifact.profileCode !== USERS_REPORT_PROFILE_CODE) {
      this.reportRegistry.purgeExpiredReportArtifacts(now);
      throw new NotFoundAppException('users.reportFileExpired', { token });
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

  private extractNormalizedParameters(
    request: Partial<RunUserReportRequest>,
  ): NormalizedReportParameters {
    const nested: ReportParametersInput | undefined = request.parameters;
    return normalizeReportParameters({
      fromDate: request.fromDate ?? nested?.fromDate ?? null,
      toDate: request.toDate ?? nested?.toDate ?? null,
      status: (request.status ?? nested?.status ?? null) as
        string | number | readonly (string | number)[] | null,
      organizationUnitId: request.organizationUnitId ?? nested?.organizationUnitId ?? null,
      includeSubUnits: request.includeSubUnits ?? nested?.includeSubUnits ?? false,
      filters: {
        ...(nested?.filters ?? {}),
        ...(request.filters ?? {}),
      },
    });
  }

  private resolveDeliveryChannels(request: Partial<RunUserReportRequest>): ReportDeliveryChannel[] {
    const channelSet = new Set<ReportDeliveryChannel>(request.notifyChannels ?? []);
    if (request.recipientEmails && request.recipientEmails.length > 0) {
      channelSet.add('EMAIL');
    }
    if (request.recipientUserIds && request.recipientUserIds.length > 0) {
      channelSet.add('IN_APP');
    }
    return [...channelSet];
  }

  private async computeReportData(
    reportDef: RegisteredReportDefinition,
    params: NormalizedReportParameters,
    scopeFilter: Awaited<ReturnType<UsersService['resolveUserScopeFilter']>>,
    preferReplica: boolean,
  ): Promise<{
    readonly totalRecords: number;
    readonly summary: Readonly<Record<string, unknown>>;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    readonly dataSourceUsed: 'REPLICA' | 'PRIMARY';
  }> {
    const parsedStatuses = params.statuses
      .map((s) => {
        try {
          return parseUserStatus(s);
        } catch {
          return null;
        }
      })
      .filter((s): s is UserStatusCode => s !== null);

    const singleStatus = parsedStatuses.length === 1 ? parsedStatuses[0] : undefined;
    const roleIdFilter =
      typeof params.filters['roleId'] === 'number' && Number.isInteger(params.filters['roleId'])
        ? (params.filters['roleId'] as number)
        : undefined;
    const mfaEnabledFilter =
      typeof params.filters['mfaEnabled'] === 'boolean'
        ? (params.filters['mfaEnabled'] as boolean)
        : undefined;
    const managerIdFilter =
      typeof params.filters['managerId'] === 'number' &&
      Number.isInteger(params.filters['managerId'])
        ? (params.filters['managerId'] as number)
        : undefined;
    const keywordFilter =
      typeof params.filters['q'] === 'string' && params.filters['q'].trim().length > 0
        ? params.filters['q'].trim()
        : undefined;

    let allowedSubtreeUnitIds: Set<number> | null = null;
    if (
      params.organizationUnitId !== null &&
      params.includeSubUnits &&
      this.organizationsPublicService
    ) {
      const subtreeIds = this.organizationsPublicService.getSubtreeUnitIds
        ? await this.organizationsPublicService
            .getSubtreeUnitIds(params.organizationUnitId)
            .catch(() => [params.organizationUnitId!])
        : this.organizationsPublicService.resolveDescendantUnitIds
          ? await this.organizationsPublicService
              .resolveDescendantUnitIds([params.organizationUnitId])
              .catch(() => [params.organizationUnitId!])
          : [params.organizationUnitId];
      allowedSubtreeUnitIds = new Set([params.organizationUnitId, ...subtreeIds]);
    }

    const searchFilter: SearchUsersFilter = {
      ...(singleStatus !== undefined ? { status: singleStatus } : {}),
      ...(params.organizationUnitId !== null && !allowedSubtreeUnitIds
        ? { organizationUnitId: params.organizationUnitId }
        : {}),
      ...(params.fromDate ? { fromDate: params.fromDate } : {}),
      ...(params.toDate ? { toDate: params.toDate } : {}),
      ...(roleIdFilter !== undefined ? { roleId: roleIdFilter } : {}),
      ...(mfaEnabledFilter !== undefined ? { mfaEnabled: mfaEnabledFilter } : {}),
      ...(managerIdFilter !== undefined ? { managerId: managerIdFilter } : {}),
      ...(keywordFilter !== undefined ? { q: keywordFilter } : {}),
      ...(scopeFilter ? { scopeFilter } : {}),
      includeArchived: true,
      page: 1,
      limit: 5000,
    };

    const { items, dataSourceUsed } = await this.userRepository.searchPaginatedReadOnly(
      searchFilter,
      preferReplica,
    );

    const hydrated = await this.usersService.hydrateUsersList(items);

    const filteredUsers = hydrated.filter((user) => {
      if (parsedStatuses.length > 1 && !parsedStatuses.includes(user.status)) {
        return false;
      }
      if (allowedSubtreeUnitIds) {
        const inPrimary =
          user.primaryOrganizationUnitId !== null &&
          allowedSubtreeUnitIds.has(user.primaryOrganizationUnitId);
        const inAssigned = user.organizationUnits.some((ou) =>
          allowedSubtreeUnitIds.has(ou.organizationUnitId),
        );
        if (!inPrimary && !inAssigned) {
          return false;
        }
      }
      return true;
    });

    if (reportDef.code === 'users.security_compliance') {
      return {
        ...this.buildSecurityComplianceAggregation(filteredUsers, params),
        dataSourceUsed,
      };
    }

    return {
      ...this.buildSummaryDashboardAggregation(filteredUsers, params),
      dataSourceUsed,
    };
  }

  private buildSummaryDashboardAggregation(
    users: readonly UserResponse[],
    params: NormalizedReportParameters,
  ): {
    readonly totalRecords: number;
    readonly summary: Readonly<Record<string, unknown>>;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  } {
    let activeCount = 0;
    let inactiveCount = 0;
    let lockedCount = 0;
    let archivedCount = 0;
    let mfaEnabledCount = 0;

    const byOrganizationUnit = new Map<
      string,
      {
        organizationUnitId: number | null;
        organizationUnitName: string;
        totalUsers: number;
        activeUsers: number;
        inactiveUsers: number;
        lockedUsers: number;
        mfaEnabledUsers: number;
      }
    >();

    for (const u of users) {
      if (u.status === USER_STATUS.ACTIVE) activeCount++;
      else if (u.status === USER_STATUS.INACTIVE) inactiveCount++;
      else if (u.status === USER_STATUS.LOCKED) lockedCount++;
      else if (u.status === USER_STATUS.ARCHIVED) archivedCount++;

      if (u.mfaEnabled) mfaEnabledCount++;

      const primaryOrg =
        u.organizationUnits.find((o) => o.isPrimary) ?? u.organizationUnits[0] ?? null;
      const orgId = primaryOrg?.organizationUnitId ?? u.primaryOrganizationUnitId ?? null;
      const orgName = primaryOrg?.name ?? (orgId ? `Đơn vị #${orgId}` : 'Chưa phân bổ đơn vị');
      const key = String(orgId ?? 'unassigned');

      const bucket = byOrganizationUnit.get(key) ?? {
        organizationUnitId: orgId,
        organizationUnitName: orgName,
        totalUsers: 0,
        activeUsers: 0,
        inactiveUsers: 0,
        lockedUsers: 0,
        mfaEnabledUsers: 0,
      };

      bucket.totalUsers++;
      if (u.status === USER_STATUS.ACTIVE) bucket.activeUsers++;
      if (u.status === USER_STATUS.INACTIVE) bucket.inactiveUsers++;
      if (u.status === USER_STATUS.LOCKED) bucket.lockedUsers++;
      if (u.mfaEnabled) bucket.mfaEnabledUsers++;

      byOrganizationUnit.set(key, bucket);
    }

    const totalUsers = users.length;
    const mfaAdoptionRate =
      totalUsers > 0 ? Number(((mfaEnabledCount / totalUsers) * 100).toFixed(2)) : 0;

    const rows = [...byOrganizationUnit.values()].map((b) => ({
      organizationUnitId: b.organizationUnitId,
      organizationUnitName: b.organizationUnitName,
      totalUsers: b.totalUsers,
      activeUsers: b.activeUsers,
      inactiveUsers: b.inactiveUsers,
      lockedUsers: b.lockedUsers,
      mfaEnabledUsers: b.mfaEnabledUsers,
      mfaRatePercent:
        b.totalUsers > 0 ? Number(((b.mfaEnabledUsers / b.totalUsers) * 100).toFixed(2)) : 0,
    }));

    return {
      totalRecords: totalUsers,
      summary: {
        totalUsers,
        activeCount,
        inactiveCount,
        lockedCount,
        archivedCount,
        mfaEnabledCount,
        mfaDisabledCount: totalUsers - mfaEnabledCount,
        mfaAdoptionRate,
        dateRange: {
          fromDate: params.fromDate,
          toDate: params.toDate,
        },
        organizationUnitId: params.organizationUnitId,
      },
      rows,
    };
  }

  private buildSecurityComplianceAggregation(
    users: readonly UserResponse[],
    params: NormalizedReportParameters,
  ): {
    readonly totalRecords: number;
    readonly summary: Readonly<Record<string, unknown>>;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  } {
    let mfaDisabledCount = 0;
    let lockedAccountsCount = 0;
    let neverLoggedInCount = 0;
    let unverifiedEmailCount = 0;

    const rows: Array<Readonly<Record<string, unknown>>> = [];

    for (const u of users) {
      if (!u.mfaEnabled) mfaDisabledCount++;
      if (u.status === USER_STATUS.LOCKED) lockedAccountsCount++;
      if (!u.lastLoginAt) neverLoggedInCount++;
      if (!u.emailVerifiedAt) unverifiedEmailCount++;

      const riskFlags: string[] = [];
      if (!u.mfaEnabled) riskFlags.push('MFA_DISABLED');
      if (u.status === USER_STATUS.LOCKED) riskFlags.push('ACCOUNT_LOCKED');
      if (!u.lastLoginAt) riskFlags.push('NEVER_LOGGED_IN');
      if (!u.emailVerifiedAt) riskFlags.push('EMAIL_UNVERIFIED');

      const primaryOrg =
        u.organizationUnits.find((o) => o.isPrimary) ?? u.organizationUnits[0] ?? null;

      rows.push({
        userId: u.id,
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        status: u.status,
        statusName: u.statusName,
        organizationUnitId: primaryOrg?.organizationUnitId ?? u.primaryOrganizationUnitId,
        organizationUnitName: primaryOrg?.name ?? 'Chưa phân bổ',
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        failedLoginAttempts: u.failedLoginAttempts,
        riskFlags,
        isCompliant: riskFlags.length === 0,
      });
    }

    const totalUsers = users.length;
    const compliantCount = rows.filter((r) => r['isCompliant'] === true).length;
    const complianceRate =
      totalUsers > 0 ? Number(((compliantCount / totalUsers) * 100).toFixed(2)) : 100;

    return {
      totalRecords: totalUsers,
      summary: {
        totalUsers,
        compliantCount,
        nonCompliantCount: totalUsers - compliantCount,
        complianceRate,
        mfaDisabledCount,
        lockedAccountsCount,
        neverLoggedInCount,
        unverifiedEmailCount,
        dateRange: {
          fromDate: params.fromDate,
          toDate: params.toDate,
        },
        organizationUnitId: params.organizationUnitId,
      },
      rows,
    };
  }

  private async buildAndStoreTemporaryReportFile(params: {
    readonly reportDef: RegisteredReportDefinition;
    readonly format: ExportFormat;
    readonly summary: Readonly<Record<string, unknown>>;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    readonly totalRecords: number;
    readonly actorId: number | null;
    readonly historyId: number;
    readonly jobId: string | null;
    readonly ttlSeconds: number;
  }) {
    const datePart = new Date().toISOString().slice(0, 10);
    const safeCode = params.reportDef.code.replace(/[^a-z0-9_-]/gi, '_');
    const fileBaseName = `bao_cao_${safeCode}_${datePart}`;

    const sampleRow = params.rows[0] ?? params.summary;
    const headers = Object.keys(sampleRow);
    const matrixRows: Array<Array<string | number>> =
      params.rows.length > 0
        ? params.rows.map((row) =>
            headers.map((key) => {
              const val = row[key];
              if (val === null || val === undefined) return '';
              if (Array.isArray(val)) return val.join(', ');
              if (typeof val === 'object') return JSON.stringify(val);
              return typeof val === 'number' ? val : String(val);
            }),
          )
        : [
            headers.map((key) => {
              const val = params.summary[key];
              if (val === null || val === undefined) return '';
              if (typeof val === 'object') return JSON.stringify(val);
              return typeof val === 'number' ? val : String(val);
            }),
          ];

    const builtFile = await buildExportFileArtifact({
      fileBaseName,
      format: params.format,
      headers: headers.length > 0 ? headers : ['Chi_tieu', 'Gia_tri'],
      rows: matrixRows,
      xlsxOptions: {
        sheetName: 'Report',
        title: params.reportDef.name.toUpperCase(),
        subtitle: `Tổng số bản ghi: ${params.totalRecords}`,
        freezeHeader: true,
      },
      pdfOptions: {
        title: params.reportDef.name.toUpperCase(),
        subtitle: `Tổng số bản ghi: ${params.totalRecords}`,
        landscape: true,
      },
      pdfAdapter: this.exportRegistry.getPdfAdapter(),
      onlyRequestedFormat: true,
    });

    return this.exportRegistry.storeTemporaryArtifact({
      profileCode: USERS_REPORT_PROFILE_CODE,
      module: 'users',
      fileName: builtFile.fileName,
      format: params.format,
      contentType: builtFile.contentType,
      totalExported: params.totalRecords,
      buffer: builtFile.primaryBuffer,
      actorId: params.actorId,
      historyId: params.historyId,
      jobId: params.jobId,
      ttlSeconds: params.ttlSeconds,
      baseDownloadPath: '/api/v1/reports/downloads',
    });
  }

  private async deliverReportNotification(params: {
    readonly historyId: number;
    readonly scheduleId: number | null;
    readonly reportDef: RegisteredReportDefinition;
    readonly channels: readonly ReportDeliveryChannel[];
    readonly recipientEmails: readonly string[];
    readonly recipientUserIds: readonly number[];
    readonly format: ExportFormat;
    readonly fileName: string;
    readonly totalRecords: number;
    readonly downloadToken: string;
    readonly downloadUrl: string;
    readonly expiresAt: string;
    readonly organizationUnitId: number | null;
  }): Promise<ReportDeliveryNotification> {
    const recorded = this.reportRegistry.recordDeliveryNotification({
      historyId: params.historyId,
      scheduleId: params.scheduleId,
      reportCode: params.reportDef.code,
      reportName: params.reportDef.name,
      module: params.reportDef.module,
      channels: params.channels,
      recipientEmails: params.recipientEmails,
      recipientUserIds: params.recipientUserIds,
      format: params.format,
      fileName: params.fileName,
      totalRecords: params.totalRecords,
      downloadToken: params.downloadToken,
      downloadUrl: params.downloadUrl,
      expiresAt: params.expiresAt,
    });

    if (this.notificationsPublicService) {
      const targetUserId = params.recipientUserIds[0];
      await this.notificationsPublicService
        .dispatch({
          title: recorded.title,
          content: recorded.message,
          category: 'SYSTEM',
          priority: 'NORMAL',
          targetType: params.recipientUserIds.length > 1 ? 'USER_GROUP' : 'SINGLE_USER',
          ...(targetUserId ? { userId: targetUserId } : {}),
          ...(params.recipientUserIds.length > 1 ? { userIds: [...params.recipientUserIds] } : {}),
          channels: [...params.channels],
          actionUrl: params.downloadUrl,
          referenceModule: 'users',
          referenceType: 'user_report',
          referenceId: String(params.historyId),
          metadata: {
            reportCode: params.reportDef.code,
            channels: params.channels,
            recipientEmails: params.recipientEmails,
            downloadToken: params.downloadToken,
            downloadUrl: params.downloadUrl,
            expiresAt: params.expiresAt,
            fileName: params.fileName,
            format: params.format,
            totalRecords: params.totalRecords,
          },
          organizationUnitId: params.organizationUnitId,
        })
        .catch(() => null);
    }

    return recorded;
  }
}
