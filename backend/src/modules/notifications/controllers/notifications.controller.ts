import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  HTTP_STATUS_CODE,
  type PaginatedResult,
  parseNumericUserId,
} from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  optionalQueryParam,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { LocaleContext } from '@packages/i18n/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { NOTIFICATIONS_ROUTES } from '../routes/notifications.routes.js';
import {
  type ArchiveNotificationRequest,
  ArchiveNotificationRequestSchema,
  type CreateNotificationSuppressionRequest,
  CreateNotificationSuppressionRequestSchema,
  type ListNotificationDeliveriesQuery,
  ListNotificationDeliveriesQuerySchema,
  type ListNotificationDispatchesQuery,
  ListNotificationDispatchesQuerySchema,
  type ListNotificationSuppressionsQuery,
  ListNotificationSuppressionsQuerySchema,
  type ListNotificationTemplatesQuery,
  ListNotificationTemplatesQuerySchema,
  type ListUserInboxQuery,
  ListUserInboxQuerySchema,
  type MarkAllNotificationsReadRequest,
  MarkAllNotificationsReadRequestSchema,
  type MarkNotificationReadRequest,
  MarkNotificationReadRequestSchema,
  type PreviewNotificationTemplateRequest,
  PreviewNotificationTemplateRequestSchema,
  type RegisterPushSubscriptionRequest,
  RegisterPushSubscriptionRequestSchema,
  type SendNotificationRequest,
  SendNotificationRequestSchema,
  type UpdateDeliveryStatusWebhookRequest,
  UpdateDeliveryStatusWebhookRequestSchema,
  type UpdateNotificationPreferencesRequest,
  UpdateNotificationPreferencesRequestSchema,
  type UpdateNotificationRuntimeConfigRequest,
  UpdateNotificationRuntimeConfigRequestSchema,
  type UpsertNotificationTemplateRequest,
  UpsertNotificationTemplateRequestSchema,
} from '../requests/notifications.requests.js';
import type {
  MarkAllNotificationsReadResponse,
  NotificationArchiveMutationResponse,
  NotificationDeleteFromInboxResponse,
  NotificationDeliveryItemResponse,
  NotificationDispatchDetailResponse,
  NotificationDispatchHistoryItemResponse,
  NotificationInboxItemResponse,
  NotificationPreferenceItemResponse,
  NotificationPushSubscriptionItemResponse,
  NotificationQuotaAndCostSummaryResponse,
  NotificationReadStateMutationResponse,
  NotificationRuntimeConfigResponse,
  NotificationSuppressionItemResponse,
  NotificationTemplateItemResponse,
  NotificationTemplatePreviewResponse,
  NotificationUnreadSummaryResponse,
  RetryDueDeliveriesResponse,
} from '../responses/notifications.response.js';
import { NotificationChannelsService } from '../services/notification-channels.service.js';
import { NotificationsService } from '../services/notifications.service.js';

const runtimeConfigQuerySchema = z.object({
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
});

