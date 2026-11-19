import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
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
  CALENDAR_CHANGE_SOURCE,
  CALENDAR_EVENT_STATUS,
  CALENDAR_HISTORY_ACTION_TYPE,
  CALENDAR_PARTICIPANT_ROLE,
  CALENDAR_PARTICIPANT_TYPE,
  CALENDAR_RSVP_STATUS,
  CALENDAR_SETTING_KEYS,
  type CalendarEventDetailView,
  type CalendarExternalBindingsMap,
  type CalendarExternalProvider,
  type CalendarExternalSyncResultView,
} from '../contracts/index.js';
import { checkCalendarScheduleConflicts } from '../helpers/calendar-conflict.helper.js';
import {
  buildEventSnapshot,
  computeChangedFields,
  parseExternalBindings,
} from '../helpers/calendar-hydration.helper.js';
import {
  assertCanEditCalendarEvent,
  evaluateCalendarEventAccess,
} from '../helpers/calendar-permission.helper.js';
import { parseRecurrenceRule } from '../helpers/calendar-recurrence.helper.js';
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
  InboundExternalCalendarSyncRequest,
  SyncCalendarExternalRequest,
  UpdateCalendarRsvpRequest,
} from '../requests/calendar.requests.js';

@Injectable()
export class CalendarCollaborationService {
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
  ) {}

  public async addOrUpdateParticipants(
    id: number,
    dto: AddCalendarParticipantsRequest,
    actor: UserIdentity | undefined,
    getEventByIdFn: (id: number, actor?: UserIdentity) => Promise<CalendarEventDetailView>,
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

    return getEventByIdFn(Number(event.id), actor);
  }

  public async removeParticipant(
    id: number,
    participantId: number,
    actor: UserIdentity | undefined,
    getEventByIdFn: (id: number, actor?: UserIdentity) => Promise<CalendarEventDetailView>,
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

    return getEventByIdFn(Number(event.id), actor);
  }

  public async updateParticipantRsvp(
    id: number,
    dto: UpdateCalendarRsvpRequest,
    actor: UserIdentity | undefined,
    getEventByIdFn: (id: number, actor?: UserIdentity) => Promise<CalendarEventDetailView>,
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

    return getEventByIdFn(Number(event.id), actor);
  }

  public async cancelEvent(
    id: number,
    dto: CancelCalendarEventRequest,
    actor: UserIdentity | undefined,
    adapterRegistry: CalendarProviderAdapterRegistry,
    getEventByIdFn: (id: number, actor?: UserIdentity) => Promise<CalendarEventDetailView>,
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
      await this.syncCancelWithExternalProvidersInternal(
        savedEvent,
        boundProviders,
        adapterRegistry,
      );
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

    return getEventByIdFn(Number(savedEvent.id), actor);
  }

  public async syncEventWithExternalProviders(
    id: number,
    dto: SyncCalendarExternalRequest,
    actor: UserIdentity | undefined,
    adapterRegistry: CalendarProviderAdapterRegistry,
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
      adapterRegistry,
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
    actor: UserIdentity | undefined,
    adapterRegistry: CalendarProviderAdapterRegistry,
    getEventByIdFn: (id: number, actor?: UserIdentity) => Promise<CalendarEventDetailView>,
  ): Promise<CalendarEventDetailView> {
    const adapter = adapterRegistry.getAdapter(provider);
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

    return getEventByIdFn(Number(saved.id), actor);
  }

  public normalizeParticipantInputs(
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

  public async enforceConflictPolicy(params: {
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

  public async syncWithExternalProvidersInternal(
    event: Awaited<ReturnType<CalendarEventRepository['findById']>> & object,
    providers: readonly CalendarExternalProvider[],
    adapterRegistry: CalendarProviderAdapterRegistry,
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
      const adapter = adapterRegistry.getAdapter(provider);
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

  public async syncCancelWithExternalProvidersInternal(
    event: Awaited<ReturnType<CalendarEventRepository['findById']>> & object,
    providers: readonly CalendarExternalProvider[],
    adapterRegistry: CalendarProviderAdapterRegistry,
  ): Promise<void> {
    const bindings = parseExternalBindings(event.externalBindingsJson);
    for (const provider of providers) {
      const adapter = adapterRegistry.getAdapter(provider);
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
}
