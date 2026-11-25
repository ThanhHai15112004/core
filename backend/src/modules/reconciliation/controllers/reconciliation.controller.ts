import { Controller, Get, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intIdParamSchema,
} from '@packages/http/index.js';
import type { DataRepairPreviewOutcome, PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type { ReconciliationCatalogView } from '../contracts/index.js';
import {
  AssignDiscrepancySchema,
  CreateCompensationSchema,
  CreateReconciliationJobSchema,
  DecideDataRepairSchema,
  DiscrepancyReportQuerySchema,
  ListDataRepairsQuerySchema,
  ListDiscrepanciesQuerySchema,
  ListReconciliationJobsQuerySchema,
  ListReconciliationRunsQuerySchema,
  PreviewDataRepairSchema,
  ProposeDataRepairSchema,
  TriggerReconciliationRunSchema,
  UpdateDiscrepancyStatusSchema,
  UpdateReconciliationJobSchema,
  type AssignDiscrepancyRequest,
  type CreateCompensationRequest,
  type CreateReconciliationJobRequest,
  type DecideDataRepairRequest,
  type DiscrepancyReportQuery,
  type ListDataRepairsQuery,
  type ListDiscrepanciesQuery,
  type ListReconciliationJobsQuery,
  type ListReconciliationRunsQuery,
  type PreviewDataRepairRequest,
  type ProposeDataRepairRequest,
  type TriggerReconciliationRunRequest,
  type UpdateDiscrepancyStatusRequest,
  type UpdateReconciliationJobRequest,
} from '../requests/reconciliation.requests.js';
import { RECONCILIATION_ROUTES } from '../routes/reconciliation.routes.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import type {
  DataRepairRequestView,
  ReconciliationDiscrepancyReportView,
  ReconciliationDiscrepancyView,
  ReconciliationJobView,
  ReconciliationRunView,
} from '../types/reconciliation.types.js';

