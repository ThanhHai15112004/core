import type {
  ExportFormat,
  ExportHistoryRecord,
  ExportProgressSnapshot,
  IPdfExportAdapter,
} from '@packages/kernel/index.js';

export const EXPORTS_PUBLIC_SERVICE = Symbol('EXPORTS_PUBLIC_SERVICE');

export interface IExportsPublicService {
  registerPdfAdapter(adapter: IPdfExportAdapter): void;
  listHistories(filter?: {
    readonly profileCode?: string | undefined;
    readonly module?: string | undefined;
    readonly actorId?: number | undefined;
    readonly format?: ExportFormat | undefined;
    readonly status?: string | undefined;
    readonly includeExpired?: boolean | undefined;
    readonly limit?: number | undefined;
  }): Promise<ExportHistoryRecord[]>;
  getHistoryById(historyId: number): Promise<ExportHistoryRecord>;
  updateHistory(
    historyId: number,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<ExportHistoryRecord>;
  deleteHistory(historyId: number): Promise<{ readonly deleted: true; readonly id: number }>;
  getJobProgress(jobIdOrHistoryId: string | number): ExportProgressSnapshot;
  downloadTemporaryExport(
    token: string,
    now?: Date,
  ): Promise<{
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
  }>;
  purgeExpiredExports(now?: Date): Promise<{
    readonly purgedCount: number;
    readonly purgedTokens: readonly string[];
    readonly purgedHistoryIds: readonly number[];
  }>;
}
