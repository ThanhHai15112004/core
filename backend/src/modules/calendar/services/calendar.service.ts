import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
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
import { CalendarProviderAdapterRegistry } from '../adapters/calendar-provider.adapters.js';
import {
  CALENDAR_AUDIT_META,
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_EVENT_TYPE,
  CALENDAR_HISTORY_ACTION_TYPE,
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
import { CalendarEventParticipantRepository } from '../repositories/calendar-event-participant.repository.js';
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
import { CalendarCollaborationService } from './calendar-collaboration.service.js';

@Injectable()
export class CalendarService implements ICalendarPublicService {
  private readonly effectiveDataScopeService: DataScopeService;
  private readonly effectiveSequenceRegistry: SequenceRegistryService;
  private readonly adapterRegistry: CalendarProviderAdapterRegistry;
  private readonly collaborationService: CalendarCollaborationService;

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
    @Optional()
    collaborationService?: CalendarCollaborationService | null,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();
    this.effectiveSequenceRegistry = this.sequenceRegistry ?? defaultSequenceRegistry;
    this.adapterRegistry = new CalendarProviderAdapterRegistry();
    this.collaborationService =
      collaborationService ??
      new CalendarCollaborationService(
        this.eventRepository,
        this.participantRepository,
        this.reminderRepository,
        this.historyRepository,
        this.usersPublicService,
        this.organizationsPublicService,
      );
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
    const normalizedParticipants = this.collaborationService.normalizeParticipantInputs(
      dto.participants ?? [],
    );

    const ownerUserId = Number(dto.ownerUserId ?? actor?.id ?? 1);
    const orgUnitId =
      dto.organizationUnitId !== undefined
        ? dto.organizationUnitId
        : (actor?.organizationUnitIds?.[0] ?? null);

    await this.collaborationService.enforceConflictPolicy({
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
      await this.collaborationService.syncWithExternalProvidersInternal(
        createdEvent,
        dto.syncProviders,
        this.adapterRegistry,
      );
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
        ? this.collaborationService.normalizeParticipantInputs(dto.participants)
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

    await this.collaborationService.enforceConflictPolicy({
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
      await this.collaborationService.syncWithExternalProvidersInternal(
        updatedEvent,
        [...providersToSync],
        this.adapterRegistry,
      );
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
    return this.collaborationService.addOrUpdateParticipants(id, dto, actor, (evId, act) =>
      this.getEventById(evId, act),
    );
  }

  public async removeParticipant(
    id: number,
    participantId: number,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    return this.collaborationService.removeParticipant(id, participantId, actor, (evId, act) =>
      this.getEventById(evId, act),
    );
  }

  public async updateParticipantRsvp(
    id: number,
    dto: UpdateCalendarRsvpRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    return this.collaborationService.updateParticipantRsvp(id, dto, actor, (evId, act) =>
      this.getEventById(evId, act),
    );
  }

  public async cancelEvent(
    id: number,
    dto: CancelCalendarEventRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    return this.collaborationService.cancelEvent(
      id,
      dto,
      actor,
      this.adapterRegistry,
      (evId, act) => this.getEventById(evId, act),
    );
  }

  public async syncEventWithExternalProviders(
    id: number,
    dto: SyncCalendarExternalRequest,
    actor?: UserIdentity,
  ): Promise<CalendarExternalSyncResultView> {
    return this.collaborationService.syncEventWithExternalProviders(
      id,
      dto,
      actor,
      this.adapterRegistry,
    );
  }

  public async handleInboundExternalSync(
    provider: CalendarExternalProvider,
    dto: InboundExternalCalendarSyncRequest,
    actor?: UserIdentity,
  ): Promise<CalendarEventDetailView> {
    return this.collaborationService.handleInboundExternalSync(
      provider,
      dto,
      actor,
      this.adapterRegistry,
      (evId, act) => this.getEventById(evId, act),
    );
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
