import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  parseNumericUserId,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  NOTIFICATIONS_AUDIT_META,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  getNotificationChannelName,
  parseNotificationCategory,
  parseNotificationChannel,
  type NotificationChannelCode,
  type NotificationDocumentFormatName,
} from '../contracts/index.js';
import type { NotificationTemplateEntity } from '../entities/notification-template.entity.js';
import type { NotificationsMapper } from '../mappers/notifications.mapper.js';
import type { NotificationChannelsRepository } from '../repositories/notification-channels.repository.js';
import type {
  CreateNotificationTemplateVersionRequest,
  PreviewNotificationTemplateRequest,
  PublishNotificationTemplateVersionRequest,
  RegisterNotificationTemplateUsageRequest,
  RenderDocumentFromTemplateRequest,
  RollbackNotificationTemplateVersionRequest,
  UpsertNotificationTemplateRequest,
} from '../requests/notifications.requests.js';
import type {
  NotificationTemplateItemResponse,
  NotificationTemplatePreviewResponse,
  NotificationTemplateUsageItemResponse,
  NotificationTemplateVersionItemResponse,
  RenderedDocumentFromTemplateResponse,
  TemplateVersionMutationResultResponse,
} from '../responses/notifications.response.js';
import { calculateSmsSegments } from './notification-delivery-policy.helper.js';
import {
  DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES,
  DEFAULT_SYSTEM_TEMPLATE_USAGES,
  buildRenderedDocumentPayload,
  extractTemplateVariables,
  normalizeDocumentFormat,
  renderNotificationTemplateContent,
  resolveTemplateTypeAndFormat,
} from './notification-template.helper.js';

export type AuditRecorderFn = (
  actor: UserIdentity | undefined,
  action: string,
  resourceType: string,
  resourceId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
) => Promise<void>;

export async function enrichTemplateItemsView(params: {
  entities: readonly NotificationTemplateEntity[];
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
}): Promise<NotificationTemplateItemResponse[]> {
  const { entities, channelsRepo, mapper } = params;
  if (entities.length === 0) return [];

  const ids = entities.map((e) => Number(e.id)).filter((id) => id > 0);
  const codes = [...new Set(entities.map((e) => e.code.trim().toUpperCase()))];

  const [allVersions, dbUsages, siblingTemplates] = await Promise.all([
    channelsRepo.findTemplateVersionsByTemplateIds
      ? channelsRepo.findTemplateVersionsByTemplateIds(ids)
      : Promise.resolve([]),
    channelsRepo.findTemplateUsagesByCodes
      ? channelsRepo.findTemplateUsagesByCodes(codes)
      : Promise.resolve([]),
    channelsRepo.findTemplatesByCodes
      ? channelsRepo.findTemplatesByCodes(codes)
      : Promise.resolve([]),
  ]);

  const draftVersionByTplId = new Map<number, number>();
  for (const v of allVersions) {
    if (String(v.status).toUpperCase() === NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT) {
      const tplId = Number(v.templateId);
      const curr = draftVersionByTplId.get(tplId) ?? 0;
      if (Number(v.version) > curr) {
        draftVersionByTplId.set(tplId, Number(v.version));
      }
    }
  }

  const localesByCodeChannel = new Map<string, Set<string>>();
  for (const t of [...entities, ...siblingTemplates]) {
    const key = `${t.code.trim().toUpperCase()}:${Number(t.channel)}`;
    const set = localesByCodeChannel.get(key) ?? new Set<string>();
    set.add((t.locale || 'vi').trim().toLowerCase());
    localesByCodeChannel.set(key, set);
  }
  for (const seed of DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES) {
    const key = `${seed.code}:${seed.channel}`;
    const set = localesByCodeChannel.get(key);
    if (set) {
      set.add(seed.locale);
    }
  }

  return entities.map((entity) => {
    const cleanCode = entity.code.trim().toUpperCase();
    const ch = Number(entity.channel);
    const matchingDbUsages = dbUsages.filter(
      (u) =>
        u.templateCode.trim().toUpperCase() === cleanCode &&
        (u.channel === null || u.channel === undefined || Number(u.channel) === ch),
    );
    const matchingSeedUsages = DEFAULT_SYSTEM_TEMPLATE_USAGES.filter(
      (u) =>
        u.templateCode === cleanCode &&
        (u.channel === null || u.channel === undefined || u.channel === ch),
    );
    const modulesSet = new Set<string>([
      ...matchingDbUsages.map((u) => u.moduleName.trim().toLowerCase()),
      ...matchingSeedUsages.map((u) => u.moduleName.trim().toLowerCase()),
    ]);
    const usageCount = Math.max(
      matchingDbUsages.length,
      matchingSeedUsages.length,
      modulesSet.size,
    );
    const localesSet = localesByCodeChannel.get(`${cleanCode}:${ch}`);

    return mapper.toTemplateItemView(entity, {
      latestDraftVersion: draftVersionByTplId.get(Number(entity.id)) ?? null,
      usedByModules: [...modulesSet],
      usageCount,
      availableLocales: localesSet ? [...localesSet] : [entity.locale || 'vi'],
    });
  });
}

