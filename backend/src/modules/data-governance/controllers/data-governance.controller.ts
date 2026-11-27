import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import type { LegalHoldCheckDecision, PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { DATA_GOVERNANCE_PERMISSIONS } from '../enum/data-governance.enum.js';
import {
  type ApproveDsarRequest,
  ApproveDsarRequestSchema,
  type CheckLegalHoldQuery,
  CheckLegalHoldQuerySchema,
  type CreateDsarRequest,
  CreateDsarRequestSchema,
  type CreateLegalHoldRequest,
  CreateLegalHoldRequestSchema,
  type EvaluateSensitivePayloadRequest,
  EvaluateSensitivePayloadRequestSchema,
  type GrantConsentRequest,
  GrantConsentRequestSchema,
  type ListConsentDefinitionsQuery,
  ListConsentDefinitionsQuerySchema,
  type ListDataClassificationsQuery,
  ListDataClassificationsQuerySchema,
  type ListDsarRequestsQuery,
  ListDsarRequestsQuerySchema,
  type ListLegalHoldsQuery,
  ListLegalHoldsQuerySchema,
  type ListSensitiveFieldsQuery,
  ListSensitiveFieldsQuerySchema,
  type ListUserConsentsQuery,
  ListUserConsentsQuerySchema,
  type RejectDsarRequest,
  RejectDsarRequestSchema,
  type ReleaseLegalHoldRequest,
  ReleaseLegalHoldRequestSchema,
  type RunRetentionSweepRequest,
  RunRetentionSweepRequestSchema,
  type UpdateDataClassificationRequest,
  UpdateDataClassificationRequestSchema,
  type UpdateSensitiveFieldRequest,
  UpdateSensitiveFieldRequestSchema,
  type UpsertConsentDefinitionRequest,
  UpsertConsentDefinitionRequestSchema,
  type UpsertDataClassificationRequest,
  UpsertDataClassificationRequestSchema,
  type UpsertSensitiveFieldRequest,
  UpsertSensitiveFieldRequestSchema,
  type WithdrawConsentRequest,
  WithdrawConsentRequestSchema,
  idParamSchema,
  tokenParamSchema,
} from '../requests/data-governance.requests.js';
import { DATA_GOVERNANCE_ROUTES } from '../routes/data-governance.routes.js';
import { DataGovernanceService } from '../services/data-governance.service.js';
import type {
  ConsentDefinitionView,
  DataClassificationView,
  DataGovernanceOverviewView,
  DsarDownloadPayloadView,
  DsarRequestView,
  GovernanceExpirationSweepResult,
  LegalHoldView,
  RetentionSweepSummaryView,
  SensitiveFieldView,
  UserConsentView,
} from '../types/data-governance.types.js';

@ApiGroup(
  'Data Privacy & Governance (14.5)',
  'Quyền riêng tư và Quản trị dữ liệu: phân loại dữ liệu 4 mức, đánh dấu trường nhạy cảm (Log/Export/Phân quyền), chính sách Retention, yêu cầu dữ liệu cá nhân DSAR (Xem/Xuất/Xóa có ngoại lệ & phê duyệt), quản lý Consent và Legal Hold.',
)
@Controller(DATA_GOVERNANCE_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class DataGovernanceController {
  constructor(private readonly governanceService: DataGovernanceService) {}

  @Get(DATA_GOVERNANCE_ROUTES.OVERVIEW)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Tổng quan trạng thái Quyền riêng tư & Quản trị dữ liệu (14.5)' })
  public getOverview(): Promise<DataGovernanceOverviewView> {
    return this.governanceService.getOverview();
  }

  @Get(DATA_GOVERNANCE_ROUTES.CLASSIFICATIONS)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách phân loại dữ liệu (Public, Internal, Confidential, Restricted) & Retention' })
  public listClassifications(
    @ValidatedQuery(ListDataClassificationsQuerySchema) query: ListDataClassificationsQuery,
  ): Promise<PaginatedResult<DataClassificationView>> {
    return this.governanceService.listClassifications(query);
  }

  @Post(DATA_GOVERNANCE_ROUTES.CLASSIFICATIONS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Khởi tạo hoặc cập nhật phân loại dữ liệu & thời gian lưu (Retention)' })
  public upsertClassification(
    @ValidatedBody(UpsertDataClassificationRequestSchema) body: UpsertDataClassificationRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<DataClassificationView> {
    return this.governanceService.upsertClassification(body, actor);
  }

  @Put(DATA_GOVERNANCE_ROUTES.CLASSIFICATION_BY_ID)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Cập nhật phân loại dữ liệu hoặc chính sách lưu trữ theo ID' })
  public updateClassification(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdateDataClassificationRequestSchema) body: UpdateDataClassificationRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<DataClassificationView> {
    return this.governanceService.updateClassification(params.id, body, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.SENSITIVE_FIELDS)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách trường dữ liệu nhạy cảm dùng cho Log, Export và Phân quyền' })
  public listSensitiveFields(
    @ValidatedQuery(ListSensitiveFieldsQuerySchema) query: ListSensitiveFieldsQuery,
  ): Promise<PaginatedResult<SensitiveFieldView>> {
    return this.governanceService.listSensitiveFields(query);
  }

  @Post(DATA_GOVERNANCE_ROUTES.SENSITIVE_FIELDS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Đánh dấu hoặc cập nhật trường dữ liệu nhạy cảm' })
  public upsertSensitiveField(
    @ValidatedBody(UpsertSensitiveFieldRequestSchema) body: UpsertSensitiveFieldRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<SensitiveFieldView> {
    return this.governanceService.upsertSensitiveField(body, actor);
  }

  @Put(DATA_GOVERNANCE_ROUTES.SENSITIVE_FIELD_BY_ID)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Cập nhật cấu hình trường dữ liệu nhạy cảm theo ID' })
  public updateSensitiveField(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdateSensitiveFieldRequestSchema) body: UpdateSensitiveFieldRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<SensitiveFieldView> {
    return this.governanceService.updateSensitiveField(params.id, body, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.SENSITIVE_FIELDS_EVALUATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Kiểm tra che giấu (mask/redact) bản ghi theo quyền của người gọi' })
  public evaluateSensitivePayload(
    @ValidatedBody(EvaluateSensitivePayloadRequestSchema) body: EvaluateSensitivePayloadRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<{
    readonly resourceType: string;
    readonly context: 'read' | 'export';
    readonly sanitizedPayload: Record<string, unknown>;
  }> {
    return this.governanceService.evaluateSensitivePayload(body, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.RETENTION_SWEEP)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Thực thi hoặc chạy thử (dryRun) thu dọn dữ liệu theo chính sách Retention' })
  public runRetentionSweep(
    @ValidatedBody(RunRetentionSweepRequestSchema) body: RunRetentionSweepRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<RetentionSweepSummaryView> {
    return this.governanceService.runRetentionSweep({
      dataTypeCode: body.dataTypeCode,
      dryRun: body.dryRun,
      actor,
    });
  }

  @Post(DATA_GOVERNANCE_ROUTES.EXPIRATION_SWEEP)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.MANAGE)
  @ApiDoc({ summary: 'Quét hết hạn các lệnh Legal Hold, Consent và liên kết tải DSAR đã quá hạn' })
  public runExpirationSweep(): Promise<GovernanceExpirationSweepResult> {
    return this.governanceService.runExpirationSweep();
  }

  @Get(DATA_GOVERNANCE_ROUTES.DSAR)
  @ApiDoc({ summary: 'Danh sách yêu cầu dữ liệu cá nhân DSAR (Quản trị xem toàn bộ, User xem của mình)' })
  public listDsarRequests(
    @ValidatedQuery(ListDsarRequestsQuerySchema) query: ListDsarRequestsQuery,
    @CurrentUser() actor: UserIdentity,
  ): Promise<PaginatedResult<DsarRequestView>> {
    return this.governanceService.listDsarRequests(query, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.DSAR_ME)
  @ApiDoc({ summary: 'Danh sách yêu cầu Xem / Xuất / Xóa dữ liệu cá nhân của chính tôi' })
  public listMyDsarRequests(@CurrentUser() actor: UserIdentity): Promise<DsarRequestView[]> {
    return this.governanceService.listMyDsarRequests(actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.DSAR_BY_ID)
  @ApiDoc({ summary: 'Chi tiết một yêu cầu dữ liệu cá nhân (bao gồm dữ liệu tổng hợp hoặc ngoại lệ giữ lại)' })
  public getDsarRequestById(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.governanceService.getDsarRequestById(params.id, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.DSAR)
  @HttpCode(HttpStatus.CREATED)
  @ApiDoc({ summary: 'Tạo yêu cầu Xem (ACCESS), Xuất máy đọc (EXPORT) hoặc Xóa dữ liệu cá nhân (ERASURE)' })
  public createDsarRequest(
    @ValidatedBody(CreateDsarRequestSchema) body: CreateDsarRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.governanceService.createDsarRequest(body, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.DSAR_APPROVE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.DSAR_APPROVE)
  @ApiDoc({ summary: 'Phê duyệt và thực thi yêu cầu xóa dữ liệu cá nhân (hỗ trợ khai báo ngoại lệ giữ lại)' })
  public approveDsarRequest(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(ApproveDsarRequestSchema) body: ApproveDsarRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.governanceService.approveDsarRequest(params.id, body, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.DSAR_REJECT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.DSAR_APPROVE)
  @ApiDoc({ summary: 'Từ chối yêu cầu xóa dữ liệu cá nhân' })
  public rejectDsarRequest(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(RejectDsarRequestSchema) body: RejectDsarRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.governanceService.rejectDsarRequest(params.id, body, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.DSAR_DOWNLOAD)
  @ApiDoc({ summary: 'Tải gói dữ liệu cá nhân định dạng máy đọc được (JSON / CSV)' })
  public downloadDsarExport(
    @ValidatedParams(tokenParamSchema) params: { token: string },
    @CurrentUser() actor: UserIdentity,
  ): Promise<DsarDownloadPayloadView> {
    return this.governanceService.downloadDsarExport(params.token, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.CONSENT_DEFINITIONS)
  @ApiDoc({ summary: 'Danh mục mục đích và phiên bản đồng ý xử lý dữ liệu' })
  public listConsentDefinitions(
    @ValidatedQuery(ListConsentDefinitionsQuerySchema) query: ListConsentDefinitionsQuery,
  ): Promise<PaginatedResult<ConsentDefinitionView>> {
    return this.governanceService.listConsentDefinitions(query);
  }

  @Post(DATA_GOVERNANCE_ROUTES.CONSENT_DEFINITIONS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.CONSENT_MANAGE)
  @ApiDoc({ summary: 'Tạo hoặc phát hành phiên bản mới cho mục đích đồng ý của người dùng' })
  public upsertConsentDefinition(
    @ValidatedBody(UpsertConsentDefinitionRequestSchema) body: UpsertConsentDefinitionRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<ConsentDefinitionView> {
    return this.governanceService.upsertConsentDefinition(body, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.CONSENT_RECORDS)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Tra cứu lịch sử đồng ý / rút lại của người dùng theo mục đích & phiên bản' })
  public listUserConsents(
    @ValidatedQuery(ListUserConsentsQuerySchema) query: ListUserConsentsQuery,
  ): Promise<PaginatedResult<UserConsentView>> {
    return this.governanceService.listUserConsents(query);
  }

  @Get(DATA_GOVERNANCE_ROUTES.CONSENT_ME)
  @ApiDoc({ summary: 'Danh sách trạng thái đồng ý hiện tại của chính người dùng đang đăng nhập' })
  public listMyConsents(@CurrentUser() actor: UserIdentity): Promise<UserConsentView[]> {
    return this.governanceService.listMyConsents(actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.CONSENT_GRANT)
  @HttpCode(HttpStatus.CREATED)
  @ApiDoc({ summary: 'Ghi nhận sự đồng ý của người dùng theo mục đích, phiên bản và thời gian' })
  public grantConsent(
    @ValidatedBody(GrantConsentRequestSchema) body: GrantConsentRequest,
    @CurrentUser() actor: UserIdentity,
    @Req() req: FastifyRequest,
  ): Promise<UserConsentView> {
    return this.governanceService.grantConsent(body, actor, {
      ipAddress: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
  }

  @Post(DATA_GOVERNANCE_ROUTES.CONSENT_WITHDRAW)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Rút lại sự đồng ý đã cấp (chặn nếu là mục đích bắt buộc duy trì dịch vụ)' })
  public withdrawConsent(
    @ValidatedBody(WithdrawConsentRequestSchema) body: WithdrawConsentRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<UserConsentView> {
    return this.governanceService.withdrawConsent(body, actor);
  }

  @Get(DATA_GOVERNANCE_ROUTES.LEGAL_HOLDS)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Danh sách lệnh tạm giữ dữ liệu pháp lý (Legal Hold)' })
  public listLegalHolds(
    @ValidatedQuery(ListLegalHoldsQuerySchema) query: ListLegalHoldsQuery,
  ): Promise<PaginatedResult<LegalHoldView>> {
    return this.governanceService.listLegalHolds(query);
  }

  @Get(DATA_GOVERNANCE_ROUTES.LEGAL_HOLD_CHECK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.READ)
  @ApiDoc({ summary: 'Kiểm tra một người dùng / loại dữ liệu / tài nguyên có đang bị Legal Hold không' })
  public checkLegalHold(
    @ValidatedQuery(CheckLegalHoldQuerySchema) query: CheckLegalHoldQuery,
  ): Promise<LegalHoldCheckDecision> {
    return this.governanceService.checkLegalHold(query);
  }

  @Post(DATA_GOVERNANCE_ROUTES.LEGAL_HOLDS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.LEGAL_HOLD_MANAGE)
  @ApiDoc({ summary: 'Áp đặt lệnh tạm giữ dữ liệu không được xóa (Legal Hold)' })
  public createLegalHold(
    @ValidatedBody(CreateLegalHoldRequestSchema) body: CreateLegalHoldRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<LegalHoldView> {
    return this.governanceService.createLegalHold(body, actor);
  }

  @Post(DATA_GOVERNANCE_ROUTES.LEGAL_HOLD_RELEASE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(DATA_GOVERNANCE_PERMISSIONS.LEGAL_HOLD_MANAGE)
  @ApiDoc({ summary: 'Giải phóng lệnh tạm giữ dữ liệu pháp lý (Release Legal Hold)' })
  public releaseLegalHold(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(ReleaseLegalHoldRequestSchema) body: ReleaseLegalHoldRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<LegalHoldView> {
    return this.governanceService.releaseLegalHold(params.id, body, actor);
  }
}
