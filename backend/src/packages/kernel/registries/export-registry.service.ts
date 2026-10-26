import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type ExportCompletionNotification,
  type ExportFormat,
  type ExportHistoryQueryFilter,
  type ExportHistoryRecord,
  type ExportJobStatus,
  type ExportProgressSnapshot,
  type IPdfExportAdapter,
  type TemporaryExportArtifact,
  type TemporaryExportArtifactSummary,
  resolveExportContentType,
} from '../contracts/export.contract.js';
import { SimpleTabularPdfAdapter } from '../utils/export-engine.util.js';

const DEFAULT_EXPORT_FILE_TTL_SECONDS = 3_600; // 1 giờ

export interface CreateExportHistoryInput {
  readonly profileCode: string;
  readonly module: string;
  readonly fileName?: string | null | undefined;
  readonly format: ExportFormat;
  readonly actorId?: number | null | undefined;
  readonly filters?: Readonly<Record<string, unknown>> | null | undefined;
  readonly totalExported?: number | undefined;
  readonly processedRows?: number | undefined;
  readonly maxRowsApplied?: number | undefined;
  readonly jobId?: string | null | undefined;
  readonly status?: ExportJobStatus | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
}

export interface UpdateExportHistoryInput {
  readonly status?: ExportJobStatus | undefined;
  readonly jobId?: string | null | undefined;
  readonly fileName?: string | undefined;
  readonly totalExported?: number | undefined;
  readonly processedRows?: number | undefined;
  readonly maxRowsApplied?: number | undefined;
  readonly downloadToken?: string | null | undefined;
  readonly downloadUrl?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly isExpired?: boolean | undefined;
  readonly notifiedAt?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly completedAt?: string | null | undefined;
}

export interface StoreTemporaryExportArtifactInput {
  readonly profileCode: string;
  readonly module: string;
  readonly fileName: string;
  readonly format: ExportFormat;
  readonly contentType?: string | undefined;
  readonly totalExported: number;
  readonly buffer: Buffer;
  readonly actorId?: number | null | undefined;
  readonly historyId?: number | null | undefined;
  readonly jobId?: string | null | undefined;
  readonly ttlSeconds?: number | undefined;
  readonly baseDownloadPath?: string | undefined;
  readonly token?: string | undefined;
  readonly now?: Date | undefined;
}

export interface RecordExportNotificationInput {
  readonly historyId?: number | null | undefined;
  readonly jobId?: string | null | undefined;
  readonly recipientUserId: number;
  readonly module: string;
  readonly profileCode: string;
  readonly format: ExportFormat;
  readonly fileName: string;
  readonly totalExported: number;
  readonly downloadToken: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly title?: string | undefined;
  readonly message?: string | undefined;
}

/**
 * Registry & Dịch vụ quản lý tập trung **Xuất dữ liệu (`ExportRegistryService`)** cho toàn hệ thống (Mục 8.3):
 * - Quản lý Pluggable PDF Adapter (`8.3.3 — Hỗ trợ xuất PDF qua adapter: Chỉ cài khi dự án cần`).
 * - Theo dõi tiến độ Export chạy qua Queue (`8.3.4 — Chạy Export lớn bằng Queue`).
 * - Lưu trữ thông báo hoàn tất Export kèm đường dẫn tải tạm thời (`8.3.5`).
 * - Lưu trữ Lịch sử Export (`8.3.7 — Người thực hiện, bộ lọc và số dòng`).
 * - Quản lý vòng đời & tự động hết hạn file Export tạm thời (`8.3.8 — Không lưu file tạm vĩnh viễn`).
 */
@Injectable()
export class ExportRegistryService {
  private pdfAdapter: IPdfExportAdapter | null = new SimpleTabularPdfAdapter();
  private readonly histories: ExportHistoryRecord[] = [];
  private readonly progressByJobId = new Map<string, ExportProgressSnapshot>();
  private readonly historyIdByJobId = new Map<string, number>();
  private readonly artifactsByToken = new Map<string, TemporaryExportArtifact>();
  private readonly notifications: ExportCompletionNotification[] = [];
  private historySeq = 0;
  private notificationSeq = 0;

