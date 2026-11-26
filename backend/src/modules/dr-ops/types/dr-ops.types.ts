import type {
  DrChecklistStepStatus,
  DrDiscrepancyKind,
  DrDrillStatus,
  DrDrillType,
  DrOperationalState,
  DrReconcileStatus,
  DrSiteRole,
  DrSwitchDirection,
  DrSwitchMode,
  DrSwitchStatus,
  DrSyncScope,
  DrSyncStatus,
  DrSyncTrigger,
  DrTopologyMode,
} from '../enum/dr-ops.enum.js';

export interface DrSiteInfoView {
  readonly code: string;
  readonly name: string;
  readonly region: string;
  readonly endpoint: string | null;
}

export interface DrProfileView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly isEnabled: boolean;
  readonly topologyMode: DrTopologyMode;
  readonly rpoTargetSeconds: number;
  readonly rtoTargetSeconds: number;
  readonly primarySite: DrSiteInfoView;
  readonly drSite: DrSiteInfoView;
  readonly activeSite: DrSiteRole;
  readonly operationalState: DrOperationalState;
  readonly syncCron: string;
  readonly drillIntervalDays: number;
  readonly lastSyncAt: string | null;
  readonly lastRpoSeconds: number | null;
  readonly lastDrillAt: string | null;
  readonly lastRtoSeconds: number | null;
  readonly nextDrillDueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DrSyncRunView {
  readonly id: number;
  readonly syncCode: string;
  readonly profileCode: string;
  readonly scope: DrSyncScope;
  readonly triggerSource: DrSyncTrigger;
  readonly status: DrSyncStatus;
  readonly dbLagSeconds: number | null;
  readonly dbCheckpoint: string | null;
  readonly storageSyncedCount: number;
  readonly storageSkippedCount: number;
  readonly storageFailedCount: number;
  readonly storageSyncedBytes: number;
  readonly actualRpoSeconds: number | null;
  readonly rpoTargetSeconds: number;
  readonly rpoMet: boolean;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly actorName: string | null;
  readonly summary: Record<string, unknown> | null;
  readonly errorMessage: string | null;
}

export interface DrChecklistItem {
  readonly stepKey: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly category: 'PREPARATION' | 'DATABASE' | 'STORAGE' | 'TRAFFIC' | 'VERIFICATION';
  readonly required: boolean;
  readonly status: DrChecklistStepStatus;
  readonly completedBy: string | null;
  readonly completedAt: string | null;
  readonly note: string | null;
}

export interface DrSwitchExecutionView {
  readonly id: number;
  readonly switchCode: string;
  readonly profileCode: string;
  readonly direction: DrSwitchDirection;
  readonly mode: DrSwitchMode;
  readonly fromSite: DrSiteRole;
  readonly toSite: DrSiteRole;
  readonly status: DrSwitchStatus;
  readonly reason: string;
  readonly checklist: DrChecklistItem[];
  readonly rtoTargetSeconds: number;
  readonly actualRtoSeconds: number | null;
  readonly rtoMet: boolean | null;
  readonly reconciliationReportId: number | null;
  readonly initiatedByName: string;
  readonly completedByName: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
}

export interface DrDiscrepancyItem {
  readonly area: 'DATABASE' | 'STORAGE';
  readonly target: string;
  readonly key: string;
  readonly kind: DrDiscrepancyKind;
  readonly primaryValue: string | number | null;
  readonly drValue: string | number | null;
  readonly detail: string;
}

export interface DrReconciliationReportView {
  readonly id: number;
  readonly reportCode: string;
  readonly profileCode: string;
  readonly switchExecutionId: number | null;
  readonly scope: DrSyncScope;
  readonly status: DrReconcileStatus;
  readonly dbTablesChecked: number;
  readonly dbMissingCount: number;
  readonly dbDuplicateCount: number;
  readonly dbMismatchCount: number;
  readonly storageObjectsChecked: number;
  readonly storageMissingCount: number;
  readonly storageDuplicateCount: number;
  readonly storageMismatchCount: number;
  readonly totalDiscrepancies: number;
  readonly findings: DrDiscrepancyItem[];
  readonly actorName: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
}

export interface DrDrillView {
  readonly id: number;
  readonly drillCode: string;
  readonly profileCode: string;
  readonly drillType: DrDrillType;
  readonly scenario: string;
  readonly status: DrDrillStatus;
  readonly rpoTargetSeconds: number;
  readonly rtoTargetSeconds: number;
  readonly measuredRpoSeconds: number | null;
  readonly measuredRtoSeconds: number | null;
  readonly rpoMet: boolean;
  readonly rtoMet: boolean;
  readonly switchExecutionId: number | null;
  readonly reconciliationReportId: number | null;
  readonly steps: Array<{ name: string; status: string; durationMs: number; detail?: string }>;
  readonly lessonsLearned: string | null;
  readonly actorName: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly errorMessage: string | null;
}

export type DrHealthStatus = 'disabled' | 'healthy' | 'warning' | 'critical' | 'unknown';
export type DrComplianceStatus = 'MET' | 'BREACHED' | 'UNKNOWN';

export interface DrOverviewView {
  readonly configEnabled: boolean;
  readonly effectiveEnabled: boolean;
  readonly liveSwitchEnabled: boolean;
  readonly healthStatus: DrHealthStatus;
  readonly rpoStatus: DrComplianceStatus;
  readonly rtoStatus: DrComplianceStatus;
  readonly drillOverdue: boolean;
  readonly profile: DrProfileView;
  readonly latestSync: DrSyncRunView | null;
  readonly latestReconciliation: DrReconciliationReportView | null;
  readonly latestDrill: DrDrillView | null;
  readonly activeSwitch: DrSwitchExecutionView | null;
  readonly storageDrConfigured: boolean;
  readonly dbDrConfigured: boolean;
}

export interface DrRunbookSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly commands?: readonly string[];
}

export interface DrRunbookView {
  readonly version: string;
  readonly updatedAt: string;
  readonly topologyModes: readonly {
    readonly mode: DrTopologyMode;
    readonly summary: string;
    readonly typicalRpo: string;
    readonly typicalRto: string;
  }[];
  readonly sections: readonly DrRunbookSection[];
  readonly antiSplitBrainRules: readonly string[];
}
