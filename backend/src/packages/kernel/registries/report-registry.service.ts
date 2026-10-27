import { Injectable, Optional } from '@nestjs/common';
import {
  EXPORT_FORMAT,
  type ExportFormat,
  resolveExportFormat,
} from '../contracts/export.contract.js';
import {
  type CachedReportEntry,
  type NormalizedReportParameters,
  type RegisteredReportDefinition,
  type ReportDataSourceType,
  type ReportDeliveryChannel,
  type ReportDeliveryNotification,
  type ReportExecutionHistoryRecord,
  type ReportExecutionMode,
  type ReportJobStatus,
  type ReportManifestItem,
  type ReportParametersInput,
  type ReportQueueWorkerExecutor,
  type ReportScheduleFrequency,
  type ReportScheduleRecord,
  type TriggeredReportScheduleItemResult,
  REPORT_SCHEDULE_FREQUENCY,
  discoverManifestReports,
} from '../contracts/report.contract.js';
import { BadRequestAppException } from '../errors/http-exceptions.js';
import { NotFoundAppException } from '../errors/not-found.exception.js';
import {
  computeNextReportScheduleRun,
  isDistinctReportPermission,
  normalizeReportParameters,
  resolveReportScheduleCron,
} from '../utils/report-engine.util.js';
import { ExportRegistryService, defaultExportRegistry } from './export-registry.service.js';

const DEFAULT_REPORT_CACHE_TTL_SECONDS = 300;
const DEFAULT_REPORT_FILE_TTL_SECONDS = 3_600;
const DEFAULT_HEAVY_RECORD_THRESHOLD = 1_000;

export interface StartReportHistoryInput {
  readonly reportCode: string;
  readonly module: string;
  readonly reportName?: string | undefined;
  readonly actorId?: number | null | undefined;
  readonly jobId?: string | null | undefined;
  readonly scheduleId?: number | null | undefined;
  readonly parameters: NormalizedReportParameters;
  readonly executionMode?: ReportExecutionMode | undefined;
  readonly dataSourceUsed?: ReportDataSourceType | undefined;
  readonly cacheHit?: boolean | undefined;
  readonly cacheKey?: string | null | undefined;
  readonly status?: ReportJobStatus | undefined;
  readonly format?: ExportFormat | null | undefined;
  readonly recipientEmails?: readonly string[] | undefined;
  readonly recipientUserIds?: readonly number[] | undefined;
  readonly startedAt?: string | undefined;
}

export interface UpdateReportHistoryInput {
  readonly jobId?: string | null | undefined;
  readonly status?: ReportJobStatus | undefined;
  readonly executionMode?: ReportExecutionMode | undefined;
  readonly dataSourceUsed?: ReportDataSourceType | undefined;
  readonly cacheHit?: boolean | undefined;
  readonly cacheKey?: string | null | undefined;
  readonly format?: ExportFormat | null | undefined;
  readonly fileName?: string | null | undefined;
  readonly totalRecords?: number | undefined;
  readonly summary?: Readonly<Record<string, unknown>> | null | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly isExpired?: boolean | undefined;
  readonly notifiedChannels?: readonly ReportDeliveryChannel[] | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
}

export interface CreateReportScheduleInput {
  readonly reportCode: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly frequency: ReportScheduleFrequency;
  readonly cronExpression?: string | null | undefined;
  readonly hour?: number | undefined;
  readonly minute?: number | undefined;
  readonly dayOfWeek?: number | null | undefined;
  readonly dayOfMonth?: number | null | undefined;
  readonly timezone?: string | undefined;
  readonly format?: ExportFormat | string | undefined;
  readonly parameters?: ReportParametersInput | null | undefined;
  readonly channels?: readonly ReportDeliveryChannel[] | undefined;
  readonly recipientEmails?: readonly string[] | undefined;
  readonly recipientUserIds?: readonly number[] | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly actorId?: number | null | undefined;
  readonly isActive?: boolean | undefined;
}

