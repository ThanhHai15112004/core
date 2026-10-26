import { Injectable } from '@nestjs/common';
import type {
  ImportCellIssue,
  ImportDuplicateStrategy,
  ImportHistoryQueryFilter,
  ImportHistoryRecord,
  ImportJobStatus,
  ImportProfileHandler,
  ImportProgressSnapshot,
} from '../contracts/import.contract.js';

export interface CreateImportHistoryInput {
  readonly profileCode: string;
  readonly module: string;
  readonly fileName?: string | null | undefined;
  readonly format: 'xlsx' | 'csv' | 'json';
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly columnMapping?: Readonly<Record<string, string | number | null>> | null | undefined;
  readonly totalRows: number;
  readonly jobId?: string | null | undefined;
  readonly actorId?: number | null | undefined;
  readonly status?: ImportJobStatus | undefined;
}

export interface UpdateImportHistoryProgressInput {
  readonly status?: ImportJobStatus | undefined;
  readonly jobId?: string | null | undefined;
  readonly totalRows?: number | undefined;
  readonly processedRows?: number | undefined;
  readonly createdCount?: number | undefined;
  readonly updatedCount?: number | undefined;
  readonly skippedCount?: number | undefined;
  readonly failedCount?: number | undefined;
  readonly errors?: readonly ImportCellIssue[] | undefined;
  readonly completedAt?: string | null | undefined;
}

/**
 * Registry & Dịch vụ quản lý tập trung cấu hình Import (`ImportProfileHandler`),
 * theo dõi tiến độ Import (`ImportProgressSnapshot`) và lưu trữ **Lịch sử Import (`ImportHistoryRecord`)**
 * dùng chung cho toàn bộ các module trong hệ thống (Mục 8.2).
 */
@Injectable()
export class ImportRegistryService {
  private readonly profiles = new Map<string, ImportProfileHandler<unknown>>();
  private readonly histories: ImportHistoryRecord[] = [];
  private readonly progressByJobId = new Map<string, ImportProgressSnapshot>();
  private readonly historyIdByJobId = new Map<string, number>();
  private historySeq = 0;

  /** Đăng ký một cấu hình Import nghiệp vụ của module (ví dụ: `'users'`, `'organizations'`, `'codes'`) */
  public registerProfile<TRow = Record<string, unknown>>(
    handler: ImportProfileHandler<TRow>,
  ): void {
    const key = handler.profileCode.trim().toLowerCase();
    if (!key) return;
    this.profiles.set(key, handler as ImportProfileHandler<unknown>);
  }

  /** Lấy cấu hình Import theo `profileCode` */
  public getProfile<TRow = Record<string, unknown>>(
    profileCode: string,
  ): ImportProfileHandler<TRow> | undefined {
    return this.profiles.get(profileCode.trim().toLowerCase()) as
      ImportProfileHandler<TRow> | undefined;
  }

  /** Liệt kê toàn bộ các `ImportProfile` đã đăng ký trong hệ thống */
  public listProfiles(): ImportProfileHandler<unknown>[] {
    return [...this.profiles.values()];
  }

  /**
   * Khởi tạo một bản ghi Lịch sử Import mới (Mục 8.2.9 — Lưu lịch sử Import: File, người thực hiện và kết quả)
   * và khởi tạo snapshot tiến độ tương ứng.
   */
  public startImportHistory(input: CreateImportHistoryInput): ImportHistoryRecord {
    const nowIso = new Date().toISOString();
    const id = ++this.historySeq;
    const effectiveJobId = input.jobId?.trim() || `imp_job_${id}_${Date.now()}`;
    const status: ImportJobStatus = input.status ?? 'PROCESSING';
    const fileName =
      input.fileName?.trim() ||
      `${input.profileCode}_import_${nowIso.slice(0, 10)}.${input.format}`;
    const totalRows = Math.max(0, input.totalRows);

    const record: ImportHistoryRecord = {
      id,
      jobId: effectiveJobId,
      profileCode: input.profileCode.trim().toLowerCase(),
      module: input.module.trim().toLowerCase(),
      fileName,
      format: input.format,
      duplicateStrategy: input.duplicateStrategy,
      actorId: input.actorId ?? null,
      status,
      totalRows,
      processedRows: 0,
      remainingRows: totalRows,
      successCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
      columnMapping: input.columnMapping ? { ...input.columnMapping } : null,
      createdAt: nowIso,
      completedAt: null,
    };

    this.histories.unshift(record);
    if (this.histories.length > 1000) {
      this.histories.pop();
    }

    this.historyIdByJobId.set(effectiveJobId, id);
    this.progressByJobId.set(effectiveJobId, {
      jobId: effectiveJobId,
      profileCode: record.profileCode,
      status: record.status,
      totalRows,
      processedRows: 0,
      remainingRows: totalRows,
      successCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      percent: totalRows === 0 ? 100 : 0,
      startedAt: nowIso,
      finishedAt: null,
    });

    return record;
  }

