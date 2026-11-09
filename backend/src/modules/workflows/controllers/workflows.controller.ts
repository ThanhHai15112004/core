import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE, type PaginatedResult } from '@packages/kernel/index.js';
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
import {
  type CancelWorkflowInstanceRequest,
  type CreateWorkflowDefinitionRequest,
  type ExecuteWorkflowTransitionRequest,
  type ListWorkflowDefinitionsQuery,
  type ListWorkflowInstancesQuery,
  type ReplaceWorkflowStatesRequest,
  type ReplaceWorkflowTransitionsRequest,
  type StartWorkflowInstanceRequest,
  type UpdateWorkflowDefinitionRequest,
  cancelWorkflowInstanceSchema,
  createWorkflowDefinitionSchema,
  executeWorkflowTransitionSchema,
  listWorkflowDefinitionsQuerySchema,
  listWorkflowInstancesQuerySchema,
  replaceWorkflowStatesSchema,
  replaceWorkflowTransitionsSchema,
  startWorkflowInstanceSchema,
  updateWorkflowDefinitionSchema,
} from '../requests/workflows.requests.js';
import {
  type WorkflowDefinitionResponse,
  type WorkflowHistoryItemResponse,
  type WorkflowInstanceDetailResponse,
  type WorkflowInstanceItemResponse,
  type WorkflowSlaScanResultResponse,
  workflowDefinitionResponseSchema,
  workflowHistoryItemSchema,
  workflowInstanceDetailResponseSchema,
  workflowInstanceItemResponseSchema,
  workflowSlaScanResultResponseSchema,
} from '../responses/workflows.response.js';
import { WORKFLOWS_ROUTES } from '../routes/workflows.routes.js';
import { WorkflowsService } from '../services/workflows.service.js';