/**
 * Registry & Dịch vụ quản lý tập trung **Báo cáo & Dashboard (`ReportRegistryService`)** trên toàn hệ thống (Mục 8.4):
 * - 8.4.1: Quét tự động danh sách báo cáo khai báo trong `module.manifest.json` của từng module (`syncFromManifests`).
 * - 8.4.3: Kiểm tra quyền xem báo cáo riêng biệt (cấm dùng chung quyền `*.read` của danh sách thông thường).
 * - 8.4.5: Quản lý lịch gửi báo cáo định kỳ theo ngày (`DAILY`), tuần (`WEEKLY`) hoặc tháng (`MONTHLY`).
 * - 8.4.6: Ghi nhận thông báo gửi báo cáo qua Email / In-App kèm file tạm có thời hạn (`expiresAt`).
 * - 8.4.7: Lưu trữ lịch sử chạy báo cáo (thời gian, người chạy, tham số, nguồn dữ liệu và kết quả).
 * - 8.4.9: Lưu trữ và tra cứu Cache kết quả báo cáo theo chữ ký tham số (`cacheKey`) có TTL.
 */
@Injectable()
export class ReportRegistryService {
  private readonly definitions = new Map<string, RegisteredReportDefinition>();
  private readonly workerExecutors = new Map<string, ReportQueueWorkerExecutor>();
  private readonly cacheEntries = new Map<string, CachedReportEntry>();
  private readonly histories: ReportExecutionHistoryRecord[] = [];
  private readonly schedules: ReportScheduleRecord[] = [];
  private readonly notifications: ReportDeliveryNotification[] = [];
  private readonly exportRegistry: ExportRegistryService;
  private historySeq = 0;
  private scheduleSeq = 0;
  private notificationSeq = 0;

  constructor(@Optional() exportRegistry?: ExportRegistryService) {
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.syncFromManifests();
  }

  /**
   * 8.4.4 — Đăng ký bộ thực thi Báo cáo nền (`ReportQueueWorkerExecutor`) của module vào Registry
   * để `HeavyJobProcessor` tự động điều phối theo `reportCode`, `module` hoặc `topic` mà không cần hardcode.
   */
  public registerWorkerExecutor(executor: ReportQueueWorkerExecutor): void {
    const moduleKey = executor.module.trim().toLowerCase();
    const topicKey = executor.topic?.trim().toLowerCase() || `${moduleKey}.report`;

    if (moduleKey) {
      this.workerExecutors.set(`module:${moduleKey}`, executor);
    }
    if (topicKey) {
      this.workerExecutors.set(`topic:${topicKey}`, executor);
    }
    if (Array.isArray(executor.reportCodes)) {
      for (const code of executor.reportCodes) {
        const normalizedCode = code.trim().toLowerCase();
        if (normalizedCode) {
          this.workerExecutors.set(`report:${normalizedCode}`, executor);
        }
      }
    }
  }

  /**
   * 8.4.4 — Tra cứu bộ thực thi Báo cáo nền theo `reportCode`, `module` hoặc `topic` (ví dụ: `'users.report'`, `'users.security_compliance'`).
   */
  public resolveWorkerExecutor(lookup: {
    readonly reportCode?: string | undefined;
    readonly module?: string | undefined;
    readonly topic?: string | undefined;
  }): ReportQueueWorkerExecutor | undefined {
    if (lookup.reportCode?.trim()) {
      const normalizedCode = lookup.reportCode.trim().toLowerCase();
      const byCode = this.workerExecutors.get(`report:${normalizedCode}`);
      if (byCode) return byCode;

      const def = this.definitions.get(normalizedCode);
      if (def?.module) {
        const byDefModule = this.workerExecutors.get(`module:${def.module}`);
        if (byDefModule) return byDefModule;
      }

      const codePrefix = normalizedCode.split('.')[0];
      if (codePrefix) {
        const byPrefix = this.workerExecutors.get(`module:${codePrefix}`);
        if (byPrefix) return byPrefix;
      }
    }
    if (lookup.module?.trim()) {
      const byModule = this.workerExecutors.get(`module:${lookup.module.trim().toLowerCase()}`);
      if (byModule) return byModule;
    }
    if (lookup.topic?.trim()) {
      const normalizedTopic = lookup.topic.trim().toLowerCase();
      const byTopic = this.workerExecutors.get(`topic:${normalizedTopic}`);
      if (byTopic) return byTopic;
      const topicPrefix = normalizedTopic.endsWith('.report')
        ? normalizedTopic.slice(0, -'.report'.length)
        : null;
      if (topicPrefix) {
        const byPrefix = this.workerExecutors.get(`module:${topicPrefix}`);
        if (byPrefix) return byPrefix;
      }
    }
    return undefined;
  }