async function ensureBaselineVersionSnapshot(
  template: NotificationTemplateEntity,
  channelsRepo: NotificationChannelsRepository,
): Promise<void> {
  if (!channelsRepo.findTemplateVersions || !channelsRepo.saveTemplateVersion) return;
  const existingVersions = await channelsRepo.findTemplateVersions(Number(template.id));
  const currentVer = Number(template.version ?? 1);
  const hasCurrent = existingVersions.some((v) => Number(v.version) === currentVer);
  if (!hasCurrent) {
    const { channel, templateType, documentFormat } = resolveTemplateTypeAndFormat({
      channel: parseNotificationChannel(template.channel),
      templateType: template.templateType,
      documentFormat: template.documentFormat,
    });
    await channelsRepo.saveTemplateVersion({
      templateId: Number(template.id),
      code: template.code,
      channel,
      locale: template.locale || 'vi',
      version: currentVer,
      status: template.status || NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
      name: template.name,
      templateType,
      documentFormat,
      subjectTemplate: template.subjectTemplate ?? null,
      bodyTemplate: template.bodyTemplate,
      htmlTemplate: template.htmlTemplate ?? null,
      variablesJson: template.variablesJson ?? '[]',
      changeNote: 'Initial baseline version',
      createdByUserId: template.publishedByUserId ?? null,
      publishedAt: template.publishedAt ?? template.createdAt ?? new Date(),
      publishedByUserId: template.publishedByUserId ?? null,
    });
  }
}

export async function executeUpsertVersionedTemplate(params: {
  input: UpsertNotificationTemplateRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
  recordAudit: AuditRecorderFn;
}): Promise<NotificationTemplateItemResponse> {
  const { input, actor, channelsRepo, mapper, recordAudit } = params;
  const actorUserId = parseNumericUserId(actor?.id) ?? null;
  const code = input.code.trim().toUpperCase();
  const rawChannelInput =
    input.channel !== undefined
      ? parseNotificationChannel(input.channel)
      : input.templateType === NOTIFICATION_TEMPLATE_TYPE.DOCUMENT
        ? NOTIFICATION_CHANNEL.DOCUMENT
        : NOTIFICATION_CHANNEL.EMAIL;

  const { channel, templateType, documentFormat } = resolveTemplateTypeAndFormat({
    channel: rawChannelInput,
    templateType: input.templateType,
    documentFormat: input.documentFormat,
  });

  const category =
    input.category !== undefined
      ? parseNotificationCategory(input.category)
      : NOTIFICATION_CATEGORY.SYSTEM;
  const locale = input.locale?.trim().toLowerCase() || 'vi';

  const autoVariables = [
    ...new Set([
      ...(input.variables ?? []),
      ...extractTemplateVariables(input.subjectTemplate),
      ...extractTemplateVariables(input.bodyTemplate),
      ...extractTemplateVariables(input.htmlTemplate),
    ]),
  ];
  const variablesJson = JSON.stringify(autoVariables);
  const now = new Date();

  const existing = channelsRepo.findExactTemplateByCodeChannelLocale
    ? await channelsRepo.findExactTemplateByCodeChannelLocale(code, channel, locale)
    : null;

  // 1. Nếu mẫu đã tồn tại và đang dùng (PUBLISHED) và người gọi KHÔNG truyền autoPublish = true:
  //    -> Tạo phiên bản mới ở trạng thái DRAFT, KHÔNG sửa trực tiếp bản đang dùng!
  if (
    existing &&
    existing.isActive &&
    input.autoPublish !== true &&
    channelsRepo.findTemplateVersions &&
    channelsRepo.saveTemplateVersion
  ) {
    await ensureBaselineVersionSnapshot(existing, channelsRepo);
    const versions = await channelsRepo.findTemplateVersions(Number(existing.id));
    const maxVer = versions.reduce(
      (max, v) => Math.max(max, Number(v.version ?? 1)),
      Number(existing.version ?? 1),
    );
    const nextVersion = maxVer + 1;

    await channelsRepo.saveTemplateVersion({
      templateId: Number(existing.id),
      code,
      channel,
      locale,
      version: nextVersion,
      status: NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT,
      name: input.name.trim(),
      templateType,
      documentFormat,
      subjectTemplate: input.subjectTemplate?.trim() || null,
      bodyTemplate: input.bodyTemplate.trim(),
      htmlTemplate: input.htmlTemplate?.trim() || null,
      variablesJson,
      changeNote:
        input.changeNote?.trim() ||
        `Tạo bản nháp v${nextVersion} (giữ nguyên bản đang chạy v${existing.publishedVersion ?? existing.version ?? 1})`,
      createdByUserId: actorUserId,
      publishedAt: null,
      publishedByUserId: null,
    });

    await recordAudit(
      actor,
      'CREATE_NOTIFICATION_TEMPLATE_DRAFT_VERSION',
      NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_VERSION,
      `${existing.id}:v${nextVersion}`,
      {
        templateId: existing.id,
        publishedVersion: existing.publishedVersion ?? existing.version ?? 1,
        bodyTemplate: existing.bodyTemplate,
      },
      {
        templateId: existing.id,
        code,
        channel,
        locale,
        draftVersion: nextVersion,
        status: NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT,
      },
    );

    const [enriched] = await enrichTemplateItemsView({
      entities: [existing],
      channelsRepo,
      mapper,
    });
    return enriched!;
  }

  // 2. Tạo mẫu mới lần đầu (v1) hoặc cập nhật có autoPublish = true
  let targetVersion = 1;
  if (existing && channelsRepo.findTemplateVersions) {
    await ensureBaselineVersionSnapshot(existing, channelsRepo);
    const versions = await channelsRepo.findTemplateVersions(Number(existing.id));
    const maxVer = versions.reduce(
      (max, v) => Math.max(max, Number(v.version ?? 1)),
      Number(existing.version ?? 1),
    );
    targetVersion = maxVer + 1;

    if (channelsRepo.saveTemplateVersion) {
      for (const v of versions) {
        if (String(v.status).toUpperCase() === NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED) {
          await channelsRepo.saveTemplateVersion({
            ...v,
            templateId: Number(existing.id),
            code: v.code,
            channel: Number(v.channel),
            locale: v.locale,
            version: Number(v.version),
            status: NOTIFICATION_TEMPLATE_VERSION_STATUS.ARCHIVED,
          });
        }
      }
    }
  }

  const isDraft = Boolean(input.saveAsDraft) && !existing;
  const status = isDraft
    ? NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT
    : NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED;

  const saved = await channelsRepo.upsertTemplate({
    code,
    name: input.name.trim(),
    channel,
    category,
    locale,
    templateType,
    documentFormat,
    version: targetVersion,
    publishedVersion: isDraft ? 0 : targetVersion,
    status,
    publishedAt: isDraft ? null : now,
    publishedByUserId: isDraft ? null : actorUserId,
    subjectTemplate: input.subjectTemplate?.trim() || null,
    bodyTemplate: input.bodyTemplate.trim(),
    htmlTemplate: input.htmlTemplate?.trim() || null,
    variablesJson,
    isActive: isDraft ? false : (input.isActive ?? true),
    organizationUnitId: input.organizationUnitId ?? null,
  });

  if (channelsRepo.saveTemplateVersion) {
    await channelsRepo.saveTemplateVersion({
      templateId: Number(saved.id),
      code,
      channel,
      locale,
      version: targetVersion,
      status,
      name: saved.name,
      templateType,
      documentFormat,
      subjectTemplate: saved.subjectTemplate ?? null,
      bodyTemplate: saved.bodyTemplate,
      htmlTemplate: saved.htmlTemplate ?? null,
      variablesJson,
      changeNote: input.changeNote?.trim() || `Khởi tạo phiên bản v${targetVersion}`,
      createdByUserId: actorUserId,
      publishedAt: isDraft ? null : now,
      publishedByUserId: isDraft ? null : actorUserId,
    });
  }

  await recordAudit(
    actor,
    'UPSERT_NOTIFICATION_TEMPLATE',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE,
    String(saved.id),
    existing
      ? {
          version: existing.version,
          subjectTemplate: existing.subjectTemplate,
          bodyTemplate: existing.bodyTemplate,
        }
      : null,
    { code, channel, locale, templateType, version: targetVersion, status },
  );

  const [enriched] = await enrichTemplateItemsView({
    entities: [saved],
    channelsRepo,
    mapper,
  });
  return enriched!;
}

