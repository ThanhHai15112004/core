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
import { CALENDAR_ROUTES, type CalendarExternalProvider } from '../contracts/index.js';
import {
  type AddCalendarParticipantsRequest,
  type CancelCalendarEventRequest,
  type CheckCalendarConflictsRequest,
  type CreateCalendarEventRequest,
  type InboundExternalCalendarSyncRequest,
  type ListCalendarEventsQuery,
  type ListCalendarHistoriesQuery,
  type ListCalendarOccurrencesQuery,
  type ScanCalendarRemindersRequest,
  type SyncCalendarExternalRequest,
  type UpdateCalendarEventRequest,
  type UpdateCalendarRsvpRequest,
  addCalendarParticipantsSchema,
  cancelCalendarEventSchema,
  checkCalendarConflictsSchema,
  createCalendarEventSchema,
  inboundExternalCalendarSyncSchema,
  listCalendarEventsQuerySchema,
  listCalendarHistoriesQuerySchema,
  listCalendarOccurrencesQuerySchema,
  positiveIntParamSchema,
  providerParamSchema,
  scanCalendarRemindersSchema,
  syncCalendarExternalSchema,
  updateCalendarEventSchema,
  updateCalendarRsvpSchema,
} from '../requests/calendar.requests.js';
import {
  calendarAccessEvaluationResponseSchema,
  calendarConflictCheckResponseSchema,
  calendarEventDetailResponseSchema,
  calendarEventItemResponseSchema,
  calendarExternalSyncResponseSchema,
  calendarHistoryItemResponseSchema,
  calendarOccurrenceItemResponseSchema,
  calendarProviderStatusResponseSchema,
  calendarReminderItemResponseSchema,
  calendarReminderScanResponseSchema,
} from '../responses/calendar.response.js';
import { CalendarService } from '../services/calendar.service.js';

