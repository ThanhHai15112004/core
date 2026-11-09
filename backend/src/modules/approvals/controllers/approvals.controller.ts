import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { APPROVALS_ROUTES } from '../routes/approvals.routes.js';
import { ApprovalsService } from '../services/approvals.service.js';
import {
  type CreateApprovalDelegationRuleRequest,
  type DecideApprovalInstanceStepRequest,
  type DelegateApprovalInstanceStepRequest,
  type ListApprovalDelegationRulesQuery,
  createApprovalDelegationRuleSchema,
  decideApprovalInstanceStepSchema,
  delegateApprovalInstanceStepSchema,
  listApprovalDelegationRulesQuerySchema,
} from '../requests/approvals.requests.js';
import {
  type ApprovalDelegationRuleResponse,
  approvalDelegationRuleResponseSchema,
  approvalInstanceStepsOverviewResponseSchema,
} from '../responses/approvals.response.js';

@ApiGroup(
  'Approvals & Delegation Engine',
  'Quản lý phê duyệt đơn lẻ/theo vai trò/tuần tự/song song, từ chối kèm lý do, trả lại bước trước và ủy quyền phê duyệt có thời hạn/phạm vi (Mục 9.4)',
)
@Controller(APPROVALS_ROUTES.PREFIX)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get(APPROVALS_ROUTES.DELEGATIONS)
  @RequirePermissions('approvals.read')
  @ApiDoc({
    summary: 'Danh sách quy tắc ủy quyền phê duyệt có thời hạn và phạm vi (Mục 9.4.7)',
    response: z.array(approvalDelegationRuleResponseSchema),
  })
  public async listDelegations(
    @ValidatedQuery(listApprovalDelegationRulesQuerySchema)
    query: ListApprovalDelegationRulesQuery,
  ): Promise<ApprovalDelegationRuleResponse[]> {
    return this.approvalsService.listDelegations(query);
  }

  @Post(APPROVALS_ROUTES.DELEGATIONS)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary: 'Tạo quy tắc ủy quyền phê duyệt có thời gian và phạm vi (Mục 9.4.7)',
    status: HTTP_STATUS_CODE.CREATED,
    response: approvalDelegationRuleResponseSchema,
  })
  public async createDelegation(
    @ValidatedBody(createApprovalDelegationRuleSchema) body: CreateApprovalDelegationRuleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ApprovalDelegationRuleResponse> {
    return this.approvalsService.createDelegation(body, actor);
  }

  @Delete(APPROVALS_ROUTES.DELEGATION_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary: 'Thu hồi quy tắc ủy quyền phê duyệt (Mục 9.4.7)',
  })
  public async revokeDelegation(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly revoked: true; readonly id: number }> {
    return this.approvalsService.revokeDelegation(id, actor);
  }

  @Post(APPROVALS_ROUTES.DELEGATION_REVOKE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary: 'Thu hồi quy tắc ủy quyền phê duyệt qua POST (Mục 9.4.7)',
  })
  public async revokeDelegationPost(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly revoked: true; readonly id: number }> {
    return this.approvalsService.revokeDelegation(id, actor);
  }

  @Get(APPROVALS_ROUTES.INSTANCE_STEPS)
  @RequirePermissions('approvals.read')
  @ApiDoc({
    summary:
      'Xem danh sách các bước phê duyệt (đơn lẻ, theo vai trò, tuần tự nhiều bước, song song) của một hồ sơ (Mục 9.4.1–9.4.4)',
    response: approvalInstanceStepsOverviewResponseSchema,
  })
  public async getInstanceSteps(
    @ValidatedParams(positiveIntParamSchema, 'id') instanceId: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.getInstanceSteps(instanceId, actor);
  }

  @Post(APPROVALS_ROUTES.INSTANCE_DECIDE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.decide')
  @ApiDoc({
    summary:
      'Ra quyết định phê duyệt (APPROVE / APPROVED), từ chối kèm lý do (REJECT / REJECTED) hoặc trả lại bước trước (RETURN / RETURNED) (Mục 9.4.1–9.4.6)',
  })
  public async decideInstanceStep(
    @ValidatedParams(positiveIntParamSchema, 'id') instanceId: number,
    @ValidatedBody(decideApprovalInstanceStepSchema) body: DecideApprovalInstanceStepRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.decideInstanceStep(instanceId, body, actor);
  }

  @Post(APPROVALS_ROUTES.INSTANCE_DELEGATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary:
      'Ủy quyền trực tiếp bước phê duyệt đang chờ của một hồ sơ sang người dùng khác (Mục 9.4.7)',
  })
  public async delegateInstanceStep(
    @ValidatedParams(positiveIntParamSchema, 'id') instanceId: number,
    @ValidatedBody(delegateApprovalInstanceStepSchema) body: DelegateApprovalInstanceStepRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.delegateInstanceStep(instanceId, body, actor);
  }
}