export async function executeListTemplateVersions(params: {
  templateId: number;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
}): Promise<NotificationTemplateVersionItemResponse[]> {
  const { templateId, channelsRepo, mapper } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }
  await ensureBaselineVersionSnapshot(template, channelsRepo);
  const versions = channelsRepo.findTemplateVersions
    ? await channelsRepo.findTemplateVersions(templateId)
    : [];
  return versions.map((v) => mapper.toTemplateVersionItemView(v));
}

export async function executeCreateTemplateVersion(params: {
  templateId: number;
  input: CreateNotificationTemplateVersionRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
  recordAudit: AuditRecorderFn;
}): Promise<NotificationTemplateVersionItemResponse> {
  const { templateId, input, actor, channelsRepo, mapper, recordAudit } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }

  await ensureBaselineVersionSnapshot(template, channelsRepo);
  const versions = await channelsRepo.findTemplateVersions(templateId);
  const maxVer = versions.reduce(
    (max, v) => Math.max(max, Number(v.version ?? 1)),
    Number(template.version ?? 1),
  );
  const nextVersion = maxVer + 1;
  const actorUserId = parseNumericUserId(actor?.id) ?? null;

  const { channel, templateType, documentFormat } = resolveTemplateTypeAndFormat({
    channel: parseNotificationChannel(template.channel),
    templateType: template.templateType,
    documentFormat: input.documentFormat ?? template.documentFormat,
  });

  const subjectTemplate =
    input.subjectTemplate !== undefined
      ? input.subjectTemplate?.trim() || null
      : (template.subjectTemplate ?? null);
  const bodyTemplate = input.bodyTemplate.trim();
  const htmlTemplate =
    input.htmlTemplate !== undefined
      ? input.htmlTemplate?.trim() || null
      : (template.htmlTemplate ?? null);

  const autoVariables = [
    ...new Set([
      ...(input.variables ?? []),
      ...extractTemplateVariables(subjectTemplate),
      ...extractTemplateVariables(bodyTemplate),
      ...extractTemplateVariables(htmlTemplate),
    ]),
  ];

  const createdVersion = await channelsRepo.saveTemplateVersion({
    templateId,
    code: template.code,
    channel,
    locale: template.locale || 'vi',
    version: nextVersion,
    status: NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT,
    name: input.name?.trim() || template.name,
    templateType,
    documentFormat,
    subjectTemplate,
    bodyTemplate,
    htmlTemplate,
    variablesJson: JSON.stringify(autoVariables),
    changeNote: input.changeNote?.trim() || `Phiên bản nháp v${nextVersion}`,
    createdByUserId: actorUserId,
    publishedAt: null,
    publishedByUserId: null,
  });

  await recordAudit(
    actor,
    'CREATE_NOTIFICATION_TEMPLATE_VERSION',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_VERSION,
    `${templateId}:v${nextVersion}`,
    {
      activePublishedVersion: template.publishedVersion ?? template.version ?? 1,
    },
    {
      templateId,
      code: template.code,
      locale: template.locale,
      version: nextVersion,
      status: NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT,
      changeNote: createdVersion.changeNote,
    },
  );

  if (input.autoPublish) {
    const published = await executePublishTemplateVersion({
      templateId,
      input: { version: nextVersion, changeNote: input.changeNote ?? null },
      actor,
      channelsRepo,
      mapper,
      recordAudit,
    });
    return published.activeVersion;
  }

  return mapper.toTemplateVersionItemView(createdVersion);
}

