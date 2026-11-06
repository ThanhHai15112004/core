import type {
  ExportFormat,
  RegisteredReportDefinition,
  ReportDeliveryChannel,
  ReportExecutionHistoryRecord,
  ReportScheduleRecord,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  CreateReportScheduleRequest,
  RunReportRequest,
} from '../requests/reports.requests.js';
import type { ReportExecutionResponse } from '../responses/reports.response.js';

export const REPORTS_PUBLIC_SERVICE = Symbol('REPORTS_PUBLIC_SERVICE');

export interface IReportsPublicService {
  listAvailableReports(options?: {
    readonly module?: string | undefined;
    readonly category?: 'REPORT' | 'DASHBOARD' | undefined;
    readonly includeAllModules?: boolean | undefined;
  }): RegisteredReportDefinition[];
  runReport(
    request?: Partial<RunReportRequest>,
    actor?: UserIdentity,
  ): Promise<ReportExecutionResponse>;
  createReportSchedule(
    dto: CreateReportScheduleRequest,
    actor?: UserIdentity,
  ): Promise<ReportScheduleRecord>;
  listReportSchedules(filter?: {
    readonly module?: string | undefined;
    readonly reportCode?: string | undefined;
    readonly frequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | undefined;
    readonly isActive?: boolean | undefined;
  }): Promise<ReportScheduleRecord[]>;
  getReportScheduleById(scheduleId: number): Promise<ReportScheduleRecord>;
  updateReportSchedule(
    scheduleId: number,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<ReportScheduleRecord>;
  deleteReportSchedule(
    scheduleId: number,
  ): Promise<{ readonly deleted: true; readonly id: number }>;
  triggerDueReportSchedules(now?: Date): Promise<{
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
  }>;
  listReportHistories(filter?: {
    readonly module?: string | undefined;
    readonly reportCode?: string | undefined;
    readonly actorId?: number | undefined;
    readonly status?: string | undefined;
    readonly executionMode?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<ReportExecutionHistoryRecord[]>;
  getReportHistoryById(historyId: number): Promise<ReportExecutionHistoryRecord>;
  deleteReportHistory(historyId: number): Promise<{ readonly deleted: true; readonly id: number }>;
  downloadTemporaryReport(
    token: string,
    now?: Date,
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
  };
  persistScheduleToDb(record: ReportScheduleRecord): Promise<void>;
  persistHistoryToDb(record: ReportExecutionHistoryRecord): Promise<void>;
}