  /**
   * 8.3.3 — Đăng ký PDF Adapter tùy chỉnh cho dự án (ví dụ: Puppeteer, PDFKit, Gotenberg...).
   */
  public registerPdfAdapter(adapter: IPdfExportAdapter): void {
    this.pdfAdapter = adapter;
  }

  /** Lấy PDF Adapter hiện hành (hoặc `null` nếu dự án chủ động gỡ bỏ adapter) */
  public getPdfAdapter(): IPdfExportAdapter | null {
    return this.pdfAdapter;
  }

  /** Gỡ PDF Adapter hiện tại (dùng khi dự án tắt tính năng xuất PDF hoặc kiểm thử) */
  public clearPdfAdapter(): void {
    this.pdfAdapter = null;
  }

  /** Khôi phục PDF Adapter bảng văn bản nhẹ mặc định */
  public useDefaultPdfAdapter(): void {
    this.pdfAdapter = new SimpleTabularPdfAdapter();
  }

  /**
   * 8.3.7 — Khởi tạo bản ghi Lịch sử Export mới (lưu rõ người thực hiện, bộ lọc hiện tại và số dòng).
   */
  public startExportHistory(input: CreateExportHistoryInput): ExportHistoryRecord {
    const nowIso = new Date().toISOString();
    const id = ++this.historySeq;
    const effectiveJobId = input.jobId?.trim() || `exp_job_${id}_${Date.now()}`;
    const status: ExportJobStatus = input.status ?? 'PROCESSING';
    const fileName =
      input.fileName?.trim() ||
      `${input.profileCode}_export_${nowIso.slice(0, 10)}.${input.format}`;
    const totalExported = Math.max(0, input.totalExported ?? 0);
    const processedRows = Math.max(0, input.processedRows ?? 0);
    const maxRowsApplied = Math.max(1, input.maxRowsApplied ?? 5_000);

    const record: ExportHistoryRecord = {
      id,
      jobId: effectiveJobId,
      profileCode: input.profileCode.trim().toLowerCase(),
      module: input.module.trim().toLowerCase(),
      fileName,
      format: input.format,
      actorId: input.actorId ?? null,
      status,
      filters: input.filters ? { ...input.filters } : {},
      totalExported,
      processedRows,
      maxRowsApplied,
      downloadToken: input.downloadToken ?? null,
      downloadUrl: input.downloadUrl ?? null,
      expiresAt: input.expiresAt ?? null,
      isExpired: false,
      notifiedAt: null,
      errorMessage: null,
      createdAt: nowIso,
      completedAt: status === 'COMPLETED' ? nowIso : null,
    };

    this.histories.unshift(record);
    if (this.histories.length > 1000) {
      this.histories.pop();
    }

    this.historyIdByJobId.set(effectiveJobId, id);
    this.progressByJobId.set(effectiveJobId, {
      jobId: effectiveJobId,
      historyId: id,
      profileCode: record.profileCode,
      format: record.format,
      status: record.status,
      totalRows: totalExported,
      processedRows,
      remainingRows: Math.max(0, totalExported - processedRows),
      percent: status === 'COMPLETED' ? 100 : 0,
      downloadToken: record.downloadToken,
      downloadUrl: record.downloadUrl,
      expiresAt: record.expiresAt,
      notifiedAt: record.notifiedAt,
      startedAt: nowIso,
      finishedAt: record.completedAt,
    });

    return record;
  }

