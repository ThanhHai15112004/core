import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  type PaginatedResult,
  SequenceRegistryService,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  AuditLogService,
  DataScopeService,
  type UserIdentity,
  createDefaultDataScopeService,
} from '@packages/security/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
} from '@modules/notifications/contracts/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  CalendarProviderAdapterRegistry,
  type CalendarExternalSyncEventPayload,
} from '../adapters/calendar-provider.adapters.js';
import {
  CALENDAR_AUDIT_META,
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RSVP_STATUS,
  CALENDAR_SEQUENCE_KEYS,
  CALENDAR_SETTING_KEYS,
  CALENDAR_VISIBILITY,
  type CalendarChangeSource,
  type CalendarConflictCheckResultView,
  type CalendarEventAccessEvaluation,
  type CalendarEventDetailView,
  type CalendarEventHistoryItemView,
  type CalendarEventItemView,
  type CalendarEventOccurrenceView,
  type CalendarEventReminderItemView,
  type CalendarExternalBindingsMap,
  type CalendarExternalProvider,
  type CalendarExternalSyncResultView,
  type CalendarProviderStatusView,
  type CalendarReminderScanResultView,
  type ICalendarPublicService,
} from '../contracts/index.js';
import { checkCalendarScheduleConflicts } from '../helpers/calendar-conflict.helper.js';
import {
  buildEventSnapshot,
  computeChangedFields,
  hydrateCalendarEventDetail,
  hydrateCalendarEventsList,
  parseExternalBindings,
} from '../helpers/calendar-hydration.helper.js';
import {
  assertCanEditCalendarEvent,
  assertCanViewCalendarEvent,
  evaluateCalendarEventAccess,
} from '../helpers/calendar-permission.helper.js';
import {
  buildScheduledReminderInputs,
  expandEventOccurrences,
  parseRecurrenceRule,
  parseReminderRules,
  validateRecurrenceRule,
} from '../helpers/calendar-recurrence.helper.js';
import { executeCalendarReminderScan } from '../helpers/calendar-reminder-scanner.helper.js';
import { CalendarEventHistoryRepository } from '../repositories/calendar-event-history.repository.js';
import {
  CalendarEventParticipantRepository,
  type UpsertCalendarParticipantInput,
} from '../repositories/calendar-event-participant.repository.js';
import { CalendarEventReminderRepository } from '../repositories/calendar-event-reminder.repository.js';
import { CalendarEventRepository } from '../repositories/calendar-event.repository.js';
import type {
  AddCalendarParticipantsRequest,
  CancelCalendarEventRequest,
  CheckCalendarConflictsRequest,
  CreateCalendarEventRequest,
  InboundExternalCalendarSyncRequest,
  ListCalendarEventsQuery,
  ListCalendarHistoriesQuery,
  ListCalendarOccurrencesQuery,
  ScanCalendarRemindersRequest,
  SyncCalendarExternalRequest,
  UpdateCalendarEventRequest,
  UpdateCalendarRsvpRequest,
} from '../requests/calendar.requests.js';

@Injectable()
export class CalendarService implements ICalendarPublicService {
  private readonly effectiveDataScopeService: DataScopeService;
  private readonly effectiveSequenceRegistry: SequenceRegistryService;
  private readonly adapterRegistry: CalendarProviderAdapterRegistry;

  constructor(
    private readonly eventRepository: CalendarEventRepository,
    private readonly participantRepository: CalendarEventParticipantRepository,
    private readonly reminderRepository: CalendarEventReminderRepository,
    private readonly historyRepository: CalendarEventHistoryRepository,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService | null = null,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsPublicService: IOrganizationsPublicService | null = null,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService: INotificationsPublicService | null = null,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(SequenceRegistryService)
    private readonly sequenceRegistry: SequenceRegistryService | null = null,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();
    this.effectiveSequenceRegistry = this.sequenceRegistry ?? defaultSequenceRegistry;
    this.adapterRegistry = new CalendarProviderAdapterRegistry();
  }

  public getAdapterRegistry(): CalendarProviderAdapterRegistry {
    return this.adapterRegistry;
  }

  public listIntegrationProviders(
    organizationUnitId?: number | null,
  ): CalendarProviderStatusView[] {
    return this.adapterRegistry.listStatuses(organizationUnitId);
  }

  public async listEventsPaginated(
    query: ListCalendarEventsQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<CalendarEventItemView>> {
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: CALENDAR_SETTING_KEYS.PAGINATION_PREFIX,
      defaultLimit: 20,
      maxLimit: 200,
    });
    const scopeFilter = actor
      ? await this.effectiveDataScopeService.resolveScopeFilter(actor, 'calendar', 'read')
      : undefined;

    const { items, total } = await this.eventRepository.searchPaginated({
      ...query,
      ...(query.status !== undefined
        ? { status: query.status as typeof CALENDAR_EVENT_STATUS.SCHEDULED }
        : {}),
      page,
      limit,
      countMode,
      ...(scopeFilter ? { scopeFilter } : {}),
    });