@ApiGroup(
  'Reconciliation & Data Repair',
  'Đối soát và Sửa dữ liệu (11.5): Job đối soát định kỳ/thủ công, phân loại sai lệch (thiếu/trùng/trạng thái/số tiền), báo cáo mức độ & người phụ trách, sửa dữ liệu có Dry-Run, phê duyệt Maker-Checker, lưu before/after và hành động bù không mất lịch sử',
)
@Controller(RECONCILIATION_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get(RECONCILIATION_ROUTES.CATALOG)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Danh sách Source Adapters đối soát và Data Repair Handlers đã đăng ký' })
  public getCatalog(): ReconciliationCatalogView {
    return this.reconciliationService.getCatalog();
  }

  @Get(RECONCILIATION_ROUTES.JOBS)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Danh sách cấu hình Job đối soát dữ liệu' })
  public async listJobs(
    @ValidatedQuery(ListReconciliationJobsQuerySchema) query: ListReconciliationJobsQuery,
  ): Promise<PaginatedResult<ReconciliationJobView>> {
    return this.reconciliationService.listJobs(query);
  }

  @Post(RECONCILIATION_ROUTES.JOBS)
  @RequirePermissions('reconciliation.job.manage')
  @ApiDoc({ summary: 'Tạo cấu hình Job đối soát dữ liệu mới' })
  public async createJob(
    @ValidatedBody(CreateReconciliationJobSchema) body: CreateReconciliationJobRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    return this.reconciliationService.createJob(body, actor);
  }

  @Get(RECONCILIATION_ROUTES.JOB_BY_ID)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Chi tiết một cấu hình Job đối soát' })
  public async getJobById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<ReconciliationJobView> {
    return this.reconciliationService.getJobById(params.id);
  }

  @Patch(RECONCILIATION_ROUTES.JOB_BY_ID)
  @RequirePermissions('reconciliation.job.manage')
  @ApiDoc({
    summary: 'Cập nhật cấu hình Job đối soát (lịch chạy, người phụ trách mặc định, quy tắc khớp)',
  })
  public async updateJob(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateReconciliationJobSchema) body: UpdateReconciliationJobRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    return this.reconciliationService.updateJob(params.id, body, actor);
  }

  @Post(RECONCILIATION_ROUTES.JOB_RUN)
  @RequirePermissions('reconciliation.run.execute')
  @ApiDoc({ summary: 'Chạy đối soát thủ công theo Job (có phân quyền & ghi Audit Log)' })
  public async triggerManualRun(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(TriggerReconciliationRunSchema) body: TriggerReconciliationRunRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReconciliationRunView> {
    return this.reconciliationService.triggerManualRun(params.id, body, actor);
  }

  @Get(RECONCILIATION_ROUTES.RUNS)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Danh sách lịch sử các phiên chạy đối soát' })
  public async listRuns(
    @ValidatedQuery(ListReconciliationRunsQuerySchema) query: ListReconciliationRunsQuery,
  ): Promise<PaginatedResult<ReconciliationRunView>> {
    return this.reconciliationService.listRuns(query);
  }

  @Get(RECONCILIATION_ROUTES.RUN_BY_ID)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Chi tiết một phiên chạy đối soát' })
  public async getRunById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<ReconciliationRunView> {
    return this.reconciliationService.getRunById(params.id);
  }

  @Get(RECONCILIATION_ROUTES.DISCREPANCIES_REPORT)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({
    summary: 'Báo cáo tổng hợp sai lệch theo loại, mức độ nghiêm trọng và người phụ trách',
  })
  public async getDiscrepancyReport(
    @ValidatedQuery(DiscrepancyReportQuerySchema) query: DiscrepancyReportQuery,
  ): Promise<ReconciliationDiscrepancyReportView> {
    return this.reconciliationService.getDiscrepancyReport(query);
  }

  @Get(RECONCILIATION_ROUTES.DISCREPANCIES_EXPORT)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Xuất báo cáo chi tiết sai lệch đối soát ra tệp CSV' })
  public async exportDiscrepanciesCsv(
    @ValidatedQuery(ListDiscrepanciesQuerySchema) query: ListDiscrepanciesQuery,
    @Res() reply: FastifyReply,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<void> {
    const exported = await this.reconciliationService.exportDiscrepanciesCsv(query, actor);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${exported.fileName}"`)
      .send(exported.buffer);
  }

  @Get(RECONCILIATION_ROUTES.DISCREPANCIES)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({
    summary:
      'Danh sách chi tiết sai lệch đối soát (lọc theo loại, mức độ, trạng thái, người phụ trách)',
  })
  public async listDiscrepancies(
    @ValidatedQuery(ListDiscrepanciesQuerySchema) query: ListDiscrepanciesQuery,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyView>> {
    return this.reconciliationService.listDiscrepancies(query);
  }

  @Get(RECONCILIATION_ROUTES.DISCREPANCY_BY_ID)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Chi tiết một bản ghi sai lệch đối soát kèm snapshot nội bộ & nguồn ngoài' })
  public async getDiscrepancyById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<ReconciliationDiscrepancyView> {
    return this.reconciliationService.getDiscrepancyById(params.id);
  }

  @Patch(RECONCILIATION_ROUTES.DISCREPANCY_ASSIGN)
  @RequirePermissions('reconciliation.discrepancy.manage')
  @ApiDoc({ summary: 'Phân công người phụ trách xử lý sai lệch đối soát' })
  public async assignDiscrepancy(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(AssignDiscrepancySchema) body: AssignDiscrepancyRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    return this.reconciliationService.assignDiscrepancy(params.id, body, actor);
  }

  @Patch(RECONCILIATION_ROUTES.DISCREPANCY_STATUS)
  @RequirePermissions('reconciliation.discrepancy.manage')
  @ApiDoc({ summary: 'Cập nhật thủ công trạng thái sai lệch (RESOLVED / IGNORED / OPEN)' })
  public async updateDiscrepancyStatus(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateDiscrepancyStatusSchema) body: UpdateDiscrepancyStatusRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    return this.reconciliationService.updateDiscrepancyStatus(params.id, body, actor);
  }

  @Post(RECONCILIATION_ROUTES.REPAIR_PREVIEW)
  @RequirePermissions('reconciliation.repair.propose')
  @ApiDoc({ summary: 'Chạy thử Dry-Run xem trước thay đổi trước/sau của công cụ sửa dữ liệu' })
  public async previewRepair(
    @ValidatedBody(PreviewDataRepairSchema) body: PreviewDataRepairRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairPreviewOutcome> {
    return this.reconciliationService.previewRepair(body, actor);
  }

  @Get(RECONCILIATION_ROUTES.REPAIRS)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Danh sách yêu cầu sửa dữ liệu và hành động bù' })
  public async listRepairs(
    @ValidatedQuery(ListDataRepairsQuerySchema) query: ListDataRepairsQuery,
  ): Promise<PaginatedResult<DataRepairRequestView>> {
    return this.reconciliationService.listRepairs(query);
  }

  @Post(RECONCILIATION_ROUTES.REPAIRS)
  @RequirePermissions('reconciliation.repair.propose')
  @ApiDoc({
    summary:
      'Tạo đề xuất sửa dữ liệu (tự động Dry-Run & định tuyến duyệt Maker-Checker nếu nhạy cảm)',
  })
  public async proposeRepair(
    @ValidatedBody(ProposeDataRepairSchema) body: ProposeDataRepairRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.proposeRepair(body, actor);
  }

  @Get(RECONCILIATION_ROUTES.REPAIR_BY_ID)
  @RequirePermissions('reconciliation.read')
  @ApiDoc({ summary: 'Chi tiết yêu cầu sửa dữ liệu kèm before/after và nhật ký thực thi bất biến' })
  public async getRepairById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.getRepairById(params.id);
  }

  @Post(RECONCILIATION_ROUTES.REPAIR_APPROVE)
  @RequirePermissions('reconciliation.repair.approve')
  @ApiDoc({
    summary: 'Phê duyệt yêu cầu sửa dữ liệu nhạy cảm (bắt buộc người duyệt khác người đề xuất)',
  })
  public async approveRepair(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(DecideDataRepairSchema) body: DecideDataRepairRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.approveRepair(params.id, body, actor);
  }

  @Post(RECONCILIATION_ROUTES.REPAIR_REJECT)
  @RequirePermissions('reconciliation.repair.approve')
  @ApiDoc({ summary: 'Từ chối yêu cầu sửa dữ liệu nhạy cảm (bắt buộc tách người duyệt)' })
  public async rejectRepair(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(DecideDataRepairSchema) body: DecideDataRepairRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.rejectRepair(params.id, body, actor);
  }

  @Post(RECONCILIATION_ROUTES.REPAIR_APPLY)
  @RequirePermissions('reconciliation.repair.execute')
  @ApiDoc({
    summary:
      'Áp dụng thực thi lệnh sửa dữ liệu hoặc hành động bù (ghi dữ liệu trước & sau + Audit)',
  })
  public async applyRepair(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.applyRepair(params.id, actor);
  }

  @Post(RECONCILIATION_ROUTES.REPAIR_COMPENSATE)
  @RequirePermissions('reconciliation.repair.propose')
  @ApiDoc({
    summary:
      'Đề xuất hành động bù cho bản ghi không thể rollback (giữ nguyên toàn bộ lịch sử lệnh gốc)',
  })
  public async proposeCompensation(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(CreateCompensationSchema) body: CreateCompensationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    return this.reconciliationService.proposeCompensation(params.id, body, actor);
  }
}
