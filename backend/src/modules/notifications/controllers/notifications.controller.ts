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
  type ListNotificationDispatchesQuery,
  ListNotificationDispatchesQuerySchema,
  type ListUserInboxQuery,
  ListUserInboxQuerySchema,
  type MarkAllNotificationsReadRequest,
  MarkAllNotificationsReadRequestSchema,
  type MarkNotificationReadRequest,
  MarkNotificationReadRequestSchema,
  type SendNotificationRequest,
  SendNotificationRequestSchema,
  type UpdateNotificationPreferencesRequest,
  UpdateNotificationPreferencesRequestSchema,
  type UpdateNotificationRuntimeConfigRequest,
  UpdateNotificationRuntimeConfigRequestSchema,
} from '../requests/notifications.requests.js';
import type {
  MarkAllNotificationsReadResponse,
  NotificationArchiveMutationResponse,
  NotificationDeleteFromInboxResponse,
  NotificationDispatchDetailResponse,
  NotificationDispatchHistoryItemResponse,
  NotificationInboxItemResponse,
  NotificationPreferenceItemResponse,
  NotificationReadStateMutationResponse,
  NotificationRuntimeConfigResponse,
  NotificationUnreadSummaryResponse,
} from '../responses/notifications.response.js';
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
  constructor(private readonly notificationsService: NotificationsService) {}

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
}