export async function executePublishTemplateVersion(params: {
  templateId: number;
  input: PublishNotificationTemplateVersionRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
  recordAudit: AuditRecorderFn;
}): Promise<TemplateVersionMutationResultResponse> {
  const { templateId, input, actor, channelsRepo, mapper, recordAudit } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }

  await ensureBaselineVersionSnapshot(template, channelsRepo);
  const targetVer = await channelsRepo.findTemplateVersionByNumber(templateId, input.version);
  if (!targetVer) {
    throw new NotFoundAppException('notifications.templateVersionNotFound', {
      templateId,
      version: input.version,
    });
  }

  const previousPublishedVersion = Number(template.publishedVersion ?? template.version ?? 1);
  const beforeData = {
    templateId,
    code: template.code,
    locale: template.locale,
    publishedVersion: previousPublishedVersion,
    subjectTemplate: template.subjectTemplate ?? null,
    bodyTemplate: template.bodyTemplate,
  };

  const allVersions = await channelsRepo.findTemplateVersions(templateId);
  for (const v of allVersions) {
    if (
      Number(v.version) !== Number(targetVer.version) &&
      String(v.status).toUpperCase() === NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED
    ) {
      await channelsRepo.saveTemplateVersion({
        ...v,
        templateId,
        code: v.code,
        channel: Number(v.channel),
        locale: v.locale,
        version: Number(v.version),
        status: NOTIFICATION_TEMPLATE_VERSION_STATUS.ARCHIVED,
      });
    }
  }

  const now = new Date();
  const actorUserId = parseNumericUserId(actor?.id) ?? null;
  const publishedVerEntity = await channelsRepo.saveTemplateVersion({
    ...targetVer,
    templateId,
    code: targetVer.code,
    channel: Number(targetVer.channel),
    locale: targetVer.locale,
    version: Number(targetVer.version),
    status: NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
    changeNote:
      input.changeNote?.trim() || targetVer.changeNote || `Phát hành v${targetVer.version}`,
    publishedAt: now,
    publishedByUserId: actorUserId,
  });

  const updatedTemplate = await channelsRepo.upsertTemplate({
    code: template.code,
    channel: Number(template.channel),
    locale: template.locale,
    name: publishedVerEntity.name,
    templateType: publishedVerEntity.templateType,
    documentFormat: publishedVerEntity.documentFormat ?? null,
    version: Number(publishedVerEntity.version),
    publishedVersion: Number(publishedVerEntity.version),
    status: NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
    publishedAt: now,
    publishedByUserId: actorUserId,
    subjectTemplate: publishedVerEntity.subjectTemplate ?? null,
    bodyTemplate: publishedVerEntity.bodyTemplate,
    htmlTemplate: publishedVerEntity.htmlTemplate ?? null,
    variablesJson: publishedVerEntity.variablesJson ?? '[]',
    isActive: true,
  });

  await recordAudit(
    actor,
    'PUBLISH_NOTIFICATION_TEMPLATE_VERSION',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_VERSION,
    `${templateId}:v${publishedVerEntity.version}`,
    beforeData,
    {
      templateId,
      code: template.code,
      locale: template.locale,
      publishedVersion: Number(publishedVerEntity.version),
      subjectTemplate: publishedVerEntity.subjectTemplate ?? null,
      bodyTemplate: publishedVerEntity.bodyTemplate,
      changeNote: publishedVerEntity.changeNote,
    },
  );

  const [enrichedTemplate] = await enrichTemplateItemsView({
    entities: [updatedTemplate],
    channelsRepo,
    mapper,
  });

  return {
    template: enrichedTemplate!,
    activeVersion: mapper.toTemplateVersionItemView(publishedVerEntity),
    previousPublishedVersion,
    action: 'PUBLISHED',
    auditRecorded: true,
  };
}

