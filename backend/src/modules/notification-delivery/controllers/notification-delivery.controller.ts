import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { type PaginatedResult, parseNumericUserId } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequireAnyPermission,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  optionalQueryParam,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { LocaleContext } from '@packages/i18n/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  type CreateNotificationSuppressionRequest,
  CreateNotificationSuppressionRequestSchema,
  type ListNotificationDeliveriesQuery,
  ListNotificationDeliveriesQuerySchema,
  type ListNotificationSuppressionsQuery,
  ListNotificationSuppressionsQuerySchema,
  type RegisterPushSubscriptionRequest,
  RegisterPushSubscriptionRequestSchema,
  type UpdateDeliveryStatusWebhookRequest,
  UpdateDeliveryStatusWebhookRequestSchema,
} from '../requests/notification-delivery.requests.js';
import type {
  NotificationDeliveryItemResponse,
  NotificationPushSubscriptionItemResponse,
  NotificationQuotaAndCostSummaryResponse,
  NotificationSuppressionItemResponse,
  RetryDueDeliveriesResponse,
} from '../responses/notification-delivery.response.js';
import { NOTIFICATION_DELIVERY_ROUTES } from '../routes/notification-delivery.routes.js';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';

const quotaSummaryQuerySchema = z.object({
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
});

@ApiGroup(
  'Multi-Channel Notification Delivery (Email, SMS & Push)',
  'Vận chuyển thông báo đa kênh (Email theo template, SMS qua nhà cung cấp, Web/Mobile Push Notification); theo dõi trạng thái gửi, tự động gửi lại lỗi tạm thời, danh sách dừng gửi (Suppression List) và theo dõi chi phí/hạn mức (Phase 7 — Mục 7.2)',
)
@Controller(NOTIFICATION_DELIVERY_ROUTES.PREFIX)
export class NotificationDeliveryController {
  constructor(private readonly deliveryService: NotificationDeliveryService) {}

  private resolveCurrentUserId(actor?: UserIdentity): number {
    return parseNumericUserId(actor?.id) ?? 1;
  }

  private resolveCurrentLocale(actor?: UserIdentity): string {
    return actor?.preferredLocale || LocaleContext.get() || 'vi';
  }

  /** Tra cứu lịch sử và trạng thái gửi từng kênh (Queued, Sent, Delivered, Failed, Suppressed) */
  @Get(NOTIFICATION_DELIVERY_ROUTES.DELIVERIES)
  @RequireAnyPermission('notification-delivery.read', 'notifications.read', 'notifications.manage')
  @ApiDoc({
    summary:
      'Tra cứu lịch sử gửi đa kênh (Queued, Sent, Delivered, Failed, Suppressed), số lần retry và chi phí',
    pagination: 'offset',
  })
  public async listDeliveries(
    @ValidatedQuery(ListNotificationDeliveriesQuerySchema) query: ListNotificationDeliveriesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<NotificationDeliveryItemResponse>> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.listDeliveries(query, locale);
  }

