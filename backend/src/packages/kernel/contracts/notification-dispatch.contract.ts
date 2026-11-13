/**
 * Cổng gửi thông báo dùng chung cho các module nghiệp vụ.
 * Module cần gửi thông báo inject `NOTIFICATION_DISPATCHER` thay vì import module `notifications`,
 * để tránh phụ thuộc vòng (ví dụ `users` ↔ `notifications`). Module `notifications` (@Global) cung cấp token này.
 */
export interface NotificationDispatchRequest {
  readonly title: string;
  readonly content: string;
  readonly category?: 'SYSTEM' | 'WORK' | 'SECURITY' | 'ANNOUNCEMENT' | undefined;
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | undefined;
  readonly targetType: 'SINGLE_USER' | 'USER_GROUP';
  readonly userId?: number | undefined;
  readonly userIds?: readonly number[] | undefined;
  readonly channels?: readonly ('IN_APP' | 'EMAIL' | 'SMS' | 'PUSH')[] | undefined;
  readonly actionUrl?: string | null | undefined;
  readonly referenceModule?: string | null | undefined;
  readonly referenceType?: string | null | undefined;
  readonly referenceId?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
}

export interface INotificationDispatcher {
  dispatch(request: NotificationDispatchRequest): Promise<unknown>;
}

export const NOTIFICATION_DISPATCHER = Symbol('NOTIFICATION_DISPATCHER');