  /**
   * Cập nhật tiến độ hoặc trạng thái hoàn tất của bản ghi Lịch sử Export theo `historyId` hoặc `jobId`.
   */
  public updateExportHistory(
    idOrJobId: number | string,
    update: UpdateExportHistoryInput,
  ): ExportHistoryRecord | null {
    const targetId =
      typeof idOrJobId === 'number'
        ? idOrJobId
        : (this.historyIdByJobId.get(String(idOrJobId)) ?? Number(idOrJobId));

    const idx = this.histories.findIndex((h) => h.id === targetId);
    if (idx < 0) {
      return null;
    }

    const current = this.histories[idx]!;
    const nowIso = new Date().toISOString();

    const totalExported = update.totalExported ?? current.totalExported;
    const processedRows = update.processedRows ?? current.processedRows;
    const maxRowsApplied = update.maxRowsApplied ?? current.maxRowsApplied;
    const nextStatus: ExportJobStatus = update.status ?? current.status;
    const isTerminal =
      nextStatus === 'COMPLETED' ||
      nextStatus === 'FAILED' ||
      nextStatus === 'EXPIRED' ||
      nextStatus === 'CANCELLED';

    const effectiveJobId = update.jobId ?? current.jobId;
    if (effectiveJobId) {
      this.historyIdByJobId.set(effectiveJobId, current.id);
    }

    const completedAt =
      update.completedAt !== undefined
        ? update.completedAt
        : isTerminal
          ? (current.completedAt ?? nowIso)
          : current.completedAt;

    const updatedRecord: ExportHistoryRecord = {
      ...current,
      jobId: effectiveJobId,
      fileName: update.fileName ?? current.fileName,
      status: nextStatus,
      totalExported,
      processedRows,
      maxRowsApplied,
      downloadToken:
        update.downloadToken !== undefined ? update.downloadToken : current.downloadToken,
      downloadUrl: update.downloadUrl !== undefined ? update.downloadUrl : current.downloadUrl,
      expiresAt: update.expiresAt !== undefined ? update.expiresAt : current.expiresAt,
      isExpired: update.isExpired ?? current.isExpired,
      notifiedAt: update.notifiedAt !== undefined ? update.notifiedAt : current.notifiedAt,
      errorMessage:
        update.errorMessage !== undefined ? update.errorMessage : current.errorMessage,
      completedAt,
    };

    this.histories[idx] = updatedRecord;

    if (effectiveJobId) {
      const remainingRows = Math.max(0, totalExported - processedRows);
      const percent =
        nextStatus === 'COMPLETED'
          ? 100
          : totalExported > 0
            ? Math.min(100, Math.max(0, Math.round((processedRows / totalExported) * 100)))
            : 0;
      const snapshot: ExportProgressSnapshot = {
        jobId: effectiveJobId,
        historyId: updatedRecord.id,
        profileCode: updatedRecord.profileCode,
        format: updatedRecord.format,
        status: updatedRecord.status,
        totalRows: totalExported,
        processedRows,
        remainingRows,
        percent,
        downloadToken: updatedRecord.downloadToken,
        downloadUrl: updatedRecord.downloadUrl,
        expiresAt: updatedRecord.expiresAt,
        notifiedAt: updatedRecord.notifiedAt,
        startedAt: updatedRecord.createdAt,
        finishedAt: completedAt,
      };
      this.progressByJobId.set(effectiveJobId, snapshot);
      if (current.jobId && current.jobId !== effectiveJobId) {
        this.progressByJobId.set(current.jobId, snapshot);
      }
    }

    return updatedRecord;
  }

  /**
   * 8.3.5 & 8.3.8 — Lưu trữ file kết quả Export tạm thời kèm đường dẫn tải (`downloadUrl`) và thời hạn (`expiresAt`).
   * Không lưu file tạm vĩnh viễn: Tự động dọn các file đã hết hạn trước khi lưu file mới.
   */
  public storeTemporaryArtifact(
    input: StoreTemporaryExportArtifactInput,
  ): TemporaryExportArtifact {
    const now = input.now ?? new Date();
    this.purgeExpiredArtifacts(now);

    const ttlSeconds = Math.max(1, input.ttlSeconds ?? DEFAULT_EXPORT_FILE_TTL_SECONDS);
    const token = input.token?.trim() || `exp_${randomBytes(16).toString('hex')}`;
    const baseDownloadPath = (
      input.baseDownloadPath ?? `/api/v1/${input.module.trim().toLowerCase()}/export/downloads`
    ).replace(/\/+$/, '');
    const downloadUrl = `${baseDownloadPath}/${token}`;
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
    const contentType = input.contentType ?? resolveExportContentType(input.format);

    const artifact: TemporaryExportArtifact = {
      token,
      downloadUrl,
      historyId: input.historyId ?? null,
      jobId: input.jobId ?? null,
      profileCode: input.profileCode.trim().toLowerCase(),
      module: input.module.trim().toLowerCase(),
      actorId: input.actorId ?? null,
      fileName: input.fileName,
      contentType,
      format: input.format,
      totalExported: input.totalExported,
      sizeBytes: input.buffer.byteLength,
      buffer: input.buffer,
      createdAt,
      expiresAt,
    };

    this.artifactsByToken.set(token, artifact);

    if (input.historyId !== undefined && input.historyId !== null) {
      this.updateExportHistory(input.historyId, {
        fileName: input.fileName,
        totalExported: input.totalExported,
        processedRows: input.totalExported,
        downloadToken: token,
        downloadUrl,
        expiresAt,
        isExpired: false,
      });
    } else if (input.jobId) {
      this.updateExportHistory(input.jobId, {
        fileName: input.fileName,
        totalExported: input.totalExported,
        processedRows: input.totalExported,
        downloadToken: token,
        downloadUrl,
        expiresAt,
        isExpired: false,
      });
    }

    return artifact;
  }

