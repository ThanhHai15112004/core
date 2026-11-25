import { Injectable } from '@nestjs/common';
import type { DataRepairPreviewOutcome, PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  IReconciliationPublicService,
  ReconciliationCatalogView,
  ScheduledReconciliationTickResult,
} from '../contracts/index.js';
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
import { DataRepairService } from './data-repair.service.js';
import { ReconciliationDiscrepanciesService } from './reconciliation-discrepancies.service.js';
import { ReconciliationJobsService } from './reconciliation-jobs.service.js';
import { ReconciliationRunnerService } from './reconciliation-runner.service.js';

@Injectable()
export class ReconciliationService implements IReconciliationPublicService {
  constructor(
    private readonly jobsService: ReconciliationJobsService,
    private readonly runnerService: ReconciliationRunnerService,
    private readonly discrepanciesService: ReconciliationDiscrepanciesService,
    private readonly dataRepairService: DataRepairService,
  ) {}

  public getCatalog(): ReconciliationCatalogView {
    return this.jobsService.getCatalog();
  }

  public listJobs(
    query: ListReconciliationJobsQuery,
  ): Promise<PaginatedResult<ReconciliationJobView>> {
    return this.jobsService.listJobs(query);
  }

  public getJobById(id: number): Promise<ReconciliationJobView> {
    return this.jobsService.getJobById(id);
  }

  public createJob(
    input: CreateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    return this.jobsService.createJob(input, actor);
  }

  public updateJob(
    id: number,
    input: UpdateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    return this.jobsService.updateJob(id, input, actor);
  }

  public triggerManualRun(
    jobId: number,
    input: TriggerReconciliationRunInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationRunView> {
    return this.runnerService.triggerManualRun(jobId, input, actor);
  }

  public processQueuedRun(
    payload: QueuedReconciliationRunJobPayload,
  ): Promise<ReconciliationRunView> {
    return this.runnerService.processQueuedRun(payload);
  }

  public triggerDueScheduledJobs(now?: Date): Promise<ScheduledReconciliationTickResult> {
    return this.runnerService.triggerDueScheduledJobs(now);
  }

  public listRuns(
    query: ListReconciliationRunsQuery,
  ): Promise<PaginatedResult<ReconciliationRunView>> {
    return this.runnerService.listRuns(query);
  }

  public getRunById(id: number): Promise<ReconciliationRunView> {
    return this.runnerService.getRunById(id);
  }

  public listDiscrepancies(
    query: ListDiscrepanciesQuery,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyView>> {
    return this.discrepanciesService.listDiscrepancies(query);
  }

  public getDiscrepancyById(id: number): Promise<ReconciliationDiscrepancyView> {
    return this.discrepanciesService.getDiscrepancyById(id);
  }

  public getDiscrepancyReport(
    query: DiscrepancyReportQuery,
  ): Promise<ReconciliationDiscrepancyReportView> {
    return this.discrepanciesService.getDiscrepancyReport(query);
  }

  public exportDiscrepanciesCsv(
    query: Partial<ListDiscrepanciesQuery>,
    actor?: UserIdentity,
  ): Promise<{ readonly fileName: string; readonly buffer: Buffer; readonly totalRows: number }> {
    return this.discrepanciesService.exportDiscrepanciesCsv(query, actor);
  }

  public assignDiscrepancy(
    id: number,
    input: AssignDiscrepancyRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    return this.discrepanciesService.assignDiscrepancy(id, input, actor);
  }

  public updateDiscrepancyStatus(
    id: number,
    input: UpdateDiscrepancyStatusRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    return this.discrepanciesService.updateDiscrepancyStatus(id, input, actor);
  }

  public previewRepair(
    input: PreviewDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairPreviewOutcome> {
    return this.dataRepairService.previewRepair(input, actor);
  }

  public proposeRepair(
    input: ProposeDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.dataRepairService.proposeRepair(input, actor);
  }

  public listRepairs(
    query: ListDataRepairsQuery,
  ): Promise<PaginatedResult<DataRepairRequestView>> {
    return this.dataRepairService.listRepairs(query);
  }

  public getRepairById(id: number): Promise<DataRepairRequestView> {
    return this.dataRepairService.getRepairById(id);
  }

  public approveRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.dataRepairService.approveRepair(id, input, actor);
  }

  public rejectRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.dataRepairService.rejectRepair(id, input, actor);
  }

  public applyRepair(id: number, actor?: UserIdentity): Promise<DataRepairRequestView> {
    return this.dataRepairService.applyRepair(id, actor);
  }

  public proposeCompensation(
    parentRepairId: number,
    input: CreateCompensationInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.dataRepairService.proposeCompensation(parentRepairId, input, actor);
  }
}