  /**
   * Cập nhật tiến độ hoặc hoàn tất bản ghi Lịch sử Import theo `historyId` hoặc `jobId`
   * (Mục 8.2.8 — Hiển thị tiến độ Import: Số dòng thành công, lỗi và còn lại).
   */
  public updateImportHistory(
    idOrJobId: number | string,
    update: UpdateImportHistoryProgressInput,
  ): ImportHistoryRecord | null {
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

    const totalRows = update.totalRows ?? current.totalRows;
    const createdCount = update.createdCount ?? current.createdCount;
    const updatedCount = update.updatedCount ?? current.updatedCount;
    const skippedCount = update.skippedCount ?? current.skippedCount;
    const failedCount = update.failedCount ?? current.failedCount;
    const successCount = createdCount + updatedCount;
    const processedRows =
      update.processedRows ?? Math.min(totalRows, successCount + skippedCount + failedCount);
    const remainingRows = Math.max(0, totalRows - processedRows);

    const nextStatus: ImportJobStatus = update.status ?? current.status;
    const isTerminal =
      nextStatus === 'COMPLETED' ||
      nextStatus === 'PARTIAL' ||
      nextStatus === 'FAILED' ||
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

    const updatedRecord: ImportHistoryRecord = {
      ...current,
      jobId: effectiveJobId,
      status: nextStatus,
      totalRows,
      processedRows,
      remainingRows,
      successCount,
      createdCount,
      updatedCount,
      skippedCount,
      failedCount,
      errors: update.errors ?? current.errors,
      completedAt,
    };

    this.histories[idx] = updatedRecord;

    if (effectiveJobId) {
      const percent =
        totalRows > 0
          ? Math.min(100, Math.max(0, Math.round((processedRows / totalRows) * 100)))
          : 100;
      const snapshot: ImportProgressSnapshot = {
        jobId: effectiveJobId,
        profileCode: updatedRecord.profileCode,
        status: updatedRecord.status,
        totalRows,
        processedRows,
        remainingRows,
        successCount,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount,
        percent: isTerminal ? 100 : percent,
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

  /** Lấy tiến độ thực thi Import theo `jobId` hoặc `historyId` (Mục 8.2.8) */
  public getProgress(jobIdOrHistoryId: string | number): ImportProgressSnapshot | null {
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

  /** Xem chi tiết một bản ghi Lịch sử Import theo ID */
  public getHistoryById(id: number): ImportHistoryRecord | null {
    return this.histories.find((h) => h.id === Number(id)) ?? null;
  }

  /** Tra cứu danh sách Lịch sử Import theo bộ lọc (Mục 8.2.9) */
  public listHistories(filter: ImportHistoryQueryFilter = {}): ImportHistoryRecord[] {
    let list = [...this.histories];

    if (filter.profileCode?.trim()) {
      const code = filter.profileCode.trim().toLowerCase();
      list = list.filter((h) => h.profileCode === code);
    }
    if (filter.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((h) => h.module === mod);
    }
    if (filter.status) {
      list = list.filter((h) => h.status === filter.status);
    }
    if (filter.actorId !== undefined) {
      list = list.filter((h) => Number(h.actorId) === Number(filter.actorId));
    }

    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    return list.slice(0, limit);
  }
}

export const defaultImportRegistry = new ImportRegistryService();