  /**
   * 8.3.8 — Truy xuất file Export tạm thời theo `token`.
   * Nếu file đã quá hạn (`expiresAt <= now`), tự động thu hồi/xóa ngay khỏi bộ nhớ và trả về `null`.
   */
  public getTemporaryArtifactByToken(
    token: string,
    now: Date = new Date(),
  ): TemporaryExportArtifact | null {
    const cleanToken = token.trim();
    const artifact = this.artifactsByToken.get(cleanToken);
    if (!artifact) {
      return null;
    }

    if (Date.parse(artifact.expiresAt) <= now.getTime()) {
      this.evictExpiredArtifact(artifact);
      return null;
    }

    return artifact;
  }

  /** Xem thông tin tóm tắt của một file Export tạm thời theo `token` */
  public getTemporaryArtifactSummary(
    token: string,
    now: Date = new Date(),
  ): TemporaryExportArtifactSummary | null {
    const artifact = this.getTemporaryArtifactByToken(token, now);
    if (!artifact) return null;
    const { buffer: _buf, ...summary } = artifact;
    return {
      ...summary,
      isExpired: false,
    };
  }

  /**
   * 8.3.8 — Tự động quét và xóa toàn bộ các file Export tạm thời đã hết hạn (`expiresAt <= now`),
   * đảm bảo hệ thống không lưu trữ file tạm vĩnh viễn.
   */
  public purgeExpiredArtifacts(now: Date = new Date()): {
    readonly purgedCount: number;
    readonly purgedTokens: readonly string[];
    readonly purgedHistoryIds: readonly number[];
  } {
    const nowMs = now.getTime();
    const purgedTokens: string[] = [];
    const purgedHistoryIds: number[] = [];

    for (const [token, artifact] of this.artifactsByToken.entries()) {
      if (Date.parse(artifact.expiresAt) <= nowMs) {
        this.evictExpiredArtifact(artifact);
        purgedTokens.push(token);
        if (artifact.historyId !== null) {
          purgedHistoryIds.push(artifact.historyId);
        }
      }
    }

    for (let i = 0; i < this.histories.length; i++) {
      const h = this.histories[i]!;
      if (h.expiresAt && !h.isExpired && Date.parse(h.expiresAt) <= nowMs) {
        this.updateExportHistory(h.id, {
          isExpired: true,
          downloadUrl: null,
          ...(h.status === 'COMPLETED' ? { status: 'EXPIRED' } : {}),
        });
        if (!purgedHistoryIds.includes(h.id)) {
          purgedHistoryIds.push(h.id);
        }
      }
    }

    return {
      purgedCount: purgedTokens.length,
      purgedTokens,
      purgedHistoryIds,
    };
  }

  private evictExpiredArtifact(artifact: TemporaryExportArtifact): void {
    this.artifactsByToken.delete(artifact.token);
    if (artifact.historyId !== null) {
      const hist = this.histories.find((h) => h.id === artifact.historyId);
      this.updateExportHistory(artifact.historyId, {
        isExpired: true,
        downloadUrl: null,
        ...(hist?.status === 'COMPLETED' ? { status: 'EXPIRED' } : {}),
      });
    } else if (artifact.jobId) {
      this.updateExportHistory(artifact.jobId, {
        isExpired: true,
        downloadUrl: null,
      });
    }
  }