@Controller(CALENDAR_ROUTES.ROOT)
@ApiGroup(CALENDAR_ROUTES.ROOT, 'Calendar & Event Management (Mục 9.7)')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get(CALENDAR_ROUTES.EVENTS)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary: 'Danh sách sự kiện lịch phân trang theo bộ lọc và Data Scope (Mục 9.7.1 & 9.7.6)',
    response: z.array(calendarEventItemResponseSchema),
  })
  public listEvents(
    @ValidatedQuery(listCalendarEventsQuerySchema) query: ListCalendarEventsQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.listEventsPaginated(query, actor);
  }

  @Get(CALENDAR_ROUTES.OCCURRENCES)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Mở rộng các phiên diễn ra của sự kiện (bao gồm sự kiện lặp lại DAILY / WEEKLY / MONTHLY) trong khoảng thời gian (Mục 9.7.3)',
    response: z.array(calendarOccurrenceItemResponseSchema),
  })
  public listOccurrences(
    @ValidatedQuery(listCalendarOccurrencesQuerySchema) query: ListCalendarOccurrencesQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.listOccurrencesInRange(query, actor);
  }

  @Get(CALENDAR_ROUTES.EVENT_BY_ID)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Xem chi tiết sự kiện lịch kèm người tham gia, chu kỳ lặp, nhắc lịch, phân quyền và lịch sử thay đổi (Mục 9.7)',
    response: calendarEventDetailResponseSchema,
  })
  public getEventById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.getEventById(id, actor);
  }

  @Get(CALENDAR_ROUTES.EVENT_ACCESS)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary: 'Kiểm tra quyền xem và sửa lịch theo Owner, Participant hoặc Manager (Mục 9.7.6)',
    response: calendarAccessEvaluationResponseSchema,
  })
  public evaluateAccess(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.evaluateAccess(id, actor);
  }

  @Post(CALENDAR_ROUTES.EVENTS)
  @RequirePermissions('calendar.create')
  @ApiDoc({
    summary:
      'Tạo sự kiện lịch mới có thời gian bắt đầu/kết thúc, người tham gia (User/Đơn vị), chu kỳ lặp và nhắc lịch (Mục 9.7.1 – 9.7.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: calendarEventDetailResponseSchema,
  })
  public createEvent(
    @ValidatedBody(createCalendarEventSchema) body: CreateCalendarEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.createEvent(body, actor);
  }

  @Put(CALENDAR_ROUTES.EVENT_BY_ID)
  @RequirePermissions('calendar.update')
  @ApiDoc({
    summary:
      'Cập nhật sự kiện lịch (chỉ Owner, Participant có quyền sửa hoặc Manager — tự động ghi lịch sử thay đổi Mục 9.7.6 & 9.7.8)',
    response: calendarEventDetailResponseSchema,
  })
  public updateEvent(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateCalendarEventSchema) body: UpdateCalendarEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.updateEvent(id, body, actor);
  }

  @Post(CALENDAR_ROUTES.EVENT_PARTICIPANTS)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.update')
  @ApiDoc({
    summary:
      'Thêm hoặc cập nhật người tham gia sự kiện (Người dùng USER hoặc Đơn vị ORGANIZATION_UNIT — Mục 9.7.2)',
    response: calendarEventDetailResponseSchema,
  })
  public addOrUpdateParticipants(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(addCalendarParticipantsSchema) body: AddCalendarParticipantsRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.addOrUpdateParticipants(id, body, actor);
  }

  @Delete(CALENDAR_ROUTES.EVENT_PARTICIPANT_BY_ID)
  @RequirePermissions('calendar.update')
  @ApiDoc({
    summary: 'Xóa một người tham gia hoặc đơn vị khỏi sự kiện lịch (Mục 9.7.2)',
    response: calendarEventDetailResponseSchema,
  })
  public removeParticipant(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedParams(positiveIntParamSchema, 'participantId') participantId: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.removeParticipant(id, participantId, actor);
  }

  @Post(CALENDAR_ROUTES.EVENT_RSVP)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Người tham gia phản hồi trạng thái tham dự RSVP (ACCEPTED / DECLINED / TENTATIVE — Mục 9.7.2 & 9.7.6)',
    response: calendarEventDetailResponseSchema,
  })
  public updateParticipantRsvp(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateCalendarRsvpSchema) body: UpdateCalendarRsvpRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.updateParticipantRsvp(id, body, actor);
  }

  @Post(CALENDAR_ROUTES.EVENT_CANCEL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.update')
  @ApiDoc({
    summary:
      'Hủy sự kiện lịch kèm lý do, thu hồi nhắc lịch chờ và đồng bộ hủy sang lịch ngoài (Mục 9.7.6 – 9.7.8)',
    response: calendarEventDetailResponseSchema,
  })
  public cancelEvent(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(cancelCalendarEventSchema) body: CancelCalendarEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.cancelEvent(id, body, actor);
  }

  @Post(CALENDAR_ROUTES.CONFLICTS_CHECK)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Kiểm tra trùng lịch theo người tham gia (User / Đơn vị) hoặc tài nguyên / phòng họp (Mục 9.7.5)',
    response: calendarConflictCheckResponseSchema,
  })
  public checkConflicts(
    @ValidatedBody(checkCalendarConflictsSchema) body: CheckCalendarConflictsRequest,
  ) {
    return this.calendarService.checkConflicts(body);
  }

  @Get(CALENDAR_ROUTES.EVENT_REMINDERS)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary: 'Danh sách các lịch nhắc của sự kiện (Mục 9.7.4)',
    response: z.array(calendarReminderItemResponseSchema),
  })
  public listEventReminders(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.listEventReminders(id, actor);
  }

  @Post(CALENDAR_ROUTES.REMINDERS_SCAN)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.manage')
  @ApiDoc({
    summary: 'Quét và gửi nhắc lịch đến hạn qua Notification & Scheduler (Mục 9.7.4)',
    response: calendarReminderScanResponseSchema,
  })
  public scanAndDispatchReminders(
    @ValidatedBody(scanCalendarRemindersSchema) body: ScanCalendarRemindersRequest,
  ) {
    return this.calendarService.scanAndDispatchReminders(body);
  }

  @Get(CALENDAR_ROUTES.INTEGRATION_PROVIDERS)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Danh sách trạng thái các Adapter tích hợp lịch ngoài Google Calendar & Microsoft Calendar (Mục 9.7.7)',
    response: z.array(calendarProviderStatusResponseSchema),
  })
  public listIntegrationProviders(@CurrentUser() actor?: UserIdentity) {
    return this.calendarService.listIntegrationProviders(actor?.organizationUnitIds?.[0] ?? null);
  }

  @Post(CALENDAR_ROUTES.EVENT_SYNC_EXTERNAL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.sync')
  @ApiDoc({
    summary:
      'Đồng bộ sự kiện lịch lên Google Calendar hoặc Microsoft Outlook Calendar qua Adapter tùy chọn (Mục 9.7.7)',
    response: calendarExternalSyncResponseSchema,
  })
  public syncEventWithExternalProviders(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(syncCalendarExternalSchema) body: SyncCalendarExternalRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.syncEventWithExternalProviders(id, body, actor);
  }

  @Post(CALENDAR_ROUTES.INTEGRATION_INBOUND_SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('calendar.sync')
  @ApiDoc({
    summary:
      'Đồng bộ chiều về từ Google Calendar / Microsoft Calendar và ghi lịch sử với nguồn GOOGLE_SYNC / MICROSOFT_SYNC (Mục 9.7.7 & 9.7.8)',
    response: calendarEventDetailResponseSchema,
  })
  public handleInboundExternalSync(
    @ValidatedParams(providerParamSchema, 'provider') provider: CalendarExternalProvider,
    @ValidatedBody(inboundExternalCalendarSyncSchema) body: InboundExternalCalendarSyncRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.handleInboundExternalSync(provider, body, actor);
  }

  @Get(CALENDAR_ROUTES.EVENT_HISTORIES)
  @RequirePermissions('calendar.read')
  @ApiDoc({
    summary:
      'Tra cứu lịch sử thay đổi sự kiện kèm nguồn thay đổi (WEB_UI, API, SCHEDULER, GOOGLE_SYNC, MICROSOFT_SYNC — Mục 9.7.8)',
    response: z.array(calendarHistoryItemResponseSchema),
  })
  public listEventHistories(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedQuery(listCalendarHistoriesQuerySchema) query: ListCalendarHistoriesQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.calendarService.listEventHistories(id, query, actor);
  }
}
