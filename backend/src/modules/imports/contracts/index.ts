import type {
  ImportHistoryRecord,
  ImportPreviewResult,
  ImportProfileHandler,
  ImportProgressSnapshot,
} from '@packages/kernel/index.js';

export const IMPORTS_PUBLIC_SERVICE = Symbol('IMPORTS_PUBLIC_SERVICE');

export interface IImportsPublicService {
  registerProfile<TRow = Record<string, unknown>>(handler: ImportProfileHandler<TRow>): void;
  listProfiles(): ReadonlyArray<{ readonly profileCode: string; readonly module: string }>;
  previewImport(
    profileCode: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ImportPreviewResult>;
  listHistories(filter?: {
    readonly profileCode?: string | undefined;
    readonly module?: string | undefined;
    readonly actorId?: number | undefined;
    readonly status?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<ImportHistoryRecord[]>;
  getHistoryById(historyId: number): Promise<ImportHistoryRecord>;
  updateHistory(
    historyId: number,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<ImportHistoryRecord>;
  deleteHistory(historyId: number): Promise<{ readonly deleted: true; readonly id: number }>;
  getJobProgress(jobIdOrHistoryId: string | number): ImportProgressSnapshot;
}