  /**
   * 8.3.5 — Ghi nhận và phát thông báo khi Export hoàn tất kèm đường dẫn tải tạm thời (`downloadUrl`).
   */
  public recordCompletionNotification(
    input: RecordExportNotificationInput,
  ): ExportCompletionNotification {
    const sentAt = new Date().toISOString();
    const id = ++this.notificationSeq;
    const title =
      input.title?.trim() || `Xuất dữ liệu ${input.format.toUpperCase()} hoàn tất (${input.fileName})`;
    const message =
      input.message?.trim() ||
      `Đã xuất thành công ${input.totalExported} bản ghi ra file ${input.fileName}. Tải xuống tại: ${input.downloadUrl} (hết hạn lúc ${input.expiresAt}).`;

    const notification: ExportCompletionNotification = {
      id,
      historyId: input.historyId ?? null,
      jobId: input.jobId ?? null,
      recipientUserId: input.recipientUserId,
      module: input.module.trim().toLowerCase(),
      profileCode: input.profileCode.trim().toLowerCase(),
      format: input.format,
      fileName: input.fileName,
      totalExported: input.totalExported,
      downloadToken: input.downloadToken,
      downloadUrl: input.downloadUrl,
      expiresAt: input.expiresAt,
      title,
      message,
      sentAt,
    };

    this.notifications.unshift(notification);
    if (this.notifications.length > 500) {
      this.notifications.pop();
    }

    if (input.historyId !== undefined && input.historyId !== null) {
      this.updateExportHistory(input.historyId, { notifiedAt: sentAt });
    } else if (input.jobId) {
      this.updateExportHistory(input.jobId, { notifiedAt: sentAt });
    }

    return notification;
  }

  /** Truy vấn danh sách thông báo hoàn tất Export đã gửi (theo người nhận hoặc module) */
  public listNotifications(filter?: {
    readonly recipientUserId?: number | undefined;
    readonly module?: string | undefined;
    readonly historyId?: number | undefined;
  }): ExportCompletionNotification[] {
    let list = [...this.notifications];
    if (filter?.recipientUserId !== undefined) {
      list = list.filter((n) => n.recipientUserId === Number(filter.recipientUserId));
    }
    if (filter?.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((n) => n.module === mod);
    }
    if (filter?.historyId !== undefined) {
      list = list.filter((n) => n.historyId === Number(filter.historyId));
    }
    return list;
  }

  /** Lấy tiến độ thực thi Export theo `jobId` hoặc `historyId` (Mục 8.3.4) */
  public getProgress(
    jobIdOrHistoryId: string | number,
    now: Date = new Date(),
  ): ExportProgressSnapshot | null {
    this.purgeExpiredArtifacts(now);
    const key = String(jobIdOrHistoryId).trim();
    const direct = this.progressByJobId.get(key);
    if (direct) return direct;

    const asNum = Number(key);
    if (Number.isInteger(asNum) && asNum > 0) {
      const hist = this.histories.find((h) => h.id === asNum);
      if (hist?.jobId) {
        return this.progressByJobId.get(hist.jobId) ?? null;
      }
    }
    return null;
  }

  /** Xem chi tiết một bản ghi Lịch sử Export theo ID (tự động đồng bộ trạng thái hết hạn file tạm) */
  public getHistoryById(id: number, now: Date = new Date()): ExportHistoryRecord | null {
    this.purgeExpiredArtifacts(now);
    return this.histories.find((h) => h.id === Number(id)) ?? null;
  }

  /** Tra cứu danh sách Lịch sử Export theo bộ lọc (Mục 8.3.7) */
  public listHistories(
    filter: ExportHistoryQueryFilter = {},
    now: Date = new Date(),
  ): ExportHistoryRecord[] {
    this.purgeExpiredArtifacts(now);
    let list = [...this.histories];

    if (filter.profileCode?.trim()) {
      const code = filter.profileCode.trim().toLowerCase();
      list = list.filter((h) => h.profileCode === code);
    }
    if (filter.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((h) => h.module === mod);
    }
    if (filter.format) {
      list = list.filter((h) => h.format === filter.format);
    }
    if (filter.status) {
      list = list.filter((h) => h.status === filter.status);
    }
    if (filter.actorId !== undefined) {
      list = list.filter((h) => Number(h.actorId) === Number(filter.actorId));
    }
    if (filter.includeExpired === false) {
      list = list.filter((h) => !h.isExpired);
    }

    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    return list.slice(0, limit);
  }
}

export const defaultExportRegistry = new ExportRegistryService();