  /**
   * 8.4.1 — Tự động quét và đăng ký danh mục báo cáo từ tất cả các tệp `module.manifest.json`.
   */
  public syncFromManifests(): void {
    const discovered = discoverManifestReports();
    this.registerManifestReports(discovered);
  }

  /** Đăng ký danh sách báo cáo quét được từ manifest */
  public registerManifestReports(items: readonly ReportManifestItem[]): void {
    for (const item of items) {
      this.registerReport(item);
    }
  }

  /**
   * 8.4.1 & 8.4.3 — Đăng ký định nghĩa một báo cáo của module.
   * Chặn ngay nếu `requiredPermission` dùng chung quyền đọc danh sách thông thường (`*.read`, `*.list`).
   */
  public registerReport(item: ReportManifestItem): RegisteredReportDefinition {
    const code = item.code.trim().toLowerCase();
    const moduleName = (item.module ?? code.split('.')[0] ?? 'core').trim().toLowerCase();
    const requiredPermission = item.requiredPermission.trim().toLowerCase();

    if (!isDistinctReportPermission(requiredPermission)) {
      throw new BadRequestAppException('report.sharedListPermissionForbidden', [
        {
          reportCode: code,
          requiredPermission,
          reason:
            'Report permission cannot share the standard list read permission (*.read / *.list)',
        },
      ]);
    }

    const registered: RegisteredReportDefinition = {
      code,
      module: moduleName,
      name: item.name.trim(),
      description: item.description ?? null,
      category: item.category === 'DASHBOARD' ? 'DASHBOARD' : 'REPORT',
      requiredPermission,
      isHeavy: Boolean(item.isHeavy),
      heavyRecordThreshold: Math.max(
        1,
        item.heavyRecordThreshold ?? DEFAULT_HEAVY_RECORD_THRESHOLD,
      ),
      cacheTtlSeconds: Math.max(0, item.cacheTtlSeconds ?? DEFAULT_REPORT_CACHE_TTL_SECONDS),
      supportsReadReplica: item.supportsReadReplica !== false,
      supportedFormats: item.supportedFormats?.length
        ? [...item.supportedFormats]
        : [EXPORT_FORMAT.XLSX, EXPORT_FORMAT.CSV, EXPORT_FORMAT.PDF],
      parameters: item.parameters ? [...item.parameters] : [],
      isSystem: item.isSystem !== false,
      status: item.status ?? 1,
    };

    this.definitions.set(code, registered);
    return registered;
  }

  /** Lấy định nghĩa của một báo cáo theo `reportCode` */
  public getReport(reportCode: string): RegisteredReportDefinition | undefined {
    return this.definitions.get(reportCode.trim().toLowerCase());
  }

  /** Liệt kê danh sách báo cáo đã đăng ký (lọc theo `module`, `category`, `isHeavy` — Mục 8.4.1) */
  public listReports(filter?: {
    readonly module?: string | undefined;
    readonly category?: 'REPORT' | 'DASHBOARD' | undefined;
    readonly isHeavy?: boolean | undefined;
  }): RegisteredReportDefinition[] {
    let list = [...this.definitions.values()];
    if (filter?.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((r) => r.module === mod);
    }
    if (filter?.category) {
      list = list.filter((r) => r.category === filter.category);
    }
    if (filter?.isHeavy !== undefined) {
      list = list.filter((r) => r.isHeavy === filter.isHeavy);
    }
    return list;
  }

  /**
   * 8.4.9 — Đọc kết quả báo cáo từ Cache theo `cacheKey`.
   * Nếu mục cache đã hết hạn (`expiresAt <= now`), tự động xóa và trả về `null`.
   */
  public getCachedReport(cacheKey: string, now: Date = new Date()): CachedReportEntry | null {
    const entry = this.cacheEntries.get(cacheKey);
    if (!entry) return null;
    if (Date.parse(entry.expiresAt) <= now.getTime()) {
      this.cacheEntries.delete(cacheKey);
      return null;
    }
    return entry;
  }