@ApiGroup('Workflows Engine', 'Quản lý quy trình xử lý (Workflow Engine — Mục 9.3)')
@Controller(WORKFLOWS_ROUTES.ROOT)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  /** Danh sách quy trình xử lý có phân trang & lọc (Mục 9.3.1) */
  @Get(WORKFLOWS_ROUTES.DEFINITIONS)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Danh sách định nghĩa quy trình (Workflow Definitions — Mục 9.3.1)',
    response: workflowDefinitionResponseSchema,
    pagination: 'offset',
  })
  public async listDefinitions(
    @ValidatedQuery(listWorkflowDefinitionsQuerySchema) query: ListWorkflowDefinitionsQuery,
  ): Promise<PaginatedResult<WorkflowDefinitionResponse>> {
    return this.workflowsService.listDefinitionsPaginated(query);
  }

  /** Xem chi tiết một quy trình kèm trạng thái & điều kiện chuyển trạng thái (Mục 9.3.1–9.3.4) */
  @Get(WORKFLOWS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Chi tiết định nghĩa quy trình kèm danh sách trạng thái và bước chuyển (Mục 9.3.1)',
    response: workflowDefinitionResponseSchema,
  })
  public async getDefinitionById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.getDefinitionById(id);
  }

  /** Tạo mới quy trình có tên, mã, phiên bản, các trạng thái và bước chuyển (Mục 9.3.1–9.3.4) */
  @Post(WORKFLOWS_ROUTES.DEFINITIONS)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Tạo mới quy trình xử lý (Mục 9.3.1–9.3.4)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowDefinitionResponseSchema,
  })
  public async createDefinition(
    @ValidatedBody(createWorkflowDefinitionSchema) body: CreateWorkflowDefinitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.createDefinition(body, actor?.id);
  }

  /** Cập nhật thông tin quy trình (Mục 9.3.1 & 9.3.8) */
  @Patch(WORKFLOWS_ROUTES.DEFINITION_BY_ID)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Cập nhật định nghĩa quy trình xử lý (Mục 9.3.1 & 9.3.8)',
    response: workflowDefinitionResponseSchema,
  })
  public async updateDefinition(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateWorkflowDefinitionSchema) body: UpdateWorkflowDefinitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.updateDefinition(id, body, actor?.id);
  }

  /** Tạo phiên bản mới của quy trình bằng cách nhân bản trạng thái & bước chuyển (Mục 9.3.1) */
  @Post(WORKFLOWS_ROUTES.DEFINITION_NEW_VERSION)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Nhân bản phiên bản mới cho quy trình xử lý (Mục 9.3.1)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowDefinitionResponseSchema,
  })
  public async createNewVersion(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.createNewVersion(id, actor?.id);
  }

  /** Cấu hình danh sách trạng thái của quy trình (Draft, Pending, Approved, Rejected... — Mục 9.3.2) */
  @Put(WORKFLOWS_ROUTES.DEFINITION_STATES)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Thiết lập các trạng thái của quy trình (Mục 9.3.2)',
    response: workflowDefinitionResponseSchema,
  })
  public async replaceStates(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(replaceWorkflowStatesSchema) body: ReplaceWorkflowStatesRequest,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.replaceStates(id, body);
  }

  /** Cấu hình điều kiện chuyển trạng thái & hành động khi chuyển trạng thái (Mục 9.3.3 & 9.3.4) */
  @Put(WORKFLOWS_ROUTES.DEFINITION_TRANSITIONS)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Thiết lập điều kiện chuyển trạng thái và hành động tự động (Mục 9.3.3 & 9.3.4)',
    response: workflowDefinitionResponseSchema,
  })
  public async replaceTransitions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(replaceWorkflowTransitionsSchema) body: ReplaceWorkflowTransitionsRequest,
  ): Promise<WorkflowDefinitionResponse> {
    return this.workflowsService.replaceTransitions(id, body);
  }

  /** Danh sách các hồ sơ quy trình đang chạy / hoàn tất / quá hạn (Mục 9.3.5–9.3.8) */
  @Get(WORKFLOWS_ROUTES.INSTANCES)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary: 'Danh sách phiên thực thi quy trình (Workflow Instances — Mục 9.3.5)',
    response: workflowInstanceItemResponseSchema,
    pagination: 'offset',
  })
  public async listInstances(
    @ValidatedQuery(listWorkflowInstancesQuerySchema) query: ListWorkflowInstancesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<WorkflowInstanceItemResponse>> {
    return this.workflowsService.listInstancesPaginated(query, actor);
  }

  /** Xem chi tiết phiên thực thi quy trình kèm các bước chuyển hợp lệ & toàn bộ lịch sử (Mục 9.3.5 & 9.3.7) */
  @Get(WORKFLOWS_ROUTES.INSTANCE_BY_ID)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Chi tiết phiên quy trình kèm bước chuyển hợp lệ, các bước phê duyệt và lịch sử (Mục 9.3.5 & 9.3.7)',
    response: workflowInstanceDetailResponseSchema,
  })
  public async getInstanceById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailResponse> {
    return this.workflowsService.getInstanceById(id, actor);
  }

  /** Khởi tạo quy trình cho một bản ghi nghiệp vụ (Mục 9.3.5) */
  @Post(WORKFLOWS_ROUTES.INSTANCE_START)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary: 'Khởi tạo quy trình cho một bản ghi nghiệp vụ (Mục 9.3.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: workflowInstanceDetailResponseSchema,
  })
  public async startInstance(
    @ValidatedBody(startWorkflowInstanceSchema) body: StartWorkflowInstanceRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailResponse> {
    return this.workflowsService.startWorkflowForEntity(body, actor);
  }

  /** Thực hiện chuyển trạng thái khi thỏa mãn điều kiện & kích hoạt hành động (Mục 9.3.3 & 9.3.4) */
  @Post(WORKFLOWS_ROUTES.INSTANCE_TRANSITION)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.execute')
  @ApiDoc({
    summary:
      'Thực hiện chuyển trạng thái quy trình (kiểm tra điều kiện & kích hoạt hành động — Mục 9.3.3 & 9.3.4)',
    response: workflowInstanceDetailResponseSchema,
  })
  public async executeTransition(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(executeWorkflowTransitionSchema) body: ExecuteWorkflowTransitionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailResponse> {
    return this.workflowsService.executeTransition(id, body, actor);
  }

  /** Hủy hoặc kết thúc cưỡng bức quy trình kèm lý do và kiểm tra quyền (Mục 9.3.6) */
  @Post(WORKFLOWS_ROUTES.INSTANCE_CANCEL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.cancel')
  @ApiDoc({
    summary: 'Hủy hoặc kết thúc quy trình kèm lý do và kiểm tra quyền (Mục 9.3.6)',
    response: workflowInstanceDetailResponseSchema,
  })
  public async cancelInstance(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(cancelWorkflowInstanceSchema) body: CancelWorkflowInstanceRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailResponse> {
    return this.workflowsService.cancelInstance(id, body, actor);
  }

  /** Theo dõi lịch sử toàn bộ quy trình — biết ai chuyển trạng thái và khi nào (Mục 9.3.7) */
  @Get(WORKFLOWS_ROUTES.INSTANCE_HISTORIES)
  @RequirePermissions('workflows.read')
  @ApiDoc({
    summary:
      'Xem lịch sử toàn bộ quy trình (biết ai chuyển trạng thái, từ đâu sang đâu và khi nào — Mục 9.3.7)',
    response: z.array(workflowHistoryItemSchema),
  })
  public async getInstanceHistories(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<readonly WorkflowHistoryItemResponse[]> {
    return this.workflowsService.getInstanceHistories(id, actor);
  }

  /** Quét cảnh báo sắp đến hạn & đánh dấu quá hạn SLA cho quy trình đang chạy (Mục 9.3.8 — dùng Scheduler) */
  @Post(WORKFLOWS_ROUTES.SLA_SCAN_OVERDUE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('workflows.manage')
  @ApiDoc({
    summary: 'Quét SLA thời hạn và gửi cảnh báo quá hạn cho quy trình đang chạy (Mục 9.3.8)',
    response: workflowSlaScanResultResponseSchema,
  })
  public async scanOverdueSla(): Promise<WorkflowSlaScanResultResponse> {
    return this.workflowsService.scanSlaAndNotifyOverdue();
  }
}
