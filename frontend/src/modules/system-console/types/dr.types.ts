export type DrTopologyMode = 'BACKUP_RESTORE' | 'PILOT_LIGHT' | 'WARM_STANDBY' | 'HOT_STANDBY';
export type DrSiteRole = 'PRIMARY' | 'DR';
export type DrOperationalState = 'NORMAL' | 'FAILING_OVER' | 'RUNNING_ON_DR' | 'FAILING_BACK' | 'DEGRADED';
export type DrSyncScope = 'DATABASE' | 'STORAGE' | 'FULL';
export type DrSwitchDirection = 'FAILOVER' | 'FAILBACK';
export type DrSwitchMode = 'SIMULATED' | 'LIVE';
export type DrChecklistStepStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'FAILED';
export type DrDrillType = 'SCHEDULED_SIMULATION' | 'MANUAL_SIMULATION' | 'LIVE_GAME_DAY' | 'TABLETOP';

export interface DrSiteInfoDto {
  code: string;
  name: string;
  region: string;
  endpoint: string | null;
}

export interface DrProfileDto {
  id: number;
  code: string;
  name: string;
  isEnabled: boolean;
  topologyMode: DrTopologyMode;
  rpoTargetSeconds: number;
  rtoTargetSeconds: number;
  primarySite: DrSiteInfoDto;
  drSite: DrSiteInfoDto;
  activeSite: DrSiteRole;
  operationalState: DrOperationalState;
  syncCron: string;
  drillIntervalDays: number;
  lastSyncAt: string | null;
  lastRpoSeconds: number | null;
  lastDrillAt: string | null;
  lastRtoSeconds: number | null;
  nextDrillDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DrSyncRunDto {
  id: number;
  syncCode: string;
  profileCode: string;
  scope: DrSyncScope;
  triggerSource: string;
  status: string;
  dbLagSeconds: number | null;
  dbCheckpoint: string | null;
  storageSyncedCount: number;
  storageSkippedCount: number;
  storageFailedCount: number;
  storageSyncedBytes: number;
  actualRpoSeconds: number | null;
  rpoTargetSeconds: number;
  rpoMet: boolean;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  actorName: string | null;
  errorMessage: string | null;
}

export interface DrChecklistItemDto {
  stepKey: string;
  order: number;
  title: string;
  description: string;
  category: 'PREPARATION' | 'DATABASE' | 'STORAGE' | 'TRAFFIC' | 'VERIFICATION';
  required: boolean;
  status: DrChecklistStepStatus;
  completedBy: string | null;
  completedAt: string | null;
  note: string | null;
}

export interface DrSwitchExecutionDto {
  id: number;
  switchCode: string;
  profileCode: string;
  direction: DrSwitchDirection;
  mode: DrSwitchMode;
  fromSite: DrSiteRole;
  toSite: DrSiteRole;
  status: string;
  reason: string;
  checklist: DrChecklistItemDto[];
  rtoTargetSeconds: number;
  actualRtoSeconds: number | null;
  rtoMet: boolean | null;
  reconciliationReportId: number | null;
  initiatedByName: string;
  completedByName: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface DrDiscrepancyItemDto {
  area: 'DATABASE' | 'STORAGE';
  target: string;
  key: string;
  kind: string;
  primaryValue: string | number | null;
  drValue: string | number | null;
  detail: string;
}

export interface DrReconciliationReportDto {
  id: number;
  reportCode: string;
  profileCode: string;
  switchExecutionId: number | null;
  scope: DrSyncScope;
  status: string;
  dbTablesChecked: number;
  dbMissingCount: number;
  dbDuplicateCount: number;
  dbMismatchCount: number;
  storageObjectsChecked: number;
  storageMissingCount: number;
  storageDuplicateCount: number;
  storageMismatchCount: number;
  totalDiscrepancies: number;
  findings: DrDiscrepancyItemDto[];
  actorName: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface DrDrillDto {
  id: number;
  drillCode: string;
  profileCode: string;
  drillType: DrDrillType;
  scenario: string;
  status: string;
  rpoTargetSeconds: number;
  rtoTargetSeconds: number;
  measuredRpoSeconds: number | null;
  measuredRtoSeconds: number | null;
  rpoMet: boolean;
  rtoMet: boolean;
  switchExecutionId: number | null;
  reconciliationReportId: number | null;
  steps: Array<{ name: string; status: string; durationMs: number; detail?: string }>;
  lessonsLearned: string | null;
  actorName: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface DrOverviewDto {
  configEnabled: boolean;
  effectiveEnabled: boolean;
  liveSwitchEnabled: boolean;
  healthStatus: 'disabled' | 'healthy' | 'warning' | 'critical' | 'unknown';
  rpoStatus: 'MET' | 'BREACHED' | 'UNKNOWN';
  rtoStatus: 'MET' | 'BREACHED' | 'UNKNOWN';
  drillOverdue: boolean;
  profile: DrProfileDto;
  latestSync: DrSyncRunDto | null;
  latestReconciliation: DrReconciliationReportDto | null;
  latestDrill: DrDrillDto | null;
  activeSwitch: DrSwitchExecutionDto | null;
  storageDrConfigured: boolean;
  dbDrConfigured: boolean;
}

export interface DrRunbookDto {
  version: string;
  updatedAt: string;
  topologyModes: Array<{
    mode: DrTopologyMode;
    summary: string;
    typicalRpo: string;
    typicalRto: string;
  }>;
  sections: Array<{
    id: string;
    title: string;
    summary: string;
    steps: string[];
    commands?: string[];
  }>;
  antiSplitBrainRules: string[];
}

export interface PaginatedDrList<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number | null;
    totalPages: number | null;
  };
}