  /** Gửi lại thủ công 1 lệnh gửi kênh ngoài (đảm bảo idempotency không gửi trùng) */
  @Post(NOTIFICATION_DELIVERY_ROUTES.DELIVERY_RETRY_BY_ID)
  @RequireAnyPermission('notification-delivery.send', 'notifications.send', 'notifications.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thử gửi lại 1 bản tin lỗi (đảm bảo không gửi trùng nếu đã Sent/Delivered)',
  })
  public async retrySingleDelivery(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDeliveryItemResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.retrySingleDelivery(id, actor, locale);
  }

  /** Tự động quét và gửi lại các lệnh gửi lỗi tạm thời đã tới hạn nextRetryAt */
  @Post(NOTIFICATION_DELIVERY_ROUTES.DELIVERIES_RETRY_DUE)
  @RequireAnyPermission('notification-delivery.send', 'notifications.send', 'notifications.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Quét và tự động gửi lại theo lô các bản tin bị lỗi tạm thời đã tới hạn retry',
  })
  public async retryDueDeliveries(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<RetryDueDeliveriesResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.retryDueDeliveries(new Date(), actor, locale);
  }

  /** Cập nhật trạng thái gửi từ Provider Webhook (Sent -> Delivered / Failed) */
  @Post(NOTIFICATION_DELIVERY_ROUTES.DELIVERY_STATUS_BY_ID)
  @RequireAnyPermission('notification-delivery.send', 'notifications.send', 'notifications.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary:
      'Cập nhật trạng thái gửi từ Provider Webhook (Delivered / Failed + tự động chặn nếu Hard Bounce)',
  })
  public async updateDeliveryStatusWebhook(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(UpdateDeliveryStatusWebhookRequestSchema)
    body: UpdateDeliveryStatusWebhookRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDeliveryItemResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.updateDeliveryStatusWebhook(id, body, actor, locale);
  }

  /** Danh sách địa chỉ Email / SĐT / Push Token bị dừng gửi (Suppression List) */
  @Get(NOTIFICATION_DELIVERY_ROUTES.SUPPRESSIONS)
  @RequireAnyPermission('notification-delivery.read', 'notifications.read', 'notifications.manage')
  @ApiDoc({
    summary: 'Lấy danh sách các địa chỉ Email, SĐT hoặc Push Token bị dừng gửi (Suppression List)',
    pagination: 'offset',
  })
  public async listSuppressions(
    @ValidatedQuery(ListNotificationSuppressionsQuerySchema)
    query: ListNotificationSuppressionsQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<NotificationSuppressionItemResponse>> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.listSuppressions(query, locale);
  }

  /** Thêm địa chỉ hoặc token vào danh sách dừng gửi */
  @Post(NOTIFICATION_DELIVERY_ROUTES.SUPPRESSIONS)
  @RequireAnyPermission('notification-delivery.manage', 'notifications.manage')
  @ApiDoc({
    summary: 'Thêm địa chỉ Email, SĐT hoặc Push Token vào danh sách dừng gửi (Suppression List)',
  })
  public async addSuppression(
    @ValidatedBody(CreateNotificationSuppressionRequestSchema)
    body: CreateNotificationSuppressionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationSuppressionItemResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.deliveryService.addSuppression(body, actor, locale);
  }

  /** Gỡ địa chỉ hoặc token khỏi danh sách dừng gửi */
  @Delete(NOTIFICATION_DELIVERY_ROUTES.SUPPRESSION_BY_ID)
  @RequireAnyPermission('notification-delivery.manage', 'notifications.manage')
  @ApiDoc({
    summary: 'Gỡ chặn địa chỉ hoặc token khỏi danh sách dừng gửi',
  })
  public async removeSuppression(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ removed: boolean; id: number }> {
    return this.deliveryService.removeSuppression(id, actor);
  }

  /** Lấy danh sách thiết bị nhận Push Notification của người dùng hiện tại */
  @Get(NOTIFICATION_DELIVERY_ROUTES.PUSH_SUBSCRIPTIONS)
  @ApiDoc({
    summary: 'Lấy danh sách thiết bị đã đăng ký nhận Push Notification của người dùng hiện tại',
  })
  public async listMyPushSubscriptions(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse[]> {
    const userId = this.resolveCurrentUserId(actor);
    return this.deliveryService.listUserPushSubscriptions(userId);
  }

  /** Đăng ký thiết bị/trình duyệt nhận Push Notification */
  @Post(NOTIFICATION_DELIVERY_ROUTES.PUSH_SUBSCRIPTIONS)
  @ApiDoc({
    summary: 'Đăng ký token thiết bị hoặc Web Push endpoint để nhận Push Notification',
  })
  public async registerPushSubscription(
    @ValidatedBody(RegisterPushSubscriptionRequestSchema) body: RegisterPushSubscriptionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.deliveryService.registerPushSubscription(userId, body, actor);
  }

  /** Hủy đăng ký thiết bị nhận Push Notification */
  @Delete(NOTIFICATION_DELIVERY_ROUTES.PUSH_SUBSCRIPTION_BY_ID)
  @ApiDoc({
    summary: 'Hủy đăng ký thiết bị nhận Push Notification',
  })
  public async unregisterPushSubscription(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ removed: true; id: number }> {
    const userId = this.resolveCurrentUserId(actor);
    return this.deliveryService.unregisterPushSubscription(userId, id, actor);
  }

  /** Thống kê chi phí lũy kế và hạn mức nhà cung cấp (Quota & Cost Summary) */
  @Get(NOTIFICATION_DELIVERY_ROUTES.QUOTA_SUMMARY)
  @RequireAnyPermission('notification-delivery.read', 'notifications.read', 'notifications.manage')
  @ApiDoc({
    summary:
      'Theo dõi chi phí lũy kế, số lượng segment SMS và hạn mức Quota ngày/tháng của nhà cung cấp',
  })
  public async getQuotaSummary(
    @ValidatedQuery(quotaSummaryQuerySchema) query: { organizationUnitId?: number | undefined },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationQuotaAndCostSummaryResponse> {
    const orgId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? null;
    return this.deliveryService.getQuotaAndCostSummary(orgId);
  }
}