export async function executeRollbackTemplateVersion(params: {
  templateId: number;
  input: RollbackNotificationTemplateVersionRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
  recordAudit: AuditRecorderFn;
}): Promise<TemplateVersionMutationResultResponse> {
  const { templateId, input, actor, channelsRepo, mapper, recordAudit } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }

  await ensureBaselineVersionSnapshot(template, channelsRepo);
  const targetVer = await channelsRepo.findTemplateVersionByNumber(templateId, input.targetVersion);
  if (!targetVer) {
    throw new NotFoundAppException('notifications.templateVersionNotFound', {
      templateId,
      version: input.targetVersion,
    });
  }

  const previousPublishedVersion = Number(template.publishedVersion ?? template.version ?? 1);
  const beforeData = {
    templateId,
    code: template.code,
    locale: template.locale,
    publishedVersion: previousPublishedVersion,
    subjectTemplate: template.subjectTemplate ?? null,
    bodyTemplate: template.bodyTemplate,
  };

  const allVersions = await channelsRepo.findTemplateVersions(templateId);
  for (const v of allVersions) {
    if (
      Number(v.version) !== Number(targetVer.version) &&
      String(v.status).toUpperCase() === NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED
    ) {
      await channelsRepo.saveTemplateVersion({
        ...v,
        templateId,
        code: v.code,
        channel: Number(v.channel),
        locale: v.locale,
        version: Number(v.version),
        status: NOTIFICATION_TEMPLATE_VERSION_STATUS.ARCHIVED,
      });
    }
  }

  const now = new Date();
  const actorUserId = parseNumericUserId(actor?.id) ?? null;
  const rollbackNote =
    input.reason?.trim() || `Rollback từ v${previousPublishedVersion} về v${targetVer.version}`;

  const restoredVerEntity = await channelsRepo.saveTemplateVersion({
    ...targetVer,
    templateId,
    code: targetVer.code,
    channel: Number(targetVer.channel),
    locale: targetVer.locale,
    version: Number(targetVer.version),
    status: NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
    changeNote: rollbackNote,
    publishedAt: now,
    publishedByUserId: actorUserId,
  });

  const updatedTemplate = await channelsRepo.upsertTemplate({
    code: template.code,
    channel: Number(template.channel),
    locale: template.locale,
    name: restoredVerEntity.name,
    templateType: restoredVerEntity.templateType,
    documentFormat: restoredVerEntity.documentFormat ?? null,
    version: Number(restoredVerEntity.version),
    publishedVersion: Number(restoredVerEntity.version),
    status: NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED,
    publishedAt: now,
    publishedByUserId: actorUserId,
    subjectTemplate: restoredVerEntity.subjectTemplate ?? null,
    bodyTemplate: restoredVerEntity.bodyTemplate,
    htmlTemplate: restoredVerEntity.htmlTemplate ?? null,
    variablesJson: restoredVerEntity.variablesJson ?? '[]',
    isActive: true,
  });

  await recordAudit(
    actor,
    'ROLLBACK_NOTIFICATION_TEMPLATE_VERSION',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_VERSION,
    `${templateId}:v${restoredVerEntity.version}`,
    beforeData,
    {
      templateId,
      code: template.code,
      locale: template.locale,
      rolledBackFromVersion: previousPublishedVersion,
      rolledBackToVersion: Number(restoredVerEntity.version),
      reason: rollbackNote,
      subjectTemplate: restoredVerEntity.subjectTemplate ?? null,
      bodyTemplate: restoredVerEntity.bodyTemplate,
    },
  );

  const [enrichedTemplate] = await enrichTemplateItemsView({
    entities: [updatedTemplate],
    channelsRepo,
    mapper,
  });

  return {
    template: enrichedTemplate!,
    activeVersion: mapper.toTemplateVersionItemView(restoredVerEntity),
    previousPublishedVersion,
    action: 'ROLLED_BACK',
    auditRecorded: true,
  };
}