@ApiGroup(
  'In-App Notifications',
  'Quản lý thông báo trong hệ thống (In-app Notification): Hộp thư cá nhân, Phát thông báo theo Người dùng/Nhóm/Vai trò/Đơn vị, Đánh dấu đọc, Lưu trữ/Xóa, Phân nhóm & Sở thích nhận thông báo (Phase 7 — Mục 7.1)',
)
@Controller(NOTIFICATIONS_ROUTES.PREFIX)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly channelsService: NotificationChannelsService,
  ) {}

  private resolveCurrentUserId(actor?: UserIdentity): number {
    return parseNumericUserId(actor?.id) ?? 1;
  }

  private resolveCurrentLocale(actor?: UserIdentity): string {
    return actor?.preferredLocale || LocaleContext.get() || 'vi';
  }

  /** Lấy toàn bộ cấu hình runtime hiệu lực của module Notifications */
  @Get(NOTIFICATIONS_ROUTES.CONFIG)
  @ApiDoc({
    summary: 'Lấy cấu hình vận hành hiện hành của hệ thống thông báo (Settings + Feature Flags)',
  })
  public getRuntimeConfig(
    @ValidatedQuery(runtimeConfigQuerySchema) query: { organizationUnitId?: number | undefined },
    @CurrentUser() actor?: UserIdentity,
  ): NotificationRuntimeConfigResponse {
    const orgId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? null;
    return this.notificationsService.getRuntimeConfig(orgId, actor);
  }

  /** Cập nhật nhanh cấu hình vận hành thông báo */
  @Put(NOTIFICATIONS_ROUTES.CONFIG)
  @RequirePermissions('notifications.manage')
  @ApiDoc({
    summary: 'Cập nhật cấu hình vận hành hệ thống thông báo (yêu cầu quyền notifications.manage)',
  })
  public async updateRuntimeConfig(
    @ValidatedBody(UpdateNotificationRuntimeConfigRequestSchema)
    body: UpdateNotificationRuntimeConfigRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationRuntimeConfigResponse> {
    return this.notificationsService.updateRuntimeConfig(body, actor);
  }

  /** Đếm số lượng thông báo chưa đọc (unreadCount) và thống kê theo phân nhóm */
  @Get(NOTIFICATIONS_ROUTES.UNREAD_COUNT)
  @ApiDoc({
    summary: 'Lấy số lượng thông báo mới chưa đọc (unreadCount) và thống kê theo từng phân nhóm',
  })
  public async getUnreadSummary(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationUnreadSummaryResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.notificationsService.getUnreadSummary(userId);
  }

  /** Lấy danh sách thông báo trong hộp thư cá nhân của người dùng hiện tại */
  @Get(NOTIFICATIONS_ROUTES.INBOX)
  @ApiDoc({
    summary:
      'Lấy danh sách hộp thư thông báo cá nhân (lọc theo trạng thái đọc, lưu trữ, phân nhóm)',
    pagination: 'offset',
  })
  public async listInbox(
    @ValidatedQuery(ListUserInboxQuerySchema) query: ListUserInboxQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<NotificationInboxItemResponse>> {
    const userId = this.resolveCurrentUserId(actor);
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.listUserInbox(userId, query, locale);
  }

  /** Xem chi tiết 1 thông báo trong hộp thư cá nhân */
  @Get(NOTIFICATIONS_ROUTES.INBOX_BY_ID)
  @ApiDoc({
    summary: 'Xem chi tiết thông báo trong hộp thư cá nhân (hỗ trợ tự động đánh dấu đã đọc)',
  })
  public async getInboxDetail(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationInboxItemResponse> {
    const userId = this.resolveCurrentUserId(actor);
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.getInboxItemDetail(userId, id, { locale });
  }

  /** Đánh dấu đã đọc hoặc chưa đọc cho 1 thông báo và cập nhật số lượng thông báo mới */
  @Patch(NOTIFICATIONS_ROUTES.INBOX_READ)
  @ApiDoc({
    summary: 'Đánh dấu đã đọc hoặc chưa đọc một thông báo và trả về unreadCount mới',
  })
  public async setReadState(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(MarkNotificationReadRequestSchema) body: MarkNotificationReadRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationReadStateMutationResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.notificationsService.setReadState(userId, id, body);
  }

  /** Đánh dấu đã đọc tất cả thông báo trong hộp thư cá nhân (có thể lọc theo phân nhóm) */
  @Post(NOTIFICATIONS_ROUTES.INBOX_MARK_ALL_READ)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đánh dấu đã đọc tất cả thông báo chưa đọc trong hộp thư cá nhân',
  })
  public async markAllAsRead(
    @ValidatedBody(MarkAllNotificationsReadRequestSchema) body: MarkAllNotificationsReadRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<MarkAllNotificationsReadResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.notificationsService.markAllAsRead(userId, body);
  }

  /** Lưu trữ hoặc khôi phục thông báo về hộp thư đến (không ảnh hưởng lịch sử gửi) */
  @Patch(NOTIFICATIONS_ROUTES.INBOX_ARCHIVE)
  @ApiDoc({
    summary:
      'Lưu trữ hoặc bỏ lưu trữ thông báo trong hộp thư cá nhân (không ảnh hưởng lịch sử gửi)',
  })
  public async setArchiveState(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(ArchiveNotificationRequestSchema) body: ArchiveNotificationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationArchiveMutationResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.notificationsService.setArchiveState(userId, id, body);
  }

  /** Xóa thông báo khỏi hộp thư cá nhân (không ảnh hưởng lịch sử gửi gốc) */
  @Delete(NOTIFICATIONS_ROUTES.INBOX_BY_ID)
  @ApiDoc({
    summary: 'Xóa thông báo khỏi hộp thư cá nhân (giữ nguyên 100% lịch sử gửi của hệ thống)',
  })
  public async deleteFromInbox(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDeleteFromInboxResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.notificationsService.deleteFromInbox(userId, id);
  }

  /** Xem cấu hình sở thích nhận thông báo của người dùng hiện tại */
  @Get(NOTIFICATIONS_ROUTES.PREFERENCES)
  @ApiDoc({
    summary: 'Lấy thiết lập sở thích nhận thông báo theo từng phân nhóm và kênh của người dùng',
  })
  public async getPreferences(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPreferenceItemResponse[]> {
    const userId = this.resolveCurrentUserId(actor);
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.getUserPreferences(
      userId,
      actor?.organizationUnitIds?.[0] ?? null,
      locale,
    );
  }

  /** Cập nhật thiết lập sở thích nhận thông báo của người dùng hiện tại */
  @Put(NOTIFICATIONS_ROUTES.PREFERENCES)
  @ApiDoc({
    summary: 'Cập nhật thiết lập kênh nhận thông báo được phép theo từng phân nhóm',
  })
  public async updatePreferences(
    @ValidatedBody(UpdateNotificationPreferencesRequestSchema)
    body: UpdateNotificationPreferencesRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPreferenceItemResponse[]> {
    const userId = this.resolveCurrentUserId(actor);
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.updateUserPreferences(userId, body, actor, locale);
  }

  /** Tạo và phát thông báo cho 1 người dùng, nhóm người dùng, vai trò hoặc đơn vị tổ chức */
  @Post(NOTIFICATIONS_ROUTES.SEND)
  @RequirePermissions('notifications.send')
  @HttpCode(HTTP_STATUS_CODE.CREATED)
  @ApiDoc({
    summary:
      'Tạo thông báo cho 1 người dùng (SINGLE_USER), nhóm (USER_GROUP), vai trò (ROLE) hoặc đơn vị (ORG_UNIT)',
  })
  public async sendNotification(
    @ValidatedBody(SendNotificationRequestSchema) body: SendNotificationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDispatchDetailResponse> {
    return this.notificationsService.dispatch(body, actor);
  }

  /** Tra cứu lịch sử phát thông báo gốc (bất biến trước thao tác xóa/lưu trữ của người nhận) */
  @Get(NOTIFICATIONS_ROUTES.DISPATCHES)
  @RequirePermissions('notifications.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử phát thông báo gốc (không bị ảnh hưởng khi người nhận xóa/lưu trữ)',
    pagination: 'offset',
  })
  public async listDispatches(
    @ValidatedQuery(ListNotificationDispatchesQuerySchema) query: ListNotificationDispatchesQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PaginatedResult<NotificationDispatchHistoryItemResponse>> {
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.listDispatchHistory(query, locale);
  }

  /** Xem chi tiết một bản ghi lịch sử phát thông báo kèm trạng thái từng người nhận */
  @Get(NOTIFICATIONS_ROUTES.DISPATCH_BY_ID)
  @RequirePermissions('notifications.read')
  @ApiDoc({
    summary:
      'Xem chi tiết bản ghi lịch sử gửi thông báo và danh sách trạng thái hộp thư người nhận',
  })
  public async getDispatchDetail(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDispatchDetailResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.notificationsService.getDispatchDetail(id, locale);
  }

  // ==================== 7.2 EMAIL, SMS & PUSH NOTIFICATION ENDPOINTS ====================

  /** Danh sách Template thông báo đa kênh (Email, SMS, Push, In-App) */
  @Get(NOTIFICATIONS_ROUTES.TEMPLATES)
  @RequirePermissions('notifications.read')
  @ApiDoc({
    summary: 'Lấy danh sách template thông báo đa kênh (Email, SMS, Push)',
    pagination: 'offset',
  })
  public async listTemplates(
    @ValidatedQuery(ListNotificationTemplatesQuerySchema) query: ListNotificationTemplatesQuery,
  ): Promise<PaginatedResult<NotificationTemplateItemResponse>> {
    return this.channelsService.listTemplates(query);
  }

  /** Tạo mới hoặc cập nhật Template thông báo */
  @Post(NOTIFICATIONS_ROUTES.TEMPLATES)
  @RequirePermissions('notifications.manage')
  @ApiDoc({
    summary: 'Tạo hoặc cập nhật template thông báo đa kênh (tách nội dung khỏi code nghiệp vụ)',
  })
  public async upsertTemplate(
    @ValidatedBody(UpsertNotificationTemplateRequestSchema)
    body: UpsertNotificationTemplateRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationTemplateItemResponse> {
    return this.channelsService.upsertTemplate(body, actor);
  }

  /** Xem trước nội dung render của Template với biến động */
  @Post(NOTIFICATIONS_ROUTES.TEMPLATES_PREVIEW)
  @RequirePermissions('notifications.read')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Render thử nghiệm template thông báo với các biến mẫu và tính số segment SMS',
  })
  public async previewTemplate(
    @ValidatedBody(PreviewNotificationTemplateRequestSchema)
    body: PreviewNotificationTemplateRequest,
  ): Promise<NotificationTemplatePreviewResponse> {
    return this.channelsService.previewTemplate(body);
  }

  /** Xóa Template thông báo tùy chỉnh */
  @Delete(NOTIFICATIONS_ROUTES.TEMPLATE_BY_ID)
  @RequirePermissions('notifications.manage')
  @ApiDoc({
    summary: 'Xóa template thông báo tùy chỉnh (chặn xóa template hệ thống)',
  })
  public async deleteTemplate(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ deleted: true; id: number }> {
    return this.channelsService.deleteTemplate(id, actor);
  }

  /** Tra cứu lịch sử và trạng thái gửi từng kênh (Queued, Sent, Delivered, Failed, Suppressed) */
  @Get(NOTIFICATIONS_ROUTES.DELIVERIES)
  @RequirePermissions('notifications.read')
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
    return this.channelsService.listDeliveries(query, locale);
  }

  /** Gửi lại thủ công 1 lệnh gửi kênh ngoài (đảm bảo idempotency không gửi trùng) */
  @Post(NOTIFICATIONS_ROUTES.DELIVERY_RETRY_BY_ID)
  @RequirePermissions('notifications.send')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thử gửi lại 1 bản tin lỗi (đảm bảo không gửi trùng nếu đã Sent/Delivered)',
  })
  public async retrySingleDelivery(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationDeliveryItemResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.channelsService.retrySingleDelivery(id, actor, locale);
  }

  /** Tự động quét và gửi lại các lệnh gửi lỗi tạm thời đã tới hạn nextRetryAt */
  @Post(NOTIFICATIONS_ROUTES.DELIVERIES_RETRY_DUE)
  @RequirePermissions('notifications.send')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Quét và tự động gửi lại theo lô các bản tin bị lỗi tạm thời đã tới hạn retry',
  })
  public async retryDueDeliveries(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<RetryDueDeliveriesResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.channelsService.retryDueDeliveries(new Date(), actor, locale);
  }

  /** Cập nhật trạng thái gửi từ Provider Webhook (Sent -> Delivered / Failed) */
  @Post(NOTIFICATIONS_ROUTES.DELIVERY_STATUS_BY_ID)
  @RequirePermissions('notifications.send')
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
    return this.channelsService.updateDeliveryStatusWebhook(id, body, actor, locale);
  }

  /** Danh sách địa chỉ Email / SĐT / Push Token bị dừng gửi (Suppression List) */
  @Get(NOTIFICATIONS_ROUTES.SUPPRESSIONS)
  @RequirePermissions('notifications.read')
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
    return this.channelsService.listSuppressions(query, locale);
  }

  /** Thêm địa chỉ hoặc token vào danh sách dừng gửi */
  @Post(NOTIFICATIONS_ROUTES.SUPPRESSIONS)
  @RequirePermissions('notifications.manage')
  @ApiDoc({
    summary: 'Thêm địa chỉ Email, SĐT hoặc Push Token vào danh sách dừng gửi (Suppression List)',
  })
  public async addSuppression(
    @ValidatedBody(CreateNotificationSuppressionRequestSchema)
    body: CreateNotificationSuppressionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationSuppressionItemResponse> {
    const locale = this.resolveCurrentLocale(actor);
    return this.channelsService.addSuppression(body, actor, locale);
  }

  /** Gỡ địa chỉ hoặc token khỏi danh sách dừng gửi */
  @Delete(NOTIFICATIONS_ROUTES.SUPPRESSION_BY_ID)
  @RequirePermissions('notifications.manage')
  @ApiDoc({
    summary: 'Gỡ chặn địa chỉ hoặc token khỏi danh sách dừng gửi',
  })
  public async removeSuppression(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ removed: boolean; id: number }> {
    return this.channelsService.removeSuppression(id, actor);
  }

  /** Lấy danh sách thiết bị nhận Push Notification của người dùng hiện tại */
  @Get(NOTIFICATIONS_ROUTES.PUSH_SUBSCRIPTIONS)
  @ApiDoc({
    summary: 'Lấy danh sách thiết bị đã đăng ký nhận Push Notification của người dùng hiện tại',
  })
  public async listMyPushSubscriptions(
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse[]> {
    const userId = this.resolveCurrentUserId(actor);
    return this.channelsService.listUserPushSubscriptions(userId);
  }

  /** Đăng ký thiết bị/trình duyệt nhận Push Notification */
  @Post(NOTIFICATIONS_ROUTES.PUSH_SUBSCRIPTIONS)
  @ApiDoc({
    summary: 'Đăng ký token thiết bị hoặc Web Push endpoint để nhận Push Notification',
  })
  public async registerPushSubscription(
    @ValidatedBody(RegisterPushSubscriptionRequestSchema) body: RegisterPushSubscriptionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationPushSubscriptionItemResponse> {
    const userId = this.resolveCurrentUserId(actor);
    return this.channelsService.registerPushSubscription(userId, body, actor);
  }

  /** Hủy đăng ký thiết bị nhận Push Notification */
  @Delete(NOTIFICATIONS_ROUTES.PUSH_SUBSCRIPTION_BY_ID)
  @ApiDoc({
    summary: 'Hủy đăng ký thiết bị nhận Push Notification',
  })
  public async unregisterPushSubscription(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ removed: true; id: number }> {
    const userId = this.resolveCurrentUserId(actor);
    return this.channelsService.unregisterPushSubscription(userId, id, actor);
  }

  /** Thống kê chi phí lũy kế và hạn mức nhà cung cấp (Quota & Cost Summary) */
  @Get(NOTIFICATIONS_ROUTES.QUOTA_SUMMARY)
  @RequirePermissions('notifications.read')
  @ApiDoc({
    summary:
      'Theo dõi chi phí lũy kế, số lượng segment SMS và hạn mức Quota ngày/tháng của nhà cung cấp',
  })
  public async getQuotaSummary(
    @ValidatedQuery(runtimeConfigQuerySchema) query: { organizationUnitId?: number | undefined },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<NotificationQuotaAndCostSummaryResponse> {
    const orgId = query.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? null;
    return this.channelsService.getQuotaAndCostSummary(orgId);
  }
}
