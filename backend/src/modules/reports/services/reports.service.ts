import { Injectable, Optional } from '@nestjs/common';
import {
  ExportRegistryService,
  NotFoundAppException,
  ReportRegistryService,
  defaultExportRegistry,
  defaultReportRegistry,
  normalizeReportParameters,
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type ExportFormat,
  type RegisteredReportDefinition,
  type ReportDeliveryChannel,
  type ReportExecutionHistoryRecord,
  type ReportScheduleRecord,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { UserReportService } from '@modules/users/index.js';
import type { IReportsPublicService } from '../contracts/index.js';
import type { ReportHistoryEntity } from '../entities/report-history.entity.js';
import type { ReportScheduleEntity } from '../entities/report-schedule.entity.js';
import { ReportHistoryRepository } from '../repositories/report-history.repository.js';
import { ReportScheduleRepository } from '../repositories/report-schedule.repository.js';
import type {
  CreateReportScheduleRequest,
  ListReportHistoriesQuery,
  ListReportSchedulesQuery,
  ListReportsQuery,
  RunReportRequest,
  UpdateReportScheduleRequest,
} from '../requests/reports.requests.js';
import type { ReportExecutionResponse } from '../responses/reports.response.js';

@Injectable()
export class ReportsService implements IReportsPublicService {
  private readonly reportRegistry: ReportRegistryService;
  private readonly exportRegistry: ExportRegistryService;

  constructor(
    @Optional() private readonly scheduleRepository?: ReportScheduleRepository,
    @Optional() private readonly historyRepository?: ReportHistoryRepository,
    @Optional() reportRegistry?: ReportRegistryService,
    @Optional() exportRegistry?: ExportRegistryService,
    @Optional() private readonly userReportService?: UserReportService,
  ) {
    this.reportRegistry = reportRegistry ?? defaultReportRegistry;
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
  }

  /** 8.4.1 — Danh sách các báo cáo & dashboard đã đăng ký trên toàn hệ thống */
  public listAvailableReports(query?: ListReportsQuery): RegisteredReportDefinition[] {
    this.userReportService?.ensureModuleReportsRegistered();
    this.reportRegistry.syncFromManifests();

    return this.reportRegistry.listReports({
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.category ? { category: query.category } : {}),
    });
  }

  /**
   * 8.4.2 → 8.4.9 — Thực thi báo cáo / dashboard (hỗ trợ Queue cho báo cáo nặng, Read Replica, Cache & file tạm)
   * và lưu lịch sử vào bảng `report_histories`.
   */
  public async runReport(
    request: Partial<RunReportRequest> = {},
    actor?: UserIdentity,
  ): Promise<ReportExecutionResponse> {
    this.userReportService?.ensureModuleReportsRegistered();
    this.reportRegistry.syncFromManifests();

    if (this.userReportService) {
      const result = await this.userReportService.runReport(request, actor);
      const memHistory = this.reportRegistry.getHistoryById(result.historyId);
      if (memHistory) {
        await this.persistHistoryToDb(memHistory);
      }
      return result;
    }

    throw new NotFoundAppException('reports.reportNotFound', {
      reportCode: request.reportCode ?? 'unknown',
    });
  }

  /** 8.4.5 — Lên lịch gửi báo cáo định kỳ (`DAILY` / `WEEKLY` / `MONTHLY`) và lưu vào bảng `report_schedules` */
  public async createReportSchedule(
    dto: CreateReportScheduleRequest,
    actor?: UserIdentity,
  ): Promise<ReportScheduleRecord> {
    this.userReportService?.ensureModuleReportsRegistered();
    this.reportRegistry.syncFromManifests();

    const record = this.userReportService
      ? this.userReportService.createReportSchedule(dto, actor)
      : this.reportRegistry.createSchedule({
          reportCode: dto.reportCode ?? 'users.summary_dashboard',
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
          ttlSeconds: dto.ttlSeconds ?? 3600,
          actorId: actor?.id ?? null,
          isActive: dto.isActive ?? true,
        });

    await this.persistScheduleToDb(record);
    return record;
  }

  /** 8.4.5 — Xem danh sách lịch gửi báo cáo định kỳ từ bảng `report_schedules` & Registry */
  public async listReportSchedules(
    query?: ListReportSchedulesQuery,
  ): Promise<ReportScheduleRecord[]> {
    const filter = {
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.reportCode ? { reportCode: query.reportCode } : {}),
      ...(query?.frequency ? { frequency: query.frequency } : {}),
      ...(query?.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const memList = this.reportRegistry.listSchedules(filter);
    if (!this.scheduleRepository) {
      return memList;
    }

    const dbEntities = await this.scheduleRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byId = new Map<number, ReportScheduleRecord>();
    for (const entity of dbEntities) {
      const mapped = this.mapScheduleEntityToRecord(entity);
      byId.set(mapped.id, mapped);
    }
    for (const mem of memList) {
      if (!byId.has(mem.id)) {
        byId.set(mem.id, mem);
      }
    }

    return [...byId.values()].sort((a, b) => b.id - a.id);
  }

  /** Xem chi tiết 1 lịch gửi báo cáo định kỳ theo ID */
  public async getReportScheduleById(scheduleId: number): Promise<ReportScheduleRecord> {
    const mem = this.reportRegistry.getScheduleById(scheduleId);
    if (mem) {
      return mem;
    }

    if (this.scheduleRepository) {
      const entity = await this.scheduleRepository.findById(scheduleId).catch(() => null);
      if (entity) {
        return this.mapScheduleEntityToRecord(entity);
      }
    }

    throw new NotFoundAppException('reports.reportScheduleNotFound', { id: scheduleId });
  }

  /** Cập nhật cấu hình lịch gửi báo cáo định kỳ (Sửa) và đồng bộ xuống bảng `report_schedules` */
  public async updateReportSchedule(
    scheduleId: number,
    dto: UpdateReportScheduleRequest,
  ): Promise<ReportScheduleRecord> {
    const updatedMem = this.reportRegistry.updateSchedule(scheduleId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
      ...(dto.cronExpression !== undefined ? { cronExpression: dto.cronExpression } : {}),
      ...(dto.hour !== undefined ? { hour: dto.hour } : {}),
      ...(dto.minute !== undefined ? { minute: dto.minute } : {}),
      ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
      ...(dto.dayOfMonth !== undefined ? { dayOfMonth: dto.dayOfMonth } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      ...(dto.format !== undefined ? { format: dto.format } : {}),
      ...(dto.parameters !== undefined ? { parameters: dto.parameters } : {}),
      ...(dto.channels !== undefined ? { channels: dto.channels } : {}),
      ...(dto.recipientEmails !== undefined ? { recipientEmails: dto.recipientEmails } : {}),
      ...(dto.recipientUserIds !== undefined ? { recipientUserIds: dto.recipientUserIds } : {}),
      ...(dto.ttlSeconds !== undefined ? { ttlSeconds: dto.ttlSeconds } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });

    if (updatedMem) {
      await this.persistScheduleToDb(updatedMem);
      return updatedMem;
    }

    if (this.scheduleRepository) {
      const updatedDb = await this.scheduleRepository
        .updateById(scheduleId, {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
          ...(dto.cronExpression !== undefined ? { cronExpression: dto.cronExpression } : {}),
          ...(dto.hour !== undefined ? { hour: dto.hour } : {}),
          ...(dto.minute !== undefined ? { minute: dto.minute } : {}),
          ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
          ...(dto.dayOfMonth !== undefined ? { dayOfMonth: dto.dayOfMonth } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.format !== undefined ? { format: dto.format } : {}),
          ...(dto.parameters !== undefined
            ? { parametersJson: JSON.stringify(normalizeReportParameters(dto.parameters)) }
            : {}),
          ...(dto.channels !== undefined ? { channelsJson: JSON.stringify(dto.channels) } : {}),
          ...(dto.recipientEmails !== undefined
            ? { recipientEmailsJson: JSON.stringify(dto.recipientEmails) }
            : {}),
          ...(dto.recipientUserIds !== undefined
            ? { recipientUserIdsJson: JSON.stringify(dto.recipientUserIds) }
            : {}),
          ...(dto.ttlSeconds !== undefined ? { ttlSeconds: dto.ttlSeconds } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        })
        .catch(() => null);

      if (updatedDb) {
        return this.mapScheduleEntityToRecord(updatedDb);
      }
    }

    throw new NotFoundAppException('reports.reportScheduleNotFound', { id: scheduleId });
  }

  /** Xóa lịch gửi báo cáo định kỳ khỏi Registry và bảng `report_schedules` (Xóa) */
  public async deleteReportSchedule(scheduleId: number): Promise<{
    readonly deleted: true;
    readonly id: number;
  }> {
    const deletedMem = this.reportRegistry.deleteSchedule(scheduleId);
    const deletedDb = this.scheduleRepository
      ? await this.scheduleRepository.deleteById(scheduleId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('reports.reportScheduleNotFound', { id: scheduleId });
    }

    return { deleted: true, id: scheduleId };
  }

  /** 8.4.5 & 8.4.6 — Kích hoạt thực thi các lịch báo cáo đã đến hạn kèm gửi Email / thông báo chứa file tạm */
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
    this.userReportService?.ensureModuleReportsRegistered();
    const res = await this.reportRegistry.triggerDueSchedules(now);

    for (const item of res.results) {
      const sched = this.reportRegistry.listSchedules().find((s) => s.id === item.scheduleId);
      if (sched) {
        await this.persistScheduleToDb(sched);
      }
      const hist = this.reportRegistry.getHistoryById(item.historyId);
      if (hist) {
        await this.persistHistoryToDb(hist);
      }
    }

    return res;
  }

  /** 8.4.7 — Xem danh sách lịch sử chạy báo cáo từ bảng `report_histories` & Registry */
  public async listReportHistories(
    query?: ListReportHistoriesQuery,
  ): Promise<ReportExecutionHistoryRecord[]> {
    const filter = {
      ...(query?.module ? { module: query.module } : {}),
      ...(query?.reportCode ? { reportCode: query.reportCode } : {}),
      ...(query?.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query?.status ? { status: query.status } : {}),
      ...(query?.executionMode ? { executionMode: query.executionMode } : {}),
      ...(query?.limit !== undefined ? { limit: query.limit } : {}),
    };

    const memList = this.reportRegistry.listHistories(filter);
    if (!this.historyRepository) {
      return memList;
    }

    const dbEntities = await this.historyRepository.listFiltered(filter).catch(() => []);
    if (dbEntities.length === 0) {
      return memList;
    }

    const byId = new Map<number, ReportExecutionHistoryRecord>();
    for (const entity of dbEntities) {
      const mapped = this.mapHistoryEntityToRecord(entity);
      byId.set(mapped.id, mapped);
    }
    for (const mem of memList) {
      if (!byId.has(mem.id)) {
        byId.set(mem.id, mem);
      }
    }

    const limit = Math.max(1, Math.min(200, query?.limit ?? 50));
    return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, limit);
  }

  /** 8.4.7 — Xem chi tiết 1 bản ghi lịch sử chạy báo cáo theo ID */
  public async getReportHistoryById(historyId: number): Promise<ReportExecutionHistoryRecord> {
    const mem = this.reportRegistry.getHistoryById(historyId);
    if (mem) {
      return mem;
    }

    if (this.historyRepository) {
      const entity = await this.historyRepository.findById(historyId).catch(() => null);
      if (entity) {
        return this.mapHistoryEntityToRecord(entity);
      }
    }

    throw new NotFoundAppException('reports.reportHistoryNotFound', { id: historyId });
  }

  /** Xóa bản ghi lịch sử chạy báo cáo khỏi Registry và bảng `report_histories` (Xóa) */
  public async deleteReportHistory(historyId: number): Promise<{
    readonly deleted: true;
    readonly id: number;
  }> {
    const deletedMem = this.reportRegistry.deleteHistory(historyId);
    const deletedDb = this.historyRepository
      ? await this.historyRepository.deleteById(historyId).catch(() => false)
      : false;

    if (!deletedMem && !deletedDb) {
      throw new NotFoundAppException('reports.reportHistoryNotFound', { id: historyId });
    }

    return { deleted: true, id: historyId };
  }

  /** 8.4.6 — Tải xuống file báo cáo tạm thời qua token (tự động chặn khi file đã hết hạn) */
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
    if (this.userReportService) {
      return this.userReportService.downloadTemporaryReport(token, now);
    }

    const artifact = this.exportRegistry.getTemporaryArtifactByToken(token, now);
    if (!artifact) {
      this.reportRegistry.purgeExpiredReportArtifacts(now);
      throw new NotFoundAppException('reports.reportFileExpired', { token });
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

  public async persistScheduleToDb(record: ReportScheduleRecord): Promise<void> {
    if (!this.scheduleRepository) return;
    try {
      const existing = await this.scheduleRepository.findById(record.id);
      await this.scheduleRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        reportCode: record.reportCode,
        module: record.module,
        name: record.name,
        frequency: record.frequency,
        cronExpression: record.cronExpression,
        hour: record.hour,
        minute: record.minute,
        dayOfWeek: record.dayOfWeek,
        dayOfMonth: record.dayOfMonth,
        timezone: record.timezone,
        format: record.format,
        parametersJson: JSON.stringify(record.parameters),
        channelsJson: JSON.stringify(record.channels),
        recipientEmailsJson: JSON.stringify(record.recipientEmails),
        recipientUserIdsJson: JSON.stringify(record.recipientUserIds),
        ttlSeconds: record.ttlSeconds,
        isActive: record.isActive,
        actorId: record.actorId,
        lastRunAt: record.lastRunAt ? new Date(record.lastRunAt) : null,
        nextRunAt: new Date(record.nextRunAt),
      });
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  public async persistHistoryToDb(record: ReportExecutionHistoryRecord): Promise<void> {
    if (!this.historyRepository) return;
    try {
      const existing = record.downloadToken
        ? await this.historyRepository.findByToken(record.downloadToken)
        : await this.historyRepository.findById(record.id);

      await this.historyRepository.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        reportCode: record.reportCode,
        module: record.module,
        reportName: record.reportName,
        actorId: record.actorId,
        jobId: record.jobId,
        scheduleId: record.scheduleId,
        parametersJson: JSON.stringify(record.parameters),
        executionMode: record.executionMode,
        dataSourceUsed: record.dataSourceUsed,
        cacheHit: record.cacheHit,
        cacheKey: record.cacheKey,
        status: record.status,
        format: record.format,
        fileName: record.fileName,
        totalRecords: record.totalRecords,
        summaryJson: JSON.stringify(record.summary ?? {}),
        downloadToken: record.downloadToken,
        downloadUrl: record.downloadUrl,
        expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
        isExpired: record.isExpired,
        notifiedChannelsJson: JSON.stringify(record.notifiedChannels ?? []),
        recipientEmailsJson: JSON.stringify(record.recipientEmails ?? []),
        recipientUserIdsJson: JSON.stringify(record.recipientUserIds ?? []),
        errorMessage: record.errorMessage,
        startedAt: new Date(record.startedAt),
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        durationMs: record.durationMs,
      });
    } catch {
      // Fallback an toàn cho môi trường test không bật DB
    }
  }

  private mapScheduleEntityToRecord(entity: ReportScheduleEntity): ReportScheduleRecord {
    const rawParams = safeJsonParseObject<Record<string, unknown>>(entity.parametersJson);
    const channels = safeJsonParse<ReportDeliveryChannel[]>(entity.channelsJson, []) ?? [];
    const recipientEmails = safeJsonParseStringArray(entity.recipientEmailsJson);
    const recipientUserIds = safeJsonParse<number[]>(entity.recipientUserIdsJson, []) ?? [];

    return {
      id: Number(entity.id),
      reportCode: entity.reportCode,
      module: entity.module,
      name: entity.name,
      frequency: entity.frequency,
      cronExpression: entity.cronExpression,
      hour: entity.hour,
      minute: entity.minute,
      dayOfWeek: entity.dayOfWeek,
      dayOfMonth: entity.dayOfMonth,
      timezone: entity.timezone,
      format: entity.format,
      parameters: normalizeReportParameters(rawParams),
      channels: channels.length > 0 ? channels : ['EMAIL', 'IN_APP'],
      recipientEmails,
      recipientUserIds,
      ttlSeconds: entity.ttlSeconds,
      actorId: entity.actorId,
      isActive: entity.isActive,
      lastRunAt:
        entity.lastRunAt instanceof Date
          ? entity.lastRunAt.toISOString()
          : entity.lastRunAt
            ? String(entity.lastRunAt)
            : null,
      nextRunAt:
        entity.nextRunAt instanceof Date
          ? entity.nextRunAt.toISOString()
          : String(entity.nextRunAt),
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  private mapHistoryEntityToRecord(entity: ReportHistoryEntity): ReportExecutionHistoryRecord {
    const rawParams = safeJsonParseObject<Record<string, unknown>>(entity.parametersJson);
    const summary = safeJsonParseObject<Record<string, unknown>>(entity.summaryJson);
    const notifiedChannels =
      safeJsonParse<ReportDeliveryChannel[]>(entity.notifiedChannelsJson, []) ?? [];
    const recipientEmails = safeJsonParseStringArray(entity.recipientEmailsJson);
    const recipientUserIds = safeJsonParse<number[]>(entity.recipientUserIdsJson, []) ?? [];

    return {
      id: Number(entity.id),
      reportCode: entity.reportCode,
      module: entity.module,
      reportName: entity.reportName,
      actorId: entity.actorId,
      jobId: entity.jobId,
      scheduleId: entity.scheduleId,
      parameters: normalizeReportParameters(rawParams),
      executionMode: entity.executionMode,
      dataSourceUsed: entity.dataSourceUsed,
      cacheHit: entity.cacheHit,
      cacheKey: entity.cacheKey,
      status: entity.status,
      format: entity.format,
      fileName: entity.fileName,
      totalRecords: entity.totalRecords,
      summary,
      downloadToken: entity.downloadToken,
      downloadUrl: entity.downloadUrl,
      expiresAt:
        entity.expiresAt instanceof Date
          ? entity.expiresAt.toISOString()
          : entity.expiresAt
            ? String(entity.expiresAt)
            : null,
      isExpired: entity.isExpired,
      notifiedChannels,
      recipientEmails,
      recipientUserIds,
      errorMessage: entity.errorMessage,
      startedAt:
        entity.startedAt instanceof Date
          ? entity.startedAt.toISOString()
          : String(entity.startedAt),
      completedAt:
        entity.completedAt instanceof Date
          ? entity.completedAt.toISOString()
          : entity.completedAt
            ? String(entity.completedAt)
            : null,
      durationMs: entity.durationMs,
    };
  }
}