export async function executePreviewTemplate(params: {
  input: PreviewNotificationTemplateRequest;
  channelsRepo: NotificationChannelsRepository;
  resolveTemplateByCode: (
    code: string,
    channel: NotificationChannelCode,
    locale?: string,
  ) => Promise<{
    readonly code: string;
    readonly subjectTemplate: string | null;
    readonly bodyTemplate: string;
    readonly htmlTemplate: string | null;
  } | null>;
}): Promise<NotificationTemplatePreviewResponse> {
  const { input, channelsRepo, resolveTemplateByCode } = params;
  let channel =
    input.channel !== undefined
      ? parseNotificationChannel(input.channel)
      : NOTIFICATION_CHANNEL.EMAIL;
  let locale = input.locale?.trim().toLowerCase() || 'vi';
  let subjectTemplate = input.subjectTemplate ?? null;
  let bodyTemplate = input.bodyTemplate ?? '';
  let htmlTemplate = input.htmlTemplate ?? null;
  let code = input.templateCode?.trim().toUpperCase() || null;
  let versionUsed: number | null = input.version ?? null;
  const declaredVariables: string[] = [...(input.declaredVariables ?? [])];
  let rawTemplateType: string | null = null;
  let rawDocFormat: string | null = null;

  if (input.templateId) {
    const tpl = await channelsRepo.findTemplateById(input.templateId);
    if (!tpl) {
      throw new NotFoundAppException('notifications.templateNotFound', { id: input.templateId });
    }
    code = tpl.code;
    channel = parseNotificationChannel(tpl.channel);
    locale = tpl.locale || locale;
    rawTemplateType = tpl.templateType ?? null;
    rawDocFormat = tpl.documentFormat ?? null;

    if (input.version && channelsRepo.findTemplateVersionByNumber) {
      await ensureBaselineVersionSnapshot(tpl, channelsRepo);
      const ver = await channelsRepo.findTemplateVersionByNumber(input.templateId, input.version);
      if (!ver) {
        throw new NotFoundAppException('notifications.templateVersionNotFound', {
          templateId: input.templateId,
          version: input.version,
        });
      }
      subjectTemplate = subjectTemplate ?? ver.subjectTemplate ?? null;
      bodyTemplate = bodyTemplate || ver.bodyTemplate;
      htmlTemplate = htmlTemplate ?? ver.htmlTemplate ?? null;
      versionUsed = Number(ver.version);
      if (ver.variablesJson) {
        declaredVariables.push(...safeJsonParseStringArray(ver.variablesJson));
      }
    } else {
      subjectTemplate = subjectTemplate ?? tpl.subjectTemplate ?? null;
      bodyTemplate = bodyTemplate || tpl.bodyTemplate;
      htmlTemplate = htmlTemplate ?? tpl.htmlTemplate ?? null;
      versionUsed = Number(tpl.publishedVersion ?? tpl.version ?? 1);
      if (tpl.variablesJson) {
        declaredVariables.push(...safeJsonParseStringArray(tpl.variablesJson));
      }
    }
  } else if (code && !bodyTemplate) {
    const dbExact = channelsRepo.findExactTemplateByCodeChannelLocale
      ? await channelsRepo.findExactTemplateByCodeChannelLocale(code, channel, locale)
      : null;

    if (dbExact && input.version && channelsRepo.findTemplateVersionByNumber) {
      await ensureBaselineVersionSnapshot(dbExact, channelsRepo);
      const ver = await channelsRepo.findTemplateVersionByNumber(Number(dbExact.id), input.version);
      if (!ver) {
        throw new NotFoundAppException('notifications.templateVersionNotFound', {
          templateId: dbExact.id,
          version: input.version,
        });
      }
      subjectTemplate = ver.subjectTemplate ?? null;
      bodyTemplate = ver.bodyTemplate;
      htmlTemplate = ver.htmlTemplate ?? null;
      versionUsed = Number(ver.version);
      rawTemplateType = ver.templateType ?? null;
      rawDocFormat = ver.documentFormat ?? null;
      if (ver.variablesJson) {
        declaredVariables.push(...safeJsonParseStringArray(ver.variablesJson));
      }
    } else {
      const resolved = await resolveTemplateByCode(code, channel, locale);
      if (!resolved) {
        throw new NotFoundAppException('notifications.templateNotFound', { code });
      }
      subjectTemplate = resolved.subjectTemplate;
      bodyTemplate = resolved.bodyTemplate;
      htmlTemplate = resolved.htmlTemplate;
      versionUsed = dbExact ? Number(dbExact.publishedVersion ?? dbExact.version ?? 1) : 1;
      if (dbExact?.variablesJson) {
        declaredVariables.push(...safeJsonParseStringArray(dbExact.variablesJson));
      }
    }
  }

  if (!bodyTemplate) {
    throw new BadRequestAppException('notifications.templateBodyRequired');
  }

  const { templateType, documentFormat } = resolveTemplateTypeAndFormat({
    channel,
    templateType: rawTemplateType,
    documentFormat: rawDocFormat,
  });

  const rendered = renderNotificationTemplateContent({
    subjectTemplate,
    bodyTemplate,
    htmlTemplate,
    variables: input.variables ?? {},
    declaredVariables,
  });

  const smsSegs = calculateSmsSegments(rendered.renderedBody);

  return {
    code,
    channel,
    channelName: getNotificationChannelName(channel),
    locale,
    templateType,
    documentFormat,
    version: versionUsed,
    extractedVariables: rendered.extractedVariables,
    renderedSubject: rendered.renderedSubject,
    renderedBody: rendered.renderedBody,
    renderedHtml: rendered.renderedHtml,
    missingVariables: rendered.missingVariables,
    smsSegmentsCount: smsSegs.segmentsCount,
  };
}

