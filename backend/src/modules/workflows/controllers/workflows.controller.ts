import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { WORKFLOWS_ROUTES } from '../contracts/index.js';
import { WorkflowsService } from '../services/workflows.service.js';
import {
  type CancelWorkflowInstanceRequest,
  type CreateWorkflowCommentRequest,
  type CreateWorkflowDefinitionRequest,
  type CreateWorkflowDelegationRuleRequest,
  type DecideWorkflowApprovalRequest,
  type DelegateWorkflowApprovalRequest,
  type ExecuteWorkflowTransitionRequest,
  type ListWorkflowCommentsQuery,
  type ListWorkflowDefinitionsQuery,
  type ListWorkflowInstancesQuery,
  type ListWorkflowTimelineQuery,
  type ReplaceWorkflowStatesRequest,
  type ReplaceWorkflowTransitionsRequest,
  type StartWorkflowInstanceRequest,
  type UpdateWorkflowCommentRequest,
  type UpdateWorkflowDefinitionRequest,
  cancelWorkflowInstanceSchema,
  createWorkflowCommentSchema,
  createWorkflowDefinitionSchema,
  createWorkflowDelegationRuleSchema,
  decideWorkflowApprovalSchema,
  delegateWorkflowApprovalSchema,
  executeWorkflowTransitionSchema,
  listWorkflowCommentsQuerySchema,
  listWorkflowDefinitionsQuerySchema,
  listWorkflowInstancesQuerySchema,
  listWorkflowTimelineQuerySchema,
  positiveIntParamSchema,
  replaceWorkflowStatesSchema,
  replaceWorkflowTransitionsSchema,
  startWorkflowInstanceSchema,
  updateWorkflowCommentSchema,
  updateWorkflowDefinitionSchema,
} from '../requests/workflows.requests.js';
import {
  workflowCommentItemResponseSchema,
  workflowDefinitionResponseSchema,
  workflowDelegationRuleResponseSchema,
  workflowHistoryItemResponseSchema,
  workflowInstanceDetailResponseSchema,
  workflowInstanceResponseSchema,
  workflowRecordActivityTimelineResponseSchema,
  workflowSlaScanResponseSchema,
} from '../responses/workflows.response.js';

