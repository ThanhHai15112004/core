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
  CreateWebhookEndpointRequestSchema,
  ListWebhookDeliveriesQuerySchema,
  ListWebhookEndpointsQuerySchema,
  ReactivateWebhookEndpointRequestSchema,
  ReplayWebhookDeliveryRequestSchema,
  SendWebhookTestEventRequestSchema,
  UpdateWebhookEndpointRequestSchema,
  type CreateWebhookEndpointRequest,
  type ListWebhookDeliveriesQuery,
  type ListWebhookEndpointsQuery,
  type ReactivateWebhookEndpointRequest,
  type ReplayWebhookDeliveryRequest,
  type SendWebhookTestEventRequest,
  type UpdateWebhookEndpointRequest,
} from '../requests/webhooks.requests.js';
import { WEBHOOKS_ROUTES } from '../routes/webhooks.routes.js';
import { WebhooksService } from '../services/webhooks.service.js';
import type {
  WebhookDeliveryView,
  WebhookEndpointView,
  WebhookEndpointWithSecretView,
  WebhookEventCatalogItem,
} from '../types/webhooks.types.js';

@ApiGroup(
  'Outbound Webhooks',
  'Quản lý Webhook gửi ra ngoài (10.2): Endpoint, chọn sự kiện, ký HMAC-SHA256, gửi qua Queue, retry/backoff, lịch sử attempts, replay thủ công có audit, tự khóa & chống SSRF',
)
@Controller(WEBHOOKS_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get(WEBHOOKS_ROUTES.EVENTS)
  @RequirePermissions('webhooks.read')
  @ApiDoc({ summary: 'Danh mục sự kiện hệ thống có sẵn từ Module Manifests' })
  public listEvents(): WebhookEventCatalogItem[] {
    return this.webhooksService.listEventCatalog();
  }

  @Get(WEBHOOKS_ROUTES.ENDPOINTS)
  @RequirePermissions('webhooks.read')
  @ApiDoc({ summary: 'Danh sách Webhook Endpoints (phân trang & lọc)' })
  public async listEndpoints(
    @ValidatedQuery(ListWebhookEndpointsQuerySchema) query: ListWebhookEndpointsQuery,
  ): Promise<PaginatedResult<WebhookEndpointView>> {
    return this.webhooksService.listEndpoints(query);
  }

  @Get(WEBHOOKS_ROUTES.ENDPOINT_BY_ID)
  @RequirePermissions('webhooks.read')
  @ApiDoc({ summary: 'Chi tiết một Webhook Endpoint' })
  public async getEndpointById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<WebhookEndpointView> {
    return this.webhooksService.getEndpointById(params.id);
  }

  @Post(WEBHOOKS_ROUTES.ENDPOINTS)
  @RequirePermissions('webhooks.manage')
  @ApiDoc({ summary: 'Tạo Webhook Endpoint mới (kiểm tra SSRF, trả signingSecret một lần)' })
  public async createEndpoint(
    @ValidatedBody(CreateWebhookEndpointRequestSchema) body: CreateWebhookEndpointRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    return this.webhooksService.createEndpoint(body, actor);
  }

  @Patch(WEBHOOKS_ROUTES.ENDPOINT_BY_ID)
  @RequirePermissions('webhooks.manage')
  @ApiDoc({ summary: 'Cập nhật cấu hình Webhook Endpoint' })
  public async updateEndpoint(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateWebhookEndpointRequestSchema) body: UpdateWebhookEndpointRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    return this.webhooksService.updateEndpoint(params.id, body, actor);
  }

  @Delete(WEBHOOKS_ROUTES.ENDPOINT_BY_ID)
  @RequirePermissions('webhooks.manage')
  @ApiDoc({ summary: 'Xóa mềm Webhook Endpoint' })
  public async deleteEndpoint(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.webhooksService.deleteEndpoint(params.id, actor);
  }

  @Post(WEBHOOKS_ROUTES.ENDPOINT_ROTATE_SECRET)
  @RequirePermissions('webhooks.secret.rotate')
  @ApiDoc({ summary: 'Xoay khóa ký HMAC-SHA256 cho Webhook Endpoint (trả secret mới một lần)' })
  public async rotateSecret(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    return this.webhooksService.rotateSecret(params.id, actor);
  }

  @Post(WEBHOOKS_ROUTES.ENDPOINT_REACTIVATE)
  @RequirePermissions('webhooks.manage')
  @ApiDoc({ summary: 'Mở khóa hoặc kích hoạt lại Endpoint đang PAUSED / AUTO_DISABLED' })
  public async reactivateEndpoint(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(ReactivateWebhookEndpointRequestSchema) body: ReactivateWebhookEndpointRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    return this.webhooksService.reactivateEndpoint(params.id, body, actor);
  }

  @Post(WEBHOOKS_ROUTES.ENDPOINT_TEST)
  @RequirePermissions('webhooks.manage')
  @ApiDoc({ summary: 'Gửi sự kiện kiểm thử qua Queue tới Webhook Endpoint' })
  public async sendTestEvent(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(SendWebhookTestEventRequestSchema) body: SendWebhookTestEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    return this.webhooksService.sendTestEvent(params.id, body, actor);
  }

  @Get(WEBHOOKS_ROUTES.DELIVERIES)
  @RequirePermissions('webhooks.read')
  @ApiDoc({ summary: 'Danh sách lịch sử gửi Webhook (Deliveries)' })
  public async listDeliveries(
    @ValidatedQuery(ListWebhookDeliveriesQuerySchema) query: ListWebhookDeliveriesQuery,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    return this.webhooksService.listDeliveries(query);
  }

  @Get(WEBHOOKS_ROUTES.DELIVERY_BY_ID)
  @RequirePermissions('webhooks.read')
  @ApiDoc({ summary: 'Chi tiết một lần gửi Webhook kèm danh sách từng Attempt' })
  public async getDeliveryById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<WebhookDeliveryView> {
    return this.webhooksService.getDeliveryById(params.id);
  }

  @Post(WEBHOOKS_ROUTES.DELIVERY_REPLAY)
  @RequirePermissions('webhooks.replay')
  @ApiDoc({ summary: 'Gửi lại thủ công (Manual Replay) một Webhook Delivery kèm Audit Log' })
  public async replayDelivery(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(ReplayWebhookDeliveryRequestSchema) body: ReplayWebhookDeliveryRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    return this.webhooksService.replayDelivery(params.id, body, actor);
  }
}