export async function executeRenderDocumentFromTemplate(params: {
  input: RenderDocumentFromTemplateRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  recordAudit: AuditRecorderFn;
}): Promise<RenderedDocumentFromTemplateResponse> {
  const { input, actor, channelsRepo, recordAudit } = params;
  const locale = input.locale?.trim().toLowerCase() || 'vi';
  let templateId: number | null = input.templateId ?? null;
  let templateCode = input.templateCode?.trim().toUpperCase() || '';
  let versionUsed = input.version ?? 1;
  let subjectTemplate: string | null = null;
  let bodyTemplate = '';
  let htmlTemplate: string | null = null;
  let declaredVariables: string[] = [];
  let documentFormat: NotificationDocumentFormatName =
    normalizeDocumentFormat(input.outputFormat) ?? NOTIFICATION_DOCUMENT_FORMAT.HTML;

  if (templateId) {
    const tpl = await channelsRepo.findTemplateById(templateId);
    if (!tpl) {
      throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
    }
    templateCode = tpl.code;
    if (input.version && channelsRepo.findTemplateVersionByNumber) {
      await ensureBaselineVersionSnapshot(tpl, channelsRepo);
      const ver = await channelsRepo.findTemplateVersionByNumber(templateId, input.version);
      if (!ver) {
        throw new NotFoundAppException('notifications.templateVersionNotFound', {
          templateId,
          version: input.version,
        });
      }
      versionUsed = Number(ver.version);
      subjectTemplate = ver.subjectTemplate ?? null;
      bodyTemplate = ver.bodyTemplate;
      htmlTemplate = ver.htmlTemplate ?? null;
      declaredVariables = ver.variablesJson ? safeJsonParseStringArray(ver.variablesJson) : [];
      if (!input.outputFormat && ver.documentFormat) {
        documentFormat =
          normalizeDocumentFormat(ver.documentFormat) ?? NOTIFICATION_DOCUMENT_FORMAT.HTML;
      }
    } else {
      versionUsed = Number(tpl.publishedVersion ?? tpl.version ?? 1);
      subjectTemplate = tpl.subjectTemplate ?? null;
      bodyTemplate = tpl.bodyTemplate;
      htmlTemplate = tpl.htmlTemplate ?? null;
      declaredVariables = tpl.variablesJson ? safeJsonParseStringArray(tpl.variablesJson) : [];
      if (!input.outputFormat && tpl.documentFormat) {
        documentFormat =
          normalizeDocumentFormat(tpl.documentFormat) ?? NOTIFICATION_DOCUMENT_FORMAT.HTML;
      }
    }
  } else if (templateCode) {
    const dbTpl = await channelsRepo.findTemplateByCodeChannelLocale(
      templateCode,
      NOTIFICATION_CHANNEL.DOCUMENT,
      locale,
    );
    if (dbTpl) {
      templateId = Number(dbTpl.id);
      if (input.version && channelsRepo.findTemplateVersionByNumber) {
        await ensureBaselineVersionSnapshot(dbTpl, channelsRepo);
        const ver = await channelsRepo.findTemplateVersionByNumber(templateId, input.version);
        if (!ver) {
          throw new NotFoundAppException('notifications.templateVersionNotFound', {
            templateId,
            version: input.version,
          });
        }
        versionUsed = Number(ver.version);
        subjectTemplate = ver.subjectTemplate ?? null;
        bodyTemplate = ver.bodyTemplate;
        htmlTemplate = ver.htmlTemplate ?? null;
        declaredVariables = ver.variablesJson ? safeJsonParseStringArray(ver.variablesJson) : [];
      } else {
        versionUsed = Number(dbTpl.publishedVersion ?? dbTpl.version ?? 1);
        subjectTemplate = dbTpl.subjectTemplate ?? null;
        bodyTemplate = dbTpl.bodyTemplate;
        htmlTemplate = dbTpl.htmlTemplate ?? null;
        declaredVariables = dbTpl.variablesJson
          ? safeJsonParseStringArray(dbTpl.variablesJson)
          : [];
      }
      if (!input.outputFormat && dbTpl.documentFormat) {
        documentFormat =
          normalizeDocumentFormat(dbTpl.documentFormat) ?? NOTIFICATION_DOCUMENT_FORMAT.HTML;
      }
    } else {
      const seed =
        DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find(
          (t) =>
            t.code === templateCode &&
            t.channel === NOTIFICATION_CHANNEL.DOCUMENT &&
            t.locale === locale,
        ) ?? DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find((t) => t.code === templateCode);

      if (!seed) {
        throw new NotFoundAppException('notifications.templateNotFound', { code: templateCode });
      }
      subjectTemplate = seed.subjectTemplate;
      bodyTemplate = seed.bodyTemplate;
      htmlTemplate = seed.htmlTemplate;
      declaredVariables = [...seed.variables];
      if (!input.outputFormat && seed.documentFormat) {
        documentFormat = seed.documentFormat;
      }
    }
  } else {
    throw new BadRequestAppException('notifications.documentTemplateCodeRequired');
  }

  if (input.referenceModule?.trim() && channelsRepo.upsertTemplateUsage) {
    await channelsRepo.upsertTemplateUsage({
      templateCode,
      channel: NOTIFICATION_CHANNEL.DOCUMENT,
      moduleName: input.referenceModule.trim().toLowerCase(),
      featureCode: input.referenceFeature?.trim() || 'document_generation',
      entityType: 'document_render',
      entityId: templateCode,
      description: `Sinh tài liệu ${documentFormat} từ module ${input.referenceModule.trim()}`,
      createdByUserId: parseNumericUserId(actor?.id) ?? null,
    });
  }

  const payload = buildRenderedDocumentPayload({
    templateId,
    templateCode,
    locale,
    versionUsed,
    documentFormat,
    subjectTemplate,
    bodyTemplate,
    htmlTemplate,
    declaredVariables,
    variables: input.variables ?? {},
    customFileName: input.fileName ?? null,
  });

  await recordAudit(
    actor,
    'RENDER_DOCUMENT_FROM_TEMPLATE',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE,
    `${templateCode}:v${versionUsed}`,
    null,
    {
      templateId,
      templateCode,
      locale,
      versionUsed,
      documentFormat,
      fileName: payload.fileName,
      sizeBytes: payload.sizeBytes,
      missingVariables: payload.missingVariables,
    },
  );

  return payload;
}

