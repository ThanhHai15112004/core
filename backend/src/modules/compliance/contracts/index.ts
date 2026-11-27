import type {
  ComplianceOverviewView,
  ComplianceReportResultView,
  ComplianceReviewSweepResult,
} from '../types/compliance.types.js';
import type { GenerateComplianceReportRequest } from '../requests/compliance.requests.js';
import type { UserIdentity } from '@packages/security/index.js';

export * from '../enum/compliance.enum.js';
export * from '../types/compliance.types.js';

export const COMPLIANCE_PUBLIC_SERVICE = Symbol('COMPLIANCE_PUBLIC_SERVICE');

export interface ICompliancePublicService {
  getOverview(): Promise<ComplianceOverviewView>;
  runReviewReminderSweep(options?: {
    readonly dryRun?: boolean | undefined;
    readonly now?: Date | undefined;
  }): Promise<ComplianceReviewSweepResult>;
  generateReport(
    dto: GenerateComplianceReportRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceReportResultView>;
}
