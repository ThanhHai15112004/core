import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { COMPLIANCE_PERMISSIONS } from '../enum/compliance.enum.js';
import {
  type ComplianceReportQuery,
  ComplianceReportQuerySchema,
  type CreateControlRequest,
  CreateControlRequestSchema,
  type CreateEvidenceRequest,
  CreateEvidenceRequestSchema,
  type CreateVendorDataAssessmentRequest,
  CreateVendorDataAssessmentRequestSchema,
  type CreateVendorRequest,
  CreateVendorRequestSchema,
  type GenerateComplianceReportRequest,
  GenerateComplianceReportRequestSchema,
  type ListCheckHistoriesQuery,
  ListCheckHistoriesQuerySchema,
  type ListControlsQuery,
  ListControlsQuerySchema,
  type ListEvidencesQuery,
  ListEvidencesQuerySchema,
  type ListVendorsQuery,
  ListVendorsQuerySchema,
  type RecordControlCheckRequest,
  RecordControlCheckRequestSchema,
  type RunReviewSweepRequest,
  RunReviewSweepRequestSchema,
  type UpdateControlRequest,
  UpdateControlRequestSchema,
  type UpdateVendorDataAssessmentRequest,
  UpdateVendorDataAssessmentRequestSchema,
  type UpdateVendorRequest,
  UpdateVendorRequestSchema,
  idParamSchema,
  tokenParamSchema,
} from '../requests/compliance.requests.js';
import { COMPLIANCE_ROUTES } from '../routes/compliance.routes.js';
import { ComplianceService } from '../services/compliance.service.js';
import type {
  ComplianceCheckHistoryView,
  ComplianceControlView,
  ComplianceEvidenceView,
  ComplianceOverviewView,
  ComplianceReportDownloadView,
  ComplianceReportResultView,
  ComplianceReviewSweepResult,
  ComplianceVendorView,
  VendorDataAssessmentView,
} from '../types/compliance.types.js';

