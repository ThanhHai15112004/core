import type {
  RegisteredReportDefinition,
  ReportExecutionHistoryRecord,
  ReportScheduleRecord,
} from '@packages/kernel/index.js';

export const REPORTS_PUBLIC_SERVICE = Symbol('REPORTS_PUBLIC_SERVICE');

export interface IReportsPublicService {
  listAvailableReports(options?: {
    readonly module?: string | undefined;
    readonly category?: 'REPORT' | 'DASHBOARD' | undefined;
    readonly includeAllModules?: boolean | undefined;
  }): RegisteredReportDefinition[];
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
}