  /**
   * 8.4.9 — Lưu kết quả báo cáo vào Cache với thời hạn `ttlSeconds` để giảm chạy lại cùng tham số.
   */
  public setCachedReport(params: {
    readonly cacheKey: string;
    readonly reportCode: string;
    readonly parameters: NormalizedReportParameters;
    readonly totalRecords: number;
    readonly summary: Readonly<Record<string, unknown>>;
    readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
    readonly dataSourceUsed: 'REPLICA' | 'PRIMARY';
    readonly ttlSeconds?: number | undefined;
    readonly now?: Date | undefined;
  }): CachedReportEntry | null {
    const ttl = params.ttlSeconds ?? DEFAULT_REPORT_CACHE_TTL_SECONDS;
    if (ttl <= 0) return null;

    const now = params.now ?? new Date();
    const entry: CachedReportEntry = {
      cacheKey: params.cacheKey,
      reportCode: params.reportCode.trim().toLowerCase(),
      parameters: params.parameters,
      totalRecords: params.totalRecords,
      summary: params.summary,
      rows: params.rows,
      dataSourceUsed: params.dataSourceUsed,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1_000).toISOString(),
    };

    this.cacheEntries.set(params.cacheKey, entry);
    return entry;
  }

  /** Xóa cache báo cáo (theo `reportCode` hoặc toàn bộ) */
  public invalidateReportCache(reportCode?: string): number {
    if (!reportCode?.trim()) {
      const count = this.cacheEntries.size;
      this.cacheEntries.clear();
      return count;
    }
    const target = reportCode.trim().toLowerCase();
    let removed = 0;
    for (const [key, entry] of this.cacheEntries.entries()) {
      if (entry.reportCode === target) {
        this.cacheEntries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * 8.4.7 — Khởi tạo bản ghi Lịch sử chạy báo cáo mới (ghi nhận thời gian bắt đầu, người chạy và tham số).
   */
  public startReportHistory(input: StartReportHistoryInput): ReportExecutionHistoryRecord {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const id = ++this.historySeq;
    const def = this.getReport(input.reportCode);
    const record: ReportExecutionHistoryRecord = {
      id,
      jobId: input.jobId ?? `rpt_job_${id}`,
      scheduleId: input.scheduleId ?? null,
      reportCode: input.reportCode.trim().toLowerCase(),
      module: input.module.trim().toLowerCase(),
      reportName: input.reportName ?? def?.name ?? input.reportCode,
      actorId: input.actorId ?? null,
      parameters: input.parameters,
      executionMode: input.executionMode ?? 'SYNC',
      dataSourceUsed: input.dataSourceUsed ?? 'PRIMARY',
      cacheHit: Boolean(input.cacheHit),
      cacheKey: input.cacheKey ?? null,
      status: input.status ?? 'PROCESSING',
      format: input.format ?? null,
      fileName: null,
      totalRecords: 0,
      summary: null,
      downloadToken: null,
      downloadUrl: null,
      expiresAt: null,
      isExpired: false,
      notifiedChannels: [],
      recipientEmails: input.recipientEmails ? [...input.recipientEmails] : [],
      recipientUserIds: input.recipientUserIds ? [...input.recipientUserIds] : [],
      errorMessage: null,
      startedAt,
      completedAt: null,
      durationMs: null,
    };

    this.histories.unshift(record);
    if (this.histories.length > 1000) {
      this.histories.pop();
    }
    return record;
  }

  /**
   * 8.4.7 — Cập nhật bản ghi Lịch sử chạy báo cáo (thời gian hoàn tất, tổng thời gian chạy, nguồn dữ liệu & kết quả).
   */
  public updateReportHistory(
    historyId: number,
    update: UpdateReportHistoryInput,
  ): ReportExecutionHistoryRecord | null {
    const idx = this.histories.findIndex((h) => h.id === Number(historyId));
    if (idx < 0) return null;

    const current = this.histories[idx]!;
    const completedAt = update.completedAt !== undefined ? update.completedAt : current.completedAt;
    const durationMs =
      completedAt !== null
        ? Math.max(0, Date.parse(completedAt) - Date.parse(current.startedAt))
        : current.durationMs;

    const updated: ReportExecutionHistoryRecord = {
      ...current,
      jobId: update.jobId !== undefined ? update.jobId : current.jobId,
      status: update.status ?? current.status,
      executionMode: update.executionMode ?? current.executionMode,
      dataSourceUsed: update.dataSourceUsed ?? current.dataSourceUsed,
      cacheHit: update.cacheHit !== undefined ? update.cacheHit : current.cacheHit,
      cacheKey: update.cacheKey !== undefined ? update.cacheKey : current.cacheKey,
      format: update.format !== undefined ? update.format : current.format,
      fileName: update.fileName !== undefined ? update.fileName : current.fileName,
      totalRecords: update.totalRecords ?? current.totalRecords,
      summary: update.summary !== undefined ? update.summary : current.summary,
      downloadToken:
        update.downloadToken !== undefined ? update.downloadToken : current.downloadToken,
      downloadUrl: update.downloadUrl !== undefined ? update.downloadUrl : current.downloadUrl,
      expiresAt: update.expiresAt !== undefined ? update.expiresAt : current.expiresAt,
      isExpired: update.isExpired !== undefined ? update.isExpired : current.isExpired,
      notifiedChannels: update.notifiedChannels
        ? [...update.notifiedChannels]
        : current.notifiedChannels,
      errorMessage: update.errorMessage !== undefined ? update.errorMessage : current.errorMessage,
      completedAt,
      durationMs,
    };

    this.histories[idx] = updated;
    return updated;
  }

  /** Xem chi tiết một bản ghi Lịch sử chạy báo cáo theo ID */
  public getHistoryById(id: number, now: Date = new Date()): ReportExecutionHistoryRecord | null {
    this.purgeExpiredReportArtifacts(now);
    const found = this.histories.find((h) => h.id === Number(id));
    return found ?? null;
  }

  /** Xóa một bản ghi Lịch sử chạy báo cáo theo ID */
  public deleteHistory(id: number): boolean {
    const idx = this.histories.findIndex((h) => h.id === Number(id));
    if (idx < 0) {
      return false;
    }
    this.histories.splice(idx, 1);
    return true;
  }

  /** Tra cứu danh sách Lịch sử chạy báo cáo theo bộ lọc (Mục 8.4.7) */
  public listHistories(
    filter: {
      readonly reportCode?: string | undefined;
      readonly module?: string | undefined;
      readonly actorId?: number | undefined;
      readonly status?: ReportJobStatus | undefined;
      readonly executionMode?: ReportExecutionMode | undefined;
      readonly limit?: number | undefined;
    } = {},
    now: Date = new Date(),
  ): ReportExecutionHistoryRecord[] {
    this.purgeExpiredReportArtifacts(now);
    let list = [...this.histories];

    if (filter.reportCode?.trim()) {
      const code = filter.reportCode.trim().toLowerCase();
      list = list.filter((h) => h.reportCode === code);
    }
    if (filter.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((h) => h.module === mod);
    }
    if (filter.actorId !== undefined) {
      list = list.filter((h) => Number(h.actorId) === Number(filter.actorId));
    }
    if (filter.status) {
      list = list.filter((h) => h.status === filter.status);
    }
    if (filter.executionMode) {
      list = list.filter((h) => h.executionMode === filter.executionMode);
    }

    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    return list.slice(0, limit);
  }

  /**
   * 8.4.5 — Tạo lịch gửi báo cáo định kỳ theo ngày (`DAILY`), tuần (`WEEKLY`) hoặc tháng (`MONTHLY`).
   */
  public createSchedule(input: CreateReportScheduleInput): ReportScheduleRecord {
    const code = input.reportCode.trim().toLowerCase();
    const def = this.getReport(code);
    if (!def) {
      throw new NotFoundAppException('report.definitionNotFound', { reportCode: code });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const id = ++this.scheduleSeq;
    const frequency: ReportScheduleFrequency =
      input.frequency === REPORT_SCHEDULE_FREQUENCY.WEEKLY ||
      input.frequency === REPORT_SCHEDULE_FREQUENCY.MONTHLY
        ? input.frequency
        : REPORT_SCHEDULE_FREQUENCY.DAILY;

    const hour = input.hour !== undefined ? Math.min(23, Math.max(0, Math.trunc(input.hour))) : 8;
    const minute =
      input.minute !== undefined ? Math.min(59, Math.max(0, Math.trunc(input.minute))) : 0;
    const dayOfWeek =
      frequency === REPORT_SCHEDULE_FREQUENCY.WEEKLY
        ? (input.dayOfWeek ?? 1)
        : (input.dayOfWeek ?? null);
    const dayOfMonth =
      frequency === REPORT_SCHEDULE_FREQUENCY.MONTHLY
        ? (input.dayOfMonth ?? 1)
        : (input.dayOfMonth ?? null);

    const nextRunDate = computeNextReportScheduleRun(
      frequency,
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      now,
    );

    const record: ReportScheduleRecord = {
      id,
      reportCode: code,
      module: (input.module ?? def.module).trim().toLowerCase(),
      name: input.name.trim(),
      frequency,
      cronExpression: resolveReportScheduleCron(
        frequency,
        hour,
        minute,
        dayOfWeek,
        dayOfMonth,
        input.cronExpression,
      ),
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
      format: resolveExportFormat(input.format, EXPORT_FORMAT.XLSX),
      parameters: normalizeReportParameters(input.parameters),
      channels: input.channels?.length ? [...new Set(input.channels)] : ['EMAIL', 'IN_APP'],
      recipientEmails: input.recipientEmails
        ? [...new Set(input.recipientEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
        : [],
      recipientUserIds: input.recipientUserIds ? [...new Set(input.recipientUserIds)] : [],
      ttlSeconds: Math.max(60, input.ttlSeconds ?? DEFAULT_REPORT_FILE_TTL_SECONDS),
      actorId: input.actorId ?? null,
      isActive: input.isActive !== false,
      lastRunAt: null,
      nextRunAt: nextRunDate.toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.schedules.unshift(record);
    return record;
  }

  /** Liệt kê danh sách lịch gửi báo cáo định kỳ */
  public listSchedules(filter?: {
    readonly module?: string | undefined;
    readonly reportCode?: string | undefined;
    readonly frequency?: ReportScheduleFrequency | undefined;
    readonly isActive?: boolean | undefined;
  }): ReportScheduleRecord[] {
    let list = [...this.schedules];
    if (filter?.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((s) => s.module === mod);
    }
    if (filter?.reportCode?.trim()) {
      const code = filter.reportCode.trim().toLowerCase();
      list = list.filter((s) => s.reportCode === code);
    }
    if (filter?.frequency) {
      list = list.filter((s) => s.frequency === filter.frequency);
    }
    if (filter?.isActive !== undefined) {
      list = list.filter((s) => s.isActive === filter.isActive);
    }
    return list;
  }

  /** Xem chi tiết một lịch gửi báo cáo định kỳ theo ID */
  public getScheduleById(scheduleId: number): ReportScheduleRecord | null {
    return this.schedules.find((s) => s.id === Number(scheduleId)) ?? null;
  }

  /** Cập nhật lịch gửi báo cáo định kỳ theo ID */
  public updateSchedule(
    scheduleId: number,
    patch: Partial<CreateReportScheduleInput>,
  ): ReportScheduleRecord | null {
    const idx = this.schedules.findIndex((s) => s.id === Number(scheduleId));
    if (idx < 0) {
      return null;
    }

    const current = this.schedules[idx]!;
    const now = new Date();
    const nowIso = now.toISOString();

    const frequency: ReportScheduleFrequency =
      patch.frequency === REPORT_SCHEDULE_FREQUENCY.DAILY ||
      patch.frequency === REPORT_SCHEDULE_FREQUENCY.WEEKLY ||
      patch.frequency === REPORT_SCHEDULE_FREQUENCY.MONTHLY
        ? patch.frequency
        : current.frequency;

    const hour =
      patch.hour !== undefined ? Math.min(23, Math.max(0, Math.trunc(patch.hour))) : current.hour;
    const minute =
      patch.minute !== undefined
        ? Math.min(59, Math.max(0, Math.trunc(patch.minute)))
        : current.minute;
    const dayOfWeek = patch.dayOfWeek !== undefined ? patch.dayOfWeek : current.dayOfWeek;
    const dayOfMonth = patch.dayOfMonth !== undefined ? patch.dayOfMonth : current.dayOfMonth;

    const nextRunDate = computeNextReportScheduleRun(
      frequency,
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      now,
    );

    const updated: ReportScheduleRecord = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      frequency,
      cronExpression: resolveReportScheduleCron(
        frequency,
        hour,
        minute,
        dayOfWeek,
        dayOfMonth,
        patch.cronExpression,
      ),
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      timezone: patch.timezone !== undefined ? patch.timezone : current.timezone,
      format:
        patch.format !== undefined
          ? resolveExportFormat(patch.format, current.format)
          : current.format,
      parameters:
        patch.parameters !== undefined
          ? normalizeReportParameters(patch.parameters)
          : current.parameters,
      channels:
        patch.channels !== undefined && patch.channels.length > 0
          ? [...new Set(patch.channels)]
          : current.channels,
      recipientEmails:
        patch.recipientEmails !== undefined
          ? [...new Set(patch.recipientEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
          : current.recipientEmails,
      recipientUserIds:
        patch.recipientUserIds !== undefined
          ? [...new Set(patch.recipientUserIds)]
          : current.recipientUserIds,
      ttlSeconds:
        patch.ttlSeconds !== undefined ? Math.max(60, patch.ttlSeconds) : current.ttlSeconds,
      isActive: patch.isActive !== undefined ? patch.isActive : current.isActive,
      nextRunAt: nextRunDate.toISOString(),
      updatedAt: nowIso,
    };

    this.schedules[idx] = updated;
    return updated;
  }

  /** Xóa lịch gửi báo cáo định kỳ theo ID */
  public deleteSchedule(scheduleId: number): boolean {
    const idx = this.schedules.findIndex((s) => s.id === Number(scheduleId));
    if (idx < 0) {
      return false;
    }
    this.schedules.splice(idx, 1);
    return true;
  }

  /** Lấy các lịch gửi báo cáo đang hoạt động và đã đến hạn chạy (`nextRunAt <= now`) theo thứ tự tạo */
  public findDueSchedules(now: Date = new Date()): ReportScheduleRecord[] {
    const nowMs = now.getTime();
    return this.schedules
      .filter((s) => s.isActive && Date.parse(s.nextRunAt) <= nowMs)
      .sort((a, b) => a.id - b.id);
  }

  /** Cập nhật mốc `lastRunAt` và `nextRunAt` sau khi lịch báo cáo đã được kích hoạt */
  public markScheduleExecuted(
    scheduleId: number,
    lastRunAt: string,
    nextRunAt: string,
  ): ReportScheduleRecord | null {
    const idx = this.schedules.findIndex((s) => s.id === Number(scheduleId));
    if (idx < 0) return null;

    const current = this.schedules[idx]!;
    const updated: ReportScheduleRecord = {
      ...current,
      lastRunAt,
      nextRunAt,
      updatedAt: lastRunAt,
    };
    this.schedules[idx] = updated;
    return updated;
  }

  /**
   * 8.4.5 & 8.4.6 — Tự động kích hoạt tất cả các lịch báo cáo đang hoạt động và đã đến hạn (`nextRunAt <= now`)
   * trên toàn hệ thống (hoặc lọc theo `module`), tạo file báo cáo tạm có thời hạn và gửi thông báo qua Email/In-App.
   */
  public async triggerDueSchedules(
    now: Date = new Date(),
    options?: { readonly module?: string | undefined },
  ): Promise<{
    readonly triggeredCount: number;
    readonly results: ReadonlyArray<TriggeredReportScheduleItemResult>;
  }> {
    const targetModule = options?.module?.trim().toLowerCase();
    const dueSchedules = this.findDueSchedules(now).filter((s) =>
      targetModule ? s.module === targetModule : true,
    );

    const results: TriggeredReportScheduleItemResult[] = [];

    for (const schedule of dueSchedules) {
      const executor = this.resolveWorkerExecutor({
        reportCode: schedule.reportCode,
        module: schedule.module,
      });
      if (!executor) {
        continue;
      }

      const execResult = await executor.executeReport({
        reportCode: schedule.reportCode,
        format: schedule.format,
        scheduleId: schedule.id,
        executionMode: 'SCHEDULED',
        ...(schedule.actorId !== null ? { actorId: schedule.actorId } : {}),
        ...(schedule.actorId !== null
          ? {
              actor: {
                id: schedule.actorId,
                email: schedule.recipientEmails[0] ?? 'scheduler@system.local',
                roles: ['system_scheduler'],
                permissions: [`${schedule.module}.report`],
              },
            }
          : {}),
        jobId: `sched_rpt_${schedule.id}_${now.getTime()}`,
        request: {
          reportCode: schedule.reportCode,
          fromDate: schedule.parameters.fromDate,
          toDate: schedule.parameters.toDate,
          status:
            schedule.parameters.statuses.length === 1
              ? schedule.parameters.statuses[0]
              : schedule.parameters.statuses,
          organizationUnitId: schedule.parameters.organizationUnitId,
          includeSubUnits: schedule.parameters.includeSubUnits,
          filters: schedule.parameters.filters,
          format: schedule.format,
          ttlSeconds: schedule.ttlSeconds,
          notifyChannels: [...schedule.channels],
          recipientEmails: [...schedule.recipientEmails],
          recipientUserIds: [...schedule.recipientUserIds],
          async: false,
        },
      });

      const nextRunDate = computeNextReportScheduleRun(
        schedule.frequency,
        schedule.hour,
        schedule.minute,
        schedule.dayOfWeek,
        schedule.dayOfMonth,
        now,
      );
      const updatedSchedule = this.markScheduleExecuted(
        schedule.id,
        now.toISOString(),
        nextRunDate.toISOString(),
      );

      results.push({
        scheduleId: schedule.id,
        reportCode: schedule.reportCode,
        historyId: execResult.historyId,
        nextRunAt: updatedSchedule?.nextRunAt ?? nextRunDate.toISOString(),
        downloadUrl: execResult.downloadUrl ?? null,
        expiresAt: execResult.expiresAt ?? null,
        notifiedChannels: execResult.notifiedChannels ?? [],
      });
    }

    return {
      triggeredCount: results.length,
      results,
    };
  }

  /**
   * 8.4.6 — Ghi nhận thông báo gửi báo cáo qua Email / In-App kèm đường dẫn tải file tạm có thời hạn (`expiresAt`).
   */
  public recordDeliveryNotification(params: {
    readonly historyId: number | null;
    readonly scheduleId: number | null;
    readonly reportCode: string;
    readonly reportName: string;
    readonly module: string;
    readonly channels: readonly ReportDeliveryChannel[];
    readonly recipientEmails: readonly string[];
    readonly recipientUserIds: readonly number[];
    readonly format: ExportFormat;
    readonly fileName: string;
    readonly totalRecords: number;
    readonly downloadToken: string;
    readonly downloadUrl: string;
    readonly expiresAt: string;
  }): ReportDeliveryNotification {
    const id = ++this.notificationSeq;
    const sentAt = new Date().toISOString();
    const record: ReportDeliveryNotification = {
      id,
      historyId: params.historyId,
      scheduleId: params.scheduleId,
      reportCode: params.reportCode,
      reportName: params.reportName,
      module: params.module,
      channels: [...params.channels],
      recipientEmails: [...params.recipientEmails],
      recipientUserIds: [...params.recipientUserIds],
      format: params.format,
      fileName: params.fileName,
      totalRecords: params.totalRecords,
      downloadToken: params.downloadToken,
      downloadUrl: params.downloadUrl,
      expiresAt: params.expiresAt,
      title: `Báo cáo "${params.reportName}" đã sẵn sàng`,
      message: `Báo cáo ${params.fileName} (${params.totalRecords} bản ghi) đã hoàn tất. Tải về tại ${params.downloadUrl} trước ${params.expiresAt}.`,
      sentAt,
    };

    this.notifications.unshift(record);
    return record;
  }

  /**
   * 8.4.6 — Dọn dẹp các file báo cáo tạm đã hết hạn (`expiresAt <= now`) và cập nhật trạng thái lịch sử báo cáo.
   */
  public purgeExpiredReportArtifacts(now: Date = new Date()): {
    readonly purgedCount: number;
    readonly purgedHistoryIds: readonly number[];
  } {
    const purgedExport = this.exportRegistry.purgeExpiredArtifacts(now);
    const nowMs = now.getTime();
    const purgedHistoryIds: number[] = [];

    for (let i = 0; i < this.histories.length; i++) {
      const h = this.histories[i]!;
      if (!h.isExpired && h.expiresAt && Date.parse(h.expiresAt) <= nowMs) {
        this.histories[i] = {
          ...h,
          isExpired: true,
          downloadUrl: null,
        };
        purgedHistoryIds.push(h.id);
      }
    }

    return {
      purgedCount: Math.max(purgedExport.purgedCount, purgedHistoryIds.length),
      purgedHistoryIds,
    };
  }
}

export const defaultReportRegistry = new ReportRegistryService();
