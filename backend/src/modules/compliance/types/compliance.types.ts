import type { DataClassificationLevel, ExportFormat } from '@packages/kernel/index.js';
import type {
  AssessmentApprovalStatus,
  ComplianceDueStatus,
  ComplianceRiskLevel,
  ControlCheckResult,
  ControlFrequency,
  ControlStatus,
  DataFlowDirection,
  EvidenceStatus,
  EvidenceType,
  VendorCategory,
  VendorStatus,
} from '../enum/compliance.enum.js';

export interface ComplianceControlView {
  readonly id: number;
  readonly controlCode: string;
  readonly title: string;
  readonly description: string | null;
  readonly domain: string;
  readonly frameworkTags: readonly string[];
  readonly ownerUserId: number | null;
  readonly organizationUnitId: number | null;
  readonly frequency: ControlFrequency;
  readonly status: ControlStatus;
  readonly lastCheckedAt: string | null;
  readonly nextCheckDueAt: string | null;
  readonly lastCheckResult: ControlCheckResult | null;
  readonly dueStatus: ComplianceDueStatus;
  readonly daysUntilDue: number | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComplianceCheckHistoryView {
  readonly id: number;
  readonly controlId: number;
  readonly controlCode: string | null;
  readonly controlTitle: string | null;
  readonly checkedByUserId: number;
  readonly checkedAt: string;
  readonly result: ControlCheckResult;
  readonly score: number | null;
  readonly findings: string | null;
  readonly remediationPlan: string | null;
  readonly remediationDueAt: string | null;
  readonly evidenceIds: readonly number[];
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
}

export interface ComplianceEvidenceView {
  readonly id: number;
  readonly controlId: number;
  readonly checkHistoryId: number | null;
  readonly vendorId: number | null;
  readonly evidenceType: EvidenceType;
  readonly title: string;
  readonly description: string | null;
  readonly fileId: number | null;
  readonly auditLogId: number | null;
  readonly logReference: string | null;
  readonly reportHistoryId: number | null;
  readonly reportCode: string | null;
  readonly externalUrl: string | null;
  readonly checksumSha256: string | null;
  readonly collectedByUserId: number;
  readonly collectedAt: string;
  readonly validUntil: string | null;
  readonly status: EvidenceStatus;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
}

export interface ComplianceVendorView {
  readonly id: number;
  readonly vendorCode: string;
  readonly name: string;
  readonly category: VendorCategory;
  readonly criticality: ComplianceRiskLevel;
  readonly status: VendorStatus;
  readonly providerEntryId: number | null;
  readonly websiteUrl: string | null;
  readonly contactEmail: string | null;
  readonly ownerUserId: number | null;
  readonly organizationUnitId: number | null;
  readonly contractStartDate: string | null;
  readonly contractEndDate: string | null;
  readonly contractDueStatus: ComplianceDueStatus;
  readonly daysUntilContractEnd: number | null;
  readonly autoRenew: boolean;
  readonly reviewFrequency: ControlFrequency;
  readonly lastReviewedAt: string | null;
  readonly nextReviewDueAt: string | null;
  readonly reviewDueStatus: ComplianceDueStatus;
  readonly daysUntilReviewDue: number | null;
  readonly dpaSigned: boolean;
  readonly dpaFileId: number | null;
  readonly fallbackVendorName: string | null;
  readonly fallbackStrategy: string | null;
  readonly migrationRunbook: string | null;
  readonly rtoHours: number | null;
  readonly exitPlanTestedAt: string | null;
  readonly hasFallbackPlan: boolean;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VendorDataAssessmentView {
  readonly id: number;
  readonly vendorId: number;
  readonly vendorName: string | null;
  readonly dataCategory: string;
  readonly classificationLevel: DataClassificationLevel;
  readonly allowedDataFields: readonly string[];
  readonly prohibitedDataFields: readonly string[];
  readonly processingPurpose: string;
  readonly dataFlowDirection: DataFlowDirection;
  readonly storageRegions: readonly string[];
  readonly crossBorderTransfer: boolean;
  readonly transferMechanism: string | null;
  readonly retentionDays: number | null;
  readonly encryptionInTransit: boolean;
  readonly encryptionAtRest: boolean;
  readonly subprocessors: readonly string[];
  readonly riskLevel: ComplianceRiskLevel;
  readonly approvalStatus: AssessmentApprovalStatus;
  readonly reviewedByUserId: number | null;
  readonly reviewedAt: string | null;
  readonly nextReviewDueAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ComplianceDueItemSummary {
  readonly kind: 'CONTROL_CHECK' | 'VENDOR_REVIEW' | 'VENDOR_CONTRACT' | 'EVIDENCE_EXPIRY';
  readonly entityId: number;
  readonly code: string;
  readonly title: string;
  readonly ownerUserId: number | null;
  readonly dueAt: string;
  readonly daysRemaining: number;
  readonly dueStatus: ComplianceDueStatus;
}

export interface ComplianceOverviewView {
  readonly moduleEnabled: boolean;
  readonly controlsEnabled: boolean;
  readonly vendorsEnabled: boolean;
  readonly reportsEnabled: boolean;
  readonly settings: {
    readonly reviewReminderDaysBefore: number;
    readonly contractExpiringDaysBefore: number;
    readonly evidenceExpiringDaysBefore: number;
    readonly reportFileTtlSeconds: number;
  };
  readonly counts: {
    readonly totalControls: number;
    readonly activeControls: number;
    readonly overdueControls: number;
    readonly dueSoonControls: number;
    readonly passRatePercent: number;
    readonly totalEvidences: number;
    readonly validEvidences: number;
    readonly totalChecks: number;
    readonly totalVendors: number;
    readonly vendorsByCategory: Readonly<Record<VendorCategory, number>>;
    readonly vendorsMissingFallback: number;
    readonly expiringContractsCount: number;
    readonly overdueVendorReviewsCount: number;
    readonly highRiskDataAssessmentsCount: number;
  };
  readonly frameworkCoverage: ReadonlyArray<{
    readonly frameworkTag: string;
    readonly totalControls: number;
    readonly passingControls: number;
    readonly passRatePercent: number;
  }>;
  readonly upcomingAndOverdueItems: readonly ComplianceDueItemSummary[];
}

export interface ComplianceReviewSweepResult {
  readonly executedAt: string;
  readonly dryRun: boolean;
  readonly controlsDueOrOverdue: number;
  readonly vendorReviewsDueOrOverdue: number;
  readonly contractsExpiringOrExpired: number;
  readonly evidencesExpiring: number;
  readonly evidencesMarkedExpired: number;
  readonly notificationsDispatched: number;
  readonly items: readonly ComplianceDueItemSummary[];
}

export interface ComplianceReportSummaryMetrics {
  readonly frameworkFilter: string | null;
  readonly domainFilter: string | null;
  readonly vendorCategoryFilter: VendorCategory | null;
  readonly totalControls: number;
  readonly activeControls: number;
  readonly passedControls: number;
  readonly partialControls: number;
  readonly failedControls: number;
  readonly uncheckedControls: number;
  readonly passRatePercent: number;
  readonly overdueControls: number;
  readonly controlsWithoutValidEvidence: number;
  readonly validEvidences: number;
  readonly expiredEvidences: number;
  readonly checksInPeriod: number;
  readonly totalVendors: number;
  readonly activeVendors: number;
  readonly vendorsMissingFallback: number;
  readonly vendorsWithoutDpa: number;
  readonly expiringOrExpiredContracts: number;
  readonly overdueVendorReviews: number;
  readonly totalDataAssessments: number;
  readonly crossBorderAssessments: number;
  readonly highOrCriticalAssessments: number;
}

export interface ComplianceReportResultView {
  readonly reportCode: string;
  readonly generatedAt: string;
  readonly historyId: number | null;
  readonly format: ExportFormat | 'json';
  readonly fileName: string | null;
  readonly downloadToken: string | null;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
  readonly summary: ComplianceReportSummaryMetrics;
  readonly controls: readonly ComplianceControlView[];
  readonly vendors: readonly ComplianceVendorView[];
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface ComplianceReportDownloadView {
  readonly token: string;
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
}
