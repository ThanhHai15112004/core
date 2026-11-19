import { Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiDoc,
  ApiGroup,
  intIdParamSchema,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  CreateInboundWebhookProviderRequestSchema,
  ListInboundWebhookEventsQuerySchema,
  ListInboundWebhookProvidersQuerySchema,
  ReprocessInboundWebhookEventRequestSchema,
  RotateInboundWebhookSecretRequestSchema,
  SimulateInboundWebhookRequestSchema,
  UpdateInboundWebhookProviderRequestSchema,
  type CreateInboundWebhookProviderRequest,
  type ListInboundWebhookEventsQuery,
  type ListInboundWebhookProvidersQuery,
  type ReprocessInboundWebhookEventRequest,
  type RotateInboundWebhookSecretRequest,
  type SimulateInboundWebhookRequest,
  type UpdateInboundWebhookProviderRequest,
} from '../requests/inbound-webhooks.requests.js';
import { INBOUND_WEBHOOKS_ROUTES } from '../routes/inbound-webhooks.routes.js';
import { InboundWebhooksService } from '../services/inbound-webhooks.service.js';
import type {
  InboundWebhookEventView,
  InboundWebhookProviderView,
  InboundWebhookProviderWithSecretView,
  SimulateInboundWebhookResult,
} from '../types/inbound-webhooks.types.js';

@ApiGroup(
  'Inbound Webhooks — Admin',
  'Quản trị Provider nhận Webhook ngoài, xoay secret xác thực, giả lập gửi webhook, tra cứu lịch sử tiếp nhận/đối soát và xử lý lại sự kiện lỗi.',
)
@Controller(INBOUND_WEBHOOKS_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class InboundWebhooksController {
  constructor(private readonly inboundWebhooksService: InboundWebhooksService) {}

  @Get(INBOUND_WEBHOOKS_ROUTES.PROVIDERS)
  @RequirePermissions('inbound-webhooks.read')
  @ApiDoc({ summary: 'Danh sách Inbound Webhook Providers (phân trang & lọc)' })
  public async listProviders(
    @ValidatedQuery(ListInboundWebhookProvidersQuerySchema)
    query: ListInboundWebhookProvidersQuery,
  ): Promise<PaginatedResult<InboundWebhookProviderView>> {
    return this.inboundWebhooksService.listProviders(query);
  }

  @Get(INBOUND_WEBHOOKS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('inbound-webhooks.read')
  @ApiDoc({ summary: 'Chi tiết một Inbound Webhook Provider' })
  public async getProviderById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<InboundWebhookProviderView> {
    return this.inboundWebhooksService.getProviderById(params.id);
  }

  @Post(INBOUND_WEBHOOKS_ROUTES.PROVIDERS)
  @RequirePermissions('inbound-webhooks.manage')
  @ApiDoc({ summary: 'Tạo Inbound Webhook Provider mới (trả signingSecret một lần)' })
  public async createProvider(
    @ValidatedBody(CreateInboundWebhookProviderRequestSchema)
    body: CreateInboundWebhookProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    return this.inboundWebhooksService.createProvider(body, actor);
  }

  @Patch(INBOUND_WEBHOOKS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('inbound-webhooks.manage')
  @ApiDoc({ summary: 'Cập nhật cấu hình Inbound Webhook Provider' })
  public async updateProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateInboundWebhookProviderRequestSchema)
    body: UpdateInboundWebhookProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<InboundWebhookProviderView> {
    return this.inboundWebhooksService.updateProvider(params.id, body, actor);
  }

  @Delete(INBOUND_WEBHOOKS_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('inbound-webhooks.manage')
  @ApiDoc({ summary: 'Xóa mềm Inbound Webhook Provider' })
  public async deleteProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.inboundWebhooksService.deleteProvider(params.id, actor);
  }

  @Post(INBOUND_WEBHOOKS_ROUTES.PROVIDER_ROTATE_SECRET)
  @RequirePermissions('inbound-webhooks.secret.rotate')
  @ApiDoc({
    summary: 'Xoay khóa bí mật xác thực cho Inbound Webhook Provider (trả secret mới một lần)',
  })
  public async rotateSecret(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(RotateInboundWebhookSecretRequestSchema)
    body: RotateInboundWebhookSecretRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    return this.inboundWebhooksService.rotateSecret(params.id, body, actor);
  }

  @Post(INBOUND_WEBHOOKS_ROUTES.PROVIDER_SIMULATE)
  @RequirePermissions('inbound-webhooks.manage')
  @ApiDoc({ summary: 'Giả lập một Webhook có ký hợp lệ gửi vào Provider để kiểm thử luồng xử lý' })
  public async simulateProviderWebhook(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(SimulateInboundWebhookRequestSchema)
    body: SimulateInboundWebhookRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SimulateInboundWebhookResult> {
    return this.inboundWebhooksService.simulateProviderWebhook(params.id, body, actor);
  }

  @Get(INBOUND_WEBHOOKS_ROUTES.EVENTS)
  @RequirePermissions('inbound-webhooks.read')
  @ApiDoc({ summary: 'Danh sách sự kiện Inbound Webhook đã tiếp nhận/từ chối (phân trang & lọc)' })
  public async listEvents(
    @ValidatedQuery(ListInboundWebhookEventsQuerySchema)
    query: ListInboundWebhookEventsQuery,
  ): Promise<PaginatedResult<InboundWebhookEventView>> {
    return this.inboundWebhooksService.listEvents(query);
  }

  @Get(INBOUND_WEBHOOKS_ROUTES.EVENT_BY_ID)
  @RequirePermissions('inbound-webhooks.read')
  @ApiDoc({ summary: 'Chi tiết một sự kiện Inbound Webhook kèm lịch sử Attempts xử lý' })
  public async getEventById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<InboundWebhookEventView> {
    return this.inboundWebhooksService.getEventById(params.id);
  }

  @Post(INBOUND_WEBHOOKS_ROUTES.EVENT_REPROCESS)
  @RequirePermissions('inbound-webhooks.replay')
  @ApiDoc({
    summary: 'Đẩy xử lý lại (Reprocess) một sự kiện Inbound Webhook bị lỗi FAILED kèm Audit Log',
  })
  public async reprocessEvent(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(ReprocessInboundWebhookEventRequestSchema)
    body: ReprocessInboundWebhookEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<InboundWebhookEventView> {
    return this.inboundWebhooksService.reprocessEvent(params.id, body, actor);
  }
}
