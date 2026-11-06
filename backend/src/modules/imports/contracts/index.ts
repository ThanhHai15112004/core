import type {
  ImportHistoryRecord,
  ImportPreviewResult,
  ImportProfileHandler,
  ImportProgressSnapshot,
  ImportTemplateFileResult,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { ExecuteImportRequest } from '../requests/imports.requests.js';
import type { ExecuteImportResultResponse } from '../responses/imports.response.js';

export const IMPORTS_PUBLIC_SERVICE = Symbol('IMPORTS_PUBLIC_SERVICE');

export interface IImportsPublicService {
  registerProfile<TRow = Record<string, unknown>>(handler: ImportProfileHandler<TRow>): void;
  listProfiles(): ReadonlyArray<{ readonly profileCode: string; readonly module: string }>;
  exportImportTemplate(profileCode: string, format?: 'csv' | 'xlsx'): ImportTemplateFileResult;
  previewImport(
    profileCode: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ImportPreviewResult>;
  executeImport(
    profileCode: string,
    dto: ExecuteImportRequest,
    actorId?: number,
    actor?: UserIdentity,
  ): Promise<ExecuteImportResultResponse>;
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
  persistHistoryRecordToDb(record: ImportHistoryRecord): Promise<void>;
}
