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
  type ListApprovalDelegationRulesQuery,
  createApprovalDelegationRuleSchema,
  decideApprovalInstanceStepSchema,
  listApprovalDelegationRulesQuerySchema,
} from '../requests/approvals.requests.js';
import {
  type ApprovalDelegationRuleResponse,
  approvalDelegationRuleResponseSchema,
  approvalInstanceStepsOverviewResponseSchema,
} from '../responses/approvals.response.js';

@ApiGroup(
  'Approvals & Delegation',
  'Quản lý phê duyệt nhiều bước (đơn lẻ, vai trò, tuần tự, song song), từ chối/trả lại và ủy quyền phê duyệt có thời hạn (Mục 9.4)',
)
@Controller(APPROVALS_ROUTES.PREFIX)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  /** Danh sách quy tắc ủy quyền phê duyệt (Mục 9.4.7) */
  @Get(APPROVALS_ROUTES.DELEGATIONS)
  @RequirePermissions('approvals.read')
  @ApiDoc({
    summary: 'Danh sách quy tắc ủy quyền phê duyệt theo thời gian và phạm vi (Mục 9.4.7)',
    response: z.array(approvalDelegationRuleResponseSchema),
  })
  public async listDelegations(
    @ValidatedQuery(listApprovalDelegationRulesQuerySchema) query: ListApprovalDelegationRulesQuery,
  ): Promise<ApprovalDelegationRuleResponse[]> {
    return this.approvalsService.listDelegations(query);
  }

  /** Tạo mới ủy quyền phê duyệt có thời hạn và phạm vi (Mục 9.4.7) */
  @Post(APPROVALS_ROUTES.DELEGATIONS)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary: 'Thiết lập ủy quyền phê duyệt có thời gian hiệu lực và phạm vi (Mục 9.4.7)',
    status: HTTP_STATUS_CODE.CREATED,
    response: approvalDelegationRuleResponseSchema,
  })
  public async createDelegation(
    @ValidatedBody(createApprovalDelegationRuleSchema) body: CreateApprovalDelegationRuleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ApprovalDelegationRuleResponse> {
    return this.approvalsService.createDelegation(body, actor);
  }

  /** Thu hồi ủy quyền phê duyệt (Mục 9.4.7) */
  @Delete(APPROVALS_ROUTES.DELEGATION_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.delegate')
  @ApiDoc({
    summary: 'Thu hồi quy tắc ủy quyền phê duyệt (Mục 9.4.7)',
  })
  public async revokeDelegation(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.revokeDelegation(id, actor);
  }

  /** Xem danh sách các bước phê duyệt của một phiên quy trình (Mục 9.4.1–9.4.8) */
  @Get(APPROVALS_ROUTES.INSTANCE_STEPS)
  @RequirePermissions('approvals.read')
  @ApiDoc({
    summary: 'Xem danh sách các bước phê duyệt và tiến độ duyệt của một phiên (Mục 9.4)',
    response: approvalInstanceStepsOverviewResponseSchema,
  })
  public async getInstanceSteps(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.getInstanceSteps(id, actor);
  }

  /** Thực hiện phê duyệt, từ chối (kèm lý do) hoặc trả lại bước trước (Mục 9.4.1–9.4.6) */
  @Post(APPROVALS_ROUTES.INSTANCE_DECIDE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('approvals.decide')
  @ApiDoc({
    summary:
      'Thực hiện phê duyệt (APPROVE), từ chối kèm lý do (REJECT) hoặc trả lại bước trước (RETURN) (Mục 9.4.1–9.4.6)',
  })
  public async decideInstanceStep(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(decideApprovalInstanceStepSchema) body: DecideApprovalInstanceStepRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.approvalsService.decideInstanceStep(id, body, actor);
  }
}