export async function executeListTemplateUsages(params: {
  templateId: number;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
}): Promise<NotificationTemplateUsageItemResponse[]> {
  const { templateId, channelsRepo, mapper } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }

  const dbUsages = channelsRepo.findTemplateUsagesByCode
    ? await channelsRepo.findTemplateUsagesByCode(template.code, Number(template.channel))
    : [];

  const views = dbUsages.map((u) => mapper.toTemplateUsageItemView(u));
  const existingKeys = new Set(
    views.map((v) => `${v.moduleName.toLowerCase()}:${v.featureCode.toLowerCase()}`),
  );

  const seedMatches = DEFAULT_SYSTEM_TEMPLATE_USAGES.filter(
    (s) =>
      s.templateCode === template.code.trim().toUpperCase() &&
      (s.channel === null || s.channel === undefined || s.channel === Number(template.channel)),
  );

  for (let i = 0; i < seedMatches.length; i++) {
    const s = seedMatches[i]!;
    const key = `${s.moduleName.toLowerCase()}:${s.featureCode.toLowerCase()}`;
    if (!existingKeys.has(key)) {
      const ch = s.channel ? parseNotificationChannel(s.channel) : null;
      views.push({
        id: -(i + 1),
        templateCode: s.templateCode,
        channel: ch,
        channelName: ch ? getNotificationChannelName(ch) : 'ALL',
        moduleName: s.moduleName,
        featureCode: s.featureCode,
        entityType: s.entityType,
        entityId: s.entityId,
        description: s.description,
        isActive: true,
        createdByUserId: null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return views;
}

export async function executeRegisterTemplateUsage(params: {
  templateId: number;
  input: RegisterNotificationTemplateUsageRequest;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  mapper: NotificationsMapper;
  recordAudit: AuditRecorderFn;
}): Promise<NotificationTemplateUsageItemResponse> {
  const { templateId, input, actor, channelsRepo, mapper, recordAudit } = params;
  const template = await channelsRepo.findTemplateById(templateId);
  if (!template) {
    throw new NotFoundAppException('notifications.templateNotFound', { id: templateId });
  }

  const saved = await channelsRepo.upsertTemplateUsage({
    templateCode: template.code,
    channel: Number(template.channel),
    moduleName: input.moduleName,
    featureCode: input.featureCode,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    description: input.description ?? null,
    createdByUserId: parseNumericUserId(actor?.id) ?? null,
  });

  await recordAudit(
    actor,
    'REGISTER_NOTIFICATION_TEMPLATE_USAGE',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_USAGE,
    String(saved.id),
    null,
    {
      templateCode: saved.templateCode,
      channel: saved.channel,
      moduleName: saved.moduleName,
      featureCode: saved.featureCode,
    },
  );

  return mapper.toTemplateUsageItemView(saved);
}

export async function executeUnregisterTemplateUsage(params: {
  usageId: number;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  recordAudit: AuditRecorderFn;
}): Promise<{ removed: true; id: number }> {
  const { usageId, actor, channelsRepo, recordAudit } = params;
  const removed = await channelsRepo.removeTemplateUsageById(usageId);
  if (!removed) {
    throw new NotFoundAppException('notifications.templateUsageNotFound', { id: usageId });
  }

  await recordAudit(
    actor,
    'UNREGISTER_NOTIFICATION_TEMPLATE_USAGE',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE_USAGE,
    String(usageId),
    {
      templateCode: removed.templateCode,
      moduleName: removed.moduleName,
      featureCode: removed.featureCode,
    },
    null,
  );

  return { removed: true, id: usageId };
}

export async function executeSafeDeleteTemplate(params: {
  id: number;
  actor?: UserIdentity | undefined;
  channelsRepo: NotificationChannelsRepository;
  recordAudit: AuditRecorderFn;
}): Promise<{ deleted: true; id: number }> {
  const { id, actor, channelsRepo, recordAudit } = params;
  const existing = await channelsRepo.findTemplateById(id);
  if (!existing) {
    throw new NotFoundAppException('notifications.templateNotFound', { id });
  }
  if (existing.isSystem) {
    throw new ForbiddenAppException('notifications.cannotDeleteSystemTemplate');
  }

  // Kiểm tra các module đang sử dụng mẫu để chặn xóa nhầm (Mục 9.6.8)
  const activeUsages = channelsRepo.findTemplateUsagesByCode
    ? await channelsRepo.findTemplateUsagesByCode(existing.code, Number(existing.channel))
    : [];
  const deliveryCount = channelsRepo.countDeliveriesByTemplateCode
    ? await channelsRepo.countDeliveriesByTemplateCode(existing.code, Number(existing.channel))
    : 0;

  const usedModules = new Set<string>(activeUsages.map((u) => u.moduleName));
  if (deliveryCount > 0) {
    usedModules.add('notifications');
  }

  if (usedModules.size > 0) {
    const modulesList = [...usedModules].join(', ');
    throw new ConflictAppException(
      `notifications.cannotDeleteTemplateInUse (${existing.code}: ${modulesList})`,
      [],
      {
        code: existing.code,
        modules: modulesList,
      },
    );
  }

  await channelsRepo.deleteTemplateById(id);
  await recordAudit(
    actor,
    'DELETE_NOTIFICATION_TEMPLATE',
    NOTIFICATIONS_AUDIT_META.ENTITY_TEMPLATE,
    String(id),
    {
      code: existing.code,
      channel: existing.channel,
      locale: existing.locale,
      version: existing.version,
    },
    null,
  );

  return { deleted: true, id };
}