    const eventIds = items.map((e) => Number(e.id));
    const participants = await this.participantRepository.findByEventIds(eventIds);
    const defaultReminderMinutes = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.DEFAULT_REMINDER_MINUTES,
      undefined,
      15,
    );

    const hydrated = await hydrateCalendarEventsList({
      events: items,
      participants,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
      defaultReminderMinutes,
    });

    return createPaginatedResult(hydrated, countMode === 'none' ? null : total, page, limit);
  }

  public async listOccurrencesInRange(
    query: ListCalendarOccurrencesQuery,
    _actor?: UserIdentity,
  ): Promise<CalendarEventOccurrenceView[]> {
    const maxOccurrences =
      query.maxOccurrences ??
      defaultSettingRegistry.getNumber(
        CALENDAR_SETTING_KEYS.MAX_RECURRENCE_OCCURRENCES,
        undefined,
        180,
      );
    const rangeStart = query.fromDate ? new Date(query.fromDate) : undefined;
    const rangeEnd = query.toDate ? new Date(query.toDate) : undefined;

    const { items } = await this.eventRepository.searchPaginated({
      ...(query.participantUserId !== undefined
        ? { participantUserId: query.participantUserId }
        : {}),
      ...(query.participantOrgUnitId !== undefined
        ? { participantOrgUnitId: query.participantOrgUnitId }
        : {}),
      ...(query.resourceCode ? { resourceCode: query.resourceCode } : {}),
      page: 1,
      limit: 200,
      countMode: 'none',
    });

    const allOccurrences: CalendarEventOccurrenceView[] = [];
    for (const ev of items) {
      if (ev.status === CALENDAR_EVENT_STATUS.CANCELLED) continue;
      const expanded = expandEventOccurrences({
        event: ev,
        ...(rangeStart && !Number.isNaN(rangeStart.getTime()) ? { rangeStart } : {}),
        ...(rangeEnd && !Number.isNaN(rangeEnd.getTime()) ? { rangeEnd } : {}),
        maxOccurrences,
      });
      allOccurrences.push(...expanded);
    }

    return allOccurrences.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }

  public async getEventById(id: number, actor?: UserIdentity): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }

    const [participants, reminders, histories] = await Promise.all([
      this.participantRepository.findByEventId(Number(event.id)),
      this.reminderRepository.findByEventId(Number(event.id)),
      this.historyRepository.findByEventId(Number(event.id)),
    ]);

    const viewerAccess = await assertCanViewCalendarEvent({
      event,
      participants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const defaultReminderMinutes = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.DEFAULT_REMINDER_MINUTES,
      undefined,
      15,
    );

    return hydrateCalendarEventDetail({
      event,
      participants,
      reminders,
      histories,
      viewerAccess,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
      defaultReminderMinutes,
    });
  }

  public async evaluateAccess(
    id: number,
    actor?: UserIdentity,
  ): Promise<CalendarEventAccessEvaluation> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    const participants = await this.participantRepository.findByEventId(Number(event.id));
    return evaluateCalendarEventAccess({
      event,
      participants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });
  }

  public async checkConflicts(
    dto: CheckCalendarConflictsRequest,
  ): Promise<CalendarConflictCheckResultView> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestAppException('calendar.invalidTimeRange');
    }

    const maxOccurrences = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.MAX_RECURRENCE_OCCURRENCES,
      undefined,
      180,
    );
    const recurrenceRule = validateRecurrenceRule(dto.recurrenceRule, startAt, maxOccurrences);

    return checkCalendarScheduleConflicts({
      input: {
        startAt,
        endAt,
        recurrenceRule,
        ownerUserId: dto.ownerUserId ?? null,
        resourceCode: dto.resourceCode ?? null,
        participantUserIds: dto.participantUserIds ?? [],
        participantOrganizationUnitIds: dto.participantOrganizationUnitIds ?? [],
        excludeEventId: dto.excludeEventId ?? null,
      },
      eventRepository: this.eventRepository,
      participantRepository: this.participantRepository,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
      maxOccurrencesToCheck: Math.min(maxOccurrences, 60),
    });
  }

  public async createEvent(
    dto: CreateCalendarEventRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestAppException('calendar.invalidTimeRange');
    }

    const maxOccurrences = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.MAX_RECURRENCE_OCCURRENCES,
      undefined,
      180,
    );
    const recurrenceRule = validateRecurrenceRule(dto.recurrenceRule, startAt, maxOccurrences);
    const normalizedParticipants = this.normalizeParticipantInputs(dto.participants ?? []);

    const ownerUserId = Number(dto.ownerUserId ?? actor?.id ?? 1);
    const orgUnitId =
      dto.organizationUnitId !== undefined
        ? dto.organizationUnitId
        : (actor?.organizationUnitIds?.[0] ?? null);

    await this.enforceConflictPolicy({
      startAt,
      endAt,
      recurrenceRule,
      ownerUserId,
      resourceCode: dto.resourceCode ?? null,
      participants: normalizedParticipants,
      organizationUnitId: orgUnitId,
      allowConflictOverride: Boolean(dto.allowConflictOverride),
      strictConflictCheck: Boolean(dto.strictConflictCheck),
    });

    const code = dto.code?.trim()
      ? dto.code.trim().toUpperCase()
      : await this.generateEventCode(orgUnitId);

    const defaultReminderMinutes = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.DEFAULT_REMINDER_MINUTES,
      { organizationUnitId: orgUnitId },
      15,
    );
    const reminderRules =
      dto.reminderRules !== undefined
        ? dto.reminderRules.map((r) => ({
            minutesBefore: Number(r.minutesBefore ?? defaultReminderMinutes),
            channels: r.channels?.length ? r.channels : ['IN_APP'],
          }))
        : [{ minutesBefore: defaultReminderMinutes, channels: ['IN_APP'] }];

    const createdEvent = await this.eventRepository.saveEntity({
      code,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      eventType: (dto.eventType ?? CALENDAR_EVENT_TYPE.MEETING).trim().toUpperCase(),
      status: CALENDAR_EVENT_STATUS.SCHEDULED,
      visibility: dto.visibility ?? CALENDAR_VISIBILITY.PUBLIC,
      startAt,
      endAt,
      timezone: dto.timezone?.trim() || 'Asia/Ho_Chi_Minh',
      isAllDay: Boolean(dto.isAllDay),
      location: dto.location?.trim() ?? null,
      meetingUrl: dto.meetingUrl?.trim() ?? null,
      resourceCode: dto.resourceCode?.trim() ? dto.resourceCode.trim().toUpperCase() : null,
      resourceName: dto.resourceName?.trim() ?? null,
      ownerUserId,
      organizationUnitId: orgUnitId,
      recurrenceRuleJson: recurrenceRule ? JSON.stringify(recurrenceRule) : null,
      remindersJson: JSON.stringify(reminderRules),
      externalBindingsJson: '{}',
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
      cancelReason: null,
    });

    const savedParticipants = await this.participantRepository.replaceParticipantsForEvent(
      Number(createdEvent.id),
      normalizedParticipants,
      actor?.id ?? ownerUserId,
    );

    const reminderInputs = buildScheduledReminderInputs({
      event: createdEvent,
      reminderRules,
    });
    await this.reminderRepository.replacePendingRemindersForEvent(
      Number(createdEvent.id),
      reminderInputs,
    );

    if (dto.syncProviders && dto.syncProviders.length > 0) {
      await this.syncWithExternalProvidersInternal(createdEvent, dto.syncProviders);
    }

    const changeSource: CalendarChangeSource = dto.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI;
    const afterSnapshot = buildEventSnapshot(createdEvent, savedParticipants);

    await this.historyRepository.recordHistory({
      calendarEventId: Number(createdEvent.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.CREATED,
      changeSource,
      actorUserId: actor?.id ?? ownerUserId,
      changedFields: Object.keys(afterSnapshot),
      beforeSnapshot: null,
      afterSnapshot,
      reason: dto.reason ?? 'Khởi tạo sự kiện lịch mới',
      metadata: {
        isRecurring: recurrenceRule !== null,
        participantCount: savedParticipants.length,
        reminderCount: reminderInputs.length,
      },
    });

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: CALENDAR_AUDIT_META.MODULE,
          feature: CALENDAR_AUDIT_META.FEATURES.EVENT,
          action: 'calendar.event.create',
          resourceType: CALENDAR_AUDIT_META.RESOURCE_TYPES.EVENT,
          resourceId: String(createdEvent.id),
          actorUserId: actor?.id ?? ownerUserId,
          afterData: afterSnapshot,
          reason: dto.reason ?? 'Tạo mới sự kiện lịch',
        })
        .catch(() => undefined);
    }

    return this.getEventById(
      Number(createdEvent.id),
      actor ?? { id: ownerUserId, username: 'owner', roles: [], permissions: [] },
    );
  }

  public async updateEvent(
    id: number,
    dto: UpdateCalendarEventRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }

    const existingParticipants = await this.participantRepository.findByEventId(Number(event.id));
    await assertCanEditCalendarEvent({
      event,
      participants: existingParticipants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const beforeSnapshot = buildEventSnapshot(event, existingParticipants);

    const nextStartAt = dto.startAt ? new Date(dto.startAt) : new Date(event.startAt);
    const nextEndAt = dto.endAt ? new Date(dto.endAt) : new Date(event.endAt);
    if (
      Number.isNaN(nextStartAt.getTime()) ||
      Number.isNaN(nextEndAt.getTime()) ||
      nextEndAt <= nextStartAt
    ) {
      throw new BadRequestAppException('calendar.invalidTimeRange');
    }

    const maxOccurrences = defaultSettingRegistry.getNumber(
      CALENDAR_SETTING_KEYS.MAX_RECURRENCE_OCCURRENCES,
      undefined,
      180,
    );
    const nextRecurrenceRule =
      dto.recurrenceRule !== undefined
        ? validateRecurrenceRule(dto.recurrenceRule, nextStartAt, maxOccurrences)
        : parseRecurrenceRule(event.recurrenceRuleJson);

    const normalizedParticipants =
      dto.participants !== undefined
        ? this.normalizeParticipantInputs(dto.participants)
        : existingParticipants.map((p) => ({
            participantType: p.participantType,
            userId: p.userId ?? null,
            organizationUnitId: p.organizationUnitId ?? null,
            role: p.participantRole,
            canEdit: Boolean(p.canEdit),
            rsvpStatus: p.rsvpStatus,
            responseNote: p.responseNote ?? null,
          }));

    const nextResourceCode =
      dto.resourceCode !== undefined
        ? dto.resourceCode?.trim()
          ? dto.resourceCode.trim().toUpperCase()
          : null
        : (event.resourceCode ?? null);

    await this.enforceConflictPolicy({
      startAt: nextStartAt,
      endAt: nextEndAt,
      recurrenceRule: nextRecurrenceRule,
      ownerUserId: Number(event.ownerUserId),
      resourceCode: nextResourceCode,
      participants: normalizedParticipants,
      organizationUnitId:
        dto.organizationUnitId !== undefined
          ? dto.organizationUnitId
          : (event.organizationUnitId ?? null),
      excludeEventId: Number(event.id),
      allowConflictOverride: Boolean(dto.allowConflictOverride),
      strictConflictCheck: Boolean(dto.strictConflictCheck),
    });

    const isRescheduled =
      nextStartAt.getTime() !== new Date(event.startAt).getTime() ||
      nextEndAt.getTime() !== new Date(event.endAt).getTime();
    const isRecurrenceChanged =
      dto.recurrenceRule !== undefined &&
      JSON.stringify(nextRecurrenceRule) !==
        JSON.stringify(parseRecurrenceRule(event.recurrenceRuleJson));

    if (dto.title !== undefined) event.title = dto.title.trim();
    if (dto.description !== undefined) event.description = dto.description?.trim() ?? null;
    if (dto.eventType !== undefined) event.eventType = dto.eventType.trim().toUpperCase();
    if (dto.status !== undefined) event.status = dto.status as typeof event.status;
    if (dto.visibility !== undefined) event.visibility = dto.visibility;
    event.startAt = nextStartAt;
    event.endAt = nextEndAt;
    if (dto.timezone !== undefined) event.timezone = dto.timezone.trim();
    if (dto.isAllDay !== undefined) event.isAllDay = Boolean(dto.isAllDay);
    if (dto.location !== undefined) event.location = dto.location?.trim() ?? null;
    if (dto.meetingUrl !== undefined) event.meetingUrl = dto.meetingUrl?.trim() ?? null;
    event.resourceCode = nextResourceCode;
    if (dto.resourceName !== undefined) event.resourceName = dto.resourceName?.trim() ?? null;
    if (dto.organizationUnitId !== undefined) event.organizationUnitId = dto.organizationUnitId;
    if (dto.recurrenceRule !== undefined) {
      event.recurrenceRuleJson = nextRecurrenceRule ? JSON.stringify(nextRecurrenceRule) : null;
    }
    if (dto.reminderRules !== undefined) {
      event.remindersJson = JSON.stringify(dto.reminderRules);
    }
    if (dto.metadata !== undefined) {
      event.metadataJson = dto.metadata ? JSON.stringify(dto.metadata) : null;
    }

    const updatedEvent = await this.eventRepository.saveEntity(event);

    let finalParticipants = existingParticipants;
    if (dto.participants !== undefined) {
      finalParticipants = await this.participantRepository.replaceParticipantsForEvent(
        Number(updatedEvent.id),
        normalizedParticipants,
        actor?.id ?? Number(updatedEvent.ownerUserId),
      );
    }

    if (isRescheduled || isRecurrenceChanged || dto.reminderRules !== undefined) {
      const reminderRules = parseReminderRules(updatedEvent.remindersJson);
      const reminderInputs = buildScheduledReminderInputs({
        event: updatedEvent,
        reminderRules,
      });
      await this.reminderRepository.replacePendingRemindersForEvent(
        Number(updatedEvent.id),
        reminderInputs,
      );
    }

    const existingBindings = parseExternalBindings(updatedEvent.externalBindingsJson);
    const autoSync = defaultSettingRegistry.getBoolean(
      CALENDAR_SETTING_KEYS.AUTO_SYNC_ON_CHANGE,
      { organizationUnitId: updatedEvent.organizationUnitId ?? null },
      true,
    );
    const providersToSync = new Set<CalendarExternalProvider>(dto.syncProviders ?? []);
    if (autoSync) {
      for (const p of Object.keys(existingBindings) as CalendarExternalProvider[]) {
        providersToSync.add(p);
      }
    }
    if (providersToSync.size > 0) {
      await this.syncWithExternalProvidersInternal(updatedEvent, [...providersToSync]);
    }

    const afterSnapshot = buildEventSnapshot(updatedEvent, finalParticipants);
    const changedFields = computeChangedFields(beforeSnapshot, afterSnapshot);
    const actionType = isRescheduled
      ? CALENDAR_HISTORY_ACTION_TYPE.RESCHEDULED
      : isRecurrenceChanged
        ? CALENDAR_HISTORY_ACTION_TYPE.RECURRENCE_UPDATED
        : dto.participants !== undefined
          ? CALENDAR_HISTORY_ACTION_TYPE.PARTICIPANTS_CHANGED
          : CALENDAR_HISTORY_ACTION_TYPE.UPDATED;

    await this.historyRepository.recordHistory({
      calendarEventId: Number(updatedEvent.id),
      actionType,
      changeSource: dto.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: actor?.id ?? null,
      changedFields,
      beforeSnapshot,
      afterSnapshot,
      reason: dto.reason ?? 'Cập nhật thông tin sự kiện lịch',
    });

    return this.getEventById(Number(updatedEvent.id), actor);
  }

  public async addOrUpdateParticipants(
    id: number,
    dto: AddCalendarParticipantsRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    const existingParticipants = await this.participantRepository.findByEventId(Number(event.id));
    await assertCanEditCalendarEvent({
      event,
      participants: existingParticipants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const beforeSnapshot = buildEventSnapshot(event, existingParticipants);
    const normalizedNew = this.normalizeParticipantInputs(dto.participants);

    let mergedInputs: UpsertCalendarParticipantInput[];
    if (dto.replaceExisting) {
      mergedInputs = normalizedNew;
    } else {
      const existingInputs: UpsertCalendarParticipantInput[] = existingParticipants.map((p) => ({
        participantType: p.participantType,
        userId: p.userId ?? null,
        organizationUnitId: p.organizationUnitId ?? null,
        role: p.participantRole,
        canEdit: Boolean(p.canEdit),
        rsvpStatus: p.rsvpStatus,
        responseNote: p.responseNote ?? null,
      }));
      const mapByKey = new Map<string, UpsertCalendarParticipantInput>();
      for (const item of [...existingInputs, ...normalizedNew]) {
        const key =
          item.participantType === CALENDAR_PARTICIPANT_TYPE.USER
            ? `USER:${item.userId}`
            : `ORG:${item.organizationUnitId}`;
        mapByKey.set(key, item);
      }
      mergedInputs = [...mapByKey.values()];
    }

    await this.enforceConflictPolicy({
      startAt: new Date(event.startAt),
      endAt: new Date(event.endAt),
      recurrenceRule: parseRecurrenceRule(event.recurrenceRuleJson),
      ownerUserId: Number(event.ownerUserId),
      resourceCode: event.resourceCode ?? null,
      participants: mergedInputs,
      organizationUnitId: event.organizationUnitId ?? null,
      excludeEventId: Number(event.id),
      allowConflictOverride: Boolean(dto.allowConflictOverride),
      strictConflictCheck: Boolean(dto.strictConflictCheck),
    });

    const savedParticipants = await this.participantRepository.replaceParticipantsForEvent(
      Number(event.id),
      mergedInputs,
      actor?.id ?? Number(event.ownerUserId),
    );
    const afterSnapshot = buildEventSnapshot(event, savedParticipants);

    await this.historyRepository.recordHistory({
      calendarEventId: Number(event.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.PARTICIPANTS_CHANGED,
      changeSource: dto.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: actor?.id ?? null,
      changedFields: ['participants'],
      beforeSnapshot,
      afterSnapshot,
      reason: dto.reason ?? 'Cập nhật danh sách người tham gia / đơn vị tham gia',
    });

    return this.getEventById(Number(event.id), actor);
  }

  public async removeParticipant(
    id: number,
    participantId: number,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    const existingParticipants = await this.participantRepository.findByEventId(Number(event.id));
    await assertCanEditCalendarEvent({
      event,
      participants: existingParticipants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const target = existingParticipants.find((p) => Number(p.id) === Number(participantId));
    if (!target) {
      throw new NotFoundAppException('calendar.participantNotFound', {
        participantId,
        eventId: id,
      });
    }

    const beforeSnapshot = buildEventSnapshot(event, existingParticipants);
    await this.participantRepository.deleteById(Number(target.id));
    const remaining = await this.participantRepository.findByEventId(Number(event.id));
    const afterSnapshot = buildEventSnapshot(event, remaining);

    await this.historyRepository.recordHistory({
      calendarEventId: Number(event.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.PARTICIPANTS_CHANGED,
      changeSource: CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: actor?.id ?? null,
      changedFields: ['participants'],
      beforeSnapshot,
      afterSnapshot,
      reason: `Xóa người tham gia #${participantId}`,
    });

    return this.getEventById(Number(event.id), actor);
  }

  public async updateParticipantRsvp(
    id: number,
    dto: UpdateCalendarRsvpRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    if (!actor?.id) {
      throw new ForbiddenAppException('calendar.forbiddenRsvp');
    }

    const existingParticipants = await this.participantRepository.findByEventId(Number(event.id));
    const access = await evaluateCalendarEventAccess({
      event,
      participants: existingParticipants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });
    if (!access.canRsvp) {
      throw new ForbiddenAppException('calendar.forbiddenRsvp');
    }

    const beforeSnapshot = buildEventSnapshot(event, existingParticipants);
    let direct = existingParticipants.find(
      (p) =>
        p.participantType === CALENDAR_PARTICIPANT_TYPE.USER &&
        Number(p.userId) === Number(actor.id),
    );

    if (direct) {
      direct.rsvpStatus = dto.rsvpStatus;
      direct.responseNote = dto.responseNote ?? null;
      direct.respondedAt = new Date();
      await this.participantRepository.saveEntity(direct);
    } else {
      direct = await this.participantRepository.saveEntity({
        calendarEventId: Number(event.id),
        participantType: CALENDAR_PARTICIPANT_TYPE.USER,
        userId: Number(actor.id),
        organizationUnitId: null,
        participantRole: CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
        canEdit: false,
        rsvpStatus: dto.rsvpStatus,
        responseNote: dto.responseNote ?? null,
        respondedAt: new Date(),
        addedByUserId: Number(actor.id),
      });
    }

    const updatedParticipants = await this.participantRepository.findByEventId(Number(event.id));
    const afterSnapshot = buildEventSnapshot(event, updatedParticipants);

    await this.historyRepository.recordHistory({
      calendarEventId: Number(event.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.RSVP_UPDATED,
      changeSource: dto.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: Number(actor.id),
      changedFields: ['rsvpStatus'],
      beforeSnapshot,
      afterSnapshot,
      reason: dto.responseNote ?? `Phản hồi tham gia sự kiện: ${dto.rsvpStatus}`,
    });

    return this.getEventById(Number(event.id), actor);
  }

  public async cancelEvent(
    id: number,
    dto: CancelCalendarEventRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    if (event.status === CALENDAR_EVENT_STATUS.CANCELLED) {
      throw new BadRequestAppException('calendar.eventAlreadyCancelled', [], { id });
    }

    const participants = await this.participantRepository.findByEventId(Number(event.id));
    await assertCanEditCalendarEvent({
      event,
      participants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const beforeSnapshot = buildEventSnapshot(event, participants);
    event.status = CALENDAR_EVENT_STATUS.CANCELLED;
    event.cancelReason = dto.reason.trim();
    const savedEvent = await this.eventRepository.saveEntity(event);

    await this.reminderRepository.cancelPendingRemindersForEvent(Number(savedEvent.id));

    const existingBindings = parseExternalBindings(savedEvent.externalBindingsJson);
    const boundProviders = Object.keys(existingBindings) as CalendarExternalProvider[];
    if (boundProviders.length > 0) {
      await this.syncCancelWithExternalProvidersInternal(savedEvent, boundProviders);
    }

    const afterSnapshot = buildEventSnapshot(savedEvent, participants);
    await this.historyRepository.recordHistory({
      calendarEventId: Number(savedEvent.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.CANCELLED,
      changeSource: dto.changeSource ?? CALENDAR_CHANGE_SOURCE.WEB_UI,
      actorUserId: actor?.id ?? null,
      changedFields: ['status', 'cancelReason'],
      beforeSnapshot,
      afterSnapshot,
      reason: dto.reason.trim(),
    });

    return this.getEventById(Number(savedEvent.id), actor);
  }

  public async syncEventWithExternalProviders(
    id: number,
    dto: SyncCalendarExternalRequest,
    actor?: UserIdentity,
  ): Promise<CalendarExternalSyncResultView> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', { id });
    }
    const participants = await this.participantRepository.findByEventId(Number(event.id));
    await assertCanEditCalendarEvent({
      event,
      participants,
      actor,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    const beforeSnapshot = buildEventSnapshot(event, participants);
    const bindings = await this.syncWithExternalProvidersInternal(
      event,
      dto.providers,
      dto.calendarIdOverride ?? null,
    );
    const afterSnapshot = buildEventSnapshot(event, participants);

    await this.historyRepository.recordHistory({
      calendarEventId: Number(event.id),
      actionType: CALENDAR_HISTORY_ACTION_TYPE.EXTERNAL_SYNCED,
      changeSource: dto.changeSource ?? CALENDAR_CHANGE_SOURCE.API,
      actorUserId: actor?.id ?? null,
      changedFields: ['externalBindings'],
      beforeSnapshot,
      afterSnapshot,
      reason: `Đồng bộ sự kiện với ${dto.providers.join(', ')}`,
      metadata: { providers: dto.providers, bindings },
    });

    return {
      eventId: Number(event.id),
      eventCode: event.code,
      syncedProviders: dto.providers,
      bindings,
    };
  }

  public async handleInboundExternalSync(
    provider: CalendarExternalProvider,
    dto: InboundExternalCalendarSyncRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    const adapter = this.adapterRegistry.getAdapter(provider);
    if (!adapter.isEnabled()) {
      throw new BadRequestAppException('calendar.providerDisabled', [], { provider });
    }

    let event = dto.eventId ? await this.eventRepository.findById(dto.eventId) : null;
    if (!event && dto.eventCode) {
      event = await this.eventRepository.findByCode(dto.eventCode);
    }
    if (!event) {
      throw new NotFoundAppException('calendar.eventNotFound', {
        id: dto.eventId ?? dto.eventCode ?? dto.externalEventId,
      });
    }

    const participants = await this.participantRepository.findByEventId(Number(event.id));
    const beforeSnapshot = buildEventSnapshot(event, participants);

    if (dto.title !== undefined) event.title = dto.title.trim();
    if (dto.description !== undefined) event.description = dto.description?.trim() ?? null;
    if (dto.location !== undefined) event.location = dto.location?.trim() ?? null;
    if (dto.startAt && dto.endAt) {
      const startAt = new Date(dto.startAt);
      const endAt = new Date(dto.endAt);
      if (!Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime()) && endAt > startAt) {
        event.startAt = startAt;
        event.endAt = endAt;
      }
    }
    if (dto.status === 'CANCELLED') {
      event.status = CALENDAR_EVENT_STATUS.CANCELLED;
      event.cancelReason = dto.reason ?? `Cancelled via ${provider} Calendar Sync`;
      await this.reminderRepository.cancelPendingRemindersForEvent(Number(event.id));
    }

    const bindings = parseExternalBindings(event.externalBindingsJson);
    const updatedBinding = await adapter.syncEventUpsert(
      {
        eventId: Number(event.id),
        eventCode: event.code,
        title: event.title,
        description: event.description ?? null,
        startAt: new Date(event.startAt),
        endAt: new Date(event.endAt),
        timezone: event.timezone,
        isAllDay: Boolean(event.isAllDay),
        location: event.location ?? null,
        meetingUrl: event.meetingUrl ?? null,
        recurrenceRule: parseRecurrenceRule(event.recurrenceRuleJson),
        ...(bindings[provider] ? { existingBinding: bindings[provider] } : {}),
        calendarIdOverride: dto.calendarId ?? null,
      },
      event.organizationUnitId ?? null,
    );

    bindings[provider] = {
      ...updatedBinding,
      externalEventId: dto.externalEventId,
      etag: dto.etag ?? updatedBinding.etag,
      syncStatus: dto.status === 'CANCELLED' ? 'CANCELLED' : 'SYNCED',
    };
    event.externalBindingsJson = JSON.stringify(bindings);
    const saved = await this.eventRepository.saveEntity(event);
    const afterSnapshot = buildEventSnapshot(saved, participants);
    const changedFields = computeChangedFields(beforeSnapshot, afterSnapshot);

    const changeSource = adapter.resolveChangeSource();
    await this.historyRepository.recordHistory({
      calendarEventId: Number(saved.id),
      actionType:
        dto.status === 'CANCELLED'
          ? CALENDAR_HISTORY_ACTION_TYPE.CANCELLED
          : CALENDAR_HISTORY_ACTION_TYPE.EXTERNAL_SYNCED,
      changeSource,
      actorUserId: actor?.id ?? null,
      changedFields,
      beforeSnapshot,
      afterSnapshot,
      reason: dto.reason ?? `Cập nhật đồng bộ chiều về từ ${provider} Calendar`,
      metadata: {
        provider,
        externalEventId: dto.externalEventId,
        etag: bindings[provider]?.etag ?? null,
      },
    });

    return this.getEventById(Number(saved.id), actor);
  }

  public async listEventHistories(
    id: number,
    query: ListCalendarHistoriesQuery,
    actor?: UserIdentity,
  ): Promise<CalendarEventHistoryItemView[]> {
    const detail = await this.getEventById(id, actor);
    return detail.histories.filter((h) => {
      if (query.changeSource && h.changeSource !== query.changeSource) return false;
      if (query.actionType && h.actionType !== query.actionType) return false;
      return true;
    });
  }

  public async listEventReminders(
    id: number,
    actor?: UserIdentity,
  ): Promise<CalendarEventReminderItemView[]> {
    const detail = await this.getEventById(id, actor);
    return [...detail.reminders];
  }

  public async scanAndDispatchReminders(
    nowOrDto?: Date | ScanCalendarRemindersRequest,
  ): Promise<CalendarReminderScanResultView> {
    const effectiveNow =
      nowOrDto instanceof Date ? nowOrDto : nowOrDto?.now ? new Date(nowOrDto.now) : new Date();
    const validNow = Number.isNaN(effectiveNow.getTime()) ? new Date() : effectiveNow;

    return executeCalendarReminderScan({
      now: validNow,
      eventRepository: this.eventRepository,
      participantRepository: this.participantRepository,
      reminderRepository: this.reminderRepository,
      historyRepository: this.historyRepository,
      notificationsPublicService: this.notificationsPublicService,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });
  }

  private normalizeParticipantInputs(
    items: readonly {
      participantType?: string | undefined;
      userId?: number | null | undefined;
      organizationUnitId?: number | null | undefined;
      role?: string | undefined;
      canEdit?: boolean | undefined;
      rsvpStatus?: string | undefined;
      responseNote?: string | null | undefined;
    }[],
  ): UpsertCalendarParticipantInput[] {
    const result: UpsertCalendarParticipantInput[] = [];
    const seen = new Set<string>();

    for (const raw of items) {
      const pType =
        raw.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT
          ? CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT
          : CALENDAR_PARTICIPANT_TYPE.USER;

      if (pType === CALENDAR_PARTICIPANT_TYPE.USER) {
        if (!raw.userId || Number(raw.userId) <= 0) {
          throw new BadRequestAppException('calendar.invalidParticipantTarget');
        }
        const key = `USER:${Number(raw.userId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          participantType: CALENDAR_PARTICIPANT_TYPE.USER,
          userId: Number(raw.userId),
          organizationUnitId: null,
          role:
            (raw.role as UpsertCalendarParticipantInput['role']) ??
            CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
          canEdit: Boolean(raw.canEdit || raw.role === CALENDAR_PARTICIPANT_ROLE.ORGANIZER),
          rsvpStatus:
            (raw.rsvpStatus as UpsertCalendarParticipantInput['rsvpStatus']) ??
            CALENDAR_RSVP_STATUS.PENDING,
          responseNote: raw.responseNote ?? null,
        });
      } else {
        if (!raw.organizationUnitId || Number(raw.organizationUnitId) <= 0) {
          throw new BadRequestAppException('calendar.invalidParticipantTarget');
        }
        const key = `ORG:${Number(raw.organizationUnitId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          participantType: CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT,
          userId: null,
          organizationUnitId: Number(raw.organizationUnitId),
          role:
            (raw.role as UpsertCalendarParticipantInput['role']) ??
            CALENDAR_PARTICIPANT_ROLE.ATTENDEE,
          canEdit: Boolean(raw.canEdit || raw.role === CALENDAR_PARTICIPANT_ROLE.ORGANIZER),
          rsvpStatus:
            (raw.rsvpStatus as UpsertCalendarParticipantInput['rsvpStatus']) ??
            CALENDAR_RSVP_STATUS.PENDING,
          responseNote: raw.responseNote ?? null,
        });
      }
    }

    return result;
  }

  private async enforceConflictPolicy(params: {
    startAt: Date;
    endAt: Date;
    recurrenceRule: ReturnType<typeof parseRecurrenceRule>;
    ownerUserId: number;
    resourceCode: string | null;
    participants: readonly UpsertCalendarParticipantInput[];
    organizationUnitId: number | null;
    excludeEventId?: number | undefined;
    allowConflictOverride: boolean;
    strictConflictCheck: boolean;
  }): Promise<void> {
    if (params.allowConflictOverride) return;

    const blockOnResource = defaultSettingRegistry.getBoolean(
      CALENDAR_SETTING_KEYS.BLOCK_ON_RESOURCE_CONFLICT,
      { organizationUnitId: params.organizationUnitId },
      true,
    );
    const blockOnParticipant = defaultSettingRegistry.getBoolean(
      CALENDAR_SETTING_KEYS.BLOCK_ON_PARTICIPANT_CONFLICT,
      { organizationUnitId: params.organizationUnitId },
      false,
    );

    if (!params.strictConflictCheck && !blockOnResource && !blockOnParticipant) {
      return;
    }

    const participantUserIds = params.participants
      .filter((p) => p.participantType === CALENDAR_PARTICIPANT_TYPE.USER && p.userId)
      .map((p) => Number(p.userId));
    const participantOrgUnitIds = params.participants
      .filter(
        (p) =>
          p.participantType === CALENDAR_PARTICIPANT_TYPE.ORGANIZATION_UNIT && p.organizationUnitId,
      )
      .map((p) => Number(p.organizationUnitId));

    const checkResult = await checkCalendarScheduleConflicts({
      input: {
        startAt: params.startAt,
        endAt: params.endAt,
        recurrenceRule: params.recurrenceRule,
        ownerUserId: params.ownerUserId,
        resourceCode: params.resourceCode,
        participantUserIds,
        participantOrganizationUnitIds: participantOrgUnitIds,
        excludeEventId: params.excludeEventId ?? null,
      },
      eventRepository: this.eventRepository,
      participantRepository: this.participantRepository,
      usersPublicService: this.usersPublicService,
      organizationsPublicService: this.organizationsPublicService,
    });

    if (!checkResult.hasConflict) return;

    const shouldBlock =
      params.strictConflictCheck ||
      (blockOnResource && checkResult.resourceConflictCount > 0) ||
      (blockOnParticipant && checkResult.participantConflictCount > 0);

    if (shouldBlock) {
      throw new ConflictAppException('calendar.scheduleConflictDetected', [], {
        conflictCount: checkResult.conflicts.length,
        details: checkResult.conflicts.map((c) => c.message).join('; '),
      });
    }
  }

  private async syncWithExternalProvidersInternal(
    event: Awaited<ReturnType<CalendarEventRepository['findById']>> & object,
    providers: readonly CalendarExternalProvider[],
    calendarIdOverride?: string | null,
  ): Promise<CalendarExternalBindingsMap> {
    const bindings = parseExternalBindings(event.externalBindingsJson);
    const payloadBase: Omit<CalendarExternalSyncEventPayload, 'existingBinding'> = {
      eventId: Number(event.id),
      eventCode: event.code,
      title: event.title,
      description: event.description ?? null,
      startAt: new Date(event.startAt),
      endAt: new Date(event.endAt),
      timezone: event.timezone,
      isAllDay: Boolean(event.isAllDay),
      location: event.location ?? null,
      meetingUrl: event.meetingUrl ?? null,
      recurrenceRule: parseRecurrenceRule(event.recurrenceRuleJson),
      calendarIdOverride: calendarIdOverride ?? null,
    };

    for (const provider of providers) {
      const adapter = this.adapterRegistry.getAdapter(provider);
      const existing = bindings[provider];
      const synced = await adapter.syncEventUpsert(
        {
          ...payloadBase,
          ...(existing ? { existingBinding: existing } : {}),
        },
        event.organizationUnitId ?? null,
      );
      bindings[provider] = synced;
    }

    event.externalBindingsJson = JSON.stringify(bindings);
    await this.eventRepository.saveEntity(event);
    return bindings;
  }

  private async syncCancelWithExternalProvidersInternal(
    event: Awaited<ReturnType<CalendarEventRepository['findById']>> & object,
    providers: readonly CalendarExternalProvider[],
  ): Promise<void> {
    const bindings = parseExternalBindings(event.externalBindingsJson);
    for (const provider of providers) {
      const adapter = this.adapterRegistry.getAdapter(provider);
      if (!adapter.isEnabled(event.organizationUnitId ?? null)) continue;
      const existing = bindings[provider];
      const cancelled = await adapter.syncEventCancel(
        {
          eventId: Number(event.id),
          eventCode: event.code,
          title: event.title,
          description: event.description ?? null,
          startAt: new Date(event.startAt),
          endAt: new Date(event.endAt),
          timezone: event.timezone,
          isAllDay: Boolean(event.isAllDay),
          location: event.location ?? null,
          meetingUrl: event.meetingUrl ?? null,
          recurrenceRule: parseRecurrenceRule(event.recurrenceRuleJson),
          ...(existing ? { existingBinding: existing } : {}),
        },
        event.organizationUnitId ?? null,
      );
      bindings[provider] = cancelled;
    }
    event.externalBindingsJson = JSON.stringify(bindings);
    await this.eventRepository.saveEntity(event);
  }

  private async generateEventCode(organizationUnitId?: number | null): Promise<string> {
    const generated = await this.effectiveSequenceRegistry.nextCode(
      CALENDAR_SEQUENCE_KEYS.EVENT_CODE,
      {
        organizationUnitId: organizationUnitId ?? null,
      },
    );
    return generated.code;
  }
}
