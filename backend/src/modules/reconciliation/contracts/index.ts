import type {
  DataRepairHandlerMetadata,
  DataRepairPreviewOutcome,
  PaginatedResult,
  ReconciliationAdapterMetadata,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  AssignDiscrepancyRequest,
  DiscrepancyReportQuery,
  ListDataRepairsQuery,
  ListDiscrepanciesQuery,
  ListReconciliationJobsQuery,
  ListReconciliationRunsQuery,
  UpdateDiscrepancyStatusRequest,
} from '../requests/reconciliation.requests.js';
import type {
  CreateCompensationInput,
  CreateReconciliationJobInput,
  DataRepairRequestView,
  DecideDataRepairInput,
  PreviewDataRepairInput,
  ProposeDataRepairInput,
  QueuedReconciliationRunJobPayload,
  ReconciliationDiscrepancyReportView,
  ReconciliationDiscrepancyView,
  ReconciliationJobView,
  ReconciliationRunView,
  TriggerReconciliationRunInput,
  UpdateReconciliationJobInput,
} from '../types/reconciliation.types.js';

export const RECONCILIATION_PUBLIC_SERVICE = Symbol('RECONCILIATION_PUBLIC_SERVICE');

export interface ReconciliationCatalogView {
  readonly adapters: readonly ReconciliationAdapterMetadata[];
  readonly repairHandlers: readonly DataRepairHandlerMetadata[];
}

export interface ScheduledReconciliationTickResult {
  readonly checkedJobs: number;
  readonly triggeredCount: number;
  readonly triggeredRunIds: readonly number[];
}

export interface IReconciliationPublicService {
  getCatalog(): ReconciliationCatalogView;
  listJobs(query: ListReconciliationJobsQuery): Promise<PaginatedResult<ReconciliationJobView>>;
  getJobById(id: number): Promise<ReconciliationJobView>;
  createJob(
    input: CreateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView>;
  updateJob(
    id: number,
    input: UpdateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView>;
  triggerManualRun(
    jobId: number,
    input: TriggerReconciliationRunInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationRunView>;
  processQueuedRun(payload: QueuedReconciliationRunJobPayload): Promise<ReconciliationRunView>;
  triggerDueScheduledJobs(now?: Date): Promise<ScheduledReconciliationTickResult>;
  listRuns(query: ListReconciliationRunsQuery): Promise<PaginatedResult<ReconciliationRunView>>;
  getRunById(id: number): Promise<ReconciliationRunView>;
  listDiscrepancies(
    query: ListDiscrepanciesQuery,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyView>>;
  getDiscrepancyById(id: number): Promise<ReconciliationDiscrepancyView>;
  getDiscrepancyReport(query: DiscrepancyReportQuery): Promise<ReconciliationDiscrepancyReportView>;
  exportDiscrepanciesCsv(
    query: Partial<ListDiscrepanciesQuery>,
    actor?: UserIdentity,
  ): Promise<{ readonly fileName: string; readonly buffer: Buffer; readonly totalRows: number }>;
  assignDiscrepancy(
    id: number,
    input: AssignDiscrepancyRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView>;
  updateDiscrepancyStatus(
    id: number,
    input: UpdateDiscrepancyStatusRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView>;
  previewRepair(
    input: PreviewDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairPreviewOutcome>;
  proposeRepair(
    input: ProposeDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView>;
  listRepairs(query: ListDataRepairsQuery): Promise<PaginatedResult<DataRepairRequestView>>;
  getRepairById(id: number): Promise<DataRepairRequestView>;
  approveRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView>;
  rejectRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView>;
  applyRepair(id: number, actor?: UserIdentity): Promise<DataRepairRequestView>;
  proposeCompensation(
    parentRepairId: number,
    input: CreateCompensationInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView>;
}