@ApiGroup(
  'Compliance & Vendor Management (14.6)',
  'Quản lý tuân thủ và rủi ro nhà cung cấp: danh mục yêu cầu kiểm soát (Control, người phụ trách, tần suất), bằng chứng (File/Log/Report/Link), lịch sử kiểm tra, danh mục nhà cung cấp (Email/SMS/Cloud/Payment/AI), đánh giá dữ liệu được phép xử lý, nhắc hạn hợp đồng/rà soát định kỳ, phương án dự phòng/thay thế và báo cáo Compliance đa tiêu chuẩn.',
)
@Controller(COMPLIANCE_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get(COMPLIANCE_ROUTES.OVERVIEW)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Tổng quan Compliance, độ phủ framework và cảnh báo sắp/quá hạn (14.6)' })
  public getOverview(): Promise<ComplianceOverviewView> {
    return this.complianceService.getOverview();
  }

  @Post(COMPLIANCE_ROUTES.REVIEWS_SWEEP)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.MANAGE)
  @ApiDoc({
    summary:
      'Quét nhắc rà soát Control định kỳ, rà soát nhà cung cấp, hạn hợp đồng và hết hạn bằng chứng',
  })
  public runReviewSweep(
    @ValidatedBody(RunReviewSweepRequestSchema) body: RunReviewSweepRequest,
  ): Promise<ComplianceReviewSweepResult> {
    return this.complianceService.runReviewReminderSweep({ dryRun: body.dryRun });
  }

  @Get(COMPLIANCE_ROUTES.CONTROLS)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách yêu cầu kiểm soát (Compliance Controls)' })
  public listControls(
    @ValidatedQuery(ListControlsQuerySchema) query: ListControlsQuery,
  ): Promise<PaginatedResult<ComplianceControlView>> {
    return this.complianceService.listControls(query);
  }

  @Get(COMPLIANCE_ROUTES.CONTROL_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Chi tiết một yêu cầu kiểm soát' })
  public getControlById(
    @ValidatedParams(idParamSchema) params: { id: number },
  ): Promise<ComplianceControlView> {
    return this.complianceService.getControlById(params.id);
  }

  @Post(COMPLIANCE_ROUTES.CONTROLS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Tạo yêu cầu kiểm soát (Control, người phụ trách, tần suất)' })
  public createControl(
    @ValidatedBody(CreateControlRequestSchema) body: CreateControlRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceControlView> {
    return this.complianceService.createControl(body, actor);
  }

  @Patch(COMPLIANCE_ROUTES.CONTROL_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Cập nhật yêu cầu kiểm soát' })
  public updateControl(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdateControlRequestSchema) body: UpdateControlRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceControlView> {
    return this.complianceService.updateControl(params.id, body, actor);
  }

  @Delete(COMPLIANCE_ROUTES.CONTROL_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Xóa mềm yêu cầu kiểm soát' })
  public deleteControl(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.complianceService.deleteControl(params.id, actor);
  }

  @Get(COMPLIANCE_ROUTES.CHECKS)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Lịch sử kiểm tra yêu cầu kiểm soát trên toàn hệ thống' })
  public listAllCheckHistories(
    @ValidatedQuery(ListCheckHistoriesQuerySchema) query: ListCheckHistoriesQuery,
  ): Promise<PaginatedResult<ComplianceCheckHistoryView>> {
    return this.complianceService.listCheckHistories(query);
  }

  @Get(COMPLIANCE_ROUTES.CONTROL_CHECKS)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Lịch sử kiểm tra của một yêu cầu kiểm soát cụ thể' })
  public listControlCheckHistories(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedQuery(ListCheckHistoriesQuerySchema) query: ListCheckHistoriesQuery,
  ): Promise<PaginatedResult<ComplianceCheckHistoryView>> {
    return this.complianceService.listCheckHistories({ ...query, controlId: params.id });
  }

  @Post(COMPLIANCE_ROUTES.CONTROL_CHECKS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.CHECK)
  @ApiDoc({ summary: 'Ghi nhận kết quả kiểm tra kiểm soát (ai kiểm tra, kết quả, khắc phục)' })
  public recordControlCheck(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(RecordControlCheckRequestSchema) body: RecordControlCheckRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceCheckHistoryView> {
    return this.complianceService.recordControlCheck(params.id, body, actor);
  }

  @Get(COMPLIANCE_ROUTES.EVIDENCES)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách bằng chứng thực hiện kiểm soát (File, Log, Report, Link)' })
  public listEvidences(
    @ValidatedQuery(ListEvidencesQuerySchema) query: ListEvidencesQuery,
  ): Promise<PaginatedResult<ComplianceEvidenceView>> {
    return this.complianceService.listEvidences(query);
  }

  @Post(COMPLIANCE_ROUTES.EVIDENCES)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.CHECK)
  @ApiDoc({ summary: 'Lưu bằng chứng thực hiện kiểm soát (File, Log, Báo cáo hoặc Link)' })
  public createEvidence(
    @ValidatedBody(CreateEvidenceRequestSchema) body: CreateEvidenceRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceEvidenceView> {
    return this.complianceService.createEvidence(body, actor);
  }

  @Delete(COMPLIANCE_ROUTES.EVIDENCE_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Xóa mềm bằng chứng kiểm soát' })
  public deleteEvidence(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.complianceService.deleteEvidence(params.id, actor);
  }

  @Get(COMPLIANCE_ROUTES.VENDORS)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({
    summary: 'Danh sách nhà cung cấp (Email, SMS, Cloud, Payment, AI, Khác) & hạn hợp đồng',
  })
  public listVendors(
    @ValidatedQuery(ListVendorsQuerySchema) query: ListVendorsQuery,
  ): Promise<PaginatedResult<ComplianceVendorView>> {
    return this.complianceService.listVendors(query);
  }

  @Get(COMPLIANCE_ROUTES.VENDOR_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Chi tiết nhà cung cấp, hợp đồng và phương án dự phòng/thay thế' })
  public getVendorById(
    @ValidatedParams(idParamSchema) params: { id: number },
  ): Promise<ComplianceVendorView> {
    return this.complianceService.getVendorById(params.id);
  }

  @Post(COMPLIANCE_ROUTES.VENDORS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Thêm nhà cung cấp kèm lịch rà soát, hợp đồng và phương án dự phòng' })
  public createVendor(
    @ValidatedBody(CreateVendorRequestSchema) body: CreateVendorRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceVendorView> {
    return this.complianceService.createVendor(body, actor);
  }

  @Patch(COMPLIANCE_ROUTES.VENDOR_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Cập nhật thông tin nhà cung cấp, ngày đánh giá, hợp đồng và dự phòng' })
  public updateVendor(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdateVendorRequestSchema) body: UpdateVendorRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceVendorView> {
    return this.complianceService.updateVendor(params.id, body, actor);
  }

  @Delete(COMPLIANCE_ROUTES.VENDOR_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Xóa mềm nhà cung cấp' })
  public deleteVendor(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.complianceService.deleteVendor(params.id, actor);
  }

  @Get(COMPLIANCE_ROUTES.VENDOR_DATA_ASSESSMENTS)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách đánh giá dữ liệu được phép xử lý của một nhà cung cấp' })
  public listVendorDataAssessments(
    @ValidatedParams(idParamSchema) params: { id: number },
  ): Promise<VendorDataAssessmentView[]> {
    return this.complianceService.listVendorDataAssessments(params.id);
  }

  @Post(COMPLIANCE_ROUTES.VENDOR_DATA_ASSESSMENTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Tạo đánh giá phạm vi dữ liệu nhà cung cấp được phép xử lý' })
  public createVendorDataAssessment(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(CreateVendorDataAssessmentRequestSchema)
    body: CreateVendorDataAssessmentRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    return this.complianceService.createVendorDataAssessment(params.id, body, actor);
  }

  @Patch(COMPLIANCE_ROUTES.DATA_ASSESSMENT_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Cập nhật hoặc phê duyệt đánh giá dữ liệu nhà cung cấp' })
  public updateVendorDataAssessment(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdateVendorDataAssessmentRequestSchema)
    body: UpdateVendorDataAssessmentRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    return this.complianceService.updateVendorDataAssessment(params.id, body, actor);
  }

  @Delete(COMPLIANCE_ROUTES.DATA_ASSESSMENT_BY_ID)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.VENDOR_MANAGE)
  @ApiDoc({ summary: 'Xóa mềm đánh giá dữ liệu nhà cung cấp' })
  public deleteVendorDataAssessment(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.complianceService.deleteVendorDataAssessment(params.id, actor);
  }

  @Get(COMPLIANCE_ROUTES.REPORTS_SUMMARY)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.REPORT)
  @ApiDoc({
    summary:
      'Xem tổng hợp báo cáo Compliance trung lập (lọc theo frameworkTag bất kỳ, domain, nhà cung cấp)',
  })
  public getSummaryReport(
    @ValidatedQuery(ComplianceReportQuerySchema) query: ComplianceReportQuery,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    return this.complianceService.getSummaryReport(query, actor);
  }

  @Post(COMPLIANCE_ROUTES.REPORTS_GENERATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.REPORT)
  @ApiDoc({ summary: 'Tạo và xuất báo cáo Compliance (JSON / CSV / XLSX / PDF)' })
  public generateReport(
    @ValidatedBody(GenerateComplianceReportRequestSchema) body: GenerateComplianceReportRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    return this.complianceService.generateReport(body, actor);
  }

  @Get(COMPLIANCE_ROUTES.REPORTS_DOWNLOAD)
  @RequirePermissions(COMPLIANCE_PERMISSIONS.REPORT)
  @ApiDoc({ summary: 'Tải xuống tệp báo cáo Compliance tạm thời theo token' })
  public downloadReportArtifact(
    @ValidatedParams(tokenParamSchema) params: { token: string },
  ): ComplianceReportDownloadView {
    return this.complianceService.downloadReportArtifact(params.token);
  }
}