@Controller(WORKFLOWS_ROUTES.ROOT)
@ApiGroup(WORKFLOWS_ROUTES.ROOT, 'Workflows, Multi-Level Approvals & Comments (Mục 9.3, 9.4 & 9.5)')
@UseGuards(AuthGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get(WORKFLOWS_ROUTES.DEFINITIONS)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Danh sách định nghĩa quy trình xử lý (Mục 9.3.1)',
    response: z.array(workflowDefinitionResponseSchema),
  })
  public listDefinitions(
    @ValidatedQuery(listWorkflowDefinitionsQuerySchema) query: ListWorkflowDefinitionsQuery,
  ) {
    return this.workflowsService.listDefinitionsPaginated(query);
  }

  @Get(WORKFLOWS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Xem chi tiết định nghĩa quy trình kèm các trạng thái và bước chuyển (Mục 9.3.1 – 9.3.4)',
    response: workflowDefinitionResponseSchema,
  })
  public getDefinitionById(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.workflowsService.getDefinitionById(id);
  }

  @Post(WORKFLOWS_ROUTES.DEFINITIONS)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary:
      'Tạo mới quy trình xử lý có tên, mã, phiên bản, trạng thái và điều kiện/hành động (Mục 9.3.1 – 9.3.4)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowDefinitionResponseSchema,
  })
  public createDefinition(
    @ValidatedBody(createWorkflowDefinitionSchema) body: CreateWorkflowDefinitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.createDefinition(body, actor?.id);
  }

  @Put(WORKFLOWS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Cập nhật định nghĩa quy trình, trạng thái, điều kiện và hành động chuyển trạng thái',
    response: workflowDefinitionResponseSchema,
  })
  public updateDefinition(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateWorkflowDefinitionSchema) body: UpdateWorkflowDefinitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.updateDefinition(id, body, actor?.id);
  }

  @Post(WORKFLOWS_ROUTES.DEFINITION_NEW_VERSION)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Tạo phiên bản mới (version + 1) cho định nghĩa quy trình hiện có (Mục 9.3.1)',
    response: workflowDefinitionResponseSchema,
  })
  public createNewVersion(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.createNewVersion(id, actor?.id);
  }

  @Post(WORKFLOWS_ROUTES.DEFINITION_STATES)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary:
      'Cập nhật danh sách trạng thái của quy trình (Draft, Pending, Approved, Rejected... — Mục 9.3.2)',
    response: workflowDefinitionResponseSchema,
  })
  public replaceStates(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(replaceWorkflowStatesSchema) body: ReplaceWorkflowStatesRequest,
  ) {
    return this.workflowsService.replaceStates(id, body);
  }

  @Post(WORKFLOWS_ROUTES.DEFINITION_TRANSITIONS)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary:
      'Cập nhật điều kiện chuyển trạng thái và hành động khi chuyển trạng thái (Mục 9.3.3 & 9.3.4)',
    response: workflowDefinitionResponseSchema,
  })
  public replaceTransitions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(replaceWorkflowTransitionsSchema) body: ReplaceWorkflowTransitionsRequest,
  ) {
    return this.workflowsService.replaceTransitions(id, body);
  }

  @Get(WORKFLOWS_ROUTES.INSTANCES)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Danh sách các quy trình đã khởi tạo cho các bản ghi nghiệp vụ (Mục 9.3.5)',
    response: z.array(workflowInstanceResponseSchema),
  })
  public listInstances(
    @ValidatedQuery(listWorkflowInstancesQuerySchema) query: ListWorkflowInstancesQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.listInstancesPaginated(query, actor);
  }

  @Get(WORKFLOWS_ROUTES.INSTANCE_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Xem chi tiết quy trình của bản ghi kèm bước chuyển hợp lệ, phê duyệt và lịch sử (Mục 9.3.5 & 9.3.7)',
    response: workflowInstanceDetailResponseSchema,
  })
  public getInstanceById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.getInstanceById(id, actor);
  }

  @Post(WORKFLOWS_ROUTES.INSTANCE_START)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Khởi tạo quy trình xử lý cho một bản ghi nghiệp vụ (Mục 9.3.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowInstanceDetailResponseSchema,
  })
  public startInstance(
    @ValidatedBody(startWorkflowInstanceSchema) body: StartWorkflowInstanceRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.startWorkflowForEntity(
      {
        ...body,
        initiatorUserId: actor?.id ?? null,
      },
      actor,
    );
  }

  @Post(WORKFLOWS_ROUTES.INSTANCE_TRANSITION)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Chuyển trạng thái quy trình (kiểm tra điều kiện 9.3.3 và chạy hành động 9.3.4)',
    response: workflowInstanceDetailResponseSchema,
  })
  public executeTransition(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(executeWorkflowTransitionSchema) body: ExecuteWorkflowTransitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.executeTransition(id, body, actor);
  }

  @Post(WORKFLOWS_ROUTES.INSTANCE_APPROVE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Phê duyệt / Từ chối / Yêu cầu bổ sung tại bước hiện tại của quy trình (Mục 9.4)',
    response: workflowInstanceDetailResponseSchema,
  })
  public decideApproval(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(decideWorkflowApprovalSchema) body: DecideWorkflowApprovalRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.decideApproval(id, body, actor);
  }

  @Post(WORKFLOWS_ROUTES.INSTANCE_DELEGATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Ủy quyền bước phê duyệt hiện tại cho nhân sự khác (Mục 9.4)',
    response: workflowInstanceDetailResponseSchema,
  })
  public delegateApproval(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(delegateWorkflowApprovalSchema) body: DelegateWorkflowApprovalRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.delegateApproval(id, body, actor);
  }

  @Get(WORKFLOWS_ROUTES.DELEGATIONS)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Danh sách cấu hình ủy quyền phê duyệt theo thời gian và phạm vi (Mục 9.4)',
    response: z.array(workflowDelegationRuleResponseSchema),
  })
  public listDelegationRules() {
    return this.workflowsService.listDelegationRules();
  }

  @Post(WORKFLOWS_ROUTES.DELEGATIONS)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Thiết lập ủy quyền phê duyệt có thời gian hiệu lực và phạm vi (Mục 9.4)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowDelegationRuleResponseSchema,
  })
  public createDelegationRule(
    @ValidatedBody(createWorkflowDelegationRuleSchema) body: CreateWorkflowDelegationRuleRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.createDelegationRule(body, actor);
  }

  @Post(WORKFLOWS_ROUTES.DELEGATION_REVOKE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Thu hồi cấu hình ủy quyền phê duyệt (Mục 9.4)',
    response: workflowDelegationRuleResponseSchema,
  })
  public revokeDelegationRule(@ValidatedParams(positiveIntParamSchema, 'id') id: number) {
    return this.workflowsService.revokeDelegationRule(id);
  }

  @Post(WORKFLOWS_ROUTES.INSTANCE_CANCEL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Hủy hoặc kết thúc quy trình kèm lý do và kiểm tra quyền (Mục 9.3.6)',
    response: workflowInstanceDetailResponseSchema,
  })
  public cancelInstance(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(cancelWorkflowInstanceSchema) body: CancelWorkflowInstanceRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.cancelInstance(id, body, actor);
  }

  @Get(WORKFLOWS_ROUTES.INSTANCE_HISTORIES)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Theo dõi lịch sử toàn bộ quy trình: ai chuyển trạng thái và khi nào (Mục 9.3.7)',
    response: z.array(workflowHistoryItemResponseSchema),
  })
  public getInstanceHistories(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.getInstanceHistories(id, actor);
  }

  @Post(WORKFLOWS_ROUTES.SLA_SCAN_OVERDUE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary:
      'Quét thời hạn SLA và gửi cảnh báo sắp đến hạn / quá hạn (Mục 9.3.8 — dùng cho Scheduler & Admin)',
    response: workflowSlaScanResponseSchema,
  })
  public scanSlaAndNotifyOverdue() {
    return this.workflowsService.scanSlaAndNotifyOverdue();
  }

  @Get(WORKFLOWS_ROUTES.COMMENTS)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Danh sách bình luận, ghi chú nội bộ (lọc theo quyền) và chuỗi phản hồi của một bản ghi (Mục 9.5)',
    response: z.array(workflowCommentItemResponseSchema),
  })
  public listComments(
    @ValidatedQuery(listWorkflowCommentsQuerySchema) query: ListWorkflowCommentsQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.listRecordComments(query, actor);
  }

  @Post(WORKFLOWS_ROUTES.COMMENTS)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Thêm bình luận, ghi chú nội bộ, trả lời bình luận, nhắc tên (@mention) và đính kèm file cho bản ghi (Mục 9.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowCommentItemResponseSchema,
  })
  public addComment(
    @ValidatedBody(createWorkflowCommentSchema) body: CreateWorkflowCommentRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.addRecordComment(body, actor);
  }

  @Put(WORKFLOWS_ROUTES.COMMENT_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Chỉnh sửa bình luận theo thời hạn/quyền và lưu lại lịch sử nội dung cũ (Mục 9.5)',
    response: workflowCommentItemResponseSchema,
  })
  public updateComment(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateWorkflowCommentSchema) body: UpdateWorkflowCommentRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.updateRecordComment(id, body, actor);
  }

  @Delete(WORKFLOWS_ROUTES.COMMENT_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Xóa bình luận theo thời hạn và quyền (Mục 9.5)',
    response: workflowCommentItemResponseSchema,
  })
  public deleteComment(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.deleteRecordComment(id, actor);
  }

  @Get(WORKFLOWS_ROUTES.TIMELINE)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Hiển thị dòng thời gian hoạt động hợp nhất (Comment + Workflow + Audit) của một bản ghi (Mục 9.5)',
    response: workflowRecordActivityTimelineResponseSchema,
  })
  public getTimeline(
    @ValidatedQuery(listWorkflowTimelineQuerySchema) query: ListWorkflowTimelineQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.workflowsService.getRecordActivityTimeline(query, actor);
  }
}
